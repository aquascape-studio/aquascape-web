/**
 * Style templates — implementation of contract v1.1.0
 * (lib/templates/contract.ts, orchestrator-owned).
 *
 * 1.0.1: iwagumi composition; group angle applied in cm space; group counts
 * are references for a 60 × 30 cm footprint, scaled by tank area then capped
 * at 60 total; suteishi default buriedFrac 0.35.
 * 1.0.2: English-only — single `name` / `blurb`.
 * 1.1.0: no regulated species; Nature templates have a "root" driftwood focal
 * piece and ≥ 2 epiphyte groups (moss + Anubias / Bucephalandra / Java fern)
 * seated on anchors() of their host (lib/editor/surface.ts, the render 1.4.0
 * hardscapeAnchors stand-in); instantiate() returns `attach`.
 *
 * Layout rules per style (sources listed in contract.ts):
 *  - Iwagumi sanzon: Oyaishi on the left third, clearly the largest and
 *    tallest; Fukuishi beside it and smaller; Soeishi smaller still; two
 *    Suteishi as fill on the opposite side (5 stones, odd count). Carpet and
 *    hairgrass only — no stems, no epiphytes. Steep bed slope (≈2 → 9 cm).
 *  - Nature triangle: one dominant mass peaking on the left golden line — a
 *    root driftwood whose trunk leans left, in front of the stem background —
 *    descending in height towards the right front; two stones in front.
 *  - Nature concave: two masses at the left and right edges (a wide root
 *    driftwood leaning left, a smaller one leaning right), low open centre
 *    that pulls the eye into depth.
 *  - Dutch streets: no hardscape; single-species stem groups in thin
 *    diagonal bands front → back, neighbouring streets alternate red / green
 *    and fine / broad leaves, terraced from low front to tall back,
 *    ≈1 species per 10 cm of a 60 cm tank.
 */
import type { HardscapeVisual, StoneRole } from "@aquascape-studio/render"
import { ANCHORS_PER_HOST, anchors, surfaceY } from "../editor/surface"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"
import type { InstantiatedTemplate, ScapeTemplate, TemplateHardscape, TemplatePlantGroup } from "./contract"

export type { ScapeTemplate, InstantiatedTemplate } from "./contract"

/** sim budget (contract): total placements per scape */
export const MAX_PLACEMENTS = 60
/** placements are kept this far inside the glass (contract) */
export const GLASS_MARGIN_CM = 1
/** extra clearance around a stone footprint for planted (non-epiphyte) placements */
export const STONE_CLEARANCE_CM = 0.5
/** group counts are references for a 60 × 30 cm footprint (contract 1.0.1) */
export const REF_AREA_CM2 = 60 * 30
/** render 1.2.0 default buriedFrac: suteishi 0.35, every other piece 0.15 */
export function defaultBuriedFrac(role: StoneRole | undefined): number {
  return role === "suteishi" ? 0.35 : 0.15
}

/** lean of the Dutch back streets, radians in cm space (≈ 32°) */
const STREET_ANGLE = 0.55

