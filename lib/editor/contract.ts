/**
 * Drag editor — contract v1.0.0 (2026-11-15).
 *
 * OWNER: orchestrator only. Sub-agents MUST NOT edit this file; report
 * disagreements in the PR instead.
 *
 * The editor is a pure document model + reducer. The /studio/sim page keeps a
 * ScapeDoc in state, renders it through FrontalTank (render contract ≥ 1.2.0,
 * `editable`), feeds `doc.plants` to sim-core, and re-runs the simulation
 * when an edit is committed (drag "end", keyboard nudge settled 300 ms,
 * add / remove / undo / redo). In-flight sims are cancelled (worker protocol
 * already supports cancel). During a drag ("move") the 3D view shows the
 * item at its new position using the CURRENT frame's height/spread; the sim
 * is not re-run until "end".
 *
 * Coordinates / units: sim-core (origin centre of the substrate plane,
 * x left→right, z back→front, y up, cm).
 */
import type { HardscapeVisual, EditTarget, WoodStyle, LeanSide } from "@aquascape-studio/render"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"

export const EDITOR_CONTRACT_VERSION = "1.2.2" as const

/*
 * 1.2.2 (2026-11-18, 11-17 r2 objections; requires render ≥ 1.4.1):
 *  - Lean side is frozen: addHardscape (wood "root") and setWoodStyle → "root"
 *    store leanSide = resolveLeanSide(h) (render 1.4.1) at that moment, so
 *    dragging root wood across the centre never flips it. "auto" is only
 *    chosen explicitly via setLeanSide (and is then re-frozen on the next
 *    committed move: move / commitPreview of a piece with leanSide "auto"
 *    stores the side it resolved to BEFORE the move). Template pieces keep
 *    their explicit sides.
 *  - setWoodStyle away from "root" removes leanSide; switching back to "root"
 *    freezes a new one (as above). Documented, tested.
 *  - migrateAttach only attaches plants whose species passes canAttach; other
 *    lifted plants (y > 0, not attachable) are dropped to y = 0 at the same
 *    (x, z) unless that spot is in a stone footprint (margin 0.5), in which
 *    case they move to the piece's front edge + 2 cm (detachPlant rule).
 *  - ANCHORS_PER_HOST = 12 for both editor and templates (was 8 / 12); every
 *    "hardscapeAnchors(h, 8)" above now reads hardscapeAnchors(h, 12). Existing
 *    attached plants are not re-seated by this change.
 *  - Glass clamp of hardscape uses render 1.4.1 clampHardscapeXZ (real
 *    extent); nothing to change in web beyond bumping the render dependency,
 *    but the web glass-clamp tests must use the new semantics.
 *  - Compose (lib/compose contract 1.0.0) applies its doc with EditOp
 *    "replace"; "replace" must run migrateAttach and the invariants like a
 *    decoded link (one history step, needsResim true when plants changed).
 */

/*
 * 1.2.1 (2026-11-17 r2, orchestrator, at integration with render 1.4.0):
 *  - "On the host" means surfaceY(h, x, z) ≠ null, not "inside the footprint
 *    ellipse": real wood surfaces (branch tips) reach past the ellipse. Moving
 *    an attached plant keeps any spot that has a surface; only spots without
 *    one are clamped into the footprint (shrunk 0.5 cm) and then fall back to
 *    the nearest anchor. attachPlant with x/z needs a surface there, not a
 *    footprint hit.
 *  - Anchors outside the glass (1 cm margin) are ignored when seating: a
 *    rotated piece's branches can extend past the footprint that
 *    clampHardscapeXZ keeps inside the tank.
 *  - A seat that misses a thin twig after rounding / glass clamping snaps to
 *    the nearest spot with a surface within 1.5 cm.
 *  - The 2000-char link budget applies to the 30-plant doc; 60-plant template
 *    docs may use up to 2048.
 */

