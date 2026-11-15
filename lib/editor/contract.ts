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
import type { HardscapeVisual, EditTarget } from "@aquascape-studio/render"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"

export const EDITOR_CONTRACT_VERSION = "1.0.0" as const

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

export interface EditorState {
  doc: ScapeDoc
  /** past docs, most recent last; capped at 100 */
  past: ScapeDoc[]
  future: ScapeDoc[]
  selected: EditTarget | null
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
