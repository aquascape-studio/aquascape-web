/**
 * Maps the /studio/sim URL params (as written by /studio/new) to a sim-core
 * SimInput. Pure and deterministic — same params ⇒ same input.
 *
 * URL params: name, w, d, h (cm), light = Low|Medium|High, co2 = "true",
 * plants = JSON {plantId: qty}. plantId is a legacy UI id (e.g. "hc-cuba")
 * or a botany id.
 */
import type { PlantPlacement, SimInput, SpeciesRecord } from "./vendor/sim-core/contract"

export type Zone = "foreground" | "midground" | "background" | "floating"
export type LightLevel = "Low" | "Medium" | "High"

/** Legacy UI ids → nearest botany species in plants.json (+ the zone the old UI implied). */
export const LEGACY_PLANT_MAP: Record<string, { speciesId: string; zone: Zone; exact: boolean }> = {
  "java-moss":            { speciesId: "taxiphyllum-barbieri",              zone: "foreground", exact: true },
  // No plain M. pteropus in botany; the 'Narrow' cultivar is the nearest.
  "java-fern":            { speciesId: "microsorum-pteropus-narrow",        zone: "midground",  exact: false },
  "anubias-barteri":      { speciesId: "anubias-barteri",                   zone: "midground",  exact: true },
  "amazon-sword":         { speciesId: "echinodorus-bleheri",               zone: "background", exact: true },
  "rotala-rotundifolia":  { speciesId: "rotala-rotundifolia",               zone: "background", exact: true },
  "ludwigia-repens":      { speciesId: "ludwigia-repens",                   zone: "background", exact: true },
  "dwarf-hairgrass":      { speciesId: "eleocharis-parvula",                zone: "foreground", exact: true },
  "monte-carlo":          { speciesId: "micranthemum-tweediei-monte-carlo", zone: "foreground", exact: true },
  "hc-cuba":              { speciesId: "hemianthus-callitrichoides-cuba",   zone: "foreground", exact: true },
  "glossostigma":         { speciesId: "glossostigma-elatinoides",          zone: "foreground", exact: true },
  "cryptocoryne-wendtii": { speciesId: "cryptocoryne-wendtii",              zone: "midground",  exact: true },
  "vallisneria":          { speciesId: "vallisneria-spiralis",              zone: "background", exact: true },
  "hornwort":             { speciesId: "ceratophyllum-demersum",            zone: "background", exact: true },
  "water-wisteria":       { speciesId: "hygrophila-difformis",              zone: "background", exact: true },
  // No Aponogeton in botany; tall ruffled background rosette is the nearest.
  "aponogeton-ulvaceus":  { speciesId: "cryptocoryne-balansae",             zone: "background", exact: false },
}

// Surface PAR under the fixture. Beer-Lambert (k=0.03/cm) leaves ~34/68/109 PAR at the substrate of a 36 cm tank,
// i.e. typical low / medium / high planted-tank lighting at substrate level.
export const LIGHT_PAR: Record<LightLevel, number> = { Low: 100, Medium: 200, High: 320 }
export const CO2_PPM = { on: 25, off: 5 } as const
export const DEFAULT_PLANTS: Record<string, number> = { "rotala-rotundifolia": 5, "java-fern": 2, "amazon-sword": 1 }
export const DEFAULT_TANK = { widthCm: 60, depthCm: 30, heightCm: 36 } as const
export const SIM_DAYS = 90
const MAX_INSTANCES_PER_SPECIES = 12

/** Botany record as stored in plants.json (superset of SpeciesRecord). */
export type BotanyRecord = SpeciesRecord & {
  placement?: string[]
  commonNames?: { en?: string[]; zh?: string[] }
  colorRange?: string[]
  colorHex?: string
}

export interface ResolvedPlant {
  /** id as given in the URL */
  sourceId: string
  speciesId: string
  zone: Zone
  qty: number
  exact: boolean
}

export interface BuildResult {
  input: SimInput
  name: string
  light: LightLevel
  co2: boolean
  resolved: ResolvedPlant[]
  /** URL plant ids that could not be mapped to any botany record */
  unknown: string[]
}

type ParamSource = { get(key: string): string | null }

function num(v: string | null, fallback: number, min: number, max: number): number {
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function parsePlants(raw: string | null): Record<string, number> {
  if (!raw) return DEFAULT_PLANTS
  try {
    const obj: unknown = JSON.parse(raw)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return DEFAULT_PLANTS
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(obj)) {
      const q = Math.floor(Number(v))
      if (Number.isFinite(q) && q > 0) out[k] = Math.min(q, 99)
    }
    return Object.keys(out).length ? out : DEFAULT_PLANTS
  } catch {
    return DEFAULT_PLANTS
  }
}