/*
 * 1.2.0 (2026-11-17 r2, additive — epiphytes tied onto hardscape; 11-16 objections):
 *  - ScapeDoc.attach (optional): plantId → hardscapeId. A plant listed here is
 *    an epiphyte TIED onto that piece; its y is the piece's surface height at
 *    (x, z) (render ≥ 1.4.0 hardscapeSurfaceY; until web can import it, a local
 *    approximation in lib/editor/surface.ts with the same signature). Docs
 *    without `attach` (1.0/1.1 links) are migrated on load: a plant with y > 0
 *    whose (x, z) lies in a piece's footprint is attached to the topmost such
 *    piece. Invariant after every op: every attach key is an existing plant,
 *    every value an existing hardscape id, and attached plants have y > 0;
 *    non-attached plants have y = 0.
 *  - Only species whose botany growthForm is "epiphyte" or "moss" AND whose
 *    placement includes "attached" may be attached (`canAttach(speciesId)`).
 *  - EditOp "attachPlant" { speciesId, hardscapeId, x?, z?, portions? }: adds a
 *    new plant tied onto the piece. x/z omitted → the first anchor from
 *    hardscapeAnchors(h, 8) not within 3 cm of an already attached plant
 *    (fallback: anchor 0). x/z given → must be inside the footprint (margin 0)
 *    and have a surface (surfaceY ≠ null), else no-op. Id "<speciesId>-<n>".
 *    Counts towards the 60-plant cap. Not a canAttach species → no-op.
 *  - EditOp "detachPlant" { id }: the plant drops onto the bed in front of the
 *    piece (z = piece front edge + 2 cm, clamped; y = 0); no-op if that spot is
 *    blocked by a stone.
 *  - Moving an attached plant (move / preview) keeps it on its host: (x, z) is
 *    clamped into the host footprint shrunk by 0.5 cm, then y = surfaceY; if
 *    surfaceY is null there, the nearest anchor of hardscapeAnchors(h, 8) is
 *    used. A drag can never silently re-parent; re-parenting = detach + attach.
 *  - Moving / rotating a hardscape piece carries exactly its attach-listed
 *    plants (replaces the 1.0 footprint test), and recomputes their y.
 *    Resizing scales their offset from the piece centre by `scale` and
 *    recomputes y. Changing woodStyle / leanSide re-seats them on the nearest
 *    anchors (k-th attached plant → nearest free anchor of hardscapeAnchors(h, 8)).
 *    Removing a piece removes its attached plants in the same history step.
 *  - EditOp "setLeanSide" { id, leanSide }: wood "root" only (else no-op).
 *  - 11-16 objections, normative:
 *    · needsResim is also true when templateId changed.
 *    · setWoodStyle keeps width sizeCm[0] and resets height and depth to the
 *      new style's default proportions (addHardscape defaults) scaled by
 *      width / defaultWidth, then clamps like "resize".
 *    · addHardscape is a no-op if the new footprint ellipse overlaps an
 *      existing piece's footprint (test: centre distance < sum of the two
 *      ellipses' radii along the centre line − 1 cm). The page tries candidate
 *      spots (centre, ±W/4, ±3W/8 at z = 0, then z = −D/4) and uses the first
 *      free one; if none is free it shows "No free spot" and adds nothing.
 *    · resize: when a piece already exceeds a bound, scale > 1 is a no-op and
 *      scale < 1 is applied (proportional, never re-grows).
 *    · Web imports clampHardscapeXZ from @aquascape-studio/render (≥ 1.3.0);
 *      the local copy is deleted and the skipped parity test re-enabled.
 *  - encodeScape / decodeScape carry `attach` and hardscape `leanSide`;
 *    ScapeDoc.v stays 1; a 30-plant, 5-piece doc with 8 attached plants must
 *    still encode to ≤ 2000 chars.
 */