export const TEMPLATES: readonly ScapeTemplate[] = [
  {
    id: "iwagumi-sanzon",
    style: "iwagumi",
    composition: "iwagumi",
    name: "Iwagumi · Sanzon",
    blurb: "Main stone on the left third, two smaller stones beside it, a full carpet in front.",
    light: "High",
    co2: true,
    guide: "thirds",
    focal: { u: 0.34, h: 0.42 },
    bed: { front: 0.055, back: 0.25 },
    hardscape: [
      { id: "oyaishi", kind: "stone", role: "oyaishi", u: 0.34, v: 0.42, wFrac: 0.2, hFrac: 0.5, dFrac: 0.34, rotationY: 0.28, seed: 101, buriedFrac: 0.2 },
      { id: "fukuishi", kind: "stone", role: "fukuishi", u: 0.49, v: 0.5, wFrac: 0.13, hFrac: 0.3, dFrac: 0.26, rotationY: -0.35, seed: 211, buriedFrac: 0.22 },
      { id: "soeishi", kind: "stone", role: "soeishi", u: 0.22, v: 0.56, wFrac: 0.09, hFrac: 0.17, dFrac: 0.2, rotationY: 0.6, seed: 307, buriedFrac: 0.25 },
      { id: "suteishi-1", kind: "stone", role: "suteishi", u: 0.7, v: 0.5, wFrac: 0.07, hFrac: 0.1, dFrac: 0.16, rotationY: -0.2, seed: 401 }, // default buriedFrac 0.35
      { id: "suteishi-2", kind: "stone", role: "suteishi", u: 0.8, v: 0.66, wFrac: 0.05, hFrac: 0.07, dFrac: 0.12, rotationY: 0.9, seed: 503, buriedFrac: 0.45 },
    ],
    groups: [
      // short hairgrass behind and between the stones — reads as distant meadow
      { speciesId: "eleocharis-acicularis-mini", u: 0.5, v: 0.17, ru: 0.46, rv: 0.13, count: 12, portions: 2 },
      // Glossostigma mid-depth around the stone group
      { speciesId: "glossostigma-elatinoides", u: 0.52, v: 0.5, ru: 0.44, rv: 0.13, count: 10, portions: 2 },
      // HC Cuba: the main foreground carpet
      { speciesId: "hemianthus-callitrichoides-cuba", u: 0.5, v: 0.8, ru: 0.47, rv: 0.16, count: 16, portions: 2 },
    ],
  },
  {
    id: "nature-triangle",
    style: "nature",
    composition: "triangle",
    name: "Nature · Triangle",
    blurb: "Wood and stone peak on the left golden line and slope down toward the front right.",
    light: "Medium",
    co2: true,
    guide: "golden",
    focal: { u: 0.382, h: 0.55 },
    bed: { front: 0.05, back: 0.27 },
    hardscape: [
      // 1.1.0 focal piece: root driftwood centred in front of the stem background, trunk leaning to the left peak
      { id: "wood-main", kind: "wood", woodStyle: "root", leanSide: "left", u: 0.42, v: 0.48, wFrac: 0.47, hFrac: 0.62, dFrac: 0.26, rotationY: 0.12, seed: 601 },
      { id: "stone-a", kind: "stone", role: "oyaishi", u: 0.15, v: 0.7, wFrac: 0.12, hFrac: 0.22, dFrac: 0.22, rotationY: 0.3, seed: 613, buriedFrac: 0.2 },
      { id: "stone-b", kind: "stone", role: "fukuishi", u: 0.6, v: 0.74, wFrac: 0.08, hFrac: 0.12, dFrac: 0.17, rotationY: -0.4, seed: 617, buriedFrac: 0.25 },
    ],
    groups: [
      // tall background on the left, the peak of the triangle
      { speciesId: "rotala-rotundifolia", u: 0.13, v: 0.14, ru: 0.11, rv: 0.08, count: 5, portions: 2 },
      { speciesId: "pogostemon-erectus", u: 0.32, v: 0.12, ru: 0.1, rv: 0.07, count: 4, portions: 2 },
      // medium height towards the right
      { speciesId: "cryptocoryne-wendtii", u: 0.72, v: 0.3, ru: 0.1, rv: 0.1, count: 4, portions: 1 },
      // epiphytes tied onto the hardscape (seated on surface anchors): moss on the upper trunk,
      // Java fern at the root flare, Bucephalandra / Anubias on the stones' shoulders
      { speciesId: "taxiphyllum-barbieri", u: 0.3, v: 0.46, ru: 0.1, rv: 0.06, count: 3, portions: 1, onHardscape: "wood-main" },
      { speciesId: "microsorum-pteropus-trident", u: 0.56, v: 0.5, ru: 0.08, rv: 0.06, count: 2, portions: 1, onHardscape: "wood-main" },
      { speciesId: "bucephalandra-sp-mini", u: 0.15, v: 0.7, ru: 0.04, rv: 0.04, count: 2, portions: 1, onHardscape: "stone-a" },
      { speciesId: "anubias-barteri-nana-petite", u: 0.6, v: 0.74, ru: 0.03, rv: 0.03, count: 1, portions: 1, onHardscape: "stone-b" },
      // low right side and foreground
      { speciesId: "cryptocoryne-parva", u: 0.84, v: 0.62, ru: 0.1, rv: 0.12, count: 4, portions: 1 },
      { speciesId: "staurogyne-repens", u: 0.2, v: 0.84, ru: 0.15, rv: 0.08, count: 5, portions: 1 },
      { speciesId: "micranthemum-tweediei-monte-carlo", u: 0.62, v: 0.84, ru: 0.32, rv: 0.12, count: 10, portions: 2 },
    ],
  },
  {
    id: "nature-concave",
    style: "nature",
    composition: "concave",
    name: "Nature · Concave",
    blurb: "Two masses of wood and plants frame a low open centre that draws the eye into depth.",
    light: "Medium",
    co2: true,
    guide: "thirds",
    focal: { u: 0.47, h: 0.28 },
    bed: { front: 0.05, back: 0.22 },
    hardscape: [
      // 1.1.0 focal piece: a wide root driftwood whose trunk rises to the left edge; the low root flare points into the open centre
      { id: "wood-left", kind: "wood", woodStyle: "root", leanSide: "left", u: 0.27, v: 0.47, wFrac: 0.45, hFrac: 0.6, dFrac: 0.24, rotationY: 0.1, seed: 701 },
      { id: "wood-right", kind: "wood", woodStyle: "root", leanSide: "right", u: 0.83, v: 0.42, wFrac: 0.26, hFrac: 0.5, dFrac: 0.22, rotationY: -0.2, seed: 709 },
      { id: "stone-left", kind: "stone", role: "fukuishi", u: 0.12, v: 0.72, wFrac: 0.1, hFrac: 0.15, dFrac: 0.2, rotationY: 0.2, seed: 719, buriedFrac: 0.25 },
      { id: "stone-right", kind: "stone", role: "soeishi", u: 0.76, v: 0.66, wFrac: 0.08, hFrac: 0.12, dFrac: 0.18, rotationY: -0.6, seed: 727, buriedFrac: 0.3 },
    ],
    groups: [
      // left mass — tall background
      { speciesId: "rotala-rotundifolia", u: 0.1, v: 0.13, ru: 0.09, rv: 0.08, count: 4, portions: 2 },
      { speciesId: "ludwigia-repens", u: 0.27, v: 0.15, ru: 0.07, rv: 0.07, count: 3, portions: 2 },
      // right mass — tall background (1.1.0: unregulated stems of the same fine / broad-leaf look
      // replace Limnophila sessiliflora and Hygrophila polysperma, both US federal noxious weeds)
      { speciesId: "limnophila-heterophylla", u: 0.9, v: 0.13, ru: 0.08, rv: 0.08, count: 4, portions: 2 },
      { speciesId: "hygrophila-corymbosa-siamensis-53b", u: 0.74, v: 0.16, ru: 0.07, rv: 0.07, count: 3, portions: 2 },
      // epiphytes tied onto both woods and the left stone: moss up the left trunk, Java fern at its flare
      { speciesId: "vesicularia-montagnei", u: 0.14, v: 0.45, ru: 0.08, rv: 0.06, count: 2, portions: 1, onHardscape: "wood-left" },
      { speciesId: "microsorum-pteropus-windelov", u: 0.38, v: 0.5, ru: 0.06, rv: 0.05, count: 2, portions: 1, onHardscape: "wood-left" },
      { speciesId: "taxiphyllum-barbieri", u: 0.88, v: 0.42, ru: 0.05, rv: 0.05, count: 2, portions: 1, onHardscape: "wood-right" },
      { speciesId: "bucephalandra-kedagang", u: 0.12, v: 0.72, ru: 0.03, rv: 0.03, count: 1, portions: 1, onHardscape: "stone-left" },
      // low valley floor: short grass at the back, carpet in front
      { speciesId: "eleocharis-acicularis-mini", u: 0.5, v: 0.3, ru: 0.14, rv: 0.12, count: 6, portions: 2 },
      { speciesId: "cryptocoryne-parva", u: 0.32, v: 0.78, ru: 0.08, rv: 0.08, count: 3, portions: 1 },
      { speciesId: "cryptocoryne-parva", u: 0.7, v: 0.8, ru: 0.08, rv: 0.08, count: 3, portions: 1 },
      { speciesId: "eleocharis-parvula", u: 0.5, v: 0.66, ru: 0.22, rv: 0.12, count: 8, portions: 2 },
      { speciesId: "micranthemum-tweediei-monte-carlo", u: 0.5, v: 0.86, ru: 0.3, rv: 0.08, count: 8, portions: 2 },
    ],
  },
  {
    id: "dutch-streets",
    style: "dutch",
    composition: "streets",
    name: "Dutch · Streets",
    blurb: "No stone or wood — red and green stems in diagonal streets, each in strong contrast to the next.",
    light: "High",
    co2: true,
    guide: "thirds",
    focal: { u: 0.64, h: 0.55 },
    bed: { front: 0.05, back: 0.25 },
    hardscape: [],
    groups: [
      // 11-14 feedback: streets must read as clear diagonal bands. Every back street is a long, thin
      // ellipse at the same 32° lean (cm space), 0.13 W apart, so parallel bands of single species run
      // back-right → front-left with bare gaps between them; neighbours alternate red / green and
      // fine / broad leaves. Hygrophila corymbosa (60 cm, broad leaves) was swamping its neighbours:
      // it is now a short, narrow street with 2 single-portion clumps.
      // back row, left → right: green fine / coral-red / green broad / red / green needle / dark red / green / orange
      { speciesId: "heteranthera-zosterifolia", u: 0.07, v: 0.36, ru: 0.022, rv: 0.3, angle: STREET_ANGLE, count: 4, portions: 2 },
      { speciesId: "ammannia-gracilis", u: 0.2, v: 0.36, ru: 0.022, rv: 0.3, angle: STREET_ANGLE, count: 4, portions: 2 },
      { speciesId: "hygrophila-corymbosa", u: 0.33, v: 0.28, ru: 0.016, rv: 0.2, angle: STREET_ANGLE, count: 2, portions: 1 },
      { speciesId: "rotala-macrandra", u: 0.46, v: 0.36, ru: 0.022, rv: 0.3, angle: STREET_ANGLE, count: 4, portions: 2 },
      { speciesId: "pogostemon-erectus", u: 0.59, v: 0.36, ru: 0.022, rv: 0.3, angle: STREET_ANGLE, count: 4, portions: 2 },
      { speciesId: "alternanthera-reineckii", u: 0.72, v: 0.36, ru: 0.022, rv: 0.3, angle: STREET_ANGLE, count: 4, portions: 2 },
      { speciesId: "limnophila-aromatica", u: 0.85, v: 0.36, ru: 0.022, rv: 0.3, angle: STREET_ANGLE, count: 4, portions: 2 },
      { speciesId: "rotala-sp-hra", u: 0.96, v: 0.4, ru: 0.018, rv: 0.22, angle: STREET_ANGLE, count: 3, portions: 2 },
      // front terrace: low streets, slightly angled against the back streets
      { speciesId: "staurogyne-repens", u: 0.2, v: 0.84, ru: 0.17, rv: 0.045, angle: -0.12, count: 5, portions: 2 },
      { speciesId: "alternanthera-reineckii-mini", u: 0.5, v: 0.8, ru: 0.1, rv: 0.045, angle: -0.12, count: 4, portions: 2 },
      { speciesId: "lobelia-cardinalis-mini", u: 0.78, v: 0.84, ru: 0.14, rv: 0.045, angle: -0.12, count: 4, portions: 2 },
    ],
  },
]

