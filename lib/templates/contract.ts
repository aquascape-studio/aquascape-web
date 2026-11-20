/**
 * Style templates — contract v1.2.0.
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
import type { CompositionGuide, StoneRole, WoodStyle, LeanSide } from "@aquascape-studio/render"
import type { HardscapeVisual } from "@aquascape-studio/render"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"

export const TEMPLATE_CONTRACT_VERSION = "1.2.0" as const

/*
 * 1.2.0 (2026-11-20 — a low-tech template; aquascape-sim#8 follow-up):
 *  - New required template "nature-lowtech", name "Nature · Low tech":
 *    style "nature", composition "triangle", light "Low", co2 false,
 *    guide "thirds". One root driftwood focal piece (same 1.1.0 wood rules)
 *    plus ≤ 2 stones.
 *  - Every species it uses must grow without injected CO2 and in low light:
 *    botany envelope.co2.min ≤ 5, envelope.light.min ≤ 40, difficulty ≤ 2,
 *    and no `regulated` entries (tested).
 *  - Planting: ≥ 3 epiphyte groups onHardscape (≥ 1 moss, ≥ 2 of Anubias /
 *    Bucephalandra / Java fern), ≥ 2 Cryptocoryne groups in the mid/foreground,
 *    ≥ 1 easy background stem or rosette group (e.g. Hygrophila, Vallisneria);
 *    no carpet plant that needs CO2. Dense enough that the day-45 frontal view
 *    is not sparse (same "never sparse" visual rule as the other templates).
 *  - All 1.1.0 rules (regulated, attach, tank scaling, ≤ 60 placements) apply.
 */

/*
 * 1.1.0 (2026-11-17 r2 — epiphytes, 11-16 follow-ups):
 *  - No template may use a species with a non-empty botany `regulated` list
 *    (tested). nature-concave's Limnophila sessiliflora and Hygrophila
 *    polysperma are replaced by unregulated stems of similar look.
 *  - TemplateHardscape gains optional woodStyle / leanSide (render 1.4.0).
 *    Nature templates use "root" driftwood as the focal piece, wFrac ≥ 0.45,
 *    centred in front of the stem background (v ≥ 0.45) so that at least
 *    half of its silhouette is visible from the front at day 45.
 *  - Every Nature template has ≥ 2 epiphyte groups `onHardscape` (one moss,
 *    one Anubias / Bucephalandra / Java fern). Their placements are seated on
 *    hardscapeAnchors(host, …) (render 1.4.0) and listed in
 *    InstantiatedTemplate.attach; (u, v, ru, rv) only pick which anchors
 *    (nearest to the group ellipse).
 *  - InstantiatedTemplate.attach: plantId → hardscapeId (editor 1.2.0).
 */

/*
 * 1.0.2 (2026-11-17, owner decision: English-only app; orchestrator-authorised
 * app-agent edit):
 *  - ScapeTemplate drops nameZh / blurbZh; nameEn / blurbEn become the single
 *    English `name` / `blurb`.
 *
 * 1.0.1 (2026-11-15, from app-agent objections):
 *  - Composition gains "iwagumi" (odd-stone triangle grouping). Existing
 *    iwagumi templates should use it instead of "triangle".
 *  - TemplatePlantGroup.angle is applied in CM space after (u,v)→(x,z)
 *    scaling, so a 30° street stays 30° in any tank aspect ratio.
 *  - Tank-size scaling: group `count` is a reference for a 60 × 30 cm
 *    footprint; instantiate() scales it by (W·D)/(60·30), rounds, keeps ≥ 1,
 *    then scales all groups down proportionally if the total exceeds 60.
 *  - Suteishi default buriedFrac is 0.35 (render 1.2.0).
 */

export type ScapeStyle = "iwagumi" | "nature" | "dutch"
export type Composition = "triangle" | "concave" | "convex" | "streets" | "iwagumi"
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
  /** wood only (1.1.0) */
  woodStyle?: WoodStyle | undefined
  /** root wood only (1.1.0) */
  leanSide?: LeanSide | undefined
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
  /** display name, "<Style> · <Composition>", e.g. "Iwagumi · Sanzon" */
  name: string
  /** one short English sentence */
  blurb: string
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
  /**
   * 1.1.0 — epiphytes tied onto hardscape: plantId → hardscapeId. Optional in
   * the type only so 1.0.x output stays valid; 1.1.0 instantiate() always sets it.
   */
  attach?: Record<string, string> | undefined
}

/**
 * Required exports (implemented in lib/templates/index.ts by app-agent):
 *
 *   export const TEMPLATES: readonly ScapeTemplate[]
 *     — at least: "iwagumi-sanzon" (Iwagumi, 3+ stones, carpet only),
 *       "nature-triangle" (Nature, wood + stones, triangle),
 *       "nature-concave" (Nature, two masses + open centre),
 *       "dutch-streets" (Dutch, stems in diagonal streets, no hardscape),
 *       "nature-lowtech" (1.2.0: Nature, Low light, no CO2, epiphytes +
 *       Cryptocoryne on root wood).
 *     Every speciesId must exist in the vendored botany plants.json.
 *
 *   export function getTemplate(id: string): ScapeTemplate | undefined
 *
 *   export function instantiate(t: ScapeTemplate, tank: TankDims, seed?: number): InstantiatedTemplate
 *     — pure and deterministic; ids "<speciesId>-<n>"; no placement inside a
 *       stone footprint (except onHardscape epiphytes); all positions clamped
 *       1 cm inside the glass; total placements ≤ 60 (sim budget).
 */
