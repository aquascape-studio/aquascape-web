/**
 * composeScape (compose contract 1.1.0): ScapeIntent → a complete ScapeDoc.
 * 1.1.0: every composed doc carries `conditions` (resolveConditions) — the
 * light / CO2 the sim runs with — and the species filters use them.
 *
 * Built only from existing pieces — templates instantiate() +
 * docFromTemplate(), and every change after that goes through the editor
 * reducer (remove / addHardscape / setWoodStyle / addPlant / attachPlant), so
 * the editor invariants hold by construction. Species swaps keep positions
 * and rename ids "<speciesId>-<n>"; the doc is finally passed through
 * sanitizeDoc() (the 1.2.2 "replace" rules). Pure and deterministic in
 * (intent, seed); never throws.
 */
import type { HardscapeVisual, WoodStyle } from "@aquascape-studio/render"
import {
  MAX_PLANTS,
  STONE_MARGIN_CM,
  docFromTemplate,
  editorReducer,
  findHardscapeSpot,
  footprintContains,
  footprintsOverlap,
  hardscapeSpotCandidates,
  hostOf,
  initEditor,
  newHardscapePiece,
  nextPlantId,
  sanitizeDoc,
  type EditOp,
  type EditorState,
  type ScapeDoc,
  type TankConditions,
} from "../editor"
import type { TankDims } from "../sim/vendor/sim-core/contract"
import { TEMPLATES, getTemplate, instantiate, type ScapeTemplate } from "../templates"
import { DEFAULT_PRESET, TANK_PRESETS, type ComposeResult, type Feature, type ScapeIntent, type Substitution } from "./contract"
import { presetTank, tankLabel } from "./parse"
import { hasFeature, isRed, type SpeciesIndex, type SpeciesInfo } from "./species"

export const MAX_NOTES = 4
/** compose 1.1.0 mismatch note (light "High" without CO2) */
export const CO2_LIMITED_NOTE = "High light without CO2 — growth will be CO2-limited."

/**
 * Compose 1.1.0: the conditions a composed doc runs with —
 * light = intent.light ?? (co2 === false ? "Low" : template.light),
 * co2 = intent.co2 ?? (light === "High" (stated) ? true : template.co2).
 */
export function resolveConditions(intent: Pick<ScapeIntent, "light" | "co2">, template: Pick<ScapeTemplate, "light" | "co2">): TankConditions {
  return {
    light: intent.light ?? (intent.co2 === false ? "Low" : template.light),
    co2: intent.co2 ?? (intent.light === "High" ? true : template.co2),
  }
}
const FEATURES: readonly Feature[] = ["carpet", "moss", "epiphytes", "red", "stems", "crypts", "grass"]
const ZONES = ["foreground", "midground", "background", "attached"] as const
type Zone = "foreground" | "midground" | "background"

// ---------------------------------------------------------------------------
// intent hygiene (an LLM front-end may hand over anything)

function cleanIntent(raw: ScapeIntent): ScapeIntent {
  const i = (raw && typeof raw === "object" ? raw : {}) as Partial<ScapeIntent>
  const arr = <T,>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : [])
  const isFeature = (x: unknown): x is Feature => typeof x === "string" && (FEATURES as readonly string[]).includes(x)
  const isStr = (x: unknown): x is string => typeof x === "string"
  const t = i.tank
  const tankOk = !!t && [t.widthCm, t.depthCm, t.heightCm].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
  return {
    style: i.style === "iwagumi" || i.style === "nature" || i.style === "dutch" ? i.style : null,
    composition: (["triangle", "concave", "convex", "streets", "iwagumi"] as const).find((c) => c === i.composition) ?? null,
    tank: tankOk
      ? {
          widthCm: Math.min(180, Math.max(20, t!.widthCm)),
          depthCm: Math.min(75, Math.max(15, t!.depthCm)),
          heightCm: Math.min(70, Math.max(20, t!.heightCm)),
        }
      : null,
    tankPreset: typeof i.tankPreset === "string" && TANK_PRESETS[i.tankPreset] ? i.tankPreset : null,
    light: i.light === "Low" || i.light === "Medium" || i.light === "High" ? i.light : null,
    co2: i.co2 === true || i.co2 === false ? i.co2 : null,
    hardscape: i.hardscape === "stone" || i.hardscape === "wood" || i.hardscape === "both" || i.hardscape === "none" ? i.hardscape : null,
    woodStyle: i.woodStyle === "branchy" || i.woodStyle === "root" || i.woodStyle === "log" ? i.woodStyle : null,
    want: arr(i.want, isFeature),
    avoid: arr(i.avoid, isFeature),
    species: arr(i.species, isStr),
    avoidSpecies: arr(i.avoidSpecies, isStr),
    spans: Array.isArray(i.spans) ? i.spans : [],
    unknown: arr(i.unknown, isStr),
  }
}