const BY_TEMPLATE_ID = new Map(TEMPLATES.map((t) => [t.id, t]))

export function getTemplate(id: string): ScapeTemplate | undefined {
  return BY_TEMPLATE_ID.get(id)
}

/** `?tpl=` → template, or undefined for a missing / unknown id. */
export function parseTemplateParam(raw: string | null | undefined): ScapeTemplate | undefined {
  if (!raw) return undefined
  return getTemplate(raw.trim())
}

export type GuideMode = "none" | "thirds" | "golden"
export const GUIDE_MODES: readonly GuideMode[] = ["none", "thirds", "golden"]

/** `?guides=` → guide mode, default "none". */
export function parseGuidesParam(raw: string | null | undefined): GuideMode {
  return raw === "thirds" || raw === "golden" ? raw : "none"
}

// ---------------------------------------------------------------------------

/** cm-space hardscape for a tank (no rounding surprises: 2 decimals). */
export function hardscapeFor(h: TemplateHardscape, tank: TankDims): HardscapeVisual {
  const { widthCm: W, depthCm: D, heightCm: H } = tank
  const out: HardscapeVisual = {
    id: h.id,
    kind: h.kind,
    x: r2((h.u - 0.5) * W),
    z: r2((h.v - 0.5) * D),
    rotationY: h.rotationY,
    sizeCm: [r2(h.wFrac * W), r2(h.hFrac * H), r2(h.dFrac * D)],
    seed: h.seed,
  }
  if (h.role !== undefined) out.role = h.role
  // 1.1.0: driftwood style / lean (render 1.3.0 / 1.4.0)
  if (h.kind === "wood" && h.woodStyle !== undefined) out.woodStyle = h.woodStyle
  if (h.kind === "wood" && h.woodStyle === "root" && h.leanSide !== undefined) out.leanSide = h.leanSide
  // suteishi default 0.35 (contract 1.0.1 / render 1.2.0) — made explicit so the doc carries it
  if (h.buriedFrac !== undefined) out.buriedFrac = h.buriedFrac
  else if (h.kind === "stone" && h.role === "suteishi") out.buriedFrac = defaultBuriedFrac("suteishi")
  return out
}

