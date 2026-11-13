/**
 * Style templates (风格模板) — contract v1.0.0.
 *
 * OWNER: orchestrator only. Sub-agents MUST NOT edit this file; report
 * disagreements in the PR instead.
 *
 * A template is a tank-size-independent layout: positions are normalised to
 * the tank footprint so the same Iwagumi / Nature / Dutch template fills a
 * 45, 60 or 90 cm tank. `instantiate()` turns it into sim-core placements
 * (SimInput.plants) and render hardscape (FrontalTank.hardscape).
 *
 * Normalised coordinates: u ∈ [0,1] left → right across the width,
 * v ∈ [0,1] back → front across the depth (front view, viewer at v = 1).
 * Converted to sim/render cm: x = (u − 0.5)·W, z = (v − 0.5)·D.
 *
 * Composition sources (2026-11-13 research):
 *  - Iwagumi: Oyaishi off-centre on a third / golden line, Fukuishi beside it
 *    and clearly smaller, Soeishi smaller still, odd stone counts, Suteishi
 *    as fill. https://aquascapinglove.com/basics/introduction-iwagumi-layout/
 *  - Nature Aquarium: triangle / concave / convex compositions.
 *    https://www.adana.co.jp/en/aquajournal/aj317_special_feature
 *    https://aquasabi.com/aquascaping-wiki/aquascaping/layout-forms-in-aquascaping
 *  - Dutch: streets of single species running diagonally front → back,
 *    terraces, strong contrast between neighbouring groups, ~1 species per
 *    10 cm of length, little or no hardscape.
 *    https://aquatic-gardeners.org/Articles/Vin-Dutch
 */
import type { CompositionGuide, StoneRole } from "@aquascape-studio/render"
import type { HardscapeVisual } from "@aquascape-studio/render"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"

export const TEMPLATE_CONTRACT_VERSION = "1.0.0" as const

export type ScapeStyle = "iwagumi" | "nature" | "dutch"
export type Composition = "triangle" | "concave" | "convex" | "streets"
export type LightLevel = "Low" | "Medium" | "High"

export interface TemplateHardscape {
  id: string
  kind: "stone" | "wood"
  role?: StoneRole | undefined
  u: number
  v: number
  /** bounding size as fractions of tank width / height / depth */
  wFrac: number
  hFrac: number
  dFrac: number
  /** radians about y */
  rotationY: number
  seed: number
  buriedFrac?: number | undefined
}

/**
 * A group of one species. instantiate() expands it into `count` placements
 * scattered deterministically inside an ellipse centred on (u, v) with
 * half-axes (ru, rv). For Dutch streets use a thin, rotated ellipse via
 * `angle` (radians, 0 = along the width).
 */
export interface TemplatePlantGroup {
  speciesId: string
  u: number
  v: number
  ru: number
  rv: number
  angle?: number | undefined
  count: number
  /** sim-core portions per placement (pots / clumps) */
  portions: number
  /** epiphytes: tie onto this hardscape id (y = top region of that piece) */
  onHardscape?: string | undefined
}

export interface ScapeTemplate {
  /** URL-safe, e.g. "iwagumi-sanzon" */
  id: string
  style: ScapeStyle
  composition: Composition
  nameZh: string
  nameEn: string
  /** one sentence, ≤ 40 Chinese chars */
  blurbZh: string
  blurbEn: string
  light: LightLevel
  co2: boolean
  /** composition guide that best explains this layout */
  guide: Exclude<CompositionGuide, "none">
  /** focal point, normalised: u across width, h = fraction of tank height */
  focal: { u: number; h: number }
  /** visual bed slope as fraction of tank height (front, back) */
  bed: { front: number; back: number }
  hardscape: TemplateHardscape[]
  groups: TemplatePlantGroup[]
}

export interface InstantiatedTemplate {
  plants: PlantPlacement[]
  hardscape: HardscapeVisual[]
  /** cm, front view, for FrontalTank.focalPoint */
  focalPoint: { x: number; y: number }
  bed: { frontCm: number; backCm: number }
}

/**
 * Required exports (implemented in lib/templates/index.ts by app-agent):
 *
 *   export const TEMPLATES: readonly ScapeTemplate[]
 *     — at least: "iwagumi-sanzon" (Iwagumi, 3+ stones, carpet only),
 *       "nature-triangle" (Nature, wood + stones, triangle),
 *       "nature-concave" (Nature, two masses + open centre),
 *       "dutch-streets" (Dutch, stems in diagonal streets, no hardscape).
 *     Every speciesId must exist in the vendored botany plants.json.
 *
 *   export function getTemplate(id: string): ScapeTemplate | undefined
 *
 *   export function instantiate(t: ScapeTemplate, tank: TankDims, seed?: number): InstantiatedTemplate
 *     — pure and deterministic; ids "<speciesId>-<n>"; no placement inside a
 *       stone footprint (except onHardscape epiphytes); all positions clamped
 *       1 cm inside the glass; total placements ≤ 60 (sim budget).
 */
