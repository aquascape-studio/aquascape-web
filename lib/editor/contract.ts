/**
 * Drag editor (拖拽编辑器) — contract v1.0.0 (2026-11-15).
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
import type { HardscapeVisual, EditTarget, WoodStyle } from "@aquascape-studio/render"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"

export const EDITOR_CONTRACT_VERSION = "1.1.0" as const

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