/**
 * Elliptical footprint test in the floor plane. ≤ 1 means inside the stone's
 * bounding ellipse grown by `marginCm`.
 */
export function footprintDistance(h: Pick<HardscapeVisual, "x" | "z" | "rotationY" | "sizeCm">, x: number, z: number, marginCm = 0): number {
  const dx = x - h.x
  const dz = z - h.z
  const c = Math.cos(h.rotationY)
  const s = Math.sin(h.rotationY)
  // rotate the point into the stone's local frame (rotation about +y)
  const lx = c * dx - s * dz
  const lz = s * dx + c * dz
  const a = h.sizeCm[0] / 2 + marginCm
  const b = h.sizeCm[2] / 2 + marginCm
  return (lx / a) ** 2 + (lz / b) ** 2
}

export function insideFootprint(h: Pick<HardscapeVisual, "x" | "z" | "rotationY" | "sizeCm">, x: number, z: number, marginCm = 0): boolean {
  return footprintDistance(h, x, z, marginCm) <= 1
}

/** mulberry32 */
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

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Group counts for a tank (contract 1.0.1): reference count × (W·D)/(60·30),
 * rounded, ≥ 1; then, if the total exceeds MAX_PLACEMENTS, every group is
 * scaled down proportionally (≥ 1 each, largest trimmed first).
 */
