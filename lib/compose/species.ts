/**
 * Species index for the one-sentence scape (compose contract 1.0.0): the
 * vendored botany records reduced to what parseIntent / composeScape need,
 * plus the name matcher (scientific + English common names, longest match).
 */
import { canAttach, isKnownSpecies } from "../editor"
import { isRegulated } from "../sim/regulated"
import type { Feature } from "./contract"

export interface SpeciesInfo {
  id: string
  /** display name: first English common name, else the scientific name */
  name: string
  scientificName: string
  growthForm: string
  placement: readonly string[]
  difficulty: number
  /** envelope.co2.min, ppm */
  co2Min: number
  /** envelope.light.min, µmol/m²/s */
  lightMin: number
  maxHeightCm: number
  colorRange: readonly string[]
  regulated: boolean
  /** editor canAttach(): epiphyte / moss with an "attached" placement */
  attachable: boolean
}

export interface SpeciesIndex {
  readonly species: readonly SpeciesInfo[]
  readonly byId: ReadonlyMap<string, SpeciesInfo>
  /** normalised lower-case name → botany id (unregulated species win name clashes) */
  readonly names: ReadonlyMap<string, string>
  /** matches any name in lower-cased text; longest alternative first */
  readonly nameRe: RegExp | null
}

/** colour tokens that count as "red" (contract: free-form botany tokens such as "red-high-light") */
export const RED_RE = /red|orange|pink|magenta|wine|copper|bronze|purple/

/** "Bacopa sp. 'Monte Carlo' (trade)" → "bacopa sp. monte carlo" */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/['‘’"“”]/g, "")
    .replace(/[\s-]+/g, " ")
    .trim()
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Built once from the vendored plants.json. Malformed records are skipped; never throws. */
export function buildSpeciesIndex(plants: readonly unknown[]): SpeciesIndex {
  const species: SpeciesInfo[] = []
  const byId = new Map<string, SpeciesInfo>()
  const names = new Map<string, string>()
  for (const raw of Array.isArray(plants) ? plants : []) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const id = r.id
    if (typeof id !== "string" || byId.has(id) || !isKnownSpecies(id)) continue
    const env = (r.envelope ?? {}) as Record<string, Record<string, unknown> | undefined>
    const growth = (r.growth ?? {}) as Record<string, unknown>
    const common = strs((r.commonNames as Record<string, unknown> | undefined)?.en)
    const scientificName = typeof r.scientificName === "string" ? r.scientificName : id
    const info: SpeciesInfo = {
      id,
      name: common[0] ?? scientificName,
      scientificName,
      growthForm: typeof r.growthForm === "string" ? r.growthForm : "",
      placement: strs(r.placement),
      difficulty: num(r.difficulty, 3),
      co2Min: num(env.co2?.min, 0),
      lightMin: num(env.light?.min, 0),
      maxHeightCm: num(growth.maxHeightCm, 10),
      colorRange: strs(r.colorRange),
      regulated: isRegulated(r),
      attachable: canAttach(id),
    }
    species.push(info)
    byId.set(id, info)
  }
  // names: scientific + common; an unregulated species wins a clash, else botany order
  const patterns = new Map<string, string>()
  for (const pass of [false, true]) {
    for (const sp of species) {
      if (sp.regulated !== pass) continue
      const rec = (plants as readonly Record<string, unknown>[]).find((p) => p && p.id === sp.id)
      const all = [sp.scientificName, ...strs((rec?.commonNames as Record<string, unknown> | undefined)?.en)]
      for (const n of all) {
        const k = normaliseName(n)
        // very short names ("ug") would match ordinary words — require ≥ 3 letters
        if (k.replace(/[^a-z]/g, "").length < 3) continue
        if (!names.has(k)) names.set(k, sp.id)
        // the pattern keeps apostrophes optional, so "wendt's" and "wendts" both match
        const raw = n.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[‘’“”"]/g, "'").replace(/[\s-]+/g, " ").trim()
        const src = raw
          .split(" ")
          .filter(Boolean)
          .map((t) => escapeRe(t).replace(/'/g, "['‘’]?"))
          .join("[\\s-]+")
        if (!patterns.has(src)) patterns.set(src, k)
      }
    }
  }
  const srcs = [...patterns.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  const nameRe = srcs.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${srcs.join("|")})(?![\\p{L}\\p{N}])`, "gu") : null
  return { species, byId, names, nameRe }
}

/** a matched text → botany id (via the same normalisation) */
export function speciesForMatch(index: SpeciesIndex, text: string): string | undefined {
  return index.names.get(normaliseName(text.replace(/['‘’]/g, "")))
}

export function isRed(sp: SpeciesInfo): boolean {
  return sp.colorRange.some((c) => RED_RE.test(c.toLowerCase()))
}

const GRASS_RE = /^(eleocharis|sagittaria|lilaeopsis|vallisneria|blyxa|acorus|cyperus)-/

/**
 * Feature predicates. carpet / moss / epiphytes / stems map to botany
 * growthForms; botany has no "crypt" or "grass" growthForm, so crypts =
 * genus Cryptocoryne and grass = the grass-like genera (hairgrass, dwarf
 * sagittaria, micro swords, vallisneria, …).
 */
export function hasFeature(sp: SpeciesInfo, f: Feature): boolean {
  switch (f) {
    case "carpet":
      return sp.growthForm === "carpeting"
    case "moss":
      return sp.growthForm === "moss"
    case "epiphytes":
      return sp.growthForm === "epiphyte"
    case "stems":
      return sp.growthForm === "stem"
    case "red":
      return isRed(sp)
    case "crypts":
      return sp.id.startsWith("cryptocoryne-")
    case "grass":
      return GRASS_RE.test(sp.id)
    default:
      return false
  }
}
