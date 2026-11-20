/**
 * Compose contract 1.1.0 (lib/compose/contract.ts): the sentence drives the
 * simulation — doc.conditions, filters on the resolved conditions, the
 * CO2-limited note, the summary tail and "Try another".
 */
import { describe, expect, it } from "vitest"
import plantsJson from "../sim/vendor/plants.json"
import { buildDocInput } from "../editor/buildDocInput"
import { effectiveConditions, type ScapeDoc } from "../editor"
import type { BotanyRecord } from "../sim/buildInput"
import { TEMPLATES, getTemplate } from "../templates"
import {
  CO2_LIMITED_NOTE,
  COMPOSE_CONTRACT_VERSION,
  EXAMPLE_PROMPTS,
  MAX_NOTES,
  buildSpeciesIndex,
  chooseTemplate,
  composeScape,
  parseIntent,
  resolveConditions,
  summarizeIntent,
} from "./index"

const INDEX = buildSpeciesIndex(plantsJson as unknown[])
const parse = (t: string) => parseIntent(t, INDEX)
const compose = (t: string, seed = 0) => composeScape(parse(t), INDEX, seed)
const sp = (id: string) => INDEX.byId.get(id)!
const needsCo2 = (id: string) => sp(id).co2Min >= 10 || sp(id).difficulty >= 4
const needsHighLight = (id: string) => sp(id).lightMin > 40

it("is version 1.1.0", () => expect(COMPOSE_CONTRACT_VERSION).toBe("1.2.0"))

describe("resolveConditions (table)", () => {
  const LOWTPL = { light: "Low", co2: false } as const
  const HITPL = { light: "High", co2: true } as const
  const cases: [string, { light: "Low" | "Medium" | "High" | null; co2: boolean | null }, { light: "Low" | "Medium" | "High"; co2: boolean }, { light: "Low" | "Medium" | "High"; co2: boolean }][] = [
    // label, intent, on a Low / no-CO2 template, on a High / CO2 template
    ["nothing stated → template", { light: null, co2: null }, { light: "Low", co2: false }, { light: "High", co2: true }],
    ["low tech → Low light, no CO2", { light: null, co2: false }, { light: "Low", co2: false }, { light: "Low", co2: false }],
    ["CO2 alone → template light", { light: null, co2: true }, { light: "Low", co2: true }, { light: "High", co2: true }],
    ["high light alone → CO2 on", { light: "High", co2: null }, { light: "High", co2: true }, { light: "High", co2: true }],
    ["medium light alone → template CO2", { light: "Medium", co2: null }, { light: "Medium", co2: false }, { light: "Medium", co2: true }],
    ["low light alone → template CO2", { light: "Low", co2: null }, { light: "Low", co2: false }, { light: "Low", co2: true }],
    ["both stated → as stated", { light: "High", co2: false }, { light: "High", co2: false }, { light: "High", co2: false }],
    ["low light + CO2", { light: "Low", co2: true }, { light: "Low", co2: true }, { light: "Low", co2: true }],
  ]
  for (const [label, intent, onLow, onHigh] of cases) {
    it(label, () => {
      expect(resolveConditions(intent, LOWTPL)).toEqual(onLow)
      expect(resolveConditions(intent, HITPL)).toEqual(onHigh)
    })
  }
})

describe("composeScape sets doc.conditions", () => {
  it("always present, equal to resolveConditions(intent, chosen template)", () => {
    for (const t of ["", "iwagumi", "nature", "dutch streets", "low tech", "60p iwagumi, low tech", "nature high light", "dutch no co2", "jungle, dim, co2", "easy nature"]) {
      for (const seed of [0, 1]) {
        const r = compose(t, seed)
        const tpl = getTemplate(r.templateId)!
        expect(r.doc.conditions, t).toEqual(resolveConditions(r.intent, tpl))
      }
    }
  })
  it("stated / unstated / low tech / high light alone", () => {
    expect(compose("60p iwagumi, low tech").doc.conditions).toEqual({ light: "Low", co2: false })
    expect(compose("nature, medium light, no co2").doc.conditions).toEqual({ light: "Medium", co2: false })
    expect(compose("nature").doc.conditions).toEqual({ light: "Medium", co2: true }) // template
    expect(compose("dutch streets").doc.conditions).toEqual({ light: "High", co2: true }) // template
    expect(compose("nature, high light").doc.conditions).toEqual({ light: "High", co2: true })
    expect(compose("easy nature").doc.conditions).toEqual({ light: "Low", co2: false })
  })
  it("the doc the sim runs: buildDocInput reads the composed conditions", () => {
    const r = compose("dutch, low light, no co2")
    const b = buildDocInput(r.doc, new URLSearchParams("light=High&co2=true"), plantsJson as unknown as BotanyRecord[])
    expect([b.light, b.co2, b.input.light.surfacePar, b.input.water.co2Ppm]).toEqual(["Low", false, 100, 5])
    expect(effectiveConditions(r.doc)).toEqual({ light: "Low", co2: false })
  })
})