// ---------------------------------------------------------------------------
// template choice

/**
 * Contract: exact (style, composition) match → style match → by hardscape
 * ("stone" → iwagumi-sanzon, "wood"/"both" → nature-triangle, "none" →
 * dutch-streets) → "nature-triangle". A stated composition without a style
 * matches on composition alone. `seed` picks among equally good matches.
 */
export function chooseTemplate(intent: Pick<ScapeIntent, "style" | "composition" | "hardscape">, seed = 0): ScapeTemplate {
  const s = Math.abs(Math.trunc(Number.isFinite(seed) ? seed : 0))
  const tiers: ScapeTemplate[][] = []
  if (intent.style || intent.composition) {
    tiers.push(TEMPLATES.filter((t) => (!intent.style || t.style === intent.style) && (!intent.composition || t.composition === intent.composition)))
  }
  if (intent.style) tiers.push(TEMPLATES.filter((t) => t.style === intent.style))
  const byHs = { stone: "iwagumi-sanzon", wood: "nature-triangle", both: "nature-triangle", none: "dutch-streets" } as const
  if (intent.hardscape) tiers.push([getTemplate(byHs[intent.hardscape])!].filter(Boolean))
  tiers.push([getTemplate("nature-triangle") ?? TEMPLATES[0]!])
  const pick = tiers.find((t) => t.length > 0)!
  return pick[s % pick.length]!
}

// ---------------------------------------------------------------------------
// helpers on docs

function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** apply one editor op; returns the new state (unchanged on a no-op) */
function op(s: EditorState, o: EditOp): EditorState {
  return editorReducer(s, { type: "apply", op: o })
}

const speciesIds = (doc: ScapeDoc) => [...new Set(doc.plants.map((p) => p.speciesId))]

/** rename every plant of `from` to `to` (same positions); attach keys follow the new ids */
function swapSpecies(doc: ScapeDoc, from: string, to: string): ScapeDoc {
  const ren = new Map<string, string>()
  const taken = { plants: doc.plants.filter((p) => p.speciesId !== from) }
  const plants = doc.plants.map((p) => {
    if (p.speciesId !== from) return p
    const id = nextPlantId(taken, to)
    taken.plants.push({ ...p, id, speciesId: to })
    ren.set(p.id, id)
    return { ...p, id, speciesId: to }
  })
  const attach = doc.attach ? Object.fromEntries(Object.entries(doc.attach).map(([k, v]) => [ren.get(k) ?? k, v])) : undefined
  const out: ScapeDoc = { ...doc, plants }
  if (attach) out.attach = attach
  return out
}

function dropSpecies(doc: ScapeDoc, id: string): ScapeDoc {
  const gone = new Set(doc.plants.filter((p) => p.speciesId === id).map((p) => p.id))
  const out: ScapeDoc = { ...doc, plants: doc.plants.filter((p) => !gone.has(p.id)) }
  if (doc.attach) {
    const a = Object.fromEntries(Object.entries(doc.attach).filter(([k]) => !gone.has(k)))
    if (Object.keys(a).length) out.attach = a
    else delete out.attach
  }
  return out
}