export function scaledCounts(groups: readonly TemplatePlantGroup[], tank: TankDims): number[] {
  const area = (tank.widthCm * tank.depthCm) / REF_AREA_CM2
  const scaled = groups.map((g) => (g.count > 0 ? Math.max(1, Math.round(g.count * area)) : 0))
  const total = scaled.reduce((a, n) => a + n, 0)
  if (total <= MAX_PLACEMENTS) return scaled
  const k = MAX_PLACEMENTS / total
  const counts = scaled.map((n) => (n > 0 ? Math.max(1, Math.floor(n * k)) : 0))
  // hand the floor() leftovers to the largest remainders (stable order) so the budget is used fully
  let left = MAX_PLACEMENTS - counts.reduce((a, n) => a + n, 0)
  const byRemainder = scaled
    .map((n, i) => ({ i, r: n > 0 ? n * k - Math.floor(n * k) : -1 }))
    .filter((e) => e.r >= 0)
    .sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    counts[i]! += 1
    left--
  }
  // trim (largest first) if the ≥1 floor pushed us over
  let over = counts.reduce((a, n) => a + n, 0) - MAX_PLACEMENTS
  while (over > 0) {
    let iMax = 0
    counts.forEach((n, i) => { if (n > counts[iMax]!) iMax = i })
    counts[iMax]! -= 1
    over--
  }
  return counts
}

/** anchors offered per host piece to its epiphyte groups (editor 1.2.2: shared with the editor) */
export { ANCHORS_PER_HOST } from "../editor/surface"

/**
 * Template → sim placements + render hardscape for a concrete tank. Pure and
 * deterministic for (t, tank, seed). Epiphyte groups (`onHardscape`) are
 * seated on anchors(host, ANCHORS_PER_HOST = 12): each group takes the free anchors nearest to
 * its (u, v, ru, rv) ellipse, and its placements are listed in `attach`.
 */
