/**
 * Compose contract 1.0.0 (lib/compose/contract.ts): parseIntent + composeScape.
 */
import { describe, expect, it } from "vitest"
import plantsJson from "../sim/vendor/plants.json"
import {
  MAX_PLANTS,
  canAttach,
  decodeScape,
  editorReducer,
  encodeScape,
  hostOf,
  initEditor,
  isKnownSpecies,
  migrateAttach,
  needsResim,
  type ScapeDoc,
} from "../editor"
import { surfaceY as surfY } from "../editor/surface"
import { TEMPLATES, getTemplate } from "../templates"
import {
  COMPOSE_CONTRACT_VERSION,
  DEFAULT_PRESET,
  EXAMPLE_PROMPTS,
  MAX_NOTES,
  TANK_PRESETS,
  buildSpeciesIndex,
  chooseTemplate,
  clampTank,
  composeScape,
  hasFeature,
  isRed,
  parseIntent,
  presetTank,
  summarizeIntent,
  type ComposeResult,
  type ScapeIntent,
} from "./index"

const INDEX = buildSpeciesIndex(plantsJson as unknown[])
const parse = (t: string) => parseIntent(t, INDEX)
const compose = (t: string, seed = 0) => composeScape(parse(t), INDEX, seed)
const sp = (id: string) => INDEX.byId.get(id)!

/** the editor invariants (editor 1.2.x) + share-link round trip + budget */
function checkDoc(doc: ScapeDoc, label = ""): void {
  expect(doc.v).toBe(1)
  expect(doc.plants.length, `${label} ≤ 60 plants`).toBeLessThanOrEqual(MAX_PLANTS)
  const ids = new Set(doc.plants.map((p) => p.id))
  expect(ids.size, `${label} unique ids`).toBe(doc.plants.length)
  const hs = new Map(doc.hardscape.map((h) => [h.id, h]))
  if (doc.attach !== undefined) expect(Object.keys(doc.attach).length).toBeGreaterThan(0)
  for (const [pid, hid] of Object.entries(doc.attach ?? {})) {
    expect(ids.has(pid), `${label} attach key ${pid}`).toBe(true)
    expect(hs.has(hid), `${label} attach value ${hid}`).toBe(true)
  }
  for (const p of doc.plants) {
    expect(isKnownSpecies(p.speciesId), `${label} ${p.speciesId}`).toBe(true)
    expect(Math.abs(p.x), `${label} ${p.id} x`).toBeLessThanOrEqual(doc.tank.widthCm / 2 - 1 + 1e-9)
    expect(Math.abs(p.z), `${label} ${p.id} z`).toBeLessThanOrEqual(doc.tank.depthCm / 2 - 1 + 1e-9)
    const hid = hostOf(doc, p.id)
    if (hid === undefined) expect(p.y, `${label} ${p.id} planted`).toBe(0)
    else {
      expect(canAttach(p.speciesId), `${label} ${p.id} attachable`).toBe(true)
      expect(p.y).toBeGreaterThan(0)
      expect(surfY(hs.get(hid)!, p.x, p.z), `${label} ${p.id} on ${hid}`).not.toBeNull()
    }
  }
  expect(migrateAttach(doc), `${label} canonical`).toBe(doc)
  const link = encodeScape(doc)
  const back = decodeScape(link)
  expect(back, `${label} decodes`).not.toBeNull()
  expect(back!.plants.map((p) => p.id)).toEqual(doc.plants.map((p) => p.id))
  expect(back!.attach).toEqual(doc.attach)
  expect(encodeScape(back!), `${label} stable round trip`).toBe(link)
}

/** contract filters */
const needsCo2 = (id: string) => sp(id).co2Min >= 10 || sp(id).difficulty >= 4
const needsHighLight = (id: string) => sp(id).lightMin > 40

describe("contract", () => {
  it("is version 1.1.0", () => expect(COMPOSE_CONTRACT_VERSION).toBe("1.2.0"))
})

