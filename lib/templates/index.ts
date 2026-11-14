/**
 * Style templates (风格模板) — implementation of contract v1.0.0
 * (lib/templates/contract.ts, orchestrator-owned).
 *
 * Layout rules per style (sources listed in contract.ts):
 *  - Iwagumi 三尊石: Oyaishi on the left third, clearly the largest and
 *    tallest; Fukuishi beside it and smaller; Soeishi smaller still; two
 *    Suteishi as fill on the opposite side (5 stones, odd count). Carpet and
 *    hairgrass only — no stems, no epiphytes. Steep bed slope (≈2 → 9 cm).
 *  - Nature triangle 三角构图: one dominant mass (wood + stones) peaking on the
 *    left golden line, descending in height towards the right front.
 *  - Nature concave 凹形构图: two masses at the left and right edges, low open
 *    centre that pulls the eye into depth.
 *  - Dutch streets 荷兰街道: no hardscape; single-species stem groups in thin
 *    diagonal bands front → back, neighbouring streets alternate red / green
 *    and fine / broad leaves, terraced from low front to tall back,
 *    ≈1 species per 10 cm of a 60 cm tank.
 */
import type { HardscapeVisual } from "@aquascape-studio/render"
import type { PlantPlacement, TankDims } from "../sim/vendor/sim-core/contract"
import type { InstantiatedTemplate, ScapeTemplate, TemplateHardscape, TemplatePlantGroup } from "./contract"

export type { ScapeTemplate, InstantiatedTemplate } from "./contract"

/** sim budget (contract): total placements per scape */
export const MAX_PLACEMENTS = 60
/** placements are kept this far inside the glass (contract) */
export const GLASS_MARGIN_CM = 1
/** extra clearance around a stone footprint for planted (non-epiphyte) placements */
export const STONE_CLEARANCE_CM = 0.5
/** template portions are tuned for a 60×30 cm footprint and scaled by area */
const REF_AREA_CM2 = 60 * 30

