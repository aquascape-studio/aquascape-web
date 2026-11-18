/**
 * Drag editor — implementation of contract v1.2.2
 * (lib/editor/contract.ts, orchestrator-owned).
 *
 * A pure document model + reducer. Positions are sim-core cm (origin centre
 * of the substrate plane, x left→right, z back→front).
 *
 * Preview bookkeeping (1.1.0): `EditorState.previewBase` holds the pre-drag
 * doc while a drag / nudge preview is active and is null otherwise; every
 * state this reducer returns has it set.
 *
 * Epiphytes (1.2.0): `ScapeDoc.attach` maps plantId → hardscapeId. Every op
 * works on a migrated doc (migrateAttach) and keeps the invariants: attach
 * keys are existing plants, values existing pieces; attached plants sit on
 * their host's surface (y > 0, lib/editor/surface.ts); every other plant has
 * y = 0. An empty attach map is normalised to `undefined`.
 *
 * 1.2.2: root-wood lean sides are frozen (addHardscape / setWoodStyle → root /
 * a committed move of an "auto" piece store the resolved side);
 * migrateAttach only attaches canAttach species and drops other lifted
 * plants onto the bed; ANCHORS_PER_HOST = 12 is shared with the templates;
 * "replace" sanitises the incoming doc (sanitizeDoc) before migrating it.
 */
import type { EditTarget, HardscapeVisual, LeanSide, StoneRole, WoodStyle } from "@aquascape-studio/render"
import { clampHardscapeXZ as renderClampHardscapeXZ, resolveLeanSide } from "@aquascape-studio/render"
import plantsJson from "../sim/vendor/plants.json"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"
import type { InstantiatedTemplate } from "../templates/contract"
import type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
import { footprintContains, footprintHalfExtents } from "./footprint"
import { ANCHORS_PER_HOST, anchors, surfaceY, type SurfaceAnchor } from "./surface"

export type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
export { EDITOR_CONTRACT_VERSION } from "./contract"
export { footprintContains, footprintDistance, footprintHalfExtents } from "./footprint"
export { ANCHORS_PER_HOST } from "./surface"
/** 1.2.2: render 1.4.1 — what "auto" (or an explicit side) resolves to */
export { resolveLeanSide } from "@aquascape-studio/render"
/** 1.1.0 objection (normative in 1.2.0): the render implementation, no local copy */
export { clampHardscapeXZ } from "@aquascape-studio/render"

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
/** addHardscape: at most this many pieces (contract 1.1.0) */
export const MAX_HARDSCAPE_PIECES = 12
/** keyboard "-" / "=" ("+") and the toolbar −/+ pills: ×0.9 / ×1.1 (contract 1.1.0) */
export const RESIZE_DOWN = 0.9
export const RESIZE_UP = 1.1
/** smallest hardscape axis (contract 1.1.0) */
export const MIN_HARDSCAPE_CM = 2
export const WOOD_STYLES: readonly WoodStyle[] = ["branchy", "root", "log"]
/** 1.2.0 root-wood lean directions */
export const LEAN_SIDES: readonly LeanSide[] = ["auto", "left", "right"]
/** decode guard: longest accepted ?scape= value */
export const MAX_ENCODED_LENGTH = 8000
/** 1.2.0: an anchor within this distance of an attached plant is taken */
export const ANCHOR_TAKEN_CM = 3
/** 1.2.0: a moved attached plant stays inside its host's footprint shrunk by this */
export const HOST_INSET_CM = 0.5
/** 1.2.0: detached plants drop this far in front of the host's front edge */
export const DETACH_FRONT_CM = 2
/** attached plants always sit at least this high (survives 0.1 cm link rounding) */
export const MIN_ATTACHED_Y = 0.1

interface BotanyLite {
  id: string
  growthForm: string
  placement?: string[]
}
const BOTANY = plantsJson as unknown as BotanyLite[]
const KNOWN_SPECIES: ReadonlySet<string> = new Set(BOTANY.map((p) => p.id))
const ATTACHABLE: ReadonlySet<string> = new Set(
  BOTANY.filter((p) => (p.growthForm === "epiphyte" || p.growthForm === "moss") && (p.placement ?? []).includes("attached")).map((p) => p.id),
)

/** true when `id` exists in the vendored botany plants.json */
export function isKnownSpecies(id: string): boolean {
  return KNOWN_SPECIES.has(id)
}

/** 1.2.0: botany growthForm "epiphyte" | "moss" AND placement includes "attached" */
export function canAttach(speciesId: string): boolean {
  return ATTACHABLE.has(speciesId)
}

/** every species canAttach() accepts, in botany order */
export function attachableSpeciesIds(): string[] {
  return BOTANY.filter((p) => ATTACHABLE.has(p.id)).map((p) => p.id)
}

export function initEditor(doc: ScapeDoc): EditorState {
  return { doc, past: [], future: [], selected: null, previewBase: null }
}

/** true while a drag / nudge preview is active (1.0.0-shaped states without previewBase: false) */
export function isPreviewing(s: EditorState): boolean {
  return s.previewBase != null
}

/** the last committed doc (the pre-drag doc while previewing) — what the sim runs */
export function committedDoc(s: EditorState): ScapeDoc {
  return s.previewBase ?? s.doc
}

/**
 * Contract 1.1.0 / 1.2.0: the sim re-runs only when the tank, the plants (any
 * field), the bed or the templateId changed. Hardscape-only edits (move /
 * rotate / resize / add / setWoodStyle with no epiphyte carried) do not —
 * growth ignores hardscape.
 */
export function needsResim(prev: ScapeDoc, next: ScapeDoc): boolean {
  if (prev === next) return false
  const tankSame =
    prev.tank === next.tank ||
    (prev.tank.widthCm === next.tank.widthCm && prev.tank.depthCm === next.tank.depthCm && prev.tank.heightCm === next.tank.heightCm)
  const bedSame = prev.bed === next.bed || (prev.bed.frontCm === next.bed.frontCm && prev.bed.backCm === next.bed.backCm)
  const plantsSame = prev.plants === next.plants || JSON.stringify(prev.plants) === JSON.stringify(next.plants)
  return !(tankSame && bedSame && plantsSame && prev.templateId === next.templateId)
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
  return [Math.min(xMax, Math.max(-xMax, x)) + 0, Math.min(zMax, Math.max(-zMax, z)) + 0]
}

