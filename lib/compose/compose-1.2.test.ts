/**
 * Compose contract 1.2.0 (lib/compose/contract.ts): a stated "no CO2" /
 * "low tech" picks the "nature-lowtech" template (templates 1.2.0) when the
 * style is nature or unstated, the composition is unstated and the hardscape
 * is not "none" / "stone"; conditions resolve exactly as in 1.1.0.
 */
import { describe, expect, it } from "vitest"
import plantsJson from "../sim/vendor/plants.json"
import { getTemplate } from "../templates"
import {
  CO2_LIMITED_NOTE,
  COMPOSE_CONTRACT_VERSION,
  EXAMPLE_PROMPTS,
  LOWTECH_TEMPLATE_ID,
  buildSpeciesIndex,
  chooseTemplate,
  composeScape,
  parseIntent,
  summarizeIntent,
} from "./index"
import type { ScapeIntent } from "./contract"

const INDEX = buildSpeciesIndex(plantsJson as unknown[])
const parse = (t: string) => parseIntent(t, INDEX)
const compose = (t: string, seed = 0) => composeScape(parse(t), INDEX, seed)
const sp = (id: string) => INDEX.byId.get(id)!
const I = (p: Partial<ScapeIntent>): ScapeIntent => ({ ...parse(""), ...p })

it("is version 1.2.0", () => expect(COMPOSE_CONTRACT_VERSION).toBe("1.2.0"))

describe("template choice (1.2.0 rule first)", () => {
  it("low tech / no CO2 with nature or no style → nature-lowtech", () => {
    expect(LOWTECH_TEMPLATE_ID).toBe("nature-lowtech")
    for (const t of [
      "low tech",
      "no co2",
      "without co2",
      "easy",
      "beginner",
      "nature, low tech",
      "nature scape with driftwood, no co2",
      "low-light jungle with java fern and crypts, no CO2",
      "nature, high light, no co2",
      "60p low tech with wood and stones",
      "20 gallon long, low tech, with moss",
    ]) {
      expect(compose(t).templateId, t).toBe("nature-lowtech")
      expect(summarizeIntent(parse(t)), t).toMatch(/^Nature · Low tech · /)
    }
  })

  it('"low tech" → Low light · No CO2', () => {
    const r = compose("low tech")
    expect(r.templateId).toBe("nature-lowtech")
    expect(r.doc.conditions).toEqual({ light: "Low", co2: false })
    expect(r.notes).not.toContain(CO2_LIMITED_NOTE)
    expect(summarizeIntent(parse("low tech"))).toBe("Nature · Low tech · 60 × 30 × 32 cm · Low light · No CO2")
  })

  it('"nature, high light, no co2" → nature-lowtech, High light · No CO2 + the CO2-limited note', () => {
    const r = compose("nature, high light, no co2")
    expect(r.templateId).toBe("nature-lowtech")
    expect(r.doc.conditions).toEqual({ light: "High", co2: false })
    expect(r.notes).toContain(CO2_LIMITED_NOTE)
  })

  it("conditions resolve exactly as 1.1.0", () => {
    expect(compose("nature, medium light, no co2").doc.conditions).toEqual({ light: "Medium", co2: false })
    expect(compose("easy nature").doc.conditions).toEqual({ light: "Low", co2: false })
    expect(compose("dim, no co2").doc.conditions).toEqual({ light: "Low", co2: false })
  })

  it("keeps the old choice for iwagumi / dutch / a stated composition / stone or no hardscape", () => {
    expect(compose("iwagumi, low tech").templateId).toBe("iwagumi-sanzon")
    expect(compose("iwagumi, low tech").doc.conditions).toEqual({ light: "Low", co2: false })
    expect(compose("dutch, no co2").templateId).toBe("dutch-streets")
    expect(compose("dutch, no co2").doc.conditions).toEqual({ light: "Low", co2: false })
    expect(compose("nature triangle, low tech").templateId).toBe("nature-triangle")
    expect(compose("concave, no co2").templateId).toBe("nature-concave")
    expect(compose("stones, low tech").templateId).toBe("iwagumi-sanzon")
    expect(compose("no hardscape, low tech").templateId).toBe("dutch-streets")
    expect(compose("plants only, no co2").templateId).toBe("dutch-streets")
  })

  it("never picks nature-lowtech without a stated co2 === false", () => {
    for (const t of ["", "nature", "nature with wood", "low light", "dim nature", "nature, co2", "high tech", "nature, medium light"]) {
      for (const seed of [0, 1, 2, 3]) expect(compose(t, seed).templateId, `${t} #${seed}`).not.toBe("nature-lowtech")
    }
    // "nature" keeps rotating between the two CO2 Nature templates exactly as before
    expect(chooseTemplate(I({ style: "nature" }), 0).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ style: "nature" }), 1).id).toBe("nature-concave")
    expect(chooseTemplate(I({ style: "nature" }), 2).id).toBe("nature-triangle")
  })

  it("chooseTemplate applies the rule on the intent fields alone", () => {
    expect(chooseTemplate(I({ co2: false })).id).toBe("nature-lowtech")
    expect(chooseTemplate(I({ co2: false, style: "nature", hardscape: "wood" })).id).toBe("nature-lowtech")
    expect(chooseTemplate(I({ co2: false, hardscape: "both" })).id).toBe("nature-lowtech")
    expect(chooseTemplate(I({ co2: false, hardscape: "stone" })).id).toBe("iwagumi-sanzon")
    expect(chooseTemplate(I({ co2: false, hardscape: "none" })).id).toBe("dutch-streets")
    expect(chooseTemplate(I({ co2: false, composition: "triangle" })).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ co2: false, style: "dutch" })).id).toBe("dutch-streets")
    expect(chooseTemplate(I({ co2: true })).id).toBe("nature-triangle")
    expect(chooseTemplate(I({ co2: null })).id).toBe("nature-triangle")
    // seed never rotates away from it ("Try another" keeps the template)
    for (const seed of [0, 1, 2, 5]) expect(chooseTemplate(I({ co2: false }), seed).id).toBe("nature-lowtech")
  })
})