export const TEMPLATES: readonly ScapeTemplate[] = [
  {
    id: "iwagumi-sanzon",
    style: "iwagumi",
    composition: "triangle",
    nameZh: "三尊石组",
    nameEn: "Iwagumi · Sanzon",
    blurbZh: "主石立于左三分线，副石与添石依次变小，前景铺满草坪。",
    blurbEn: "Main stone on the left third, smaller companions beside it, a single carpet below.",
    light: "High",
    co2: true,
    guide: "thirds",
    focal: { u: 0.34, h: 0.42 },
    bed: { front: 0.055, back: 0.25 },
    hardscape: [
      { id: "oyaishi", kind: "stone", role: "oyaishi", u: 0.34, v: 0.42, wFrac: 0.2, hFrac: 0.5, dFrac: 0.34, rotationY: 0.28, seed: 101, buriedFrac: 0.2 },
      { id: "fukuishi", kind: "stone", role: "fukuishi", u: 0.49, v: 0.5, wFrac: 0.13, hFrac: 0.3, dFrac: 0.26, rotationY: -0.35, seed: 211, buriedFrac: 0.22 },
      { id: "soeishi", kind: "stone", role: "soeishi", u: 0.22, v: 0.56, wFrac: 0.09, hFrac: 0.17, dFrac: 0.2, rotationY: 0.6, seed: 307, buriedFrac: 0.25 },
      { id: "suteishi-1", kind: "stone", role: "suteishi", u: 0.7, v: 0.5, wFrac: 0.07, hFrac: 0.1, dFrac: 0.16, rotationY: -0.2, seed: 401, buriedFrac: 0.4 },
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
    nameZh: "三角构图",
    nameEn: "Nature · Triangle",
    blurbZh: "沉木与石块在左侧黄金线堆出高点，向右前方逐渐降低。",
    blurbEn: "Wood and stone peak on the left golden line and fall away to the right.",
    light: "Medium",
    co2: true,
    guide: "golden",
    focal: { u: 0.382, h: 0.55 },
    bed: { front: 0.05, back: 0.27 },
    hardscape: [
      { id: "wood-main", kind: "wood", u: 0.36, v: 0.38, wFrac: 0.36, hFrac: 0.62, dFrac: 0.3, rotationY: 0.45, seed: 601 },
      { id: "stone-a", kind: "stone", role: "oyaishi", u: 0.22, v: 0.56, wFrac: 0.14, hFrac: 0.26, dFrac: 0.26, rotationY: 0.3, seed: 613, buriedFrac: 0.2 },
      { id: "stone-b", kind: "stone", role: "fukuishi", u: 0.45, v: 0.62, wFrac: 0.09, hFrac: 0.14, dFrac: 0.2, rotationY: -0.4, seed: 617, buriedFrac: 0.25 },
    ],
    groups: [
      // tall background on the left, the peak of the triangle
      { speciesId: "rotala-rotundifolia", u: 0.13, v: 0.14, ru: 0.11, rv: 0.08, count: 5, portions: 2 },
      { speciesId: "pogostemon-erectus", u: 0.32, v: 0.12, ru: 0.1, rv: 0.07, count: 4, portions: 2 },
      // medium height towards the right
      { speciesId: "cryptocoryne-wendtii", u: 0.62, v: 0.3, ru: 0.12, rv: 0.1, count: 4, portions: 1 },
      // epiphytes on the hardscape
      { speciesId: "microsorum-pteropus-trident", u: 0.36, v: 0.38, ru: 0.08, rv: 0.06, count: 3, portions: 1, onHardscape: "wood-main" },
      { speciesId: "bucephalandra-sp-mini", u: 0.22, v: 0.56, ru: 0.04, rv: 0.04, count: 2, portions: 1, onHardscape: "stone-a" },
      { speciesId: "anubias-barteri-nana-petite", u: 0.45, v: 0.62, ru: 0.03, rv: 0.03, count: 1, portions: 1, onHardscape: "stone-b" },
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
    nameZh: "凹形构图",
    nameEn: "Nature · Concave",
    blurbZh: "左右两组沉木水草围出中央低谷，视线被引向深处。",
    blurbEn: "Two planted masses frame an open centre that draws the eye into depth.",
    light: "Medium",
    co2: true,
    guide: "thirds",
    focal: { u: 0.47, h: 0.28 },
    bed: { front: 0.05, back: 0.22 },
    hardscape: [
      { id: "wood-left", kind: "wood", u: 0.17, v: 0.4, wFrac: 0.26, hFrac: 0.58, dFrac: 0.26, rotationY: 0.5, seed: 701 },
      { id: "wood-right", kind: "wood", u: 0.84, v: 0.38, wFrac: 0.22, hFrac: 0.5, dFrac: 0.24, rotationY: -0.55, seed: 709 },
      { id: "stone-left", kind: "stone", role: "fukuishi", u: 0.27, v: 0.6, wFrac: 0.1, hFrac: 0.15, dFrac: 0.2, rotationY: 0.2, seed: 719, buriedFrac: 0.25 },
      { id: "stone-right", kind: "stone", role: "soeishi", u: 0.74, v: 0.62, wFrac: 0.08, hFrac: 0.12, dFrac: 0.18, rotationY: -0.6, seed: 727, buriedFrac: 0.3 },
    ],
    groups: [
      // left mass — tall background
      { speciesId: "rotala-rotundifolia", u: 0.1, v: 0.13, ru: 0.09, rv: 0.08, count: 4, portions: 2 },
      { speciesId: "ludwigia-repens", u: 0.27, v: 0.15, ru: 0.07, rv: 0.07, count: 3, portions: 2 },
      // right mass — tall background
      { speciesId: "limnophila-sessiliflora", u: 0.9, v: 0.13, ru: 0.08, rv: 0.08, count: 4, portions: 2 },
      { speciesId: "hygrophila-polysperma", u: 0.74, v: 0.16, ru: 0.07, rv: 0.07, count: 3, portions: 2 },
      // epiphytes on both woods
      { speciesId: "microsorum-pteropus-windelov", u: 0.17, v: 0.4, ru: 0.06, rv: 0.05, count: 2, portions: 1, onHardscape: "wood-left" },
      { speciesId: "taxiphyllum-barbieri", u: 0.84, v: 0.38, ru: 0.05, rv: 0.05, count: 2, portions: 1, onHardscape: "wood-right" },
      { speciesId: "bucephalandra-kedagang", u: 0.27, v: 0.6, ru: 0.03, rv: 0.03, count: 1, portions: 1, onHardscape: "stone-left" },
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
    nameZh: "荷兰街道",
    nameEn: "Dutch · Streets",
    blurbZh: "不用石木，红绿有茎草排成斜向街道，相邻色块强烈对比。",
    blurbEn: "No hardscape — red and green stems in diagonal streets of strong contrast.",
    light: "High",
    co2: true,
    guide: "thirds",
    focal: { u: 0.64, h: 0.55 },
    bed: { front: 0.05, back: 0.25 },
    hardscape: [],
    groups: [
      // back row, left → right: green fine / coral-red / green broad / red / green needle / dark red
      { speciesId: "heteranthera-zosterifolia", u: 0.09, v: 0.3, ru: 0.03, rv: 0.22, angle: 0.35, count: 4, portions: 2 },
      { speciesId: "ammannia-gracilis", u: 0.22, v: 0.32, ru: 0.035, rv: 0.24, angle: 0.35, count: 5, portions: 2 },
      { speciesId: "hygrophila-corymbosa", u: 0.36, v: 0.24, ru: 0.035, rv: 0.2, angle: 0.3, count: 4, portions: 2 },
      { speciesId: "rotala-macrandra", u: 0.52, v: 0.3, ru: 0.035, rv: 0.24, angle: 0.3, count: 5, portions: 2 },
      { speciesId: "pogostemon-erectus", u: 0.66, v: 0.26, ru: 0.035, rv: 0.22, angle: 0.25, count: 4, portions: 2 },
      { speciesId: "alternanthera-reineckii", u: 0.8, v: 0.32, ru: 0.035, rv: 0.22, angle: 0.25, count: 5, portions: 2 },
      { speciesId: "limnophila-aromatica", u: 0.93, v: 0.24, ru: 0.025, rv: 0.18, angle: 0.2, count: 3, portions: 2 },
      // front terrace: low streets
      { speciesId: "staurogyne-repens", u: 0.22, v: 0.82, ru: 0.18, rv: 0.05, angle: -0.12, count: 5, portions: 2 },
      { speciesId: "alternanthera-reineckii-mini", u: 0.5, v: 0.78, ru: 0.1, rv: 0.05, angle: -0.12, count: 4, portions: 2 },
      { speciesId: "lobelia-cardinalis-mini", u: 0.76, v: 0.82, ru: 0.15, rv: 0.05, angle: -0.12, count: 4, portions: 2 },
      { speciesId: "rotala-sp-hra", u: 0.92, v: 0.62, ru: 0.03, rv: 0.1, angle: 0.25, count: 3, portions: 2 },
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
  if (h.buriedFrac !== undefined) out.buriedFrac = h.buriedFrac
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

/** Group counts after the ≤ MAX_PLACEMENTS budget (proportional scale-down, ≥ 1 each). */
function budgetCounts(groups: readonly TemplatePlantGroup[]): number[] {
  const total = groups.reduce((a, g) => a + Math.max(0, Math.floor(g.count)), 0)
  if (total <= MAX_PLACEMENTS) return groups.map((g) => Math.max(0, Math.floor(g.count)))
  const k = MAX_PLACEMENTS / total
  const counts = groups.map((g) => Math.max(1, Math.floor(g.count * k)))
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

/**
 * Template → sim placements + render hardscape for a concrete tank. Pure and
 * deterministic for (t, tank, seed).
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

  const counts = budgetCounts(t.groups)
  const perSpecies = new Map<string, number>()
  const plants: PlantPlacement[] = []

  t.groups.forEach((g, gi) => {
    const n = counts[gi]!
    if (n <= 0) return
    const rand = prng(hashStr(`${t.id}|${gi}|${g.speciesId}`) ^ (seed >>> 0))
    const host = g.onHardscape !== undefined ? hsById.get(g.onHardscape) : undefined
    const portions = Math.max(1, Math.round(g.portions * Math.min(2, Math.max(0.5, areaScale))))
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
      return [cx + ca * lx - sa * lz, cz + sa * lx + ca * lz]
    }

    for (let k = 0; k < n; k++) {
      let x: number
      let z: number
      let y = 0
      if (host) {
        // epiphyte: tie onto the host piece — inside its footprint, upper part of it
        const [px, pz] = candidate(k, 0.25)
        const hx = host.sizeCm[0] / 2
        const hz = host.sizeCm[2] / 2
        x = clampX(Math.min(host.x + hx * 0.6, Math.max(host.x - hx * 0.6, px)))
        z = clampZ(Math.min(host.z + hz * 0.6, Math.max(host.z - hz * 0.6, pz)))
        const exposed = host.sizeCm[1] * (1 - (host.buriedFrac ?? 0.15))
        y = r2(exposed * (host.kind === "wood" ? 0.45 + 0.25 * rand() : 0.6 + 0.25 * rand()))
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
      plants.push({ id: `${g.speciesId}-${no}`, speciesId: g.speciesId, x: r2(x), z: r2(z), y, portions })
    }
  })

  return {
    plants,
    hardscape,
    focalPoint: { x: r2((t.focal.u - 0.5) * W), y: r2(t.focal.h * H) },
    bed: { frontCm: r2(t.bed.front * H), backCm: r2(t.bed.back * H) },
  }
}

function r2(v: number): number {
  return Math.round(v * 100) / 100
}