/** render's clampHardscapeXZ, with -0 normalised to 0 (docs compare by JSON) */
function clampHS(h: Pick<HardscapeVisual, "rotationY" | "sizeCm">, tank: TankDims, x: number, z: number): { x: number; z: number } {
  // render only reads rotationY / sizeCm
  const r = renderClampHardscapeXZ(h as HardscapeVisual, tank, x, z)
  return { x: r.x + 0, z: r.z + 0 }
}

/** true when a planted (y = 0) plant may not stand at (x, z): inside a stone footprint + 0.5 cm */
export function blockedByStone(doc: Pick<ScapeDoc, "hardscape">, x: number, z: number): boolean {
  return doc.hardscape.some((h) => h.kind === "stone" && footprintContains(h, x, z, STONE_MARGIN_CM))
}

function normAngle(a: number): number {
  let r = a % (2 * Math.PI)
  if (r > Math.PI) r -= 2 * Math.PI
  if (r <= -Math.PI) r += 2 * Math.PI
  return r
}

const r2 = (v: number) => Math.round(v * 100) / 100 + 0

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
// 1.2.0 — attach map + seating on the host surface

/** attach map as a Map (own entries only) */
function attachMap(doc: Pick<ScapeDoc, "attach">): Map<string, string> {
  return new Map(doc.attach ? Object.entries(doc.attach) : [])
}

/** host piece id of an attached plant, or undefined */
export function hostOf(doc: Pick<ScapeDoc, "attach">, plantId: string): string | undefined {
  const a = doc.attach
  return a && Object.prototype.hasOwnProperty.call(a, plantId) ? a[plantId] : undefined
}

/** plant ids attached to `hardscapeId`, in doc.plants order */
export function attachedTo(doc: Pick<ScapeDoc, "attach" | "plants">, hardscapeId: string): string[] {
  return doc.plants.filter((p) => hostOf(doc, p.id) === hardscapeId).map((p) => p.id)
}

/** doc with `attach` set from a map; an empty map is normalised to no attach field */
function withAttach(doc: ScapeDoc, m: ReadonlyMap<string, string>): ScapeDoc {
  const { attach: _drop, ...rest } = doc
  return m.size > 0 ? { ...rest, attach: Object.fromEntries(m) } : rest
}

type Seat = { x: number; z: number; y: number }

/** nearest anchor (floor distance) of anchors(h, ANCHORS_PER_HOST), or null when the piece has none */
function nearestAnchor(h: HardscapeVisual, tank: TankDims, x: number, z: number): Seat | null {
  let best: Seat | null = null
  let bestD = Infinity
  for (const a of anchorsInTank(h, tank, ANCHORS_PER_HOST)) {
    const d = Math.hypot(a.x - x, a.z - z)
    if (d < bestD) {
      bestD = d
      best = { x: a.x, z: a.z, y: a.y }
    }
  }
  return best
}

/**
 * 1.2.0: where an attached plant wanting (x, z) sits on host `h`: (x, z) is
 * clamped into the footprint shrunk by 0.5 cm (and 1 cm inside the glass),
 * then y = surfaceY; where the surface misses, the nearest anchor is used.
 */
export function seatOn(h: HardscapeVisual, tank: TankDims, x: number, z: number): Seat {
  // 1.2.1: render 1.4.0 surfaces reach past the footprint ellipse (branch tips) —
  // a spot that has a surface is on the host already
  if (Number.isFinite(x) && Number.isFinite(z)) {
    const [cx, cz] = clampPos(tank, x, z)
    const y = surfaceY(h, cx, cz)
    if (y !== null && y > 0) return { x: cx, z: cz, y: Math.max(MIN_ATTACHED_Y, r2(y)) }
  }
  const a = Math.max(0.05, h.sizeCm[0] / 2 - HOST_INSET_CM)
  const b = Math.max(0.05, h.sizeCm[2] / 2 - HOST_INSET_CM)
  const c = Math.cos(h.rotationY)
  const s = Math.sin(h.rotationY)
  const fx = Number.isFinite(x) ? x : h.x
  const fz = Number.isFinite(z) ? z : h.z
  let lx = c * (fx - h.x) - s * (fz - h.z)
  let lz = s * (fx - h.x) + c * (fz - h.z)
  const d = Math.sqrt((lx / a) ** 2 + (lz / b) ** 2)
  let wx = fx
  let wz = fz
  if (d > 1) {
    // outside the shrunk footprint: pull back onto its rim along the ray from the centre
    lx /= d
    lz /= d
    wx = h.x + lx * c + lz * s
    wz = h.z - lx * s + lz * c
  }
  return seatAt(h, tank, wx, wz)
}

/**
 * 1.2.0: an attached plant at (x, z) (1 cm inside the glass) gets y =
 * surfaceY there; where the surface misses, it moves to the nearest anchor.
 * Used when a host carries its plants and when docs are migrated.
 */
export function seatAt(h: HardscapeVisual, tank: TankDims, x: number, z: number): Seat {
  const [cx, cz] = clampPos(tank, Number.isFinite(x) ? x : h.x, Number.isFinite(z) ? z : h.z)
  const y = surfaceY(h, cx, cz)
  if (y !== null && y > 0) return { x: cx, z: cz, y: Math.max(MIN_ATTACHED_Y, r2(y)) }
  const an = nearestAnchor(h, tank, cx, cz)
  if (an) return anchorSeat(h, tank, an)
  return { x: cx, z: cz, y: Math.max(MIN_ATTACHED_Y, r2(y ?? 0)) }
}

/** seat on an anchor; y is the surface height at the (rounded) anchor position, as seatAt computes it */
function anchorSeat(h: HardscapeVisual, tank: TankDims, a: Seat): Seat {
  const [ax, az] = clampPos(tank, a.x, a.z)
  const y = surfaceY(h, ax, az)
  if (y !== null && y > 0) return { x: ax, z: az, y: Math.max(MIN_ATTACHED_Y, r2(y)) }
  // rounding / glass clamping can step off a thin twig: snap to the nearest spot that has a surface
  const snap = snapToSurface(h, tank, ax, az)
  if (snap) return snap
  return { x: ax, z: az, y: Math.max(MIN_ATTACHED_Y, r2(a.y)) }
}

