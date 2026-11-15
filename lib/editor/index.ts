/**
 * Drag editor (拖拽编辑器) — implementation of contract v1.0.0
 * (lib/editor/contract.ts, orchestrator-owned).
 *
 * A pure document model + reducer. Positions are sim-core cm (origin centre
 * of the substrate plane, x left→right, z back→front).
 *
 * Preview bookkeeping: the contract's EditorState has no slot for the
 * pre-drag doc that `commitPreview` / `cancelPreview` need, so the reducer
 * keeps it in an extra optional field `previewBase` (see EditorStateWithPreview).
 * States without it are exactly contract EditorStates.
 */
import type { EditTarget, HardscapeVisual, StoneRole } from "@aquascape-studio/render"
import plantsJson from "../sim/vendor/plants.json"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"
import type { InstantiatedTemplate } from "../templates/contract"
import type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
import { footprintContains } from "./footprint"

export type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
export { EDITOR_CONTRACT_VERSION } from "./contract"
export { footprintContains, footprintDistance } from "./footprint"

/** sim budget (contract) */
export const MAX_PLANTS = 60
/** undo depth (contract) */
export const HISTORY_CAP = 100
/** positions are clamped this far inside the glass (contract) */
export const GLASS_MARGIN_CM = 1
/** plants may not be dropped within this margin of a stone footprint (contract) */
export const STONE_MARGIN_CM = 0.5
/** keyboard [ / ] rotation step: 15° */
export const ROTATE_STEP_RAD = Math.PI / 12
/** keyboard arrow nudge (shift = NUDGE_FAST_CM) */
export const NUDGE_CM = 1
export const NUDGE_FAST_CM = 5
/** decode guard: hardscape pieces per doc */
export const MAX_HARDSCAPE = 24
/** decode guard: longest accepted ?scape= value */
export const MAX_ENCODED_LENGTH = 8000

const KNOWN_SPECIES: ReadonlySet<string> = new Set((plantsJson as unknown as { id: string }[]).map((p) => p.id))

/** true when `id` exists in the vendored botany plants.json */
export function isKnownSpecies(id: string): boolean {
  return KNOWN_SPECIES.has(id)
}

/** Reducer state; `previewBase` is the pre-drag doc while a preview is active. */
export interface EditorStateWithPreview extends EditorState {
  previewBase?: ScapeDoc | undefined
}

export function initEditor(doc: ScapeDoc): EditorState {
  return { doc, past: [], future: [], selected: null }
}

/** true while a drag / nudge preview is active */
export function isPreviewing(s: EditorState): boolean {
  return (s as EditorStateWithPreview).previewBase !== undefined
}

/** the last committed doc (the pre-drag doc while previewing) — what the sim runs */
export function committedDoc(s: EditorState): ScapeDoc {
  return (s as EditorStateWithPreview).previewBase ?? s.doc
}

export function canUndo(s: EditorState): boolean {
  return s.past.length > 0
}

export function canRedo(s: EditorState): boolean {
  return s.future.length > 0
}

// ---------------------------------------------------------------------------
// geometry helpers

function clampPos(tank: TankDims, x: number, z: number): [number, number] {
  const xMax = Math.max(0, tank.widthCm / 2 - GLASS_MARGIN_CM)
  const zMax = Math.max(0, tank.depthCm / 2 - GLASS_MARGIN_CM)
  return [Math.min(xMax, Math.max(-xMax, x)), Math.min(zMax, Math.max(-zMax, z))]
}

/** true when a planted (y = 0) plant may not stand at (x, z): inside a stone footprint + 0.5 cm */
export function blockedByStone(doc: Pick<ScapeDoc, "hardscape">, x: number, z: number): boolean {
  return doc.hardscape.some((h) => h.kind === "stone" && footprintContains(h, x, z, STONE_MARGIN_CM))
}

function onAnyHardscape(doc: Pick<ScapeDoc, "hardscape">, x: number, z: number): boolean {
  return doc.hardscape.some((h) => footprintContains(h, x, z, 0))
}