/** Zone for a botany record when the URL already uses botany ids. */
export function zoneFor(rec: BotanyRecord): Zone {
  const pl = rec.placement ?? []
  if (rec.growthForm === "floating" || pl.includes("floating")) return "floating"
  if (rec.growthForm === "carpeting") return "foreground"
  if (rec.growthForm === "stem" && pl.includes("background")) return "background"
  if (pl.length && pl.every((p) => p === "foreground" || p === "attached")) return "foreground"
  if (pl.includes("midground")) return "midground"
  if (pl.includes("background")) return "background"
  return "foreground"
}

export function resolvePlant(id: string, byId: Map<string, BotanyRecord>): Omit<ResolvedPlant, "qty"> | null {
  const legacy = LEGACY_PLANT_MAP[id]
  if (legacy && byId.has(legacy.speciesId)) return { sourceId: id, ...legacy }
  const rec = byId.get(id)
  if (rec) return { sourceId: id, speciesId: id, zone: zoneFor(rec), exact: true }
  return null
}

/** z (cm, back → front, origin at tank centre) for each zone, as a fraction of half-depth. */
const ZONE_Z: Record<Zone, number> = { background: -0.62, midground: -0.05, foreground: 0.6, floating: -0.2 }
const ZONE_ORDER: Zone[] = ["background", "midground", "foreground", "floating"]

export function buildInput(params: ParamSource, plants: readonly BotanyRecord[]): BuildResult {
  const byId = new Map(plants.map((p) => [p.id, p]))
  const name = params.get("name") ?? "My Aquascape"
  const lightRaw = params.get("light")
  const light: LightLevel = lightRaw === "Low" || lightRaw === "High" ? lightRaw : "Medium"
  const co2 = params.get("co2") === "true"
  const tank = {
    widthCm: num(params.get("w"), DEFAULT_TANK.widthCm, 10, 300),
    depthCm: num(params.get("d"), DEFAULT_TANK.depthCm, 10, 150),
    heightCm: num(params.get("h"), DEFAULT_TANK.heightCm, 10, 120),
  }

  const resolved: ResolvedPlant[] = []
  const unknown: string[] = []
  for (const [id, qty] of Object.entries(parsePlants(params.get("plants")))) {
    const r = resolvePlant(id, byId)
    if (r) resolved.push({ ...r, qty })
    else unknown.push(id)
  }

  // Deterministic layout: each species gets `min(qty, MAX)` instances; zones are rows,
  // instances spread evenly along x with a small alternating z stagger.
  const placements: PlantPlacement[] = []
  const halfD = tank.depthCm / 2
  for (const zone of ZONE_ORDER) {
    const inZone = resolved.filter((r) => r.zone === zone)
    const slots: { r: ResolvedPlant; portions: number; k: number }[] = []
    for (const r of inZone) {
      const n = Math.min(r.qty, MAX_INSTANCES_PER_SPECIES)
      for (let k = 0; k < n; k++) {
        // spread leftover qty across instances so total portions == qty
        const portions = Math.floor(r.qty / n) + (k < r.qty % n ? 1 : 0)
        slots.push({ r, portions, k })
      }
    }
    const n = slots.length
    const margin = Math.min(4, tank.widthCm * 0.06)
    const usable = tank.widthCm - 2 * margin
    slots.forEach(({ r, portions, k }, i) => {
      const x = -tank.widthCm / 2 + margin + (usable * (i + 0.5)) / n
      const stagger = (i % 2 === 0 ? 1 : -1) * 0.12 * halfD
      const z = Math.max(-halfD, Math.min(halfD, ZONE_Z[zone] * halfD + (n > 1 ? stagger : 0)))
      const rec = byId.get(r.speciesId)
      const y = zone === "floating" ? tank.heightCm : rec?.growthForm === "epiphyte" ? 4 : 0
      placements.push({
        id: `${r.speciesId}#${k + 1}`,
        speciesId: r.speciesId,
        x: round2(x),
        z: round2(z),
        y,
        portions,
      })
    })
  }

  const species: Record<string, SpeciesRecord> = {}
  for (const r of resolved) {
    const rec = byId.get(r.speciesId)
    if (rec) species[r.speciesId] = rec
  }

  const input: SimInput = {
    tank,
    light: { surfacePar: LIGHT_PAR[light], photoperiodH: 8, coverage: 0.85 },
    water: { temperatureC: 25, pH: 6.8, gh: 6, kh: 4, co2Ppm: co2 ? CO2_PPM.on : CO2_PPM.off },
    dosing: { no3: 1.5, po4: 0.15, k: 1.5, fe: 0.02 },
    plants: placements,
    species,
    days: SIM_DAYS,
    seed: hashSeed(JSON.stringify([tank, light, co2, resolved.map((r) => [r.speciesId, r.qty])])),
    gridX: 32,
    substrate: { type: "aquasoil", reserve: 1 },
    lowLightPar: 30,
  }
  return { input, name, light, co2, resolved, unknown }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** FNV-1a 32-bit — stable seed from the scape definition. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