/** nearest (x, z) within 1.5 cm of (x, z) with a surface on `h` (rings of 8–16 probes), or null */
/**
 * anchors(h, n) that lie inside the glass (1 cm margin): branch tips of a
 * rotated piece can reach past the footprint ellipse that clampHardscapeXZ keeps inside
 */
function anchorsInTank(h: HardscapeVisual, tank: TankDims, n: number): SurfaceAnchor[] {
  const xm = tank.widthCm / 2 - 1
  const zm = tank.depthCm / 2 - 1
  return anchors(h, n).filter((a) => Math.abs(a.x) <= xm && Math.abs(a.z) <= zm)
}

function snapToSurface(h: HardscapeVisual, tank: TankDims, x: number, z: number): Seat | null {
  for (let r = 0.05; r <= 1.5 + 1e-9; r += 0.05) {
    const k = r < 0.5 ? 8 : 16
    for (let i = 0; i < k; i++) {
      const t = (i / k) * 2 * Math.PI
      const [cx, cz] = clampPos(tank, x + r * Math.cos(t), z + r * Math.sin(t))
      const y = surfaceY(h, cx, cz)
      if (y !== null && y > 0) return { x: cx, z: cz, y: Math.max(MIN_ATTACHED_Y, r2(y)) }
    }
  }
  return null
}

function seated(p: PlantPlacement, seat: Seat): PlantPlacement {
  return p.x === seat.x && p.z === seat.z && p.y === seat.y ? p : { ...p, x: seat.x, z: seat.z, y: seat.y }
}

/**
 * 1.2.0 migration (idempotent). With an `attach` map: drops entries whose
 * plant or piece is gone. Without one (1.0 / 1.1 docs): a plant with y > 0
 * whose (x, z) lies in a piece's footprint is attached to the topmost such
 * piece (highest surface there; later pieces win ties). Then every attached
 * plant is seated on its host's surface and every other plant gets y = 0.
 *
 * 1.2.2: only canAttach species are attached (entries of other species are
 * dropped from an existing map too). Every other lifted plant (y > 0) drops to
 * y = 0 at the same (x, z) — unless that spot is in a stone footprint
 * (margin 0.5 cm), in which case it moves to that stone's front edge + 2 cm
 * (the detachPlant rule; if that spot is blocked as well, the nearest free
 * spot, findFreeSpot).
 *
 * Returns the same doc when nothing changes.
 */
export function migrateAttach(doc: ScapeDoc): ScapeDoc {
  const hsById = new Map(doc.hardscape.map((h) => [h.id, h]))
  const plantById = new Map(doc.plants.map((p) => [p.id, p]))
  const m = new Map<string, string>()
  if (doc.attach !== undefined) {
    for (const [pid, hid] of attachMap(doc)) {
      const p = plantById.get(pid)
      if (p && hsById.has(hid) && canAttach(p.speciesId)) m.set(pid, hid)
    }
  } else {
    for (const p of doc.plants) {
      if (!(p.y > 0) || !canAttach(p.speciesId)) continue
      let top: HardscapeVisual | undefined
      let topY = -Infinity
      for (const h of doc.hardscape) {
        if (!footprintContains(h, p.x, p.z, 0)) continue
        const y = surfaceY(h, p.x, p.z) ?? 0
        if (y >= topY) {
          topY = y
          top = h
        }
      }
      if (top) m.set(p.id, top.id)
    }
  }
  let changed = false
  const plants = doc.plants.map((p) => {
    const hid = m.get(p.id)
    const next = hid ? seated(p, seatAt(hsById.get(hid)!, doc.tank, p.x, p.z)) : p.y === 0 ? p : dropLifted(doc, p)
    if (next !== p) changed = true
    return next
  })
  const before = attachMap(doc)
  const sameAttach = (doc.attach === undefined) === (m.size === 0) && before.size === m.size && [...m].every(([k, v]) => before.get(k) === v)
  if (!changed && sameAttach) return doc
  return withAttach({ ...doc, plants: changed ? plants : doc.plants }, m)
}

/** 1.2.2: a lifted plant that is not attached drops onto the bed (in front of a stone it would land on) */
function dropLifted(doc: ScapeDoc, p: PlantPlacement): PlantPlacement {
  const stone = doc.hardscape.find((h) => h.kind === "stone" && footprintContains(h, p.x, p.z, STONE_MARGIN_CM))
  if (!stone) return { ...p, y: 0 }
  let spot = detachSpot(doc, stone, p)
  if (blockedByStone(doc, spot.x, spot.z)) spot = findFreeSpot(doc, spot.x, spot.z) ?? spot
  return { ...p, x: spot.x, z: spot.z, y: 0 }
}

/** carried plants of `oldH` re-seated on `newH`, each at `to(p)` */
function reseatCarried(doc: ScapeDoc, oldId: string, newH: HardscapeVisual, to: (p: PlantPlacement) => [number, number]): PlantPlacement[] {
  const carried = new Set(attachedTo(doc, oldId))
  if (carried.size === 0) return doc.plants
  let changed = false
  const out = doc.plants.map((p) => {
    if (!carried.has(p.id)) return p
    const [x, z] = to(p)
    const q = seated(p, seatAt(newH, doc.tank, x, z))
    if (q !== p) changed = true
    return q
  })
  return changed ? out : doc.plants
}

/**
 * 1.2.0 (woodStyle / leanSide change): the k-th attached plant goes to the
 * nearest free anchor of anchors(h, ANCHORS_PER_HOST) (all taken → the nearest one).
 */