/*
 * 1.1.0 (2026-11-16, additive — driftwood + resize, 11-15 objections):
 *  - EditOp "resize": multiply a hardscape piece's sizeCm by `scale`
 *    (all three axes, uniform). Keyboard "-" / "=" (or "+") → ×0.9 / ×1.1;
 *    toolbar −/+ pill buttons do the same. Result clamped per axis:
 *    each axis ≥ 2 cm; width ≤ W − 2, depth ≤ D − 2, height ≤ 0.9 × tank
 *    height; if any axis hits a bound the scale is reduced so the piece keeps
 *    its proportions. After resizing, x/z are re-clamped with
 *    clampHardscapeXZ. A resize that changes nothing is a no-op.
 *    Epiphytes inside the footprint keep their positions.
 *  - EditOp "addHardscape": adds a stone or a driftwood piece at (x, z) with
 *    id "<kind>-<n>" (smallest unused n), seed = deterministic hash of the id,
 *    rotationY 0. Default sizes relative to the tank (W × H × D):
 *      stone  → [0.16W, 0.22H, 0.16D], role "soeishi", buriedFrac default
 *      wood   → branchy [0.45W, 0.55H, 0.30D]; root [0.50W, 0.60H, 0.30D];
 *               log [0.40W, 0.18H, 0.22D]
 *    then clamped like "resize". Max 12 hardscape pieces (no-op beyond).
 *    Rejected (no-op) when the new footprint would contain any non-epiphyte
 *    plant (footprintContains, margin 0.5 cm).
 *  - EditOp "setWoodStyle": change a wood piece's woodStyle (no-op on stones).
 *  - clampHardscapeXZ (render ≥ 1.3.0 semantics; web may keep a local copy
 *    in lib/editor until it can import it) replaces the centre-only clamp for
 *    hardscape in "move" / "preview" / "rotate" (rotation can change the
 *    footprint extent) / "resize" / "addHardscape".
 *  - EditorState.previewBase: the doc captured at the first "preview" of a
 *    drag; null when no drag is in progress. commitPreview pushes it onto
 *    `past`; cancelPreview restores it. undo/redo/apply set it to null.
 *  - needsResim(prev, next): the page re-runs the sim only when this is true:
 *    tank, plants (any field) or bed changed. Hardscape-only edits (move /
 *    rotate / resize / add / setWoodStyle with no epiphyte carried) do NOT
 *    re-run the sim — growth does not depend on hardscape yet.
 *  - encodeScape / decodeScape: hardscape woodStyle is encoded; links made
 *    by 1.0.0 still decode (missing woodStyle → undefined, i.e. "branchy").
 *    ScapeDoc.v stays 1.
 */

export interface ScapeDoc {
  v: 1
  tank: TankDims
  /** template it started from, if any (informational) */
  templateId?: string | undefined
  bed: { frontCm: number; backCm: number }
  focalPoint?: { x: number; y: number } | undefined
  hardscape: HardscapeVisual[]
  plants: PlantPlacement[]
  /** 1.2.0 — epiphytes tied onto hardscape: plantId → hardscapeId */
  attach?: Record<string, string> | undefined
}

export type EditOp =
  | { type: "move"; target: EditTarget; x: number; z: number }
  /** rotate a hardscape piece about y by dRad (keyboard [ and ]: ±15°) */
  | { type: "rotate"; id: string; dRad: number }
  | { type: "remove"; target: EditTarget }
  /** id is generated "<speciesId>-<n>" with the smallest unused n */
  | { type: "addPlant"; speciesId: string; x: number; z: number; portions?: number | undefined }
  | { type: "replace"; doc: ScapeDoc }
  /** 1.1.0 — uniform scale of a hardscape piece's sizeCm */
  | { type: "resize"; id: string; scale: number }
  /** 1.1.0 — add a stone or driftwood piece; id "<kind>-<n>" */
  | { type: "addHardscape"; kind: "stone" | "wood"; woodStyle?: WoodStyle | undefined; x: number; z: number }
  /** 1.1.0 — wood only */
  | { type: "setWoodStyle"; id: string; woodStyle: WoodStyle }
  /** 1.2.0 — tie a new epiphyte onto a hardscape piece */
  | { type: "attachPlant"; speciesId: string; hardscapeId: string; x?: number | undefined; z?: number | undefined; portions?: number | undefined }
  /** 1.2.0 — untie an attached plant; it drops onto the bed in front of the piece */
  | { type: "detachPlant"; id: string }
  /** 1.2.0 — root wood only */
  | { type: "setLeanSide"; id: string; leanSide: LeanSide }