describe("buildSpeciesIndex", () => {
  it("indexes every vendored species and tolerates junk", () => {
    expect(INDEX.species.length).toBe((plantsJson as unknown[]).length)
    expect(INDEX.byId.get("hemianthus-callitrichoides-cuba")!.name).toBe("HC Cuba")
    const junk = buildSpeciesIndex([null, 3, "x", {}, { id: "not-a-plant" }, { id: "anubias-barteri" }] as unknown[])
    expect(junk.species.map((s) => s.id)).toEqual(["anubias-barteri"])
    expect(buildSpeciesIndex(undefined as unknown as unknown[]).species).toEqual([])
  })
  it("flags regulated species and unregulated names win clashes", () => {
    expect(sp("cabomba-caroliniana").regulated).toBe(true)
    // "Ambulia" is a common name of both Limnophila sessiliflora (regulated) and L. aromatica
    expect(parse("dutch with ambulia").species).toEqual(["limnophila-aromatica"])
  })
})

describe("parseIntent · tank presets", () => {
  const cases: [string, string][] = [
    ["60p", "60p"], ["60-p", "60p"], ["60 p", "60p"], ["ada 60p", "60p"], ["ADA 60-P", "60p"], ["60P", "60p"],
    ["30c", "30c"], ["30-C", "30c"], ["ada 30 c", "30c"], ["45p", "45p"], ["45-P", "45p"], ["90p", "90p"], ["ADA 90P", "90p"],
    ["10 gal", "10g"], ["10 gallon", "10g"], ["10 gallons", "10g"], ["10g", "10g"],
    ["20 long", "20l"], ["20l", "20l"], ["20L", "20l"], ["20 gallon long", "20l"], ["20g long", "20l"],
    ["29 gallon", "29g"], ["29 gal", "29g"], ["29g", "29g"],
    ["40 breeder", "40b"], ["40b", "40b"], ["40 gallon breeder", "40b"],
  ]
  it.each(cases)("%j → %s", (text, key) => {
    const i = parse(`iwagumi in a ${text}`)
    expect(i.tankPreset).toBe(key)
    const [w, d, h] = TANK_PRESETS[key]!.glass
    expect(i.tank).toEqual(clampTank(w, d, Math.max(20, h - 4)))
    expect(i.unknown).toEqual([])
    expect(i.spans.filter((s) => s.kind === "tank")).toHaveLength(1)
  })
  it("water column = glass − 4 cm (60-P → 60 × 30 × 32)", () => {
    expect(presetTank("60p")).toEqual({ widthCm: 60, depthCm: 30, heightCm: 32 })
    expect(presetTank("10g")).toEqual({ widthCm: 50.8, depthCm: 25.4, heightCm: 26.5 })
    expect(presetTank("nope")).toBeNull()
  })
  it("does not invent presets (30p, 60c) or read plain words as tanks", () => {
    expect(parse("30p").tank).toBeNull()
    expect(parse("60c").tank).toBeNull()
    expect(parse("60 plants").tank).toBeNull()
  })
})

describe("parseIntent · W × D × H", () => {
  const cm: [string, [number, number, number]][] = [
    ["90x45x45", [90, 45, 41]],
    ["90 x 45 x 45", [90, 45, 41]],
    ["90×45×45", [90, 45, 41]],
    ["90 × 45 × 45 cm", [90, 45, 41]],
    ["90*45*45", [90, 45, 41]],
    ["90cm x 45cm x 45cm", [90, 45, 41]],
    ["60 X 30 X 36", [60, 30, 32]],
  ]
  it.each(cm)("cm: %j", (text, [w, d, h]) => {
    const i = parse(`dutch ${text}`)
    expect(i.tank).toEqual({ widthCm: w, depthCm: d, heightCm: h })
    expect(i.tankPreset).toBeNull()
    expect(i.unknown).toEqual([])
  })
  const inch: [string, [number, number, number]][] = [
    ['24x12x16 in', [61, 30.5, 36.6]],
    ['24"x12"x16"', [61, 30.5, 36.6]],
    ["24 × 12 × 16 inches", [61, 30.5, 36.6]],
    ["36*18*16 inch", [91.4, 45.7, 36.6]],
  ]
  it.each(inch)("inches: %j", (text, [w, d, h]) => {
    const i = parse(`nature ${text}`)
    expect(i.tank!.widthCm).toBeCloseTo(w, 1)
    expect(i.tank!.depthCm).toBeCloseTo(d, 1)
    expect(i.tank!.heightCm).toBeCloseTo(h, 1)
    expect(i.unknown).toEqual([])
  })
  it("clamps to W 20–180, D 15–75, H 20–70", () => {
    expect(parse("500x200x150").tank).toEqual({ widthCm: 180, depthCm: 75, heightCm: 70 })
    expect(parse("5x5x5").tank).toEqual({ widthCm: 20, depthCm: 15, heightCm: 20 })
    expect(parse("100x10x22").tank).toEqual({ widthCm: 100, depthCm: 15, heightCm: 20 })
  })
})

