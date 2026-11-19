/**
 * parseIntent (compose contract 1.0.0): one English sentence → ScapeIntent.
 * Pure, deterministic, never throws. Rule-based: every recogniser yields
 * candidate spans on the lower-cased text; overlapping candidates are
 * resolved earliest-first, longest-first, so spans never overlap and each
 * understood phrase yields exactly one span.
 */
import type { WoodStyle } from "@aquascape-studio/render"
import type { TankDims } from "../sim/vendor/sim-core/contract"
import type { Composition, LightLevel, ScapeStyle } from "../templates/contract"
import { TANK_PRESETS, type Feature, type IntentSpan, type ScapeIntent, type SpanKind } from "./contract"
import { speciesForMatch, type SpeciesIndex } from "./species"

export const MAX_TEXT = 280

/** water column = glass height − 4 cm, at least 20 cm (contract) */
export function waterHeight(glassH: number): number {
  return Math.max(20, glassH - 4)
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** final dims clamped to W 20–180, D 15–75, H 20–70 (contract) */
export function clampTank(w: number, d: number, h: number): TankDims {
  const c = (v: number, lo: number, hi: number) => r1(Math.min(hi, Math.max(lo, v)))
  return { widthCm: c(w, 20, 180), depthCm: c(d, 15, 75), heightCm: c(h, 20, 70) }
}

/** preset key → water-column dims */
export function presetTank(key: string): TankDims | null {
  const p = TANK_PRESETS[key]
  if (!p) return null
  const [w, d, h] = p.glass
  return clampTank(w, d, waterHeight(h))
}

export function fmtCm(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export function tankLabel(t: TankDims): string {
  return `${fmtCm(t.widthCm)} × ${fmtCm(t.depthCm)} × ${fmtCm(t.heightCm)} cm`
}

/** words that carry no meaning for the scape (never reported as "not understood") */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "a an the and or but with w in on of for to into inside at as by from my me i we you it its this that these those is are be " +
    "please want would like could can make build create give show do get need some any lots lot plenty few little bit plus also using use " +
    "style styled scape scapes aquascape aquascaping layout tank tanks aquarium aquariums setup set up planted plants plant just " +
    "mostly mainly very really nice beautiful pretty simple small big large lush dense green natural-looking look looking type kind sort " +
    "front back foreground midground background middle centre center left right side sides " +
    "one two three four five lots of"
  ).split(" "),
)

interface Candidate {
  start: number
  end: number
  kind: SpanKind
  label: string
  apply: (i: ScapeIntent) => void
  /** set when "no X" / "without X" may negate this phrase */
  negate?: { label: string; apply: (i: ScapeIntent) => void } | undefined
  /** words to report as not understood (still consumed so they do not mis-parse) */
  unknownWords?: string[] | undefined
  /** "no wood" / "without stones": negation not supported for this phrase → report as not understood */
  unknownOnNegate?: boolean | undefined
}

const B = "(?<![\\p{L}\\p{N}])"
const E = "(?![\\p{L}\\p{N}])"
const re = (src: string) => new RegExp(`${B}(?:${src})${E}`, "gu")