function reseatOnAnchors(doc: ScapeDoc, oldH: HardscapeVisual, newH: HardscapeVisual): PlantPlacement[] {
  const carried = new Set(attachedTo(doc, oldH.id))
  if (carried.size === 0) return doc.plants
  const list = anchorsInTank(newH, doc.tank, ANCHORS_PER_HOST)
  const taken = new Set<number>()
  const dx = newH.x - oldH.x
  const dz = newH.z - oldH.z
  return doc.plants.map((p) => {
    if (!carried.has(p.id)) return p
    const px = p.x + dx
    const pz = p.z + dz
    let best = -1
    let bestFree = -1
    list.forEach((a, i) => {
      const d = Math.hypot(a.x - px, a.z - pz)
      if (best < 0 || d < Math.hypot(list[best]!.x - px, list[best]!.z - pz)) best = i
      if (!taken.has(i) && (bestFree < 0 || d < Math.hypot(list[bestFree]!.x - px, list[bestFree]!.z - pz))) bestFree = i
    })
    const pick = bestFree >= 0 ? bestFree : best
    if (pick < 0) return seated(p, seatAt(newH, doc.tank, px, pz))
    taken.add(pick)
    return seated(p, anchorSeat(newH, doc.tank, list[pick]!))
  })
}

// ---------------------------------------------------------------------------
// ops — each takes a migrated doc and returns a new doc, or null for a no-op

function movePlant(doc: ScapeDoc, id: string, x: number, z: number): ScapeDoc | null {
  const p = doc.plants.find((pp) => pp.id === id)
  if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return null
  const hid = hostOf(doc, id)
  const host = hid !== undefined ? doc.hardscape.find((h) => h.id === hid) : undefined
  if (host) {
    // 1.2.0: an attached plant stays on its host — a drag never re-parents
    const q = seated(p, seatOn(host, doc.tank, x, z))
    return q === p ? null : { ...doc, plants: doc.plants.map((pp) => (pp.id === id ? q : pp)) }
  }
  const [cx, cz] = clampPos(doc.tank, x, z)
  if (blockedByStone(doc, cx, cz)) return null
  return { ...doc, plants: doc.plants.map((pp) => (pp.id === id ? { ...pp, x: cx, z: cz, y: 0 } : pp)) }
}

function moveHardscape(doc: ScapeDoc, id: string, x: number, z: number): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h || !Number.isFinite(x) || !Number.isFinite(z)) return null
  // 1.1.0: the whole rotated footprint stays ≥ 1 cm inside the glass
  const { x: cx, z: cz } = clampHS(h, doc.tank, x, z)
  const dx = cx - h.x
  const dz = cz - h.z
  // 1.2.2: a root piece on "auto" keeps the side it resolved to BEFORE the move (no flip across the centre)
  const moved: HardscapeVisual = (dx !== 0 || dz !== 0) && isAutoRoot(h) ? { ...h, x: cx, z: cz, leanSide: resolveLeanSide(h) } : { ...h, x: cx, z: cz }
  return {
    ...doc,
    hardscape: doc.hardscape.map((hh) => (hh.id === id ? moved : hh)),
    // 1.2.0: exactly the attach-listed plants follow, re-seated on the moved piece
    plants: dx === 0 && dz === 0 ? doc.plants : reseatCarried(doc, id, moved, (p) => [p.x + dx, p.z + dz]),
  }
}

/** root wood whose lean is "auto" (explicitly, or missing = "auto" in render) */
function isAutoRoot(h: HardscapeVisual): boolean {
  return h.kind === "wood" && h.woodStyle === "root" && (h.leanSide ?? "auto") === "auto"
}

function move(doc: ScapeDoc, t: EditTarget, x: number, z: number): ScapeDoc | null {
  return t.kind === "plant" ? movePlant(doc, t.id, x, z) : moveHardscape(doc, t.id, x, z)
}

function rotate(doc: ScapeDoc, id: string, dRad: number): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h || !Number.isFinite(dRad) || dRad === 0) return null
  // rotate carried epiphytes about the piece's centre by Ry(dRad) so they keep their local position
  const c = Math.cos(dRad)
  const s = Math.sin(dRad)
  const rotationY = normAngle(h.rotationY + dRad)
  // 1.1.0: rotating changes the footprint's extent — re-clamp the centre; carried epiphytes follow the shift too
  const { x: nx, z: nz } = clampHS({ rotationY, sizeCm: h.sizeCm }, doc.tank, h.x, h.z)
  const turned: HardscapeVisual = { ...h, rotationY, x: nx, z: nz }
  return {
    ...doc,
    hardscape: doc.hardscape.map((hh) => (hh.id === id ? turned : hh)),
    plants: reseatCarried(doc, id, turned, (p) => {
      const dx = p.x - h.x
      const dz = p.z - h.z
      return [nx + c * dx + s * dz, nz - s * dx + c * dz]
    }),
  }
}

function remove(doc: ScapeDoc, t: EditTarget): ScapeDoc | null {
  const m = attachMap(doc)
  if (t.kind === "plant") {
    if (!doc.plants.some((p) => p.id === t.id)) return null
    m.delete(t.id)
    return withAttach({ ...doc, plants: doc.plants.filter((p) => p.id !== t.id) }, m)
  }
  if (!doc.hardscape.some((hh) => hh.id === t.id)) return null
  // 1.2.0: the piece's attached plants go with it, in the same history step
  const gone = new Set(attachedTo(doc, t.id))
  for (const pid of gone) m.delete(pid)
  return withAttach(
    {
      ...doc,
      hardscape: doc.hardscape.filter((hh) => hh.id !== t.id),
      plants: gone.size ? doc.plants.filter((p) => !gone.has(p.id)) : doc.plants,
    },
    m,
  )
}

/** smallest unused n for "<speciesId>-<n>" */
export function nextPlantId(doc: Pick<ScapeDoc, "plants">, speciesId: string): string {
  const ids = new Set(doc.plants.map((p) => p.id))
  let n = 1
  while (ids.has(`${speciesId}-${n}`)) n++
  return `${speciesId}-${n}`
}

function clampPortions(portions: number | undefined): number {
  return portions === undefined || !Number.isFinite(portions) ? 1 : Math.min(99, Math.max(1, Math.round(portions)))
}

function addPlant(doc: ScapeDoc, speciesId: string, x: number, z: number, portions: number | undefined): ScapeDoc | null {
  if (doc.plants.length >= MAX_PLANTS || !isKnownSpecies(speciesId)) return null
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const [cx, cz] = clampPos(doc.tank, x, z)
  if (blockedByStone(doc, cx, cz)) return null
  const plant: PlantPlacement = { id: nextPlantId(doc, speciesId), speciesId, x: cx, z: cz, y: 0, portions: clampPortions(portions) }
  return { ...doc, plants: [...doc.plants, plant] }
}