describe("parseIntent · lone length", () => {
  it("60 cm → 60 × 30 × (round(0.6·60) − 4)", () => {
    expect(parse("iwagumi 60 cm").tank).toEqual({ widthCm: 60, depthCm: 30, heightCm: 32 })
    expect(parse("iwagumi 60cm").tank).toEqual({ widthCm: 60, depthCm: 30, heightCm: 32 })
  })
  it("glass height clamped 25–60 before the water column", () => {
    expect(parse("120 cm dutch").tank).toEqual({ widthCm: 120, depthCm: 60, heightCm: 56 })
    expect(parse("30 cm nature").tank).toEqual({ widthCm: 30, depthCm: 15, heightCm: 21 })
  })
  it("inches and clamping", () => {
    const i = parse('a 24" nature tank')
    expect(i.tank).toEqual({ widthCm: 61, depthCm: 30, heightCm: 33 })
    expect(parse("24 inches").tank!.widthCm).toBe(61)
    expect(parse("10 cm").tank).toEqual({ widthCm: 20, depthCm: 15, heightCm: 21 })
    expect(parse("400 cm").tank).toEqual({ widthCm: 180, depthCm: 75, heightCm: 56 })
  })
  it("the first tank phrase wins", () => {
    expect(parse("60p or 90x45x45").tankPreset).toBe("60p")
  })
})

describe("parseIntent · style, composition, light, CO2, hardscape", () => {
  it("styles and compositions", () => {
    expect(parse("iwagumi").style).toBe("iwagumi")
    for (const t of ["nature", "natural", "nature aquarium", "jungle"]) expect(parse(t).style).toBe("nature")
    expect(parse("Dutch").style).toBe("dutch")
    expect(parse("nature aquarium").spans).toHaveLength(1)
    for (const t of ["triangle", "triangular"]) expect(parse(t).composition).toBe("triangle")
    for (const t of ["concave", "u-shape", "u shape", "valley"]) expect(parse(t).composition).toBe("concave")
    for (const t of ["convex", "mound", "island"]) expect(parse(t).composition).toBe("convex")
    expect(parse("streets").composition).toBe("streets")
    for (const t of ["sanzon", "three stones"]) expect(parse(t).composition).toBe("iwagumi")
  })
  it("light", () => {
    expect(parse("low light").light).toBe("Low")
    expect(parse("low-light").light).toBe("Low")
    expect(parse("dim").light).toBe("Low")
    expect(parse("medium light").light).toBe("Medium")
    expect(parse("high light").light).toBe("High")
    expect(parse("bright").light).toBe("High")
  })
  it("CO2", () => {
    for (const t of ["co2", "CO2", "co₂", "pressurized", "high tech", "high-tech"]) expect(parse(t).co2).toBe(true)
    for (const t of ["no co2", "without co2", "low tech", "low-tech", "easy", "beginner"]) expect(parse(t).co2).toBe(false)
  })
  it('"easy" / "beginner" imply light Low only when light is unstated', () => {
    expect(parse("easy").light).toBe("Low")
    expect(parse("beginner nature").light).toBe("Low")
    expect(parse("easy, high light").light).toBe("High")
    expect(parse("low tech").light).toBeNull()
  })
  it("hardscape and wood style", () => {
    for (const t of ["stones", "rock", "seiryu", "dragon stone"]) expect(parse(t).hardscape).toBe("stone")
    for (const t of ["wood", "driftwood", "branch"]) expect(parse(t).hardscape).toBe("wood")
    expect(parse("spider wood").woodStyle).toBe("branchy")
    expect(parse("root").woodStyle).toBe("root")
    expect(parse("tree").woodStyle).toBe("root")
    expect(parse("log").woodStyle).toBe("log")
    expect(parse("driftwood").woodStyle).toBeNull()
    expect(parse("stones and driftwood").hardscape).toBe("both")
    expect(parse("no hardscape").hardscape).toBe("none")
    expect(parse("plants only").hardscape).toBe("none")
    expect(parse("stones, plants only").hardscape).toBe("none")
  })
  it("species by scientific or common name, case-insensitive, longest match", () => {
    expect(parse("Monte Carlo").species).toEqual(["micranthemum-tweediei-monte-carlo"])
    expect(parse("micranthemum tweediei monte carlo").species).toEqual(["micranthemum-tweediei-monte-carlo"])
    expect(parse("java moss").species).toEqual(["taxiphyllum-barbieri"])
    expect(parse("java moss").want).toEqual([]) // the species, not the feature
    expect(parse("wendt's cryptocoryne").species).toEqual(["cryptocoryne-wendtii"])
    expect(parse("Rotala Blood Red").species).toEqual(["rotala-rotundifolia-blood-red"])
  })
  it("features", () => {
    expect(parse("carpet, moss, epiphytes, red, stems, crypts, grass").want).toEqual(["carpet", "moss", "epiphytes", "red", "stems", "crypts", "grass"])
    expect(parse("red stems").want).toEqual(["red", "stems"])
    expect(parse("hairgrass").want).toEqual(["grass"])
  })
})

