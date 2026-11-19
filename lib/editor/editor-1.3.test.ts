/**
 * Editor contract 1.3.0 (lib/editor/contract.ts): ScapeDoc.conditions —
 * effectiveConditions, setConditions, needsResim, share links, buildDocInput,
 * template-bar picks — plus the acceptance check that conditions really
 * drive the vendored sim-core.
 */
import { describe, expect, it } from "vitest"
import plantsJson from "../sim/vendor/plants.json"
import { CO2_PPM, LIGHT_PAR, type BotanyRecord } from "../sim/buildInput"
import { simulate } from "../sim/vendor/sim-core"
import { TEMPLATES, getTemplate, instantiate } from "../templates"
import type { ScapeDoc, TankConditions } from "./contract"
import {
  NO_PARAMS,
  canUndo,
  conditionsLabel,
  decodeConditions,
  decodeScape,
  docFromTemplate,
  editorReducer,
  effectiveConditions,
  encodeConditions,
  encodeScape,
  initEditor,
  migrateAttach,
  needsResim,
  sanitizeDoc,
} from "./index"
import { buildDocInput, docFromTemplatePick } from "./buildDocInput"

const PLANTS = plantsJson as unknown as BotanyRecord[]
const TANK = { widthCm: 60, depthCm: 30, heightCm: 32 }
const params = (q: string) => new URLSearchParams(q)
/** the positional array behind a share link */
const rawOf = (link: string): unknown[] => JSON.parse(atob(link.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((link.length + 3) % 4)))

function plainDoc(): ScapeDoc {
  return migrateAttach({
    v: 1,
    tank: { ...TANK },
    bed: { frontCm: 2, backCm: 9 },
    hardscape: [{ id: "rock", kind: "stone", x: 0, z: 0, rotationY: 0, sizeCm: [10, 8, 6], seed: 1 }],
    plants: [
      { id: "hemianthus-callitrichoides-cuba-1", speciesId: "hemianthus-callitrichoides-cuba", x: -20, z: 10, y: 0, portions: 2 },
      { id: "cryptocoryne-wendtii-1", speciesId: "cryptocoryne-wendtii", x: 15, z: -5, y: 0, portions: 1 },
    ],
  })
}

const dutch = getTemplate("dutch-streets")!
function dutchDoc(): ScapeDoc {
  return docFromTemplate(instantiate(dutch, TANK), TANK, dutch.id)
}

const apply = (doc: ScapeDoc, light?: TankConditions["light"], co2?: boolean) =>
  editorReducer(initEditor(doc), { type: "apply", op: { type: "setConditions", light, co2 } })

describe("effectiveConditions (resolution order)", () => {
  it("no conditions, no template, no params → Medium / no CO2", () => {
    expect(effectiveConditions(plainDoc())).toEqual({ light: "Medium", co2: false })
    expect(effectiveConditions(plainDoc(), NO_PARAMS)).toEqual({ light: "Medium", co2: false })
  })
  it("URL params are parsed exactly as buildInput does", () => {
    expect(effectiveConditions(plainDoc(), params("light=Low&co2=true"))).toEqual({ light: "Low", co2: true })
    expect(effectiveConditions(plainDoc(), params("light=High"))).toEqual({ light: "High", co2: false })
    expect(effectiveConditions(plainDoc(), params("light=low&co2=1"))).toEqual({ light: "Medium", co2: false })
  })
  it("a known template wins over the URL; an unknown templateId falls through to the URL", () => {
    const tplDoc = { ...plainDoc(), templateId: "iwagumi-sanzon" }
    expect(effectiveConditions(tplDoc, params("light=Low"))).toEqual({ light: "High", co2: true })
    expect(effectiveConditions({ ...plainDoc(), templateId: "no-such-template" }, params("light=Low"))).toEqual({ light: "Low", co2: false })
  })
  it("doc.conditions wins over template and URL", () => {
    const doc: ScapeDoc = { ...plainDoc(), templateId: "iwagumi-sanzon", conditions: { light: "Low", co2: false } }
    expect(effectiveConditions(doc, params("light=High&co2=true"))).toEqual({ light: "Low", co2: false })
  })
  it("labels", () => {
    expect(conditionsLabel({ light: "Low", co2: false })).toBe("Low light · No CO2")
    expect(conditionsLabel({ light: "High", co2: true })).toBe("High light · CO2")
  })
})