/**
 * 1.2.0 "attachPlant": the seat a new epiphyte on `h` would get — x/z omitted:
 * the first anchor of anchors(h, ANCHORS_PER_HOST) not within 3 cm of an attached plant
 * (fallback anchor 0); x/z given: inside the footprint with a surface there.
 */
export function attachSeat(doc: ScapeDoc, h: HardscapeVisual, x?: number, z?: number): Seat | null {
  if (x === undefined || z === undefined) {
    const list = anchorsInTank(h, doc.tank, ANCHORS_PER_HOST)
    if (list.length === 0) return null
    const attached = doc.plants.filter((p) => hostOf(doc, p.id) !== undefined)
    const free = list.find((a) => !attached.some((p) => Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) < ANCHOR_TAKEN_CM)) ?? list[0]!
    return anchorSeat(h, doc.tank, free)
  }
  // 1.2.1: "on the piece" = it has a surface there (render surfaces reach past the footprint ellipse)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const [cx, cz] = clampPos(doc.tank, x, z)
  const y = surfaceY(h, cx, cz)
  if (y === null || !(y > 0)) return null
  return { x: cx, z: cz, y: Math.max(MIN_ATTACHED_Y, r2(y)) }
}

function attachPlant(
  doc: ScapeDoc,
  speciesId: string,
  hardscapeId: string,
  x: number | undefined,
  z: number | undefined,
  portions: number | undefined,
): ScapeDoc | null {
  if (doc.plants.length >= MAX_PLANTS || !canAttach(speciesId)) return null
  const h = doc.hardscape.find((hh) => hh.id === hardscapeId)
  if (!h) return null
  const seat = attachSeat(doc, h, x, z)
  if (!seat) return null
  const id = nextPlantId(doc, speciesId)
  const m = attachMap(doc)
  m.set(id, h.id)
  return withAttach({ ...doc, plants: [...doc.plants, { id, speciesId, ...seat, portions: clampPortions(portions) }] }, m)
}

/** 1.2.0 "detachPlant": where an untied plant lands — in front of its host, on the bed */
export function detachSpot(doc: ScapeDoc, h: HardscapeVisual, p: Pick<PlantPlacement, "x">): { x: number; z: number } {
  const [x, z] = clampPos(doc.tank, p.x, h.z + footprintHalfExtents(h).z + DETACH_FRONT_CM)
  return { x, z }
}

function detachPlant(doc: ScapeDoc, id: string): ScapeDoc | null {
  const p = doc.plants.find((pp) => pp.id === id)
  const hid = hostOf(doc, id)
  const h = hid !== undefined ? doc.hardscape.find((hh) => hh.id === hid) : undefined
  if (!p || !h) return null
  const spot = detachSpot(doc, h, p)
  if (blockedByStone(doc, spot.x, spot.z)) return null
  const m = attachMap(doc)
  m.delete(id)
  return withAttach({ ...doc, plants: doc.plants.map((pp) => (pp.id === id ? { ...pp, x: spot.x, z: spot.z, y: 0 } : pp)) }, m)
}

// --- 1.1.0: resize / addHardscape / setWoodStyle

type Size3 = [number, number, number]

/**
 * Uniform scale `scale` applied to `size`, reduced (or raised) so every axis
 * stays within the contract bounds: ≥ 2 cm; width ≤ W − 2, depth ≤ D − 2,
 * height ≤ 0.9 H. Growing never shrinks and shrinking never grows: a piece
 * that already exceeds an upper bound does not grow at all (scale > 1 is a
 * no-op) and still shrinks proportionally (1.2.0). Returns the effective
 * factor (1 = nothing to do).
 */
export function effectiveScale(size: readonly number[], tank: TankDims, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  const [w, h, d] = size as Size3
  if (!(w > 0 && h > 0 && d > 0)) return 1
  if (scale > 1) {
    const cap = Math.min(scale, (tank.widthCm - 2) / w, (tank.depthCm - 2) / d, (0.9 * tank.heightCm) / h)
    return Math.max(1, cap)
  }
  const floor = Math.max(scale, MIN_HARDSCAPE_CM / w, MIN_HARDSCAPE_CM / h, MIN_HARDSCAPE_CM / d)
  return Math.min(1, floor)
}

/** fit a size into the contract bounds keeping its proportions (shrink first, then grow to the 2 cm floor) */
function fitSize(size: Size3, tank: TankDims, round = true): Size3 {
  const down = Math.min(1, (tank.widthCm - 2) / size[0], (tank.depthCm - 2) / size[2], (0.9 * tank.heightCm) / size[1])
  let s: Size3 = [size[0] * down, size[1] * down, size[2] * down]
  const up = Math.max(1, MIN_HARDSCAPE_CM / s[0], MIN_HARDSCAPE_CM / s[1], MIN_HARDSCAPE_CM / s[2])
  if (up > 1) s = [s[0] * up, s[1] * up, s[2] * up]
  return round ? [r1(s[0]), r1(s[1]), r1(s[2])] : s
}

function r1(v: number): number {
  return Math.round(v * 10) / 10
}

function resize(doc: ScapeDoc, id: string, scale: number): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h) return null
  const f = effectiveScale(h.sizeCm, doc.tank, scale)
  if (Math.abs(f - 1) < 1e-9) return null
  const sizeCm: Size3 = [h.sizeCm[0] * f, h.sizeCm[1] * f, h.sizeCm[2] * f]
  // a growing piece near the glass is pushed inwards
  const { x, z } = clampHS({ rotationY: h.rotationY, sizeCm }, doc.tank, h.x, h.z)
  const sized: HardscapeVisual = { ...h, sizeCm, x, z }
  return {
    ...doc,
    hardscape: doc.hardscape.map((hh) => (hh.id === id ? sized : hh)),
    // 1.2.0: attached plants' offsets from the centre scale with the piece
    plants: reseatCarried(doc, id, sized, (p) => [x + (p.x - h.x) * f, z + (p.z - h.z) * f]),
  }
}