describe("parseIntent · negation", () => {
  it('"no / without / not / skip X" negates the next phrase only', () => {
    expect(parse("no moss")).toMatchObject({ avoid: ["moss"], want: [] })
    expect(parse("without carpet")).toMatchObject({ avoid: ["carpet"] })
    expect(parse("not red")).toMatchObject({ avoid: ["red"] })
    expect(parse("skip stems")).toMatchObject({ avoid: ["stems"] })
    expect(parse("without any moss")).toMatchObject({ avoid: ["moss"] })
    expect(parse("no moss with a carpet")).toMatchObject({ avoid: ["moss"], want: ["carpet"] })
    expect(parse("no monte carlo")).toMatchObject({ avoidSpecies: ["micranthemum-tweediei-monte-carlo"], species: [] })
    expect(parse("without co2").co2).toBe(false)
    expect(parse("no co2, red").want).toEqual(["red"])
  })
  it("a negated phrase is one span of kind negation", () => {
    const t = "iwagumi, no moss"
    const i = parse(t)
    const neg = i.spans.find((s) => s.kind === "negation")!
    expect(t.slice(neg.start, neg.end)).toBe("no moss")
    expect(neg.label).toBe("No moss")
    expect(i.unknown).toEqual([])
  })
  it('"no wood" is not supported in v1: reported as not understood, never read as wood', () => {
    const i = parse("nature, no wood")
    expect(i.hardscape).toBeNull()
    expect(i.unknown).toEqual(["no", "wood"])
  })
})

describe("parseIntent · robustness", () => {
  it("never throws; trims and caps at 280 chars", () => {
    for (const t of ["", "   ", "!!!", "🐟🌿", "x".repeat(5000), null, undefined, 42, "co2 co2 co2", "no", "no no no", "60p 60p", "×××", "1x2x", "İstanbul iwagumi"]) {
      expect(() => parse(t as string)).not.toThrow()
    }
    const long = `iwagumi ${"a ".repeat(200)}dutch`
    const i = parse(long)
    expect(i.style).toBe("iwagumi")
    expect(i.spans.every((s) => s.end <= 280)).toBe(true)
    expect(parse("  iwagumi  ").spans[0]).toMatchObject({ start: 0, end: 7 })
  })
  it("reports words it did not understand, minus stop words", () => {
    expect(parse("an iwagumi with purple unicorns, please").unknown).toEqual(["purple", "unicorns"])
    expect(parse("a nice planted tank").unknown).toEqual([])
  })
  it("spans are sorted, inside the text and never overlap", () => {
    const t = "Dutch 90x45x45 with red stems, high light, CO2, no moss, monte carlo and java fern"
    const i = parse(t)
    expect(i.spans.length).toBeGreaterThanOrEqual(9)
    for (let k = 0; k < i.spans.length; k++) {
      const s = i.spans[k]!
      expect(s.start).toBeGreaterThanOrEqual(0)
      expect(s.end).toBeGreaterThan(s.start)
      expect(s.end).toBeLessThanOrEqual(t.length)
      expect(s.label.length).toBeGreaterThan(0)
      if (k > 0) expect(s.start).toBeGreaterThanOrEqual(i.spans[k - 1]!.end)
    }
  })
  it("is deterministic", () => {
    const t = "concave nature with spider wood, moss and crypts in a 90P, no CO2"
    expect(parse(t)).toEqual(parse(t))
  })
})