const NUM = "(\\d{1,3}(?:\\.\\d+)?)"
const UNIT = "(?:\\s*(cm|centimet(?:er|re)s?|inch(?:es)?|in|\"|”))?"
const SEP = "\\s*[x×*]\\s*"
const DIMS_RE = new RegExp(`(?<![\\p{L}\\p{N}.])${NUM}${UNIT}${SEP}${NUM}${UNIT}${SEP}${NUM}${UNIT}(?![\\p{L}\\p{N}])`, "gu")
const LONE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.])${NUM}\\s*(?:(cm|centimet(?:er|re)s?|inch(?:es)?|\"|”)(?![\\p{L}\\p{N}])|(in)(?=\\s*(?:$|[,.;:)!?]|wide|long|tank|aquarium)))`,
  "gu",
)
const isInch = (u: string | undefined) => u !== undefined && /^(in|inch|inches|"|”)$/.test(u)

const NEG_BEFORE = /(?:^|[^\p{L}\p{N}])(no|without|not|skip|minus|zero)\s+(?:any\s+|the\s+)?$/u

const FEATURES: { src: string; f: Feature; label: string }[] = [
  { src: "carpets?|carpeting|carpeted|carpet\\s+plants?", f: "carpet", label: "Carpet" },
  { src: "moss(?:es)?|mossy", f: "moss", label: "Moss" },
  { src: "epiphytes?|epiphytic|anubias|buce|bucephalandras?|bucephalandra", f: "epiphytes", label: "Epiphytes" },
  { src: "reds?|red\\s+plants?|reddish", f: "red", label: "Red plants" },
  { src: "stems?|stem\\s+plants?|stemmed", f: "stems", label: "Stems" },
  { src: "crypts?|cryptocorynes?|cryptocoryne", f: "crypts", label: "Crypts" },
  { src: "grass(?:es)?|grassy|hair\\s*grass|hairgrass", f: "grass", label: "Grass" },
]

const STYLES: { src: string; style: ScapeStyle; label: string }[] = [
  { src: "iwagumi", style: "iwagumi", label: "Iwagumi" },
  { src: "nature\\s+aquarium|nature|natural|jungle|naturescape", style: "nature", label: "Nature" },
  { src: "dutch", style: "dutch", label: "Dutch" },
]

const COMPOSITIONS: { src: string; c: Composition; label: string }[] = [
  { src: "triangle|triangular", c: "triangle", label: "Triangle" },
  { src: "concave|u[\\s-]*shaped?|valley", c: "concave", label: "Concave" },
  { src: "convex|mound|island", c: "convex", label: "Convex" },
  { src: "streets?", c: "streets", label: "Streets" },
  { src: "sanzon|three[\\s-]+stones?|3[\\s-]+stones?|three[\\s-]+stone", c: "iwagumi", label: "Sanzon" },
]

const LIGHTS: { src: string; light: LightLevel; label: string }[] = [
  { src: "low[\\s-]*light(?:ing)?|dim(?:\\s+light(?:ing)?)?|shaded|shady", light: "Low", label: "Low light" },
  { src: "(?:medium|moderate|med|mid)[\\s-]*light(?:ing)?", light: "Medium", label: "Medium light" },
  { src: "high[\\s-]*light(?:ing)?|bright(?:\\s+light(?:ing)?)?|strong\\s+light(?:ing)?", light: "High", label: "High light" },
]

/** lower-case each UTF-16 unit separately so offsets into the original text stay valid */
function lowerSameLength(s: string): string {
  let out = ""
  for (const ch of s) {
    const l = ch.toLowerCase()
    out += l.length === ch.length ? l : ch
  }
  return out
}

function emptyIntent(): ScapeIntent {
  return {
    style: null,
    composition: null,
    tank: null,
    tankPreset: null,
    light: null,
    co2: null,
    hardscape: null,
    woodStyle: null,
    want: [],
    avoid: [],
    species: [],
    avoidSpecies: [],
    spans: [],
    unknown: [],
  }
}

const pushUnique = <T,>(list: T[], v: T) => {
  if (!list.includes(v)) list.push(v)
}

/** set a field only the first time a phrase states it */
function first<K extends keyof ScapeIntent>(i: ScapeIntent, k: K, v: ScapeIntent[K]): void {
  if (i[k] === null) i[k] = v
}

function collect(text: string, lc: string, index: SpeciesIndex): Candidate[] {
  const out: Candidate[] = []
  const each = (r: RegExp, f: (m: RegExpExecArray) => Candidate | null) => {
    r.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = r.exec(lc))) {
      if (m[0].length === 0) {
        r.lastIndex++
        continue
      }
      const c = f(m)
      if (c) out.push(c)
    }
  }
  const at = (m: RegExpExecArray) => ({ start: m.index, end: m.index + m[0].length })

  // --- tank: presets
  each(re("(?:ada\\s*)?(30|45|60|90)\\s*-?\\s*([cp])"), (m) => {
    const key = `${m[1]}${m[2]}`
    const t = presetTank(key)
    if (!t) return null
    return { ...at(m), kind: "tank", label: TANK_PRESETS[key]!.label, apply: (i) => setTank(i, t, key) }
  })
  const GAL = "(?:gal(?:lon)?s?\\.?|g)"
  const us: [string, string][] = [
    [`10\\s*-?\\s*${GAL}`, "10g"],
    [`20\\s*-?\\s*(?:${GAL}\\s*)?(?:long|l)`, "20l"],
    [`29\\s*-?\\s*${GAL}`, "29g"],
    [`40\\s*-?\\s*(?:${GAL}\\s*)?(?:breeder|b)`, "40b"],
  ]
  for (const [src, key] of us) {
    const t = presetTank(key)!
    each(re(src), (m) => ({ ...at(m), kind: "tank", label: TANK_PRESETS[key]!.label, apply: (i) => setTank(i, t, key) }))
  }
  // --- tank: W × D × H (glass, cm or inches)
  each(DIMS_RE, (m) => {
    const units = [m[2], m[4], m[6]]
    const inch = units.some(isInch) && !units.some((u) => u !== undefined && !isInch(u))
    const k = inch ? 2.54 : 1
    const [w, d, h] = [Number(m[1]) * k, Number(m[3]) * k, Number(m[5]) * k]
    if (![w, d, h].every((v) => Number.isFinite(v) && v > 0)) return null
    const t = clampTank(w, d, waterHeight(h))
    const label = `${fmtCm(r1(w))} × ${fmtCm(r1(d))} × ${fmtCm(r1(h))} cm`
    return { ...at(m), kind: "tank", label, apply: (i) => setTank(i, t, null) }
  })
  // --- tank: lone length "60 cm" → W, D = W/2, glass H = 0.6 W (25–60)
  each(LONE_RE, (m) => {
    const unit = m[2] ?? m[3]
    const w = Number(m[1]) * (isInch(unit) ? 2.54 : 1)
    if (!(Number.isFinite(w) && w > 0)) return null
    const gh = Math.min(60, Math.max(25, Math.round(0.6 * w)))
    const t = clampTank(w, Math.round(w / 2), waterHeight(gh))
    return { ...at(m), kind: "tank", label: `${fmtCm(t.widthCm)} cm wide`, apply: (i) => setTank(i, t, null) }
  })

  // --- style / composition
  for (const s of STYLES) each(re(s.src), (m) => ({ ...at(m), kind: "style", label: s.label, apply: (i) => first(i, "style", s.style) }))
  for (const c of COMPOSITIONS) each(re(c.src), (m) => ({ ...at(m), kind: "composition", label: c.label, apply: (i) => first(i, "composition", c.c) }))

  // --- light (bright → High, dim → Low)
  for (const l of LIGHTS) each(re(l.src), (m) => ({ ...at(m), kind: "light", label: l.label, apply: (i) => first(i, "light", l.light) }))

  // --- CO2
  each(re("co[2₂](?:\\s+injection|\\s+injected)?|pressuri[sz]ed(?:\\s+co[2₂])?|injected\\s+co[2₂]|high[\\s-]*tech"), (m) => ({
    ...at(m),
    kind: "co2",
    label: /tech/.test(m[0]) ? "High tech" : "CO2",
    apply: (i) => first(i, "co2", true),
    negate: { label: "No CO2", apply: (i) => first(i, "co2", false) },
  }))
  each(re("low[\\s-]*tech|easy|beginners?(?:[\\s-]+friendly)?"), (m) => {
    const easy = /easy|beginner/.test(m[0])
    return {
      ...at(m),
      kind: "co2",
      label: easy ? "Easy" : "Low tech",
      apply: (i) => {
        first(i, "co2", false)
        if (easy) easyFlag.add(i)
      },
    }
  })

  // --- hardscape
  each(re("no\\s+hardscape|without\\s+hardscape|plants?\\s+only|only\\s+plants|no\\s+stones?\\s+(?:or|and|nor)\\s+(?:drift)?wood|no\\s+(?:drift)?wood\\s+(?:or|and|nor)\\s+stones?"), (m) => ({
    ...at(m),
    kind: "hardscape",
    label: "No hardscape",
    apply: (i) => {
      i.hardscape = "none"
    },
  }))
  each(re("seiryu(?:\\s+stones?)?|dragon\\s+(?:stones?|rocks?)|stones?|rocks?|pebbles?|boulders?"), (m) => ({
    ...at(m),
    kind: "hardscape",
    label: "Stone",
    apply: (i) => addHardscape(i, "stone"),
    unknownOnNegate: true,
  }))
  each(re("spider[\\s-]*wood|branch(?:es|y)?|root[\\s-]*wood|roots?|tree(?:\\s+trunk)?|logs?|drift[\\s-]*wood|wood|manzanita"), (m) => {
    const t = m[0]
    const style: WoodStyle | null = /spider|branch|manzanita/.test(t) ? "branchy" : /root|tree/.test(t) ? "root" : /log/.test(t) ? "log" : null
    const label = style === "branchy" ? "Branchy wood" : style === "root" ? "Root wood" : style === "log" ? "Log" : "Driftwood"
    return {
      ...at(m),
      kind: "hardscape",
      label,
      apply: (i) => {
        addHardscape(i, "wood")
        if (style) first(i, "woodStyle", style)
      },
      unknownOnNegate: true,
    }
  })

  // --- features
  for (const f of FEATURES) {
    each(re(f.src), (m) => ({
      ...at(m),
      kind: "feature",
      label: f.label,
      apply: (i) => pushUnique(i.want, f.f),
      negate: { label: `No ${f.label.toLowerCase()}`, apply: (i) => pushUnique(i.avoid, f.f) },
    }))
  }

  // --- species (scientific or English common name, longest match)
  if (index.nameRe) {
    each(index.nameRe, (m) => {
      const id = speciesForMatch(index, text.slice(m.index, m.index + m[0].length))
      const sp = id ? index.byId.get(id) : undefined
      if (!id || !sp) return null
      return {
        ...at(m),
        kind: "species",
        label: sp.name,
        apply: (i) => pushUnique(i.species, id),
        negate: { label: `No ${sp.name}`, apply: (i) => pushUnique(i.avoidSpecies, id) },
      }
    })
  }

  // --- negation: "no X" / "without X" / "not X" / "skip X" negates the next phrase only
  return out.map((c) => {
    const neg = NEG_BEFORE.exec(lc.slice(0, c.start))
    if (!neg) return c
    // the match may begin with the separator before the negation word
    const s0 = c.start - neg[0].length + (/^[^\p{L}\p{N}]/u.test(neg[0]) ? 1 : 0)
    if (c.negate) return { start: s0, end: c.end, kind: "negation" as const, label: c.negate.label, apply: c.negate.apply }
    if (c.unknownOnNegate) {
      // "no wood" / "without stones": not supported in v1 — consumed (so it cannot read as "wood") and reported
      const words = lc.slice(s0, c.end).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      return { start: s0, end: c.end, kind: "negation" as const, label: "", apply: () => {}, unknownWords: words }
    }
    return c
  })
}