export function instantiate(t: ScapeTemplate, tank: TankDims, seed = 0): InstantiatedTemplate {
  const { widthCm: W, depthCm: D, heightCm: H } = tank
  const hardscape = t.hardscape.map((h) => hardscapeFor(h, tank))
  const hsById = new Map(hardscape.map((h) => [h.id, h]))
  const stones = hardscape.filter((h) => h.kind === "stone")
  const xMax = W / 2 - GLASS_MARGIN_CM
  const zMax = D / 2 - GLASS_MARGIN_CM
  const clampX = (x: number) => Math.min(xMax, Math.max(-xMax, x))
  const clampZ = (z: number) => Math.min(zMax, Math.max(-zMax, z))
  const blocked = (x: number, z: number) => stones.some((s) => insideFootprint(s, x, z, STONE_CLEARANCE_CM))
  const areaScale = (W * D) / REF_AREA_CM2

  const counts = scaledCounts(t.groups, tank)
  const attach: Record<string, string> = {}
  const hostAnchors = new Map<string, ReturnType<typeof anchors>>()
  const usedAnchors = new Map<string, Set<number>>()
  const perSpecies = new Map<string, number>()
  const plants: PlantPlacement[] = []

  t.groups.forEach((g, gi) => {
    const n = counts[gi]!
    if (n <= 0) return
    const rand = prng(hashStr(`${t.id}|${gi}|${g.speciesId}`) ^ (seed >>> 0))
    const host = g.onHardscape !== undefined ? hsById.get(g.onHardscape) : undefined
    // counts carry the tank-area scaling; portions only make up for what the 60-placement cap removed
    const wanted = g.count * areaScale
    const portions = Math.max(1, Math.round(g.portions * Math.min(2, Math.max(1, wanted / n))))
    const angle = g.angle ?? 0
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const a = g.ru * W
    const b = g.rv * D
    const cx = (g.u - 0.5) * W
    const cz = (g.v - 0.5) * D
    const phase = rand() * Math.PI * 2

    /** point k of n on a Vogel spiral inside the (rotated) group ellipse, with jitter */
    const candidate = (k: number, jitter: number): [number, number] => {
      const r = Math.sqrt((k + 0.5) / n)
      const th = phase + k * GOLDEN_ANGLE
      let ex = r * Math.cos(th) + (rand() - 0.5) * jitter
      let ez = r * Math.sin(th) + (rand() - 0.5) * jitter
      const m = Math.hypot(ex, ez)
      if (m > 1) { ex /= m; ez /= m }
      const lx = ex * a
      const lz = ez * b
      // angle is measured in the floor plane from the width axis
      // contract 1.0.1: rotation is applied in cm space after (u,v) → (x,z) scaling,
      // so a street keeps its angle in any tank aspect ratio
      return [cx + ca * lx - sa * lz, cz + sa * lx + ca * lz]
    }

    // 1.1.0: epiphyte groups take the free host anchors nearest to their ellipse (normalised distance)
    let seats: { x: number; z: number; y: number }[] = []
    if (host) {
      if (!hostAnchors.has(host.id)) {
        hostAnchors.set(host.id, anchors(host, ANCHORS_PER_HOST))
        usedAnchors.set(host.id, new Set())
      }
      const list = hostAnchors.get(host.id)!
      const used = usedAnchors.get(host.id)!
      const ellipseDist = (ax: number, az: number) => {
        const dx = ax - cx
        const dz = az - cz
        const lx = ca * dx + sa * dz
        const lz = -sa * dx + ca * dz
        return Math.hypot(lx / Math.max(0.5, a), lz / Math.max(0.5, b))
      }
      const order = list.map((_, i) => i).sort((i, j) => ellipseDist(list[i]!.x, list[i]!.z) - ellipseDist(list[j]!.x, list[j]!.z) || i - j)
      const free = order.filter((i) => !used.has(i))
      const pick = [...free, ...order].slice(0, n)
      for (const i of pick) used.add(i)
      seats = pick.map((i) => list[i]!)
    }

    for (let k = 0; k < n; k++) {
      let x: number
      let z: number
      let y = 0
      if (host) {
        const seat = seats[k]
        if (!seat) continue // a piece without an upward-facing surface: nothing to tie onto
        x = r2(clampX(seat.x))
        z = r2(clampZ(seat.z))
        // the surface height at the stored position, exactly as the editor seats it (no drift on load)
        y = Math.max(0.1, r2(surfaceY(host, x, z) ?? seat.y))
      } else {
        let found: [number, number] | null = null
        for (let tries = 0; tries < 40 && !found; tries++) {
          const [px, pz] = tries === 0 ? candidate(k, 0.18) : candidate(Math.floor(rand() * n), 0.6 + tries * 0.05)
          const qx = clampX(px)
          const qz = clampZ(pz)
          if (!blocked(qx, qz)) found = [qx, qz]
        }
        if (!found) continue // group area fully covered by stone: skip rather than plant inside it
        ;[x, z] = found
      }
      const no = (perSpecies.get(g.speciesId) ?? 0) + 1
      perSpecies.set(g.speciesId, no)
      const id = `${g.speciesId}-${no}`
      plants.push({ id, speciesId: g.speciesId, x: r2(x), z: r2(z), y, portions })
      if (host) attach[id] = host.id
    }
  })

  return {
    plants,
    hardscape,
    focalPoint: { x: r2((t.focal.u - 0.5) * W), y: r2(t.focal.h * H) },
    bed: { frontCm: r2(t.bed.front * H), backCm: r2(t.bed.back * H) },
    attach,
  }
}

function r2(v: number): number {
  return Math.round(v * 100) / 100
}