describe("composeScape · template choice", () => {
  const I = (o: Partial<ScapeIntent>) => ({ ...parse(""), ...o })
  it("exact (style, composition) → style → hardscape → nature-triangle; seed picks among ties", () => {
    expect(chooseTemplate(I({ style: "nature", composition: "concave" })).id).toBe("nature-concave")
    expect(chooseTemplate(I({ style: "iwagumi", composition: "concave" })).id).toBe("iwagumi-sanzon")
    expect(chooseTemplate(I({ style: "nature" }), 0).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ style: "nature" }), 1).id).toBe("nature-concave")
    expect(chooseTemplate(I({ style: "nature" }), 2).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ composition: "streets" })).id).toBe("dutch-streets")
    expect(chooseTemplate(I({ hardscape: "stone" })).id).toBe("iwagumi-sanzon")
    expect(chooseTemplate(I({ hardscape: "wood" })).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ hardscape: "both" })).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ hardscape: "none" })).id).toBe("dutch-streets")
    expect(chooseTemplate(I({})).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ composition: "convex" })).id).toBe("nature-triangle")
  })
  it("uses the stated tank, else ADA 60-P with a note first", () => {
    const r = compose("iwagumi")
    expect(r.doc.tank).toEqual(presetTank(DEFAULT_PRESET))
    expect(r.notes[0]).toMatch(/^Tank size not given — using ADA 60-P/)
    expect(compose("iwagumi 90p").doc.tank).toEqual(presetTank("90p"))
    expect(compose("iwagumi 90p").notes).toEqual([])
    expect(compose("iwagumi 90p").doc.templateId).toBe("iwagumi-sanzon")
  })
})

describe("composeScape · substitutions", () => {
  const LOW_TECH = ["low tech", "no co2", "easy", "beginner", "without co2"]
  const SCAPES = ["iwagumi", "nature", "nature concave", "dutch", "dutch with red stems and a carpet", "nature with moss, crypts and grass"]
  it("co2 === false: no species with co2.min ≥ 10 or difficulty ≥ 4; light Low implied when unstated", () => {
    for (const s of SCAPES) for (const t of LOW_TECH) for (const seed of [0, 1]) {
      const r = compose(`${s}, ${t}`, seed)
      for (const p of r.doc.plants) {
        expect(needsCo2(p.speciesId), `${s}, ${t}: ${p.speciesId}`).toBe(false)
        expect(needsHighLight(p.speciesId), `${s}, ${t}: ${p.speciesId}`).toBe(false)
        expect(sp(p.speciesId).regulated).toBe(false)
      }
      checkDoc(r.doc, `${s}, ${t}`)
    }
  })
  it("light Low: no species with light.min > 40 (CO2 allowed)", () => {
    for (const s of SCAPES) {
      const r = compose(`${s}, low light, co2`)
      for (const p of r.doc.plants) expect(needsHighLight(p.speciesId), `${s}: ${p.speciesId}`).toBe(false)
    }
  })
  it("substitutes keep growthForm, share a zone, pass the filters, closest height then id; same species → same substitute", () => {
    const r = compose("60p iwagumi, low tech")
    expect(r.substitutions.length).toBeGreaterThan(0)
    for (const s of r.substitutions) {
      const a = sp(s.from)
      const b = sp(s.to)
      expect(b.growthForm).toBe(a.growthForm)
      expect(b.placement.some((z) => a.placement.includes(z))).toBe(true)
      expect(needsCo2(b.id) || needsHighLight(b.id) || b.regulated).toBe(false)
      expect(s.reason).toMatch(/^(needs CO2|needs high light|excluded|regulated)$/)
      // nothing allowed is closer in height
      const better = INDEX.species.filter(
        (c) => c.id !== a.id && c.growthForm === a.growthForm && c.placement.some((z) => a.placement.includes(z) && z !== "floating") && !needsCo2(c.id) && !needsHighLight(c.id) && !c.regulated && Math.abs(c.maxHeightCm - a.maxHeightCm) < Math.abs(b.maxHeightCm - a.maxHeightCm),
      )
      expect(better.map((c) => c.id), `${s.from} → ${s.to}`).toEqual([])
      expect(r.doc.plants.some((p) => p.speciesId === s.from)).toBe(false)
    }
    expect(new Set(r.substitutions.map((s) => s.from)).size).toBe(r.substitutions.length)
  })
  it("never uses a regulated species, even when named", () => {
    for (const t of ["dutch with cabomba caroliniana", "nature with hygrophila polysperma and ambulia", "limnophila sessiliflora", "dutch with water hyacinth"]) {
      const r = compose(t)
      for (const p of r.doc.plants) expect(sp(p.speciesId).regulated, `${t}: ${p.speciesId}`).toBe(false)
      checkDoc(r.doc, t)
    }
    const r = compose("dutch with cabomba caroliniana")
    expect(r.substitutions.find((s) => s.from === "cabomba-caroliniana")?.reason).toBe("regulated")
  })
  it("named species that need CO2 are substituted in a low-tech scape", () => {
    const r = compose("low tech nature with HC Cuba and rotala macrandra")
    for (const p of r.doc.plants) expect(needsCo2(p.speciesId)).toBe(false)
    expect(r.substitutions.some((s) => s.from === "hemianthus-callitrichoides-cuba" && s.reason === "needs CO2")).toBe(true)
  })
  it("avoid / avoidSpecies remove the matching groups (excluded)", () => {
    const noMoss = compose("nature, no moss")
    expect(noMoss.doc.plants.some((p) => hasFeature(sp(p.speciesId), "moss"))).toBe(false)
    expect(noMoss.notes.join(" ")).toMatch(/Left out .*\(excluded\)/)
    const noCarpet = compose("iwagumi without carpet")
    expect(noCarpet.doc.plants.some((p) => sp(p.speciesId).growthForm === "carpeting")).toBe(false)
    const noRed = compose("dutch, no red")
    expect(noRed.doc.plants.some((p) => isRed(sp(p.speciesId)))).toBe(false)
    expect(noRed.doc.plants.length).toBeGreaterThan(20) // red stems swapped for green ones, not dropped
    const noMc = compose("nature triangle, no monte carlo")
    expect(noMc.doc.plants.some((p) => p.speciesId === "micranthemum-tweediei-monte-carlo")).toBe(false)
  })
})