describe("a composed low-tech scape", () => {
  it("needs no substitutions at Low · No CO2 and keeps the template's layout", () => {
    const r = compose("low tech")
    expect(r.substitutions).toEqual([])
    const tpl = getTemplate("nature-lowtech")!
    const ids = new Set(r.doc.plants.map((p) => p.speciesId))
    for (const g of tpl.groups) expect(ids.has(g.speciesId), g.speciesId).toBe(true)
    expect(r.doc.hardscape.some((h) => h.kind === "wood")).toBe(true)
    expect(Object.keys(r.doc.attach ?? {}).length).toBeGreaterThanOrEqual(3)
    for (const p of r.doc.plants) {
      expect(sp(p.speciesId).co2Min, p.speciesId).toBeLessThanOrEqual(5)
      expect(sp(p.speciesId).lightMin, p.speciesId).toBeLessThanOrEqual(40)
    }
  })

  it("honours wanted features and hardscape overrides on top of it", () => {
    const moss = compose("low tech with moss")
    expect(moss.templateId).toBe("nature-lowtech")
    expect(moss.notes.filter((n) => /moss/i.test(n))).toEqual([])
    const spider = compose("low tech with spider wood")
    expect(spider.templateId).toBe("nature-lowtech")
    for (const h of spider.doc.hardscape) if (h.kind === "wood") expect(h.woodStyle).toBe("branchy")
  })

  it("every example prompt still composes without unknown-word notes", () => {
    for (const t of EXAMPLE_PROMPTS) expect(compose(t).notes.some((n) => n.startsWith("Didn't understand")), t).toBe(false)
  })
})

describe("acceptance: the low-tech template grows in the vendored sim-core", () => {
  it("day-90 biomass at Low · No CO2 is above day 0, and below Medium · CO2", async () => {
    const { simulate } = await import("../sim/vendor/sim-core")
    const { buildDocInput } = await import("../editor/buildDocInput")
    const doc = compose("low tech").doc
    const run = (conditions: { light: "Low" | "Medium"; co2: boolean }) => {
      const r = simulate(buildDocInput({ ...doc, conditions }, new URLSearchParams(""), plantsJson as never).input)
      const sum = (d: number) => r.frames[d]!.plants.reduce((a, p) => a + p.biomassG, 0)
      return { d0: sum(0), d90: sum(90) }
    }
    const low = run({ light: "Low", co2: false })
    const med = run({ light: "Medium", co2: true })
    expect(low.d90).toBeGreaterThan(low.d0)
    expect(med.d90).toBeGreaterThan(low.d90)
  })
})