/** free room for `need` new plants: trim the largest planted groups (each keeps ≥ 2) */
function makeRoom(s: EditorState, need: number): EditorState {
  let st = s
  while (st.doc.plants.length + need > MAX_PLANTS) {
    const counts = new Map<string, string[]>()
    for (const p of st.doc.plants) if (hostOf(st.doc, p.id) === undefined) counts.set(p.speciesId, [...(counts.get(p.speciesId) ?? []), p.id])
    let best: string[] | null = null
    for (const ids of counts.values()) if (ids.length > 2 && (!best || ids.length > best.length)) best = ids
    if (!best) break
    st = op(st, { type: "remove", target: { kind: "plant", id: best[best.length - 1]! } })
  }
  return st
}

/** reference count for a new group in this tank (60 × 30 cm → ref), 2–12 */
function groupCount(tank: TankDims, ref: number): number {
  return Math.max(2, Math.min(12, Math.round((ref * tank.widthCm * tank.depthCm) / 1800)))
}

/** z band of a zone, cm (back → front) */
function band(tank: TankDims, zone: Zone): [number, number] {
  const D = tank.depthCm
  if (zone === "background") return [-D / 2 + 1.5, -D / 6]
  if (zone === "midground") return [-D / 6, D / 6]
  return [D / 6, D / 2 - 1.5]
}

/** add `n` placements of `speciesId` spread across the zone (addPlant ops; blocked spots retried) */
function addGroup(s: EditorState, speciesId: string, zone: Zone, n: number, seed: number, portions = 2): { state: EditorState; added: number } {
  let st = makeRoom(s, n)
  const room = Math.max(0, MAX_PLANTS - st.doc.plants.length)
  const want = Math.min(n, room)
  const rand = prng(hashStr(`${speciesId}|${zone}`) ^ seed)
  const { widthCm: W } = st.doc.tank
  const [z0, z1] = band(st.doc.tank, zone)
  const phase = rand()
  let added = 0
  for (let k = 0; k < want; k++) {
    for (let tries = 0; tries < 12; tries++) {
      const u = (phase + (k + tries * 0.37) * 0.6180339887) % 1
      const x = (u - 0.5) * (W - 3)
      const z = z0 + rand() * (z1 - z0)
      const next = op(st, { type: "addPlant", speciesId, x, z, portions })
      if (next !== st) {
        st = next
        added++
        break
      }
    }
  }
  return { state: st, added }
}

/** largest piece to tie epiphytes onto: wood first, then stone (by footprint area) */
function hostPiece(doc: ScapeDoc): HardscapeVisual | undefined {
  const area = (h: HardscapeVisual) => h.sizeCm[0] * h.sizeCm[2]
  const sorted = [...doc.hardscape].sort((a, b) => Number(b.kind === "wood") - Number(a.kind === "wood") || area(b) - area(a) || (a.id < b.id ? -1 : 1))
  return sorted[0]
}

function attachGroup(s: EditorState, speciesId: string, n: number): { state: EditorState; added: number } {
  const host = hostPiece(s.doc)
  if (!host) return { state: s, added: 0 }
  let st = makeRoom(s, n)
  let added = 0
  for (let k = 0; k < n; k++) {
    const next = op(st, { type: "attachPlant", speciesId, hardscapeId: host.id, portions: 1 })
    if (next === st) break
    st = next
    added++
  }
  return { state: st, added }
}

/** the zone a new planted group of `sp` goes to */
function zoneFor(sp: SpeciesInfo, prefer?: Zone): Zone {
  const pl = sp.placement
  if (prefer && pl.includes(prefer)) return prefer
  if (sp.growthForm === "carpeting" && pl.includes("foreground")) return "foreground"
  const byHeight: Zone = sp.maxHeightCm <= 10 ? "foreground" : sp.maxHeightCm <= 25 ? "midground" : "background"
  if (pl.includes(byHeight)) return byHeight
  return (["midground", "background", "foreground"] as const).find((z) => pl.includes(z)) ?? "background"
}

// ---------------------------------------------------------------------------