describe("composeScape · hardscape overrides", () => {
  it('"none" removes all hardscape and the plants tied to it', () => {
    const r = compose("nature, plants only")
    expect(r.doc.hardscape).toEqual([])
    expect(r.doc.attach).toBeUndefined()
    expect(r.doc.plants.every((p) => p.y === 0)).toBe(true)
    checkDoc(r.doc)
  })
  it('"wood" on an iwagumi keeps the stones and adds one root driftwood', () => {
    const base = compose("iwagumi 60p")
    const r = compose("iwagumi 60p with driftwood")
    const stones = base.doc.hardscape.filter((h) => h.kind === "stone").map((h) => h.id)
    expect(r.doc.hardscape.filter((h) => h.kind === "stone").map((h) => h.id)).toEqual(stones)
    const wood = r.doc.hardscape.filter((h) => h.kind === "wood")
    expect(wood).toHaveLength(1)
    expect(wood[0]!.woodStyle).toBe("root")
    expect(wood[0]!.leanSide === "left" || wood[0]!.leanSide === "right").toBe(true) // frozen (editor 1.2.2)
    checkDoc(r.doc)
  })
  it("woodStyle sets every wood piece's style", () => {
    const r = compose("concave nature with spider wood")
    const wood = r.doc.hardscape.filter((h) => h.kind === "wood")
    expect(wood.length).toBe(2)
    for (const w of wood) {
      expect(w.woodStyle).toBe("branchy")
      expect(w.leanSide).toBeUndefined()
    }
    checkDoc(r.doc)
    expect(compose("iwagumi with a log").doc.hardscape.filter((h) => h.kind === "wood").map((h) => h.woodStyle)).toEqual(["log"])
  })
})