describe("setConditions", () => {
  it("sets doc.conditions from the effective value plus the given fields (one history step)", () => {
    const s = apply(dutchDoc(), "Low")
    expect(s.doc.conditions).toEqual({ light: "Low", co2: true })
    expect(s.past.length).toBe(1)
    expect(apply(plainDoc(), undefined, true).doc.conditions).toEqual({ light: "Medium", co2: true })
  })
  it("no-op (same state reference, no history) when the result equals doc.conditions", () => {
    const s = apply(plainDoc(), "High", true)
    expect(editorReducer(s, { type: "apply", op: { type: "setConditions", light: "High" } })).toBe(s)
    expect(editorReducer(s, { type: "apply", op: { type: "setConditions", co2: true } })).toBe(s)
    expect(editorReducer(s, { type: "apply", op: { type: "setConditions" } })).toBe(s)
  })
  it("storing the effective value on a doc without conditions is an edit (absent ≠ present)", () => {
    const s = apply(dutchDoc(), "High", true)
    expect(s.doc.conditions).toEqual({ light: "High", co2: true })
    expect(s.past.length).toBe(1)
  })
  it("undo restores 'absent'; redo brings the conditions back", () => {
    const s0 = initEditor(plainDoc())
    const s1 = editorReducer(s0, { type: "apply", op: { type: "setConditions", light: "Low" } })
    const s2 = editorReducer(s1, { type: "undo" })
    expect("conditions" in s2.doc).toBe(false)
    expect(s2.doc).toBe(s0.doc)
    expect(canUndo(s2)).toBe(false)
    expect(editorReducer(s2, { type: "redo" }).doc.conditions).toEqual({ light: "Low", co2: false })
  })
  it("rejects malformed values (no-op)", () => {
    const s = initEditor(plainDoc())
    expect(editorReducer(s, { type: "apply", op: { type: "setConditions", light: "Bright" as never } })).toBe(s)
    expect(editorReducer(s, { type: "apply", op: { type: "setConditions", co2: "yes" as never } })).toBe(s)
  })
  it("other edits keep conditions", () => {
    const s = apply(plainDoc(), "Low", true)
    const moved = editorReducer(s, { type: "apply", op: { type: "move", target: { kind: "plant", id: "cryptocoryne-wendtii-1" }, x: 10, z: -4 } })
    expect(moved.doc.conditions).toEqual({ light: "Low", co2: true })
  })
})

describe("needsResim", () => {
  it("is true when conditions differ (absent vs present included), false when equal", () => {
    const a = plainDoc()
    const b: ScapeDoc = { ...a, conditions: { light: "Medium", co2: false } }
    expect(needsResim(a, b)).toBe(true)
    expect(needsResim(b, { ...b, conditions: { light: "Medium", co2: true } })).toBe(true)
    expect(needsResim(b, { ...b, conditions: { light: "High", co2: false } })).toBe(true)
    expect(needsResim(b, { ...b, conditions: { light: "Medium", co2: false } })).toBe(false)
  })
})

describe("replace / sanitize keep conditions", () => {
  it("replace keeps the incoming doc's conditions as given", () => {
    const incoming: ScapeDoc = { ...dutchDoc(), conditions: { light: "Low", co2: false } }
    const s = editorReducer(apply(plainDoc(), "High"), { type: "apply", op: { type: "replace", doc: incoming } })
    expect(s.doc.conditions).toEqual({ light: "Low", co2: false })
    // and an incoming doc without conditions drops the old ones
    const s2 = editorReducer(s, { type: "apply", op: { type: "replace", doc: dutchDoc() } })
    expect(s2.doc.conditions).toBeUndefined()
  })
  it("sanitizeDoc keeps valid conditions and drops malformed ones", () => {
    const ok: ScapeDoc = { ...plainDoc(), conditions: { light: "High", co2: true } }
    expect(sanitizeDoc(ok)).toBe(ok)
    const bad = { ...plainDoc(), conditions: { light: "Ultra", co2: 1 } } as unknown as ScapeDoc
    const out = sanitizeDoc(bad)!
    expect(out).not.toBeNull()
    expect("conditions" in out).toBe(false)
  })
  it("migrateAttach keeps conditions", () => {
    const doc: ScapeDoc = { ...plainDoc(), conditions: { light: "Low", co2: false } }
    expect(migrateAttach(doc).conditions).toEqual({ light: "Low", co2: false })
  })
})

