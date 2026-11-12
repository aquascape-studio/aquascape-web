import { describe, expect, it } from "vitest"
import plantsJson from "./vendor/plants.json"
import {
  buildInput,
  CO2_PPM,
  DEFAULT_PLANTS,
  LEGACY_PLANT_MAP,
  LIGHT_PAR,
  zoneFor,
  type BotanyRecord,
} from "./buildInput"
import { simulate } from "./vendor/sim-core"

const plants = plantsJson as unknown as BotanyRecord[]
const ids = new Set(plants.map((p) => p.id))

const LEGACY_IDS = [
  "java-moss", "java-fern", "anubias-barteri", "amazon-sword", "rotala-rotundifolia",
  "ludwigia-repens", "dwarf-hairgrass", "monte-carlo", "hc-cuba", "cryptocoryne-wendtii",
  "vallisneria", "hornwort", "water-wisteria",
]

function params(p: Record<string, string>) {
  return new URLSearchParams(p)
}

describe("LEGACY_PLANT_MAP", () => {
  it("covers every plant id offered by /studio/new", () => {
    for (const id of LEGACY_IDS) expect(LEGACY_PLANT_MAP[id], id).toBeDefined()
  })

  it("only targets species present in the vendored plants.json", () => {
    for (const [legacy, m] of Object.entries(LEGACY_PLANT_MAP)) expect(ids.has(m.speciesId), legacy).toBe(true)
  })

  it("maps hc-cuba to Hemianthus callitrichoides 'Cuba' (carpet, foreground)", () => {
    const m = LEGACY_PLANT_MAP["hc-cuba"]!
    expect(m.speciesId).toBe("hemianthus-callitrichoides-cuba")
    const rec = plants.find((p) => p.id === m.speciesId)!
    expect(rec.growthForm).toBe("carpeting")
    expect(m.zone).toBe("foreground")
  })

  it("marks exact matches only where the scientific species agrees", () => {
    for (const [legacy, m] of Object.entries(LEGACY_PLANT_MAP)) {
      if (m.exact) expect(plants.some((p) => p.id === m.speciesId), legacy).toBe(true)
    }
    expect(LEGACY_PLANT_MAP["java-fern"]!.exact).toBe(false)
  })
})

describe("buildInput", () => {
  it("uses defaults when params are missing", () => {
    const r = buildInput(params({}), plants)
    expect(r.input.tank).toEqual({ widthCm: 60, depthCm: 30, heightCm: 36 })
    expect(r.light).toBe("Medium")
    expect(r.input.light.surfacePar).toBe(LIGHT_PAR.Medium)
    expect(r.input.water.co2Ppm).toBe(CO2_PPM.off)
    expect(r.resolved.map((x) => x.sourceId).sort()).toEqual(Object.keys(DEFAULT_PLANTS).sort())
    expect(r.input.days).toBe(90)
  })

  it("maps light level and CO2 toggle", () => {
    expect(buildInput(params({ light: "Low" }), plants).input.light.surfacePar).toBe(100)
    expect(buildInput(params({ light: "High" }), plants).input.light.surfacePar).toBe(320)
    expect(buildInput(params({ light: "bogus" }), plants).input.light.surfacePar).toBe(200)
    expect(buildInput(params({ co2: "true" }), plants).input.water.co2Ppm).toBe(25)
    expect(buildInput(params({ co2: "false" }), plants).input.water.co2Ppm).toBe(5)
  })

  it("reads tank dims and clamps nonsense", () => {
    const r = buildInput(params({ w: "90", d: "45", h: "45" }), plants)
    expect(r.input.tank).toEqual({ widthCm: 90, depthCm: 45, heightCm: 45 })
    expect(buildInput(params({ w: "abc", d: "-3" }), plants).input.tank.widthCm).toBe(60)
    expect(buildInput(params({ d: "-3" }), plants).input.tank.depthCm).toBe(10)
  })

  it("maps every legacy id and places foreground in front of background", () => {
    const all = Object.fromEntries(LEGACY_IDS.map((id) => [id, 2]))
    const r = buildInput(params({ plants: JSON.stringify(all) }), plants)
    expect(r.unknown).toEqual([])
    const { tank } = r.input
    for (const p of r.input.plants) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(tank.widthCm / 2)
      expect(Math.abs(p.z)).toBeLessThanOrEqual(tank.depthCm / 2)
      expect(r.input.species[p.speciesId]).toBeDefined()
    }
    const zOf = (sid: string) => r.input.plants.filter((p) => p.speciesId === sid).map((p) => p.z)
    const carpet = zOf("hemianthus-callitrichoides-cuba")
    const stems = zOf("rotala-rotundifolia")
    expect(Math.min(...carpet)).toBeGreaterThan(Math.max(...stems)) // z: back → front
  })

  it("keeps total portions equal to quantity and ids unique", () => {
    const r = buildInput(params({ plants: JSON.stringify({ "hc-cuba": 30, "java-fern": 3 }) }), plants)
    const portions = (sid: string) =>
      r.input.plants.filter((p) => p.speciesId === sid).reduce((a, p) => a + p.portions, 0)
    expect(portions("hemianthus-callitrichoides-cuba")).toBe(30)
    expect(portions("microsorum-pteropus-narrow")).toBe(3)
    expect(new Set(r.input.plants.map((p) => p.id)).size).toBe(r.input.plants.length)
  })

  it("accepts botany ids directly and reports unknown ids", () => {
    const r = buildInput(params({ plants: JSON.stringify({ "rotala-macrandra": 2, "no-such-plant": 1 }) }), plants)
    expect(r.resolved.map((x) => x.speciesId)).toEqual(["rotala-macrandra"])
    expect(r.unknown).toEqual(["no-such-plant"])
  })

  it("falls back to defaults on malformed plants JSON", () => {
    const r = buildInput(params({ plants: "{not json" }), plants)
    expect(r.resolved.length).toBe(Object.keys(DEFAULT_PLANTS).length)
  })

  it("is deterministic", () => {
    const p = params({ w: "45", light: "High", co2: "true", plants: JSON.stringify({ "monte-carlo": 4, "ludwigia-repens": 3 }) })
    expect(buildInput(p, plants)).toEqual(buildInput(p, plants))
  })

  it("produces input the engine accepts", () => {
    const r = buildInput(params({ plants: JSON.stringify({ "hc-cuba": 4, "rotala-rotundifolia": 3, "java-fern": 1 }) }), plants)
    const res = simulate({ ...r.input, days: 5 })
    expect(res.frames).toHaveLength(6)
    expect(res.frames[0]!.plants).toHaveLength(r.input.plants.length)
  })
})

describe("zoneFor", () => {
  it("classifies by growth form and placement", () => {
    const get = (id: string) => plants.find((p) => p.id === id)!
    expect(zoneFor(get("eleocharis-parvula"))).toBe("foreground")
    expect(zoneFor(get("hygrophila-corymbosa"))).toBe("background")
    expect(zoneFor(get("cryptocoryne-wendtii"))).toBe("midground")
    expect(zoneFor(get("salvinia-natans"))).toBe("floating")
  })
})