describe("composeScape · wanted features and named species", () => {
  it("carpet: a foreground carpet group exists", () => {
    const r = compose("dutch with a carpet")
    const carpets = r.doc.plants.filter((p) => sp(p.speciesId).growthForm === "carpeting")
    expect(carpets.length).toBeGreaterThan(0)
    expect(carpets.every((p) => p.z > 0)).toBe(true)
    checkDoc(r.doc)
  })
  it("moss / epiphytes: tied onto hardscape when there is some, otherwise a note", () => {
    const r = compose("iwagumi with moss")
    expect(r.doc.plants.some((p) => sp(p.speciesId).growthForm === "moss" && hostOf(r.doc, p.id) !== undefined)).toBe(true)
    const e = compose("iwagumi with epiphytes, low tech")
    expect(e.doc.plants.some((p) => sp(p.speciesId).growthForm === "epiphyte" && hostOf(e.doc, p.id) !== undefined)).toBe(true)
    const none = compose("dutch with moss")
    expect(none.notes).toContain("No stone or wood to tie moss onto.")
    checkDoc(r.doc)
    checkDoc(e.doc)
  })
  it("red: one stem group becomes a red stem", () => {
    const r = compose("nature triangle with red stems")
    expect(r.doc.plants.some((p) => sp(p.speciesId).growthForm === "stem" && isRed(sp(p.speciesId)))).toBe(true)
    const low = compose("nature triangle with red, low tech")
    expect(low.doc.plants.some((p) => sp(p.speciesId).growthForm === "stem" && isRed(sp(p.speciesId)))).toBe(true)
    const iw = compose("iwagumi with red")
    expect(iw.doc.plants.some((p) => sp(p.speciesId).growthForm === "stem" && isRed(sp(p.speciesId)))).toBe(true)
    checkDoc(iw.doc)
  })
  it("crypts / grass / stems: one group of that kind", () => {
    for (const [t, f] of [["iwagumi with crypts", "crypts"], ["dutch with grass", "grass"], ["iwagumi with stems", "stems"]] as const) {
      const r = compose(t)
      expect(r.doc.plants.some((p) => hasFeature(sp(p.speciesId), f)), t).toBe(true)
      checkDoc(r.doc, t)
    }
  })
  it("named species are added as one group each (tied on when attachable)", () => {
    const r = compose("nature with java fern, monte carlo and vallisneria")
    for (const id of ["microsorum-pteropus", "micranthemum-tweediei-monte-carlo", "vallisneria-spiralis"]) expect(r.doc.plants.some((p) => p.speciesId === id), id).toBe(true)
    expect(r.doc.plants.filter((p) => p.speciesId === "microsorum-pteropus").every((p) => hostOf(r.doc, p.id) !== undefined)).toBe(true)
    checkDoc(r.doc)
  })
  it("stays within 60 plants on the largest tanks", () => {
    const r = compose("dutch 180x75x70 with a carpet, crypts, grass, moss, java fern, monte carlo, anubias nana and vallisneria")
    expect(r.doc.plants.length).toBeLessThanOrEqual(60)
    checkDoc(r.doc)
  })
})