/** epiphytes (y > 0) tied onto `h`: their (x, z) lie inside its footprint */
function epiphytesOn(doc: ScapeDoc, h: HardscapeVisual): Set<string> {
  return new Set(doc.plants.filter((p) => p.y > 0 && footprintContains(h, p.x, p.z, 0)).map((p) => p.id))
}

function normAngle(a: number): number {
  let r = a % (2 * Math.PI)
  if (r > Math.PI) r -= 2 * Math.PI
  if (r <= -Math.PI) r += 2 * Math.PI
  return r
}

/** current position of an edit target, or null when it does not exist */
export function targetPosition(doc: ScapeDoc, t: EditTarget): { x: number; z: number } | null {
  const item = t.kind === "plant" ? doc.plants.find((p) => p.id === t.id) : doc.hardscape.find((h) => h.id === t.id)
  return item ? { x: item.x, z: item.z } : null
}

function targetExists(doc: ScapeDoc, t: EditTarget): boolean {
  return targetPosition(doc, t) !== null
}

function sameTarget(a: EditTarget | null, b: EditTarget | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id)
}

function docsEqual(a: ScapeDoc, b: ScapeDoc): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Nearest spot to (x, z) where a planted plant may stand (outward spiral, 1 cm
 * rings), or null if the whole tank is covered. For "add at tank centre".
 */
export function findFreeSpot(doc: ScapeDoc, x: number, z: number): { x: number; z: number } | null {
  const maxR = Math.hypot(doc.tank.widthCm, doc.tank.depthCm)
  for (let r = 0; r <= maxR; r += 1) {
    const steps = r === 0 ? 1 : Math.max(8, Math.ceil(2 * Math.PI * r))
    for (let k = 0; k < steps; k++) {
      const th = (k / steps) * 2 * Math.PI
      const [cx, cz] = clampPos(doc.tank, x + r * Math.cos(th), z + r * Math.sin(th))
      if (!blockedByStone(doc, cx, cz)) return { x: cx, z: cz }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// ops — each returns a new doc, or null for a no-op (rejected / not found)

function movePlant(doc: ScapeDoc, id: string, x: number, z: number): ScapeDoc | null {
  const p = doc.plants.find((pp) => pp.id === id)
  if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return null
  const [cx, cz] = clampPos(doc.tank, x, z)
  // an epiphyte keeps its height only while it stays on a hardscape piece; off it, it is planted (y = 0)
  const y = p.y > 0 && onAnyHardscape(doc, cx, cz) ? p.y : 0
  if (y === 0 && blockedByStone(doc, cx, cz)) return null
  return { ...doc, plants: doc.plants.map((pp) => (pp.id === id ? { ...pp, x: cx, z: cz, y } : pp)) }
}

function moveHardscape(doc: ScapeDoc, id: string, x: number, z: number): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h || !Number.isFinite(x) || !Number.isFinite(z)) return null
  const [cx, cz] = clampPos(doc.tank, x, z)
  const dx = cx - h.x
  const dz = cz - h.z
  const carried = epiphytesOn(doc, h)
  return {
    ...doc,
    hardscape: doc.hardscape.map((hh) => (hh.id === id ? { ...hh, x: cx, z: cz } : hh)),
    // nothing carried: keep the plants array itself, so views keyed on it do not re-layout
    plants: carried.size === 0 ? doc.plants : doc.plants.map((p) => {
      if (!carried.has(p.id)) return p
      const [px, pz] = clampPos(doc.tank, p.x + dx, p.z + dz)
      return { ...p, x: px, z: pz }
    }),
  }
}

function move(doc: ScapeDoc, t: EditTarget, x: number, z: number): ScapeDoc | null {
  return t.kind === "plant" ? movePlant(doc, t.id, x, z) : moveHardscape(doc, t.id, x, z)
}

function rotate(doc: ScapeDoc, id: string, dRad: number): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h || !Number.isFinite(dRad) || dRad === 0) return null
  const carried = epiphytesOn(doc, h)
  // rotate carried epiphytes about the piece's centre by Ry(dRad) so they keep their local position
  const c = Math.cos(dRad)
  const s = Math.sin(dRad)
  return {
    ...doc,
    hardscape: doc.hardscape.map((hh) => (hh.id === id ? { ...hh, rotationY: normAngle(hh.rotationY + dRad) } : hh)),
    plants: doc.plants.map((p) => {
      if (!carried.has(p.id)) return p
      const dx = p.x - h.x
      const dz = p.z - h.z
      const [px, pz] = clampPos(doc.tank, h.x + c * dx + s * dz, h.z - s * dx + c * dz)
      return { ...p, x: px, z: pz }
    }),
  }
}