interface Ctx {
  index: SpeciesIndex
  intent: ScapeIntent
  seed: number
  lowCo2: boolean
  lowLight: boolean
  avoidSpecies: ReadonlySet<string>
}

/** why `sp` may not appear in this scape, or null */
function blockReason(ctx: Ctx, sp: SpeciesInfo): string | null {
  if (sp.regulated) return "regulated"
  if (ctx.avoidSpecies.has(sp.id) || ctx.intent.avoid.some((f) => hasFeature(sp, f))) return "excluded"
  if (ctx.lowCo2 && (sp.co2Min >= 10 || sp.difficulty >= 4)) return "needs CO2"
  if (ctx.lowLight && sp.lightMin > 40) return "needs high light"
  return null
}

const zonesOf = (sp: SpeciesInfo) => sp.placement.filter((z) => (ZONES as readonly string[]).includes(z))

/** same growthForm, overlapping zone, passes the filters; closest |maxHeightCm Δ| then id */
function substituteFor(ctx: Ctx, sp: SpeciesInfo, attached: boolean, extra?: (c: SpeciesInfo) => boolean): SpeciesInfo | undefined {
  const zones = zonesOf(sp)
  const overlap = (c: SpeciesInfo) => {
    const cz = zonesOf(c)
    return zones.length === 0 ? c.placement.some((z) => sp.placement.includes(z)) : cz.some((z) => zones.includes(z))
  }
  return ctx.index.species
    .filter((c) => c.id !== sp.id && c.growthForm === sp.growthForm && overlap(c) && !blockReason(ctx, c) && (!attached || c.attachable) && (!extra || extra(c)))
    .sort((a, b) => Math.abs(a.maxHeightCm - sp.maxHeightCm) - Math.abs(b.maxHeightCm - sp.maxHeightCm) || (a.id < b.id ? -1 : 1))[0]
}

/** deterministic pick among the allowed species matching `pred` (seed rotates among the best few) */
function pickSpecies(ctx: Ctx, pred: (c: SpeciesInfo) => boolean, salt: string): SpeciesInfo | undefined {
  const list = ctx.index.species.filter((c) => pred(c) && !blockReason(ctx, c)).sort((a, b) => a.difficulty - b.difficulty || (a.id < b.id ? -1 : 1))
  if (!list.length) return undefined
  const top = list.slice(0, Math.min(3, list.length))
  return top[(ctx.seed + (hashStr(salt) % 3)) % top.length]
}