describe("composeScape · notes", () => {
  it("at most 4, most useful first, unknown words last", () => {
    const r = compose("dutch with moss and foo bar, no carpet, without co2, xyzzy")
    expect(r.notes.length).toBeLessThanOrEqual(MAX_NOTES)
    expect(r.notes[0]).toMatch(/^Tank size not given/)
    expect(r.notes[r.notes.length - 1]).toMatch(/^Didn't understand: “foo”, “bar”, “xyzzy”/)
  })
})

describe("composeScape · determinism and seeds", () => {
  it("same (intent, seed) → same result; another seed → another layout", () => {
    for (const t of EXAMPLE_PROMPTS) {
      expect(JSON.stringify(compose(t, 0))).toBe(JSON.stringify(compose(t, 0)))
      expect(encodeScape(compose(t, 1).doc), t).not.toBe(encodeScape(compose(t, 0).doc))
    }
  })
  it("seed picks among equally good templates", () => {
    expect(compose("nature", 0).templateId).toBe("nature-triangle")
    expect(compose("nature", 1).templateId).toBe("nature-concave")
  })
  it("never throws on malformed intents or seeds", () => {
    const junk = [null, {}, { want: ["fly"], tank: { widthCm: Number.NaN } }, { species: ["not-a-plant"], style: "rococo" }, { tank: { widthCm: 9999, depthCm: 1, heightCm: 1 } }]
    for (const j of junk) for (const seed of [0, -3, 1.5, Number.NaN, 2 ** 40]) {
      let r: ComposeResult | undefined
      expect(() => (r = composeScape(j as unknown as ScapeIntent, INDEX, seed))).not.toThrow()
      checkDoc(r!.doc)
    }
  })
})

describe("EXAMPLE_PROMPTS", () => {
  it("4–6 prompts, each understood completely", () => {
    expect(EXAMPLE_PROMPTS.length).toBeGreaterThanOrEqual(4)
    expect(EXAMPLE_PROMPTS.length).toBeLessThanOrEqual(6)
    for (const t of EXAMPLE_PROMPTS) {
      const i = parse(t)
      expect(i.unknown, t).toEqual([])
      const r = composeScape(i, INDEX)
      expect(r.notes.some((n) => n.startsWith("Didn't understand")), t).toBe(false)
      checkDoc(r.doc, t)
    }
  })
  it("summary line of the first example", () => {
    expect(summarizeIntent(parse(EXAMPLE_PROMPTS[0]!))).toBe("Iwagumi · Sanzon · 60 × 30 × 32 cm · Low light · No CO2")
  })
})

describe("applied through the editor", () => {
  it('one "replace" op: one undo step, needsResim', () => {
    const s0 = initEditor(compose("dutch").doc)
    const r = compose("60P iwagumi with a carpet, low tech")
    const s1 = editorReducer(s0, { type: "apply", op: { type: "replace", doc: r.doc } })
    expect(s1.doc).toBe(r.doc) // already canonical: replace keeps it as is
    expect(s1.past).toEqual([s0.doc])
    expect(needsResim(s0.doc, s1.doc)).toBe(true)
    expect(editorReducer(s1, { type: "undo" }).doc).toBe(s0.doc)
  })
})

describe("property: random sentences from the vocabulary", () => {
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
  const VOCAB = [
    "iwagumi", "nature", "natural", "jungle", "dutch", "triangle", "concave", "u-shape", "valley", "convex", "island", "streets", "sanzon",
    "60p", "60-p", "ada 45p", "30c", "90P", "10 gallon", "20 long", "29 gal", "40 breeder", "90x45x45", "24x12x16 in", "60 cm", "36\"", "200x80x90",
    "low light", "medium light", "high light", "bright", "dim", "co2", "co₂", "no co2", "without co2", "low tech", "high tech", "easy", "beginner",
    "stones", "rocks", "seiryu", "dragon stone", "wood", "driftwood", "spider wood", "branch", "root", "tree", "log", "no hardscape", "plants only",
    "carpet", "moss", "epiphytes", "red", "stems", "crypts", "grass", "hairgrass", "no moss", "without carpet", "not red", "skip stems",
    "monte carlo", "HC Cuba", "java fern", "java moss", "anubias nana", "vallisneria", "cabomba caroliniana", "water hyacinth", "rotala macrandra", "no monte carlo",
    "with", "and", "a", "in", "please", ",", "!", "foo", "glorp", "x", "×", "no", "without",
  ]
  it("~200 sentences never throw and always give valid docs", () => {
    const rand = prng(20261118)
    for (let n = 0; n < 200; n++) {
      const words = Array.from({ length: 1 + Math.floor(rand() * 9) }, () => VOCAB[Math.floor(rand() * VOCAB.length)]!)
      const text = words.join(rand() < 0.5 ? " " : ", ")
      let i: ScapeIntent | undefined
      expect(() => (i = parse(text)), text).not.toThrow()
      for (let k = 1; k < i!.spans.length; k++) expect(i!.spans[k]!.start, text).toBeGreaterThanOrEqual(i!.spans[k - 1]!.end)
      const seed = Math.floor(rand() * 5)
      let r: ComposeResult | undefined
      expect(() => (r = composeScape(i!, INDEX, seed)), text).not.toThrow()
      checkDoc(r!.doc, text)
      expect(r!.notes.length).toBeLessThanOrEqual(MAX_NOTES)
      expect(r!.templateId).toBe(r!.doc.templateId)
      expect(getTemplate(r!.templateId)).toBeDefined()
      for (const p of r!.doc.plants) expect(sp(p.speciesId).regulated, `${text}: ${p.speciesId}`).toBe(false)
      if (i!.co2 === false) for (const p of r!.doc.plants) expect(needsCo2(p.speciesId), `${text}: ${p.speciesId}`).toBe(false)
      if (i!.light === "Low" || (i!.co2 === false && i!.light === null)) for (const p of r!.doc.plants) expect(needsHighLight(p.speciesId), `${text}: ${p.speciesId}`).toBe(false)
    }
  })
  it("templates are all reachable", () => {
    const seen = new Set<string>()
    for (const t of ["iwagumi", "nature", "dutch"]) for (const s of [0, 1]) seen.add(compose(t, s).templateId)
    expect([...seen].sort()).toEqual(TEMPLATES.map((t) => t.id).sort())
  })
})