describe("share links", () => {
  const ALL: TankConditions[] = (["Low", "Medium", "High"] as const).flatMap((light) => [false, true].map((co2) => ({ light, co2 })))
  it("compact codes", () => {
    expect(encodeConditions({ light: "Low", co2: false })).toBe("L0")
    expect(encodeConditions({ light: "High", co2: true })).toBe("H1")
    for (const c of ALL) expect(decodeConditions(encodeConditions(c))).toEqual(c)
    for (const bad of ["", "X0", "L2", "l0", "L01", 0, null, ["L", 0]]) expect(decodeConditions(bad)).toBeNull()
  })
  it("round-trips every value, with and without an attach map", () => {
    const withAttach = { ...docFromTemplate(instantiate(getTemplate("nature-triangle")!, TANK), TANK, "nature-triangle") }
    expect(withAttach.attach).toBeDefined()
    for (const base of [plainDoc(), withAttach]) {
      for (const c of ALL) {
        const doc: ScapeDoc = { ...base, conditions: c }
        const link = encodeScape(doc)
        const back = decodeScape(link)
        expect(back, JSON.stringify(c)).not.toBeNull()
        expect(back!.conditions).toEqual(c)
        expect(back!.attach).toEqual(base.attach)
        expect(encodeScape(back!)).toBe(link)
      }
    }
  })
  it("a doc without conditions encodes exactly as before (no new entry)", () => {
    const doc = plainDoc()
    expect(rawOf(encodeScape(doc)).length).toBe(8)
    const withC = rawOf(encodeScape({ ...doc, conditions: { light: "Low", co2: false } }))
    expect(withC[withC.length - 1]).toBe("L0")
  })
  it("old (1.2) links still decode, conditions absent", () => {
    // encoded by editor 1.2.2 (origin/main 788560a): 60 × 30 × 32, one stone, two plants
    const OLD = "WzEsWzYwMCwzMDAsMzIwXSwwLFsyMCw5MF0sMCxbImhlbWlhbnRodXMtY2FsbGl0cmljaG9pZGVzLWN1YmEiLCJjcnlwdG9jb3J5bmUtd2VuZHRpaSJdLFtbInJvY2siLDAsMCwwLDAsMTAwLDgwLDYwLDEsMCwtMV1dLFswLDAsLTIwMCwxMDAsMiwxLDAsMTUwLC01MCwxXV0"
    const back = decodeScape(OLD)
    expect(back).not.toBeNull()
    expect(back!.conditions).toBeUndefined()
    expect(back).toEqual(plainDoc())
    expect(encodeScape(back!)).toBe(OLD)
  })
  it("malformed conditions → null", () => {
    const raw = rawOf(encodeScape(plainDoc()))
    const enc = (a: unknown[]) => btoa(JSON.stringify(a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    for (const bad of ["X1", "L2", "", "M", "H10", "low"]) expect(decodeScape(enc([...raw, bad])), bad).toBeNull()
    // two conditions entries, attach after conditions, too many entries
    expect(decodeScape(enc([...raw, "L0", "H1"]))).toBeNull()
    expect(decodeScape(enc([...raw, "L0", []]))).toBeNull()
    expect(decodeScape(enc([...raw, [], "L0", "L0"]))).toBeNull()
    // the valid form decodes
    expect(decodeScape(enc([...raw, "M1"]))!.conditions).toEqual({ light: "Medium", co2: true })
  })
  it("30-plant budget: still ≤ 2000 chars with conditions", () => {
    const longIds = PLANTS.map((p) => p.id).sort((a, b) => b.length - a.length).slice(0, 10)
    const doc: ScapeDoc = {
      v: 1,
      tank: { widthCm: 90, depthCm: 45, heightCm: 45 },
      bed: { frontCm: 2.5, backCm: 9.5 },
      templateId: "nature-concave",
      focalPoint: { x: 12.3, y: 20.1 },
      hardscape: Array.from({ length: 5 }, (_, i) => ({
        id: `stone-${i}`, kind: "stone" as const, x: -30 + i * 14.123, z: -8.456 + i * 3.21, rotationY: -2.9 + i * 1.37, sizeCm: [8.37 + i, 8, 6.11] as [number, number, number], seed: 1000 + i * 977,
      })),
      plants: Array.from({ length: 30 }, (_, i) => {
        const sid = longIds[i % 10]!
        return { id: `${sid}-${Math.floor(i / 10) + 1}`, speciesId: sid, x: -43.21 + i * 2.913, z: -21.07 + ((i * 7) % 42) + 0.137, y: 0, portions: 1 + (i % 4) }
      }),
      conditions: { light: "Medium", co2: true },
    }
    expect(encodeScape(doc).length).toBeLessThanOrEqual(2000)
  })
})

describe("buildDocInput uses effectiveConditions", () => {
  it("doc.conditions wins over the template and the URL; LIGHT_PAR / CO2_PPM unchanged", () => {
    expect(LIGHT_PAR).toEqual({ Low: 100, Medium: 200, High: 320 })
    expect(CO2_PPM).toEqual({ on: 25, off: 5 })
    const doc: ScapeDoc = { ...dutchDoc(), conditions: { light: "Low", co2: false } }
    const b = buildDocInput(doc, params("light=High&co2=true"), PLANTS)
    expect(b.light).toBe("Low")
    expect(b.co2).toBe(false)
    expect(b.input.light.surfacePar).toBe(100)
    expect(b.input.water.co2Ppm).toBe(5)
    // absent → template
    const t = buildDocInput(dutchDoc(), params("light=Low"), PLANTS)
    expect([t.light, t.co2, t.input.light.surfacePar, t.input.water.co2Ppm]).toEqual(["High", true, 320, 25])
    // absent, no template → URL
    const u = buildDocInput(plainDoc(), params("light=Low&co2=true"), PLANTS)
    expect([u.light, u.co2]).toEqual(["Low", true])
  })
  it("conditions do not change the seed (only light / CO2 differ between runs)", () => {
    const a = buildDocInput(dutchDoc(), params(""), PLANTS)
    const b = buildDocInput({ ...dutchDoc(), conditions: { light: "Low", co2: false } }, params(""), PLANTS)
    expect(b.input.seed).toBe(a.input.seed)
    expect(b.input.plants).toEqual(a.input.plants)
  })
})

describe("template bar", () => {
  it("picking a template sets conditions to the template's { light, co2 }", () => {
    for (const tpl of TEMPLATES) {
      const doc = docFromTemplatePick(instantiate(tpl, TANK), TANK, tpl)
      expect(doc.templateId).toBe(tpl.id)
      expect(doc.conditions).toEqual({ light: tpl.light, co2: tpl.co2 })
      expect(sanitizeDoc(doc)).toBe(doc)
    }
  })
  it("a pick after editing conditions overrides them (one replace step, sim re-runs)", () => {
    const edited = apply(dutchDoc(), "Low", false)
    const tpl = getTemplate("iwagumi-sanzon")!
    const pick = docFromTemplatePick(instantiate(tpl, TANK), TANK, tpl)
    const s = editorReducer(edited, { type: "apply", op: { type: "replace", doc: pick } })
    expect(s.doc.conditions).toEqual({ light: "High", co2: true })
    expect(needsResim(edited.doc, s.doc)).toBe(true)
    expect(editorReducer(s, { type: "undo" }).doc.conditions).toEqual({ light: "Low", co2: false })
  })
})

describe("acceptance: conditions drive the vendored sim-core", () => {
  const total = (doc: ScapeDoc) => {
    const r = simulate(buildDocInput(doc, params(""), PLANTS).input)
    const f = r.frames[90]!
    return { biomass: f.plants.reduce((a, p) => a + p.biomassG, 0), frame0: r.frames[0]! }
  }
  it("60-P Dutch, day 90: High + CO2 vs Low + no CO2 total biomass differ by ≥ 20 %", () => {
    const hi = total({ ...dutchDoc(), conditions: { light: "High", co2: true } }).biomass
    const lo = total({ ...dutchDoc(), conditions: { light: "Low", co2: false } }).biomass
    expect(hi).toBeGreaterThan(0)
    expect(Math.abs(hi - lo) / Math.max(hi, lo)).toBeGreaterThanOrEqual(0.2)
  }, 60_000)
})