export function composeScapeImpl(rawIntent: ScapeIntent, index: SpeciesIndex, rawSeed = 0): ComposeResult {
  const intent = cleanIntent(rawIntent)
  const seed = Math.abs(Math.trunc(Number.isFinite(rawSeed) ? rawSeed : 0)) % 0x7fffffff
  const notes: { p: number; text: string }[] = []
  const note = (p: number, text: string) => notes.push({ p, text })
  const substitutions: Substitution[] = []
  const nameOf = (id: string) => index.byId.get(id)?.name ?? id

  // 1. template + tank + conditions (1.1.0: the filters follow the resolved conditions)
  const template = chooseTemplate(intent, seed)
  const conditions = resolveConditions(intent, template)
  const ctx: Ctx = { index, intent, seed, lowCo2: !conditions.co2, lowLight: conditions.light === "Low", avoidSpecies: new Set(intent.avoidSpecies) }
  const tank: TankDims = intent.tank ?? presetTank(DEFAULT_PRESET)!
  if (!intent.tank) note(0, `Tank size not given — using ${TANK_PRESETS[DEFAULT_PRESET]!.label} (${tankLabel(tank)}).`)
  // after the missing-tank note, before everything else
  if (conditions.light === "High" && !conditions.co2) note(0.5, CO2_LIMITED_NOTE)
  let st = initEditor(docFromTemplate(instantiate(template, tank, seed), tank, template.id))

  // 2. hardscape override
  if (intent.hardscape === "none") {
    for (const h of [...st.doc.hardscape]) st = op(st, { type: "remove", target: { kind: "hardscape", id: h.id } })
  } else if ((intent.hardscape === "wood" || intent.hardscape === "both") && !st.doc.hardscape.some((h) => h.kind === "wood")) {
    st = addWood(st, intent.woodStyle ?? "root", note)
  }
  if (intent.woodStyle && intent.hardscape !== "none") {
    for (const h of st.doc.hardscape) if (h.kind === "wood" && (h.woodStyle ?? "branchy") !== intent.woodStyle) st = op(st, { type: "setWoodStyle", id: h.id, woodStyle: intent.woodStyle })
  }

  // 3. species substitution, per placement group (same species → same substitute)
  let doc = st.doc
  const dropped: { id: string; reason: string }[] = []
  for (const id of speciesIds(doc)) {
    const sp = index.byId.get(id)
    if (!sp) {
      doc = dropSpecies(doc, id)
      continue
    }
    const reason = blockReason(ctx, sp)
    if (!reason) continue
    const attached = doc.plants.some((p) => p.speciesId === id && hostOf(doc, p.id) !== undefined)
    const sub = substituteFor(ctx, sp, attached)
    if (sub && !speciesIds(doc).includes(sub.id)) {
      doc = swapSpecies(doc, id, sub.id)
      substitutions.push({ from: id, to: sub.id, reason })
    } else if (sub) {
      // the substitute is already in the scape: merge into it
      doc = swapSpecies(doc, id, sub.id)
      substitutions.push({ from: id, to: sub.id, reason })
    } else {
      doc = dropSpecies(doc, id)
      dropped.push({ id, reason })
    }
  }
  st = initEditor(doc)

  // 4. wanted features
  const has = (pred: (sp: SpeciesInfo) => boolean, attachedOnly = false) =>
    st.doc.plants.some((p) => {
      const sp = index.byId.get(p.speciesId)
      return !!sp && pred(sp) && (!attachedOnly || hostOf(st.doc, p.id) !== undefined)
    })
  for (const f of intent.want) {
    if (f === "carpet") {
      if (has((sp) => sp.growthForm === "carpeting")) continue
      const sp = pickSpecies(ctx, (c) => c.growthForm === "carpeting" && c.placement.includes("foreground"), "carpet")
      if (!sp) note(1, "No carpet plant fits these conditions.")
      else st = addGroup(st, sp.id, "foreground", groupCount(st.doc.tank, 8), seed).state
    } else if (f === "moss" || f === "epiphytes") {
      const form = f === "moss" ? "moss" : "epiphyte"
      if (has((sp) => sp.growthForm === form, true)) continue
      if (st.doc.hardscape.length === 0) {
        note(2, `No stone or wood to tie ${f === "moss" ? "moss" : "epiphytes"} onto.`)
        continue
      }
      const sp = pickSpecies(ctx, (c) => c.growthForm === form && c.attachable, f)
      const r = sp ? attachGroup(st, sp.id, 2) : null
      if (!sp || !r || r.added === 0) note(2, `Couldn't tie ${f === "moss" ? "moss" : "epiphytes"} onto the hardscape.`)
      else st = r.state
    } else if (f === "red") {
      if (has((sp) => sp.growthForm === "stem" && isRed(sp))) continue
      const stems = speciesIds(st.doc).filter((id) => index.byId.get(id)?.growthForm === "stem")
      let swapped = false
      for (const id of stems) {
        const sp = index.byId.get(id)!
        const sub = substituteFor(ctx, sp, false, isRed)
        if (sub && !speciesIds(st.doc).includes(sub.id)) {
          st = initEditor(swapSpecies(st.doc, id, sub.id))
          swapped = true
          break
        }
      }
      if (!swapped) {
        const sp = pickSpecies(ctx, (c) => c.growthForm === "stem" && isRed(c) && (c.placement.includes("background") || c.placement.includes("midground")), "red")
        if (!sp) note(1, "No red stem fits these conditions.")
        else st = addGroup(st, sp.id, zoneFor(sp, "background"), groupCount(st.doc.tank, 4), seed).state
      }
    } else {
      const pred = (sp: SpeciesInfo) => hasFeature(sp, f)
      if (has(pred)) continue
      const prefer: Zone = f === "stems" ? "background" : f === "crypts" ? "midground" : "foreground"
      const sp = pickSpecies(ctx, (c) => pred(c) && c.placement.some((z) => z !== "floating"), f)
      if (!sp) note(1, `No ${f === "crypts" ? "crypt" : f === "stems" ? "stem plant" : "grass"} fits these conditions.`)
      else st = addGroup(st, sp.id, zoneFor(sp, prefer), groupCount(st.doc.tank, f === "grass" ? 6 : 4), seed).state
    }
  }

  // 5. explicitly named species: one group each (tied on when attachable and a host exists)
  for (const id of intent.species) {
    const named = index.byId.get(id)
    if (!named) continue
    let sp: SpeciesInfo | undefined = named
    const reason = blockReason(ctx, named)
    if (reason) {
      sp = substituteFor(ctx, named, false)
      if (sp) substitutions.push({ from: named.id, to: sp.id, reason })
      else {
        dropped.push({ id: named.id, reason })
        continue
      }
    }
    if (speciesIds(st.doc).includes(sp.id)) continue
    if (sp.attachable && st.doc.hardscape.length > 0) {
      const r = attachGroup(st, sp.id, 2)
      if (r.added > 0) {
        st = r.state
        continue
      }
    }
    const r = addGroup(st, sp.id, zoneFor(sp), groupCount(st.doc.tank, sp.growthForm === "carpeting" ? 6 : 3), seed + 1, sp.growthForm === "carpeting" ? 2 : 1)
    if (r.added === 0) note(3, `No room for ${sp.name}.`)
    st = r.state
  }

  if (dropped.length) {
    note(1, `Left out ${dropped.map((d) => `${nameOf(d.id)} (${d.reason})`).join(", ")} — no suitable substitute.`)
  }
  if (intent.unknown.length) {
    note(4, `Didn't understand: ${intent.unknown.slice(0, 6).map((w) => `“${w}”`).join(", ")}.`)
  }

  // 6. the "replace" invariants (sanitizeDoc → migrateAttach); keep the template id; 1.1.0 conditions
  const finalDoc = sanitizeDoc({ ...st.doc, templateId: template.id, conditions }) ?? { ...st.doc, conditions }
  return {
    doc: finalDoc,
    templateId: template.id,
    intent,
    substitutions,
    notes: notes
      .map((n, k) => ({ ...n, k }))
      .sort((a, b) => a.p - b.p || a.k - b.k)
      .slice(0, MAX_NOTES)
      .map((n) => n.text),
  }
}