export interface EditorState {
  doc: ScapeDoc
  /** past docs, most recent last; capped at 100 */
  past: ScapeDoc[]
  future: ScapeDoc[]
  selected: EditTarget | null
  /**
   * 1.1.0 — pre-drag doc while a drag preview is active, else null.
   * Optional in the type only so 1.0.0 states stay valid; 1.1.0
   * implementations always set it (null when idle).
   */
  previewBase?: ScapeDoc | null | undefined
}

export type EditorAction =
  | { type: "apply"; op: EditOp }
  /** live drag preview: updates doc WITHOUT pushing history */
  | { type: "preview"; target: EditTarget; x: number; z: number }
  /** commit the preview: pushes the pre-drag doc onto `past` once */
  | { type: "commitPreview" }
  /** restore the pre-drag doc (drag cancelled) */
  | { type: "cancelPreview" }
  | { type: "select"; target: EditTarget | null }
  | { type: "undo" }
  | { type: "redo" }

/**
 * Rules every implementation must keep (tested):
 *  - Pure, deterministic, never mutates inputs.
 *  - All positions clamped 1 cm inside the glass (|x| ≤ W/2−1, |z| ≤ D/2−1).
 *  - Moving / adding a plant (not an epiphyte with y > 0) onto a stone
 *    footprint (render footprintContains, margin 0.5 cm) is rejected: the op
 *    is a no-op (state returned unchanged, same reference).
 *  - Moving a hardscape piece carries the epiphytes whose (x, z) lie inside
 *    its footprint along with it (same dx, dz).
 *  - Max 60 plants (sim budget); addPlant beyond that is a no-op.
 *  - A no-op never pushes history. undo/redo clear the preview.
 */

/**
 * Required exports (lib/editor/index.ts, implemented by app-agent):
 *
 *   export function initEditor(doc: ScapeDoc): EditorState
 *   export function editorReducer(s: EditorState, a: EditorAction): EditorState
 *   export function docFromTemplate(inst: InstantiatedTemplate, tank: TankDims, templateId?: string): ScapeDoc
 *   export function encodeScape(doc: ScapeDoc): string
 *     — URL-safe (base64url of compact JSON, numbers rounded to 0.1 cm /
 *       0.01 rad); a 30-plant, 5-stone doc must encode to ≤ 2000 chars.
 *   export function needsResim(prev: ScapeDoc, next: ScapeDoc): boolean   (1.1.0)
 *   export function clampHardscapeXZ(h, tank, x, z): { x: number; z: number }   (1.1.0, render 1.3.0 semantics)
 *   export function canAttach(speciesId: string): boolean   (1.2.0)
 *   export function migrateAttach(doc: ScapeDoc): ScapeDoc   (1.2.0; idempotent, used by decodeScape / docFromTemplate)
 *   export function decodeScape(s: string): ScapeDoc | null
 *     — null on any malformed / unknown-version / unknown-species input;
 *       never throws. Round-trip encode→decode is stable to the rounding.
 *
 * URL: /studio/sim?scape=<encoded> loads a doc (takes precedence over ?tpl=).
 * The page writes the current doc back with history.replaceState after each
 * committed edit (debounced 500 ms), so the address bar is always a share link.
 *
 * Feature flag: `dragEditor` (NEXT_PUBLIC_FF_DRAG_EDITOR), default OFF.
 * When off, /studio/sim is byte-for-byte the current page.
 */