describe("substitution filters follow the resolved conditions", () => {
  it('"dutch streets" alone keeps High + CO2 and does NOT substitute CO2 plants', () => {
    const r = compose("dutch streets")
    expect(r.doc.conditions).toEqual({ light: "High", co2: true })
    expect(r.substitutions.filter((s) => s.reason === "needs CO2" || s.reason === "needs high light")).toEqual([])
    // the template's own CO2 / high-light species survive
    expect(r.doc.plants.some((p) => needsCo2(p.speciesId) || needsHighLight(p.speciesId))).toBe(true)
  })
  it("resolved co2 false → no CO2 plants; resolved Low → no high-light plants", () => {
    for (const t of ["dutch, no co2", "iwagumi low tech", "dutch streets, easy", "nature with red stems, without co2"]) {
      const r = compose(t)
      expect(r.doc.conditions!.co2, t).toBe(false)
      for (const p of r.doc.plants) expect(needsCo2(p.speciesId), `${t}: ${p.speciesId}`).toBe(false)
      if (r.doc.conditions!.light === "Low") for (const p of r.doc.plants) expect(needsHighLight(p.speciesId), `${t}: ${p.speciesId}`).toBe(false)
    }
    const low = compose("dutch, low light, co2")
    expect(low.doc.conditions).toEqual({ light: "Low", co2: true })
    for (const p of low.doc.plants) expect(needsHighLight(p.speciesId), p.speciesId).toBe(false)
  })
  it("High light without CO2: CO2 plants are swapped, high-light plants may stay", () => {
    const r = compose("dutch, high light, no co2")
    expect(r.doc.conditions).toEqual({ light: "High", co2: false })
    for (const p of r.doc.plants) expect(needsCo2(p.speciesId), p.speciesId).toBe(false)
    expect(r.substitutions.some((s) => s.reason === "needs high light")).toBe(false)
  })
})

describe("mismatch note", () => {
  it('"High light without CO2 — growth will be CO2-limited." after the missing-tank note', () => {
    expect(CO2_LIMITED_NOTE).toBe("High light without CO2 — growth will be CO2-limited.")
    const r = compose("dutch, high light, no co2")
    expect(r.notes[0]).toMatch(/^Tank size not given/)
    expect(r.notes[1]).toBe(CO2_LIMITED_NOTE)
    const withTank = compose("dutch 60p, bright, without co2, glorp")
    expect(withTank.notes[0]).toBe(CO2_LIMITED_NOTE)
    expect(withTank.notes[withTank.notes.length - 1]).toMatch(/^Didn't understand/)
  })
  it("absent otherwise; never more than 4 notes", () => {
    for (const t of ["dutch", "dutch, high light", "iwagumi, low tech", "nature, high light, co2"]) expect(compose(t).notes, t).not.toContain(CO2_LIMITED_NOTE)
    const busy = compose("iwagumi no hardscape with moss and epiphytes, high light, no co2, glorp foo")
    expect(busy.notes.length).toBeLessThanOrEqual(MAX_NOTES)
    expect(busy.notes).toContain(CO2_LIMITED_NOTE)
  })
})

describe("summarizeIntent", () => {
  it("ends with the resolved conditions", () => {
    expect(summarizeIntent(parse("60P iwagumi with a carpet, low tech"))).toBe("Iwagumi · Sanzon · 60 × 30 × 32 cm · Low light · No CO2")
    expect(summarizeIntent(parse("dutch streets"))).toBe("Dutch · Streets · 60 × 30 × 32 cm · High light · CO2")
    expect(summarizeIntent(parse("nature triangle, high light"))).toMatch(/ · High light · CO2$/)
    expect(summarizeIntent(parse("nature triangle, medium light, no co2"))).toMatch(/ · Medium light · No CO2$/)
    for (const t of EXAMPLE_PROMPTS) {
      const s = summarizeIntent(parse(t))
      expect(s, t).toMatch(/ · (Low|Medium|High) light · (CO2|No CO2)$/)
      expect(s, t).not.toMatch(/CO₂|low tech/)
    }
  })
  it("matches what composeScape builds", () => {
    for (const t of EXAMPLE_PROMPTS) for (const seed of [0, 1]) {
      const i = parse(t)
      const r = composeScape(i, INDEX, seed)
      const c = r.doc.conditions!
      expect(summarizeIntent(i, seed).endsWith(`${c.light} light · ${c.co2 ? "CO2" : "No CO2"}`), t).toBe(true)
    }
  })
})

describe('"Try another" (seed + 1)', () => {
  it("keeps stated conditions; unstated values follow the (possibly new) template", () => {
    for (const t of ["iwagumi, low tech", "nature, high light, no co2", "dutch, medium light, co2", "nature", "dutch", "iwagumi", "low tech"]) {
      for (let seed = 0; seed < 4; seed++) {
        const a = compose(t, seed)
        const b = compose(t, seed + 1)
        const i = a.intent
        if (i.light !== null) expect(b.doc.conditions!.light, t).toBe(a.doc.conditions!.light)
        if (i.co2 !== null) expect(b.doc.conditions!.co2, t).toBe(a.doc.conditions!.co2)
        if (a.templateId === b.templateId) expect(b.doc.conditions, t).toEqual(a.doc.conditions)
        const tpl = getTemplate(b.templateId)!
        expect(b.doc.conditions, t).toEqual(resolveConditions(i, tpl))
      }
    }
  })
  it("a template change with unstated values follows the new template", () => {
    // "nature" rotates between the two nature templates; with nothing stated the conditions are the template's
    const i = parse("")
    for (let seed = 0; seed < TEMPLATES.length; seed++) {
      const tpl = chooseTemplate(i, seed)
      expect(composeScape(i, INDEX, seed).doc.conditions).toEqual({ light: tpl.light, co2: tpl.co2 })
    }
  })
})

describe("chips use plain CO2", () => {
  it("labels", () => {
    expect(parse("co2").spans.map((s) => s.label)).toEqual(["CO2"])
    expect(parse("no co2").spans.map((s) => s.label)).toEqual(["No CO2"])
  })
})

it("composed docs survive a share link with their conditions", async () => {
  const { decodeScape, encodeScape } = await import("../editor")
  for (const t of EXAMPLE_PROMPTS) {
    const doc: ScapeDoc = compose(t).doc
    expect(decodeScape(encodeScape(doc))!.conditions, t).toEqual(doc.conditions)
  }
})
