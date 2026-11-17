/**
 * Drag editor — implementation of contract v1.1.0
 * (lib/editor/contract.ts, orchestrator-owned).
 *
 * A pure document model + reducer. Positions are sim-core cm (origin centre
 * of the substrate plane, x left→right, z back→front).
 *
 * Preview bookkeeping (1.1.0): `EditorState.previewBase` holds the pre-drag
 * doc while a drag / nudge preview is active and is null otherwise; every
 * state this reducer returns has it set.
 */
import type { EditTarget, HardscapeVisual, StoneRole, WoodStyle } from "@aquascape-studio/render"
import plantsJson from "../sim/vendor/plants.json"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"
import type { InstantiatedTemplate } from "../templates/contract"
import type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
import { clampHardscapeXZ, footprintContains, footprintHalfExtents } from "./footprint"

export type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
export { EDITOR_CONTRACT_VERSION } from "./contract"
export { clampHardscapeXZ, footprintContains, footprintDistance, footprintHalfExtents } from "./footprint"

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
/** decode guard: longest accepted ?scape= value */
export const MAX_ENCODED_LENGTH = 8000

const KNOWN_SPECIES: ReadonlySet<string> = new Set((plantsJson as unknown as { id: string }[]).map((p) => p.id))

/** true when `id` exists in the vendored botany plants.json */
export function isKnownSpecies(id: string): boolean {
  return KNOWN_SPECIES.has(id)
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
 * Contract 1.1.0: the sim re-runs only when the tank, the plants (any field)
 * or the bed changed. Hardscape-only edits (move / rotate / resize / add /
 * setWoodStyle with no epiphyte carried) do not — growth ignores hardscape.
 */
export function needsResim(prev: ScapeDoc, next: ScapeDoc): boolean {
  if (prev === next) return false
  const tankSame =
    prev.tank === next.tank ||
    (prev.tank.widthCm === next.tank.widthCm && prev.tank.depthCm === next.tank.depthCm && prev.tank.heightCm === next.tank.heightCm)
  const bedSame = prev.bed === next.bed || (prev.bed.frontCm === next.bed.frontCm && prev.bed.backCm === next.bed.backCm)
  const plantsSame = prev.plants === next.plants || JSON.stringify(prev.plants) === JSON.stringify(next.plants)
  return !(tankSame && bedSame && plantsSame)
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
  // 1.1.0: the whole rotated footprint stays ≥ 1 cm inside the glass
  const { x: cx, z: cz } = clampHardscapeXZ(h, doc.tank, x, z)
  return {
    ...doc,
    hardscape: doc.hardscape.map((hh) => (hh.id === id ? { ...hh, x: cx, z: cz } : hh)),
    plants: shiftCarried(doc, epiphytesOn(doc, h), cx - h.x, cz - h.z),
  }
}

/** carried epiphytes follow their piece by (dx, dz); nothing carried / no shift keeps the plants array itself */
function shiftCarried(doc: ScapeDoc, carried: ReadonlySet<string>, dx: number, dz: number): PlantPlacement[] {
  if (carried.size === 0 || (dx === 0 && dz === 0)) return doc.plants
  return doc.plants.map((p) => {
    if (!carried.has(p.id)) return p
    const [px, pz] = clampPos(doc.tank, p.x + dx, p.z + dz)
    return { ...p, x: px, z: pz }
  })
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
  const rotationY = normAngle(h.rotationY + dRad)
  // 1.1.0: rotating changes the footprint's extent — re-clamp the centre; carried epiphytes follow the shift too
  const { x: nx, z: nz } = clampHardscapeXZ({ rotationY, sizeCm: h.sizeCm }, doc.tank, h.x, h.z)
  return {
    ...doc,
    hardscape: doc.hardscape.map((hh) => (hh.id === id ? { ...hh, rotationY, x: nx, z: nz } : hh)),
    plants: doc.plants.map((p) => {
      if (!carried.has(p.id)) return p
      const dx = p.x - h.x
      const dz = p.z - h.z
      const [px, pz] = clampPos(doc.tank, nx + c * dx + s * dz, nz - s * dx + c * dz)
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

// --- 1.1.0: resize / addHardscape / setWoodStyle

type Size3 = [number, number, number]

/**
 * Uniform scale `scale` applied to `size`, reduced (or raised) so every axis
 * stays within the contract bounds: ≥ 2 cm; width ≤ W − 2, depth ≤ D − 2,
 * height ≤ 0.9 H. Growing never shrinks and shrinking never grows (a piece
 * already outside a bound is left alone by a scale that would push it
 * further out). Returns the effective factor (1 = nothing to do).
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

/** fit a fresh size into the contract bounds keeping its proportions (shrink first, then grow to the 2 cm floor) */
function fitSize(size: Size3, tank: TankDims): Size3 {
  const down = Math.min(1, (tank.widthCm - 2) / size[0], (tank.depthCm - 2) / size[2], (0.9 * tank.heightCm) / size[1])
  let s: Size3 = [size[0] * down, size[1] * down, size[2] * down]
  const up = Math.max(1, MIN_HARDSCAPE_CM / s[0], MIN_HARDSCAPE_CM / s[1], MIN_HARDSCAPE_CM / s[2])
  if (up > 1) s = [s[0] * up, s[1] * up, s[2] * up]
  return [r1(s[0]), r1(s[1]), r1(s[2])]
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
  // a growing piece near the glass is pushed inwards; epiphytes keep their positions (contract)
  const { x, z } = clampHardscapeXZ({ rotationY: h.rotationY, sizeCm }, doc.tank, h.x, h.z)
  return { ...doc, hardscape: doc.hardscape.map((hh) => (hh.id === id ? { ...hh, sizeCm, x, z } : hh)) }
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
  const pos = clampHardscapeXZ({ rotationY: 0, sizeCm }, doc.tank, x, z)
  const piece: HardscapeVisual = { id, kind, x: pos.x, z: pos.z, rotationY: 0, sizeCm, seed: hashId(id) }
  if (kind === "stone") piece.role = "soeishi"
  else piece.woodStyle = woodStyle ?? "branchy"
  return piece
}

/** true when the footprint (+0.5 cm) covers a planted (non-epiphyte) plant */
function coversPlantedPlant(doc: Pick<ScapeDoc, "plants">, h: HardscapeVisual): boolean {
  return doc.plants.some((p) => !(p.y > 0) && footprintContains(h, p.x, p.z, STONE_MARGIN_CM))
}

function addHardscape(doc: ScapeDoc, kind: "stone" | "wood", woodStyle: WoodStyle | undefined, x: number, z: number): ScapeDoc | null {
  if (doc.hardscape.length >= MAX_HARDSCAPE_PIECES) return null
  const piece = newHardscapePiece(doc, kind, woodStyle, x, z)
  if (!piece || coversPlantedPlant(doc, piece)) return null
  return { ...doc, hardscape: [...doc.hardscape, piece] }
}

/**
 * A free spot for a new stone / wood near (x, z) (outward spiral, 1 cm rings):
 * its footprint covers no planted plant; spots clear of other pieces are
 * preferred. Null when nothing fits (or the piece limit is reached).
 */
export function findFreeHardscapeSpot(
  doc: ScapeDoc,
  kind: "stone" | "wood",
  woodStyle: WoodStyle | undefined,
  x = 0,
  z = 0,
): { x: number; z: number } | null {
  if (doc.hardscape.length >= MAX_HARDSCAPE_PIECES) return null
  const probe = newHardscapePiece(doc, kind, woodStyle, x, z)
  if (!probe) return null
  const reach = Math.min(footprintHalfExtents(probe).x, footprintHalfExtents(probe).z)
  const maxR = Math.hypot(doc.tank.widthCm, doc.tank.depthCm)
  for (const avoidPieces of [true, false]) {
    for (let r = 0; r <= maxR; r += 1) {
      const steps = r === 0 ? 1 : Math.max(8, Math.ceil(2 * Math.PI * r))
      for (let k = 0; k < steps; k++) {
        const th = (k / steps) * 2 * Math.PI
        const pos = clampHardscapeXZ(probe, doc.tank, x + r * Math.cos(th), z + r * Math.sin(th))
        const at = { ...probe, x: pos.x, z: pos.z }
        if (coversPlantedPlant(doc, at)) continue
        if (avoidPieces && doc.hardscape.some((h) => footprintContains(h, pos.x, pos.z, reach))) continue
        return pos
      }
    }
  }
  return null
}

function setWoodStyle(doc: ScapeDoc, id: string, woodStyle: WoodStyle): ScapeDoc | null {
  const h = doc.hardscape.find((hh) => hh.id === id)
  if (!h || h.kind !== "wood" || !WOOD_STYLES.includes(woodStyle)) return null
  // missing woodStyle means "branchy" (render 1.3.0): setting it explicitly changes nothing
  if ((h.woodStyle ?? "branchy") === woodStyle) return null
  return { ...doc, hardscape: doc.hardscape.map((hh) => (hh.id === id ? { ...hh, woodStyle } : hh)) }
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
    case "resize":
      return resize(doc, op.id, op.scale)
    case "addHardscape":
      return addHardscape(doc, op.kind, op.woodStyle, op.x, op.z)
    case "setWoodStyle":
      return setWoodStyle(doc, op.id, op.woodStyle)
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
      const next = applyOp(cur, a.op)
      if (!next || docsEqual(next, cur)) return s
      let selected = keepSelection(next, s.selected)
      if (a.op.type === "addPlant") {
        const added = next.plants[next.plants.length - 1]
        if (added) selected = { kind: "plant", id: added.id }
      } else if (a.op.type === "addHardscape") {
        const added = next.hardscape[next.hardscape.length - 1]
        if (added) selected = { kind: "hardscape", id: added.id }
      }
      return plain(next, pushCapped(s.past, cur), [], selected)
    }
    case "preview": {
      const from = base ?? s.doc
      const next = move(from, a.target, a.x, a.z)
      if (!next || docsEqual(next, s.doc)) return s
      return { doc: next, past: s.past, future: s.future, selected: s.selected, previewBase: from }
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
//   hardscape: [id, kind (0 stone | 1 wood), x·10, z·10, rotY·100, w·10, h·10, d·10, seed, role (0 none | 1..4), buriedFrac·100 | -1
//               (, woodStyle 1 branchy | 2 root | 3 log)]   ← 12th entry since 1.1.0, only on wood with a woodStyle;
//              1.0.0 links (11 entries) still decode, woodStyle undefined (= "branchy")
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
    ...(h.kind === "wood" && h.woodStyle !== undefined && WOOD_STYLES.includes(h.woodStyle) ? [WOOD_STYLES.indexOf(h.woodStyle) + 1] : []),
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
      check(Array.isArray(e) && (e.length === 11 || e.length === 12))
      const [id, kind, x, z, rot, w, h, d, seed, role, buried, style] = e as unknown[]
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
      if (e.length === 12) {
        // 1.1.0 woodStyle: wood only
        check(kind === 1 && isInt(style) && style >= 1 && style <= WOOD_STYLES.length)
        out.woodStyle = WOOD_STYLES[style - 1]!
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
    return doc
  } catch {
    return null
  }
}
