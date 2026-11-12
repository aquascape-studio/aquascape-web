import { describe, expect, it } from "vitest"
import { speciesLook } from "@aquascape-studio/render"
import plantsJson from "./vendor/plants.json"
import { buildInput, type BotanyRecord } from "./buildInput"
import { defaultHardscape, toFrontal } from "./toFrontal"
import type { Frame, PlantFrame } from "./vendor/sim-core/contract"

const PLANTS = plantsJson as unknown as BotanyRecord[]
const BY_ID = new Map(PLANTS.map((p) => [p.id, p]))

function pf(id: string, heightCm: number, spreadCm: number, health: number): PlantFrame {
  return { id, heightCm, spreadCm, health, biomassG: 1, parAtPlant: 100, limiting: [] }
}

describe("toFrontal", () => {
  const { input } = buildInput(new URLSearchParams(), PLANTS)

  it("joins placements and frame plants by id, coordinates unchanged", () => {
    const frame = { plants: input.plants.map((p, i) => pf(p.id, 5 + i, 3 + i, 0.9)).reverse() }
    const out = toFrontal(input, frame, BY_ID, speciesLook)
    expect(out.tank).toEqual(input.tank)
    expect(out.plants).toHaveLength(input.plants.length)
    input.plants.forEach((p, i) => {
      expect(out.plants[i]).toEqual({ id: p.id, speciesId: p.speciesId, x: p.x, z: p.z, y: p.y, heightCm: 5 + i, spreadCm: 3 + i, health: 0.9 })
    })
  })

  it("derives one SpeciesLook per used species from the botany visual block", () => {
    const frame = { plants: input.plants.map((p) => pf(p.id, 5, 3, 1)) }
    const out = toFrontal(input, frame, BY_ID, speciesLook)
    const used = [...new Set(input.plants.map((p) => p.speciesId))].sort()
    expect(Object.keys(out.species).sort()).toEqual(used)
    for (const p of out.plants) expect(out.species[p.speciesId]).toBeDefined()
    const rotala = BY_ID.get("rotala-rotundifolia")!
    expect(out.species["rotala-rotundifolia"]).toEqual(speciesLook(rotala))
    expect(out.species["rotala-rotundifolia"]!.leafShape).toBe((rotala as { visual?: { leafShape?: string } }).visual?.leafShape)
  })

  it("drops placements missing from the frame or from botany", () => {
    const tank = { widthCm: 60, depthCm: 30, heightCm: 36 }
    const plants = [
      { id: "a#1", speciesId: "rotala-rotundifolia", x: 1, z: 2, y: 0, portions: 1 },
      { id: "b#1", speciesId: "no-such-species", x: 0, z: 0, y: 0, portions: 1 },
      { id: "c#1", speciesId: "rotala-rotundifolia", x: 3, z: 0, y: 0, portions: 1 },
    ]
    const frame = { plants: [pf("a#1", 4, 2, 0.5), pf("b#1", 4, 2, 0.5)] }
    const out = toFrontal({ tank, plants }, frame, BY_ID, speciesLook)
    expect(out.plants.map((p) => p.id)).toEqual(["a#1"])
    expect(Object.keys(out.species)).toEqual(["rotala-rotundifolia"])
  })

  it("returns no plants without a frame", () => {
    expect(toFrontal(input, undefined as Frame | undefined, BY_ID, speciesLook).plants).toEqual([])
  })
})

describe("defaultHardscape", () => {
  const tank = { widthCm: 60, depthCm: 30, heightCm: 36 }

  it("is deterministic", () => {
    expect(defaultHardscape(tank)).toEqual(defaultHardscape({ ...tank }))
  })

  it("places 2–3 smooth stones on the thirds, at mid-depth, inside the tank", () => {
    const hs = defaultHardscape(tank)
    expect(hs.length).toBeGreaterThanOrEqual(2)
    expect(hs.length).toBeLessThanOrEqual(3)
    expect(hs.every((h) => h.kind === "stone")).toBe(true)
    expect(hs[0]!.x).toBeCloseTo(-10, 1) // left third
    expect(hs.some((h) => Math.abs(h.x - 10) < 0.01)).toBe(true) // right third
    for (const h of hs) {
      const [w, ht, d] = h.sizeCm
      expect(Math.abs(h.x) + w / 2).toBeLessThanOrEqual(tank.widthCm / 2)
      expect(Math.abs(h.z)).toBeLessThan(tank.depthCm * 0.25)
      expect(Math.abs(h.z) + d / 2).toBeLessThanOrEqual(tank.depthCm / 2)
      expect(ht).toBeLessThan(tank.heightCm * 0.5)
    }
    expect(new Set(hs.map((h) => h.id)).size).toBe(hs.length)
  })

  it("scales with tank width", () => {
    const big = defaultHardscape({ widthCm: 120, depthCm: 45, heightCm: 50 })
    expect(big[0]!.x).toBeCloseTo(-20, 1)
  })
})