/**
 * Adds one driftwood piece (root by default) via editor "addHardscape". When
 * every candidate spot is covered by planted plants (an Iwagumi carpet), the
 * first spot clear of other hardscape is used after removing the planted
 * plants under the new footprint.
 */
function addWood(s: EditorState, woodStyle: WoodStyle, note: (p: number, t: string) => void): EditorState {
  const spot = findHardscapeSpot(s.doc, "wood", woodStyle)
  if (spot) return op(s, { type: "addHardscape", kind: "wood", woodStyle, x: spot.x, z: spot.z })
  for (const c of hardscapeSpotCandidates(s.doc.tank)) {
    const piece = newHardscapePiece(s.doc, "wood", woodStyle, c.x, c.z)
    if (!piece || s.doc.hardscape.some((h) => footprintsOverlap(h, piece))) continue
    let st = s
    for (const p of s.doc.plants) {
      if (hostOf(s.doc, p.id) === undefined && footprintContains(piece, p.x, p.z, STONE_MARGIN_CM)) st = op(st, { type: "remove", target: { kind: "plant", id: p.id } })
    }
    const next = op(st, { type: "addHardscape", kind: "wood", woodStyle, x: c.x, z: c.z })
    if (next !== st) return next
  }
  note(3, "No free spot for driftwood.")
  return s
}