/** intents that said "easy" / "beginner" (imply light Low when light is unstated) */
const easyFlag = new WeakSet<ScapeIntent>()

function setTank(i: ScapeIntent, t: TankDims, preset: string | null): void {
  if (i.tank !== null) return
  i.tank = { ...t }
  i.tankPreset = preset
}

function addHardscape(i: ScapeIntent, kind: "stone" | "wood"): void {
  if (i.hardscape === "none") return
  if (i.hardscape === null) i.hardscape = kind
  else if (i.hardscape !== kind && i.hardscape !== "both") i.hardscape = "both"
}

/** earliest first, longest first; drop anything overlapping an accepted span */
function resolve(cands: Candidate[]): Candidate[] {
  const sorted = [...cands].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const out: Candidate[] = []
  let end = -1
  for (const c of sorted) {
    if (c.start < end) continue
    out.push(c)
    end = c.end
  }
  return out
}

export function parseIntent(text: string, index: SpeciesIndex): ScapeIntent {
  const intent = emptyIntent()
  try {
    const src = (typeof text === "string" ? text : "").trim().slice(0, MAX_TEXT)
    if (!src) return intent
    const lc = lowerSameLength(src)
    const accepted = resolve(collect(src, lc, index))
    const unknownExtra: string[] = []
    for (const c of accepted) {
      c.apply(intent)
      if (c.unknownWords) unknownExtra.push(...c.unknownWords)
      else intent.spans.push({ start: c.start, end: c.end, kind: c.kind, label: c.label })
    }
    // "plants only" / "no hardscape" wins over any stone / wood phrase
    if (accepted.some((c) => c.kind === "hardscape" && c.label === "No hardscape")) {
      intent.hardscape = "none"
      intent.woodStyle = null
    }
    if (easyFlag.has(intent) && intent.light === null) intent.light = "Low"
    easyFlag.delete(intent)
    // a feature both wanted and avoided: the negation wins
    intent.want = intent.want.filter((f) => !intent.avoid.includes(f))
    intent.species = intent.species.filter((id) => !intent.avoidSpecies.includes(id))
    // words outside every span, minus stop words
    let rest = ""
    let pos = 0
    for (const c of accepted) {
      rest += lc.slice(pos, c.start) + " "
      pos = c.end
    }
    rest += lc.slice(pos)
    const words = [...unknownExtra, ...rest.split(/[^\p{L}\p{N}'’]+/u)]
      .map((w) => w.replace(/^['’]+|['’]+$/g, ""))
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    for (const w of words) pushUnique(intent.unknown, w)
    return intent
  } catch {
    return emptyIntent()
  }
}
