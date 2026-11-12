import type { BotanyRecord, BuildResult, Zone } from "@/lib/sim/buildInput"
import type { Frame, SimEvent } from "@/lib/sim/vendor/sim-core/contract"

export interface SpeciesMeta {
  id: string
  zh: string
  en: string
  latin: string
  /** red / pink plants use the coral accent */
  red: boolean
  zone: Zone
  qty: number
  /** legacy UI name this species stands in for, when not an exact match */
  substituteFor: string | null
  instanceIds: string[]
}

const RED_WORDS = ["red", "pink", "magenta"]

export function speciesMeta(built: BuildResult, byId: Map<string, BotanyRecord>, legacyNames: Record<string, string>): SpeciesMeta[] {
  const out = new Map<string, SpeciesMeta>()
  for (const r of built.resolved) {
    const rec = byId.get(r.speciesId)
    if (!rec) continue
    const prev = out.get(r.speciesId)
    if (prev) {
      prev.qty += r.qty
      continue
    }
    const colorRange = rec.colorRange ?? []
    out.set(r.speciesId, {
      id: r.speciesId,
      zh: rec.commonNames?.zh?.[0]?.replace(/（.*?）/g, "") ?? rec.scientificName,
      en: rec.commonNames?.en?.[0] ?? rec.scientificName,
      latin: rec.scientificName,
      red: colorRange.some((c) => RED_WORDS.some((w) => c.startsWith(w) || c.includes(`${w}-high`) || c === w)),
      zone: r.zone,
      qty: r.qty,
      substituteFor: r.exact ? null : (legacyNames[r.sourceId] ?? r.sourceId),
      instanceIds: built.input.plants.filter((p) => p.speciesId === r.speciesId).map((p) => p.id),
    })
  }
  return [...out.values()]
}

/** biomass per species per day (g), from the frames received so far */
export function speciesSeries(frames: Frame[], species: SpeciesMeta[]): Map<string, number[]> {
  const owner = new Map<string, string>()
  for (const s of species) for (const id of s.instanceIds) owner.set(id, s.id)
  const out = new Map(species.map((s) => [s.id, [] as number[]]))
  for (const f of frames) {
    const day = new Map<string, number>()
    for (const p of f.plants) {
      const sid = owner.get(p.id)
      if (sid) day.set(sid, (day.get(sid) ?? 0) + p.biomassG)
    }
    for (const s of species) out.get(s.id)!.push(day.get(s.id) ?? 0)
  }
  return out
}

export function totalSeries(frames: Frame[]): number[] {
  return frames.map((f) => f.plants.reduce((a, p) => a + p.biomassG, 0))
}

export function eventsByDay(frames: Frame[]): Map<number, SimEvent[]> {
  const m = new Map<number, SimEvent[]>()
  for (const f of frames) if (f.events.length) m.set(f.day, f.events)
  return m
}

export function lowLightFraction(frame: Frame | undefined, lowLightPar: number): number {
  if (!frame) return 0
  const par = frame.light.par
  let n = 0
  for (let i = 0; i < par.length; i++) if (par[i]! < lowLightPar) n++
  return par.length ? n / par.length : 0
}

export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function fmtG(v: number): string {
  return v >= 100 ? `${Math.round(v)}` : v >= 10 ? v.toFixed(1) : v.toFixed(2)
}