/** default size of a new piece (contract 1.1.0), before fitting into the tank */
export function defaultHardscapeSize(kind: "stone" | "wood", woodStyle: WoodStyle | undefined, tank: TankDims): Size3 {
  const { widthCm: W, heightCm: H, depthCm: D } = tank
  if (kind === "stone") return [0.16 * W, 0.22 * H, 0.16 * D]
  switch (woodStyle ?? "branchy") {
    case "root":
      return [0.5 * W, 0.6 * H, 0.3 * D]
    case "log":
      return [0.4 * W, 0.18 * H, 0.22 * D]
    default:
      return [0.45 * W, 0.55 * H, 0.3 * D]
  }
}

/** smallest unused n for "<kind>-<n>" */
export function nextHardscapeId(doc: Pick<ScapeDoc, "hardscape">, kind: "stone" | "wood"): string {
  const ids = new Set(doc.hardscape.map((h) => h.id))
  let n = 1
  while (ids.has(`${kind}-${n}`)) n++
  return `${kind}-${n}`
}

/** deterministic 31-bit FNV-1a hash of an id (seed of an added piece) */
export function hashId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) & 0x7fffffff
}

/** the piece "addHardscape" would create at (x, z), clamped — or null when kind / input is invalid */
export function newHardscapePiece(
  doc: ScapeDoc,
  kind: "stone" | "wood",
  woodStyle: WoodStyle | undefined,
  x: number,
  z: number,
): HardscapeVisual | null {
  if ((kind !== "stone" && kind !== "wood") || !Number.isFinite(x) || !Number.isFinite(z)) return null
  if (woodStyle !== undefined && !WOOD_STYLES.includes(woodStyle)) return null
  const id = nextHardscapeId(doc, kind)
  const sizeCm = fitSize(defaultHardscapeSize(kind, woodStyle, doc.tank), doc.tank)
  const pos = clampHS({ rotationY: 0, sizeCm }, doc.tank, x, z)
  const piece: HardscapeVisual = { id, kind, x: pos.x, z: pos.z, rotationY: 0, sizeCm, seed: hashId(id) }
  if (kind === "stone") piece.role = "soeishi"
  else piece.woodStyle = woodStyle ?? "branchy"
  // 1.2.2: new root wood stores the side "auto" resolves to here (frozen)
  if (piece.woodStyle === "root") piece.leanSide = resolveLeanSide(piece)
  return piece
}

/** true when the footprint (+0.5 cm) covers a planted (non-attached) plant */
function coversPlantedPlant(doc: Pick<ScapeDoc, "plants" | "attach">, h: HardscapeVisual): boolean {
  return doc.plants.some((p) => hostOf(doc, p.id) === undefined && footprintContains(h, p.x, p.z, STONE_MARGIN_CM))
}

/** radius of a footprint ellipse along the unit world direction (ux, uz) */
function footprintRadius(h: Pick<HardscapeVisual, "rotationY" | "sizeCm">, ux: number, uz: number): number {
  const c = Math.cos(h.rotationY)
  const s = Math.sin(h.rotationY)
  const lx = c * ux - s * uz
  const lz = s * ux + c * uz
  const a = Math.max(1e-6, h.sizeCm[0] / 2)
  const b = Math.max(1e-6, h.sizeCm[2] / 2)
  return 1 / Math.sqrt((lx / a) ** 2 + (lz / b) ** 2)
}

/**
 * 1.2.0: two footprints overlap when their centre distance is less than the
 * sum of the two ellipses' radii along the centre line, minus 1 cm.
 */
export function footprintsOverlap(p: HardscapeVisual, q: HardscapeVisual): boolean {
  const dx = q.x - p.x
  const dz = q.z - p.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-9) return true
  const ux = dx / d
  const uz = dz / d
  return d < footprintRadius(p, ux, uz) + footprintRadius(q, ux, uz) - 1
}

function addHardscape(doc: ScapeDoc, kind: "stone" | "wood", woodStyle: WoodStyle | undefined, x: number, z: number): ScapeDoc | null {
  if (doc.hardscape.length >= MAX_HARDSCAPE_PIECES) return null
  const piece = newHardscapePiece(doc, kind, woodStyle, x, z)
  if (!piece || coversPlantedPlant(doc, piece)) return null
  if (doc.hardscape.some((h) => footprintsOverlap(h, piece))) return null
  return { ...doc, hardscape: [...doc.hardscape, piece] }
}

/** 1.2.0: the page's candidate spots for a new piece — centre, ±W/4, ±3W/8 at z = 0, then the same at z = −D/4 */
export function hardscapeSpotCandidates(tank: TankDims): { x: number; z: number }[] {
  const W = tank.widthCm
  const xs = [0, -W / 4, W / 4, (-3 * W) / 8, (3 * W) / 8]
  return [0, -tank.depthCm / 4].flatMap((z) => xs.map((x) => ({ x: x + 0, z: z + 0 })))
}

/**
 * 1.2.0: the first candidate spot where "addHardscape" succeeds, or null —
 * the page then shows "No free spot" and adds nothing.
 */
export function findHardscapeSpot(doc: ScapeDoc, kind: "stone" | "wood", woodStyle?: WoodStyle): { x: number; z: number } | null {
  const d = migrateAttach(doc)
  for (const c of hardscapeSpotCandidates(doc.tank)) if (addHardscape(d, kind, woodStyle, c.x, c.z)) return c
  return null
}

function setWoodStyle(doc: ScapeDoc, id: string, woodStyle: WoodStyle): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h || h.kind !== "wood" || !WOOD_STYLES.includes(woodStyle)) return null
  // missing woodStyle means "branchy" (render 1.3.0): setting it explicitly changes nothing
  if ((h.woodStyle ?? "branchy") === woodStyle) return null
  // 1.2.0: keep the width, reset height / depth to the new style's default proportions, clamp like resize
  const def = defaultHardscapeSize("wood", woodStyle, doc.tank)
  const k = h.sizeCm[0] / def[0]
  const sizeCm = fitSize([h.sizeCm[0], def[1] * k, def[2] * k], doc.tank, false)
  const { x, z } = clampHS({ rotationY: h.rotationY, sizeCm }, doc.tank, h.x, h.z)
  const { leanSide: _lean, ...rest } = h
  // leanSide is root-only: dropped when the piece stops being root wood (1.2.2: documented, tested);
  // switching to root freezes the side "auto" resolves to at the piece's (clamped) position
  const styled: HardscapeVisual =
    woodStyle === "root" ? { ...rest, woodStyle, sizeCm, x, z, leanSide: resolveLeanSide({ x, leanSide: h.leanSide }) } : { ...rest, woodStyle, sizeCm, x, z }
  return { ...doc, hardscape: doc.hardscape.map((hh) => (hh.id === id ? styled : hh)), plants: reseatOnAnchors(doc, h, styled) }
}