function remove(doc: ScapeDoc, t: EditTarget): ScapeDoc | null {
  if (t.kind === "plant") {
    if (!doc.plants.some((p) => p.id === t.id)) return null
    return { ...doc, plants: doc.plants.filter((p) => p.id !== t.id) }
  }
  const h = doc.hardscape.find((hh) => hh.id === t.id)
  if (!h) return null
  const hardscape = doc.hardscape.filter((hh) => hh.id !== t.id)
  const carried = epiphytesOn(doc, h)
  // epiphytes that were tied onto the removed piece drop onto the bed (unless another piece holds them)
  const plants = doc.plants.map((p) =>
    carried.has(p.id) && !hardscape.some((hh) => footprintContains(hh, p.x, p.z, 0)) ? { ...p, y: 0 } : p,
  )
  return { ...doc, hardscape, plants }
}

/** smallest unused n for "<speciesId>-<n>" */
export function nextPlantId(doc: Pick<ScapeDoc, "plants">, speciesId: string): string {
  const ids = new Set(doc.plants.map((p) => p.id))
  let n = 1
  while (ids.has(`${speciesId}-${n}`)) n++
  return `${speciesId}-${n}`
}

function addPlant(doc: ScapeDoc, speciesId: string, x: number, z: number, portions: number | undefined): ScapeDoc | null {
  if (doc.plants.length >= MAX_PLANTS || !isKnownSpecies(speciesId)) return null
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const [cx, cz] = clampPos(doc.tank, x, z)
  if (blockedByStone(doc, cx, cz)) return null
  const n = portions === undefined || !Number.isFinite(portions) ? 1 : Math.min(99, Math.max(1, Math.round(portions)))
  const plant: PlantPlacement = { id: nextPlantId(doc, speciesId), speciesId, x: cx, z: cz, y: 0, portions: n }
  return { ...doc, plants: [...doc.plants, plant] }
}

function applyOp(doc: ScapeDoc, op: EditOp): ScapeDoc | null {
  switch (op.type) {
    case "move":
      return move(doc, op.target, op.x, op.z)
    case "rotate":
      return rotate(doc, op.id, op.dRad)
    case "remove":
      return remove(doc, op.target)
    case "addPlant":
      return addPlant(doc, op.speciesId, op.x, op.z, op.portions)
    case "replace":
      return op.doc
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// reducer

function pushCapped(list: readonly ScapeDoc[], doc: ScapeDoc): ScapeDoc[] {
  const out = [...list, doc]
  return out.length > HISTORY_CAP ? out.slice(out.length - HISTORY_CAP) : out
}

function keepSelection(doc: ScapeDoc, sel: EditTarget | null): EditTarget | null {
  return sel && targetExists(doc, sel) ? sel : null
}

function plain(doc: ScapeDoc, past: ScapeDoc[], future: ScapeDoc[], selected: EditTarget | null): EditorState {
  return { doc, past, future, selected }
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  const base = (s as EditorStateWithPreview).previewBase
  switch (a.type) {
    case "apply": {
      // ops apply to the committed doc: an active preview is discarded first
      const cur = base ?? s.doc
      const next = applyOp(cur, a.op)
      if (!next || docsEqual(next, cur)) return s
      let selected = keepSelection(next, s.selected)
      if (a.op.type === "addPlant") {
        const added = next.plants[next.plants.length - 1]
        if (added) selected = { kind: "plant", id: added.id }
      }
      return plain(next, pushCapped(s.past, cur), [], selected)
    }
    case "preview": {
      const from = base ?? s.doc
      const next = move(from, a.target, a.x, a.z)
      if (!next || docsEqual(next, s.doc)) return s
      const out: EditorStateWithPreview = { doc: next, past: s.past, future: s.future, selected: s.selected, previewBase: from }
      return out
    }
    case "commitPreview": {
      if (!base) return s
      // a drag that ended where it started changes nothing: drop the preview, keep history as is
      if (docsEqual(s.doc, base)) return plain(base, s.past, s.future, s.selected)
      return plain(s.doc, pushCapped(s.past, base), [], s.selected)
    }
    case "cancelPreview": {
      if (!base) return s
      return plain(base, s.past, s.future, keepSelection(base, s.selected))
    }
    case "select": {
      if (sameTarget(a.target, s.selected)) return s
      if (a.target !== null && !targetExists(s.doc, a.target)) return s
      const out: EditorStateWithPreview = { ...(s as EditorStateWithPreview), selected: a.target }
      return out
    }
    case "undo": {
      const cur = base ?? s.doc
      const prev = s.past[s.past.length - 1]
      if (!prev) return base ? plain(base, s.past, s.future, keepSelection(base, s.selected)) : s
      const future = [cur, ...s.future].slice(0, HISTORY_CAP)
      return plain(prev, s.past.slice(0, -1), future, keepSelection(prev, s.selected))
    }
    case "redo": {
      const cur = base ?? s.doc
      const next = s.future[0]
      if (!next) return base ? plain(base, s.past, s.future, keepSelection(base, s.selected)) : s
      return plain(next, pushCapped(s.past, cur), s.future.slice(1), keepSelection(next, s.selected))
    }
    default:
      return s
  }
}

// ---------------------------------------------------------------------------
// template → doc

export function docFromTemplate(inst: InstantiatedTemplate, tank: TankDims, templateId?: string): ScapeDoc {
  const doc: ScapeDoc = {
    v: 1,
    tank: { widthCm: tank.widthCm, depthCm: tank.depthCm, heightCm: tank.heightCm },
    bed: { frontCm: inst.bed.frontCm, backCm: inst.bed.backCm },
    focalPoint: { x: inst.focalPoint.x, y: inst.focalPoint.y },
    hardscape: inst.hardscape.map((h) => ({ ...h, sizeCm: [h.sizeCm[0], h.sizeCm[1], h.sizeCm[2]] })),
    plants: inst.plants.map((p) => ({ ...p })),
  }
  if (templateId !== undefined) doc.templateId = templateId
  return doc
}

// ---------------------------------------------------------------------------
// URL encoding
//
// base64url( UTF-8( JSON ) ) of a compact positional array (format v1):
//   [1, [W,D,H]·10, templateId | 0, [bedFront,bedBack]·10, [fx,fy]·10 | 0,
//    speciesIds[], hardscape[], plants[]]
//   hardscape: [id, kind (0 stone | 1 wood), x·10, z·10, rotY·100, w·10, h·10, d·10, seed, role (0 none | 1..4), buriedFrac·100 | -1]
//   plants:    flat, 5 numbers / strings per plant:
//              speciesIndex, id, x·10, z·10, y·10·100 + portions
//              id = 0 when it is `${speciesId}-${k}` with k = (plants of that species so far) + 1,
//              n when it is `${speciesId}-${n}`, otherwise the id string.

const ROLES: readonly StoneRole[] = ["oyaishi", "fukuishi", "soeishi", "suteishi"]
const q1 = (v: number) => Math.round(v * 10) + 0 // + 0 turns -0 into 0
const q2 = (v: number) => Math.round(v * 100) + 0

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw new Error("bad base64url")
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

export function encodeScape(doc: ScapeDoc): string {
  const species: string[] = []
  const sIdx = new Map<string, number>()
  for (const p of doc.plants) {
    if (!sIdx.has(p.speciesId)) {
      sIdx.set(p.speciesId, species.length)
      species.push(p.speciesId)
    }
  }
  const hs = doc.hardscape.map((h) => [
    h.id,
    h.kind === "wood" ? 1 : 0,
    q1(h.x),
    q1(h.z),
    q2(h.rotationY),
    q1(h.sizeCm[0]),
    q1(h.sizeCm[1]),
    q1(h.sizeCm[2]),
    Math.round(h.seed),
    h.role ? ROLES.indexOf(h.role) + 1 : 0,
    h.buriedFrac === undefined ? -1 : q2(h.buriedFrac),
  ])
  const plants: (number | string)[] = []
  const seen = new Map<string, number>()
  for (const p of doc.plants) {
    const k = (seen.get(p.speciesId) ?? 0) + 1
    seen.set(p.speciesId, k)
    const prefix = `${p.speciesId}-`
    const tail = p.id.startsWith(prefix) ? p.id.slice(prefix.length) : ""
    const idPart: number | string = tail === String(k) ? 0 : /^[1-9]\d{0,5}$/.test(tail) ? Number(tail) : p.id
    plants.push(sIdx.get(p.speciesId)!, idPart, q1(p.x), q1(p.z), q1(Math.max(0, p.y)) * 100 + Math.min(99, Math.max(1, Math.round(p.portions))))
  }
  const json = JSON.stringify([
    1,
    [q1(doc.tank.widthCm), q1(doc.tank.depthCm), q1(doc.tank.heightCm)],
    doc.templateId ?? 0,
    [q1(doc.bed.frontCm), q1(doc.bed.backCm)],
    doc.focalPoint ? [q1(doc.focalPoint.x), q1(doc.focalPoint.y)] : 0,
    species,
    hs,
    plants,
  ])
  return toBase64Url(json)
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)
const ID_RE = /^[A-Za-z0-9_.#:-]{1,80}$/

class Invalid extends Error {}
function check(cond: unknown): asserts cond {
  if (!cond) throw new Invalid()
}

export function decodeScape(s: string): ScapeDoc | null {
  try {
    check(typeof s === "string" && s.length > 0 && s.length <= MAX_ENCODED_LENGTH)
    const raw: unknown = JSON.parse(fromBase64Url(s))
    check(Array.isArray(raw) && raw.length === 8 && raw[0] === 1)
    const [, tankRaw, tplRaw, bedRaw, focalRaw, speciesRaw, hsRaw, plantsRaw] = raw as unknown[]

    check(Array.isArray(tankRaw) && tankRaw.length === 3 && tankRaw.every(isInt))
    const [W, D, H] = (tankRaw as number[]).map((v) => v / 10) as [number, number, number]
    // same ranges buildInput() accepts for ?w / ?d / ?h
    check(W >= 10 && W <= 300 && D >= 10 && D <= 150 && H >= 10 && H <= 120)
    const tank: TankDims = { widthCm: W, depthCm: D, heightCm: H }

    check(tplRaw === 0 || (typeof tplRaw === "string" && /^[a-z0-9-]{1,64}$/.test(tplRaw)))

    check(Array.isArray(bedRaw) && bedRaw.length === 2 && bedRaw.every(isInt))
    const [bf, bb] = (bedRaw as number[]).map((v) => v / 10) as [number, number]
    check(bf >= 0 && bb >= 0 && bf <= H && bb <= H)

    let focalPoint: { x: number; y: number } | undefined
    if (focalRaw !== 0) {
      check(Array.isArray(focalRaw) && focalRaw.length === 2 && focalRaw.every(isInt))
      const [fx, fy] = (focalRaw as number[]).map((v) => v / 10) as [number, number]
      check(Math.abs(fx) <= W && fy >= 0 && fy <= H)
      focalPoint = { x: fx, y: fy }
    }

    check(Array.isArray(speciesRaw) && speciesRaw.length <= MAX_PLANTS)
    const species = speciesRaw as unknown[]
    check(species.every((id) => typeof id === "string" && isKnownSpecies(id)))
    check(new Set(species).size === species.length)

    const [xMax, zMax] = [W / 2 - GLASS_MARGIN_CM, D / 2 - GLASS_MARGIN_CM]
    const inGlass = (x: number, z: number) => Math.abs(x) <= xMax + 0.05 && Math.abs(z) <= zMax + 0.05

    check(Array.isArray(hsRaw) && hsRaw.length <= MAX_HARDSCAPE)
    const hsIds = new Set<string>()
    const hardscape: HardscapeVisual[] = (hsRaw as unknown[]).map((e) => {
      check(Array.isArray(e) && e.length === 11)
      const [id, kind, x, z, rot, w, h, d, seed, role, buried] = e as unknown[]
      check(typeof id === "string" && ID_RE.test(id) && !hsIds.has(id))
      hsIds.add(id)
      check(kind === 0 || kind === 1)
      check([x, z, rot, w, h, d, seed, role, buried].every(isInt))
      const [xc, zc] = [(x as number) / 10, (z as number) / 10]
      check(inGlass(xc, zc))
      check(Math.abs(rot as number) <= 315) // |rotY| ≤ π (rounded)
      const size: [number, number, number] = [(w as number) / 10, (h as number) / 10, (d as number) / 10]
      check(size[0] > 0 && size[1] > 0 && size[2] > 0 && size[0] <= W && size[1] <= H && size[2] <= D)
      check((role as number) >= 0 && (role as number) <= ROLES.length)
      check(buried === -1 || ((buried as number) >= 0 && (buried as number) <= 60))
      const out: HardscapeVisual = {
        id,
        kind: kind === 1 ? "wood" : "stone",
        x: xc,
        z: zc,
        rotationY: (rot as number) / 100,
        sizeCm: size,
        seed: seed as number,
      }
      if ((role as number) > 0) out.role = ROLES[(role as number) - 1]!
      if (buried !== -1) out.buriedFrac = (buried as number) / 100
      return out
    })

    check(Array.isArray(plantsRaw) && plantsRaw.length % 5 === 0 && plantsRaw.length / 5 <= MAX_PLANTS)
    const flat = plantsRaw as unknown[]
    const ids = new Set<string>()
    const perSpecies = new Map<string, number>()
    const plants: PlantPlacement[] = []
    for (let i = 0; i < flat.length; i += 5) {
      const [si, idPart, x, z, yp] = flat.slice(i, i + 5)
      check(isInt(si) && si >= 0 && si < species.length)
      const speciesId = species[si] as string
      const k = (perSpecies.get(speciesId) ?? 0) + 1
      perSpecies.set(speciesId, k)
      let id: string
      if (isInt(idPart)) {
        check(idPart >= 0)
        id = `${speciesId}-${idPart === 0 ? k : idPart}`
      } else {
        check(typeof idPart === "string" && ID_RE.test(idPart))
        id = idPart
      }
      check(!ids.has(id))
      ids.add(id)
      check(isInt(x) && isInt(z) && isInt(yp) && yp >= 0)
      const portions = yp % 100
      const [xc, zc, yc] = [x / 10, z / 10, Math.floor(yp / 100) / 10]
      check(inGlass(xc, zc) && yc <= H)
      check(portions >= 1)
      plants.push({ id, speciesId, x: xc, z: zc, y: yc, portions })
    }

    const doc: ScapeDoc = { v: 1, tank, bed: { frontCm: bf, backCm: bb }, hardscape, plants }
    if (typeof tplRaw === "string") doc.templateId = tplRaw
    if (focalPoint) doc.focalPoint = focalPoint
    return doc
  } catch {
    return null
  }
}