function setLeanSide(doc: ScapeDoc, id: string, leanSide: LeanSide): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h || h.kind !== "wood" || h.woodStyle !== "root" || !LEAN_SIDES.includes(leanSide)) return null
  // missing leanSide means "auto" (render 1.4.0)
  if ((h.leanSide ?? "auto") === leanSide) return null
  const leaned: HardscapeVisual = { ...h, leanSide }
  return { ...doc, hardscape: doc.hardscape.map((hh) => (hh.id === id ? leaned : hh)), plants: reseatOnAnchors(doc, h, leaned) }
}

/**
 * 1.2.2 "replace": the incoming doc (a template, a compose result, a pasted
 * link) gets the invariants a decoded link has — null (→ no-op) for a tank
 * outside the link ranges; otherwise unknown species and duplicate ids are
 * dropped, at most 60 plants / 24 pieces are kept, positions are clamped
 * 1 cm inside the glass (hardscape by its real extent, clampHardscapeXZ),
 * portions to 1–99, and the result is migrated (migrateAttach). A doc that
 * already satisfies all of this comes back structurally unchanged.
 */
export function sanitizeDoc(doc: ScapeDoc): ScapeDoc | null {
  const t = doc?.tank
  if (!t || doc.v !== 1) return null
  const { widthCm: W, depthCm: D, heightCm: H } = t
  if (!(W >= 10 && W <= 300 && D >= 10 && D <= 150 && H >= 10 && H <= 120)) return null
  const tank: TankDims = { widthCm: W, depthCm: D, heightCm: H }
  const fin = (v: number) => typeof v === "number" && Number.isFinite(v)
  const hsIds = new Set<string>()
  const hardscape: HardscapeVisual[] = []
  for (const h of doc.hardscape ?? []) {
    if (hardscape.length >= MAX_HARDSCAPE || hsIds.has(h.id) || (h.kind !== "stone" && h.kind !== "wood")) continue
    if (![h.x, h.z, h.rotationY, ...h.sizeCm].every(fin) || !h.sizeCm.every((v) => v > 0)) continue
    hsIds.add(h.id)
    const pos = clampHS(h, tank, h.x, h.z)
    hardscape.push(pos.x === h.x && pos.z === h.z ? h : { ...h, x: pos.x, z: pos.z })
  }
  const ids = new Set<string>()
  const plants: PlantPlacement[] = []
  for (const p of doc.plants ?? []) {
    if (plants.length >= MAX_PLANTS || ids.has(p.id) || !isKnownSpecies(p.speciesId) || !fin(p.x) || !fin(p.z)) continue
    ids.add(p.id)
    const [x, z] = clampPos(tank, p.x, p.z)
    const y = fin(p.y) && p.y > 0 ? p.y : 0
    const portions = clampPortions(p.portions)
    plants.push(x === p.x && z === p.z && y === p.y && portions === p.portions ? p : { ...p, x, z, y, portions })
  }
  const same = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i])
  if (doc.tank === t && same(hardscape, doc.hardscape ?? []) && same(plants, doc.plants ?? [])) return migrateAttach(doc)
  const out: ScapeDoc = { ...doc, tank, hardscape, plants }
  if (doc.attach !== undefined) out.attach = Object.fromEntries(Object.entries(doc.attach).filter(([pid, hid]) => ids.has(pid) && hsIds.has(hid)))
  return migrateAttach(out)
}

/** `doc` must be migrated (migrateAttach) */
function applyOp(doc: ScapeDoc, op: EditOp): ScapeDoc | null {
  if (op.type === "replace") return sanitizeDoc(op.doc)
  switch (op.type) {
    case "move":
      return move(doc, op.target, op.x, op.z)
    case "rotate":
      return rotate(doc, op.id, op.dRad)
    case "remove":
      return remove(doc, op.target)
    case "addPlant":
      return addPlant(doc, op.speciesId, op.x, op.z, op.portions)
    case "resize":
      return resize(doc, op.id, op.scale)
    case "addHardscape":
      return addHardscape(doc, op.kind, op.woodStyle, op.x, op.z)
    case "setWoodStyle":
      return setWoodStyle(doc, op.id, op.woodStyle)
    case "attachPlant":
      return attachPlant(doc, op.speciesId, op.hardscapeId, op.x, op.z, op.portions)
    case "detachPlant":
      return detachPlant(doc, op.id)
    case "setLeanSide":
      return setLeanSide(doc, op.id, op.leanSide)
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
  return { doc, past, future, selected, previewBase: null }
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  const base = s.previewBase ?? undefined
  switch (a.type) {
    case "apply": {
      // ops apply to the committed doc: an active preview is discarded first
      const cur = base ?? s.doc
      // 1.0 / 1.1-shaped docs are migrated first; the migration alone is not an edit
      const next = applyOp(migrateAttach(cur), a.op)
      if (!next || docsEqual(next, migrateAttach(cur))) return s
      let selected = keepSelection(next, s.selected)
      if (a.op.type === "addPlant") {
        const added = next.plants[next.plants.length - 1]
        if (added) selected = { kind: "plant", id: added.id }
      } else if (a.op.type === "addHardscape") {
        const added = next.hardscape[next.hardscape.length - 1]
        if (added) selected = { kind: "hardscape", id: added.id }
      }
      // attachPlant keeps the host piece selected, so several epiphytes can be tied on in a row
      return plain(next, pushCapped(s.past, cur), [], selected)
    }
    case "preview": {
      const from = base ?? s.doc
      const next = move(migrateAttach(from), a.target, a.x, a.z)
      if (!next || docsEqual(next, s.doc)) return s
      return { doc: next, past: s.past, future: s.future, selected: s.selected, previewBase: from }
    }
    case "commitPreview": {
      if (!base) return s
      // a drag that ended where it started changes nothing: drop the preview, keep history as is
      if (docsEqual(s.doc, base) || docsEqual(s.doc, migrateAttach(base))) return plain(base, s.past, s.future, s.selected)
      return plain(s.doc, pushCapped(s.past, base), [], s.selected)
    }
    case "cancelPreview": {
      if (!base) return s
      return plain(base, s.past, s.future, keepSelection(base, s.selected))
    }
    case "select": {
      if (sameTarget(a.target, s.selected)) return s
      if (a.target !== null && !targetExists(s.doc, a.target)) return s
      return { ...s, selected: a.target, previewBase: s.previewBase ?? null }
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
    // 1.2.0: templates list their tied epiphytes; 1.0.x output (no attach) is migrated from y > 0
    attach: inst.attach ? { ...inst.attach } : undefined,
  }
  if (templateId !== undefined) doc.templateId = templateId
  if (doc.attach === undefined) delete doc.attach
  return migrateAttach(doc)
}

// ---------------------------------------------------------------------------
// URL encoding
//
// base64url( UTF-8( JSON ) ) of a compact positional array (format v1):
//   [1, [W,D,H]·10, templateId | 0, [bedFront,bedBack]·10, [fx,fy]·10 | 0,
//    speciesIds[], hardscape[], plants[]]
//   hardscape: [id, kind (0 stone | 1 wood), x·10, z·10, rotY·100, w·10, h·10, d·10, seed, role (0 none | 1..4), buriedFrac·100 | -1
//               (, woodStyle 1 branchy | 2 root | 3 log)]   ← 12th entry since 1.1.0, only on wood with a woodStyle;
//              1.0.0 links (11 entries) still decode, woodStyle undefined (= "branchy")
//              (, leanSide 1 auto | 2 left | 3 right)]  ← 13th entry since 1.2.0, only on root wood with a leanSide
//   attach:    9th top-level entry since 1.2.0, only when some plant is attached: flat
//              [plantIndex, hardscapeIndex, …] (indices into plants[] / hardscape[]).
//              Links without it (1.0 / 1.1) are migrated on decode (migrateAttach).
//   plants:    flat, 5 numbers / strings per plant:
//              speciesIndex, id, x·10, z·10, y·10·100 + portions
//              (1.2.0: y is stored as 0 for attached plants — decode re-seats them on the host surface)
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
    ...(h.kind === "wood" && h.woodStyle !== undefined && WOOD_STYLES.includes(h.woodStyle) ? [WOOD_STYLES.indexOf(h.woodStyle) + 1] : []),
    ...(h.kind === "wood" && h.woodStyle === "root" && h.leanSide !== undefined && LEAN_SIDES.includes(h.leanSide) ? [LEAN_SIDES.indexOf(h.leanSide) + 1] : []),
  ])
  const hsIndex = new Map(doc.hardscape.map((h, i) => [h.id, i]))
  const attachFlat: number[] = []
  doc.plants.forEach((p, i) => {
    const hid = hostOf(doc, p.id)
    const hi = hid !== undefined ? hsIndex.get(hid) : undefined
    if (hi !== undefined) attachFlat.push(i, hi)
  })
  const plants: (number | string)[] = []
  const seen = new Map<string, number>()
  for (const p of doc.plants) {
    const k = (seen.get(p.speciesId) ?? 0) + 1
    seen.set(p.speciesId, k)
    const prefix = `${p.speciesId}-`
    const tail = p.id.startsWith(prefix) ? p.id.slice(prefix.length) : ""
    const idPart: number | string = tail === String(k) ? 0 : /^[1-9]\d{0,5}$/.test(tail) ? Number(tail) : p.id
    // 1.2.0: an attached plant's y is its host's surface height — derived on decode, so not stored
    const y = hostOf(doc, p.id) !== undefined ? 0 : q1(Math.max(0, p.y))
    plants.push(sIdx.get(p.speciesId)!, idPart, q1(p.x), q1(p.z), y * 100 + Math.min(99, Math.max(1, Math.round(p.portions))))
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
    ...(attachFlat.length ? [attachFlat] : []),
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
    check(Array.isArray(raw) && (raw.length === 8 || raw.length === 9) && raw[0] === 1)
    const [, tankRaw, tplRaw, bedRaw, focalRaw, speciesRaw, hsRaw, plantsRaw, attachRaw] = raw as unknown[]

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
      check(Array.isArray(e) && e.length >= 11 && e.length <= 13)
      const [id, kind, x, z, rot, w, h, d, seed, role, buried, style, lean] = e as unknown[]
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
      if (e.length >= 12) {
        // 1.1.0 woodStyle: wood only
        check(kind === 1 && isInt(style) && style >= 1 && style <= WOOD_STYLES.length)
        out.woodStyle = WOOD_STYLES[style - 1]!
      }
      if (e.length === 13) {
        // 1.2.0 leanSide: root wood only
        check(out.woodStyle === "root" && isInt(lean) && lean >= 1 && lean <= LEAN_SIDES.length)
        out.leanSide = LEAN_SIDES[lean - 1]!
      }
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
    if (raw.length === 9) {
      // 1.2.0 attach: [plantIndex, hardscapeIndex, …]
      check(Array.isArray(attachRaw) && attachRaw.length % 2 === 0 && attachRaw.every(isInt))
      const flatA = attachRaw as number[]
      const seenP = new Set<number>()
      const entries: [string, string][] = []
      for (let i = 0; i < flatA.length; i += 2) {
        const pi = flatA[i]!
        const hi = flatA[i + 1]!
        check(pi >= 0 && pi < plants.length && hi >= 0 && hi < hardscape.length && !seenP.has(pi))
        seenP.add(pi)
        entries.push([plants[pi]!.id, hardscape[hi]!.id])
      }
      doc.attach = Object.fromEntries(entries)
    }
    return migrateAttach(doc)
  } catch {
    return null
  }
}
