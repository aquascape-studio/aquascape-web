import { describe, expect, it } from "vitest"
import plantsJson from "../sim/vendor/plants.json"
import type { BotanyRecord } from "../sim/buildInput"
import {
  GLASS_MARGIN_CM,
  MAX_PLACEMENTS,
  TEMPLATES,
  getTemplate,
  insideFootprint,
  instantiate,
  parseGuidesParam,
  parseTemplateParam,
} from "./index"
import { buildTemplateInput } from "./buildTemplateInput"

const PLANTS = plantsJson as unknown as BotanyRecord[]
const BY_ID = new Map(PLANTS.map((p) => [p.id, p]))
const TANKS = [
  { widthCm: 45, depthCm: 27, heightCm: 30 },
  { widthCm: 60, depthCm: 30, heightCm: 36 },
  { widthCm: 90, depthCm: 45, heightCm: 45 },
]
const REQUIRED = ["iwagumi-sanzon", "nature-triangle", "nature-concave", "dutch-streets"]
const EPS = 0.011 // r2 rounding

describe("TEMPLATES", () => {
  it("contains the four required templates with unique ids", () => {
    const ids = TEMPLATES.map((t) => t.id)
    for (const id of REQUIRED) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of REQUIRED) expect(getTemplate(id)?.id).toBe(id)
    expect(getTemplate("nope")).toBeUndefined()
  })

  it("uses only species from the vendored botany plants.json", () => {
    for (const t of TEMPLATES) for (const g of t.groups) expect(BY_ID.has(g.speciesId), `${t.id}: ${g.speciesId}`).toBe(true)
  })

  it("has bilingual names and short blurbs", () => {
    for (const t of TEMPLATES) {
      expect(t.nameZh).toMatch(/[一-鿿]/)
      expect(t.nameEn.length).toBeGreaterThan(0)
      expect([...t.blurbZh].length).toBeLessThanOrEqual(40)
      expect(t.blurbEn.length).toBeGreaterThan(0)
    }
  })

  it("keeps normalised coordinates in [0,1] and epiphyte hosts valid", () => {
    for (const t of TEMPLATES) {
      const hs = new Set(t.hardscape.map((h) => h.id))
      for (const h of [...t.hardscape, ...t.groups]) {
        expect(h.u).toBeGreaterThanOrEqual(0)
        expect(h.u).toBeLessThanOrEqual(1)
        expect(h.v).toBeGreaterThanOrEqual(0)
        expect(h.v).toBeLessThanOrEqual(1)
      }
      for (const g of t.groups) if (g.onHardscape) {
        expect(hs.has(g.onHardscape), `${t.id}: host ${g.onHardscape}`).toBe(true)
        expect(BY_ID.get(g.speciesId)?.growthForm, `${t.id}: ${g.speciesId}`).toMatch(/epiphyte|moss/)
      }
    }
  })

  it("follows its style's rules", () => {
    const iwagumi = getTemplate("iwagumi-sanzon")!
    const stones = iwagumi.hardscape.filter((h) => h.kind === "stone")
    expect(stones.length).toBeGreaterThanOrEqual(3)
    expect(stones.length % 2).toBe(1) // odd stone count
    expect(iwagumi.hardscape.some((h) => h.kind === "wood")).toBe(false)
    const oya = stones.find((s) => s.role === "oyaishi")!
    const fuku = stones.find((s) => s.role === "fukuishi")!
    const soe = stones.find((s) => s.role === "soeishi")!
    expect(Math.abs(oya.u - 1 / 3) < 0.03 || Math.abs(oya.u - 2 / 3) < 0.03).toBe(true) // on a third, off centre
    expect(oya.hFrac).toBeGreaterThan(fuku.hFrac)
    expect(fuku.hFrac).toBeGreaterThan(soe.hFrac)
    for (const g of iwagumi.groups) expect(BY_ID.get(g.speciesId)?.growthForm).toBe("carpeting")
    expect(iwagumi.groups.map((g) => g.speciesId)).toContain("hemianthus-callitrichoides-cuba")

    const dutch = getTemplate("dutch-streets")!
    expect(dutch.hardscape).toHaveLength(0)
    expect(dutch.groups.every((g) => BY_ID.get(g.speciesId)?.growthForm === "stem")).toBe(true)
    // ≈1 species per 10 cm of a 60 cm tank, at least
    expect(new Set(dutch.groups.map((g) => g.speciesId)).size).toBeGreaterThanOrEqual(6)
    // strong contrast: back-row neighbours alternate red / green
    const back = dutch.groups.filter((g) => g.v < 0.5).sort((a, b) => a.u - b.u)
    const isRed = (id: string) => {
      const hex = BY_ID.get(id)!.colorHex!
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) > ((n >> 8) & 255)
    }
    for (let i = 1; i < back.length; i++) expect(isRed(back[i]!.speciesId)).not.toBe(isRed(back[i - 1]!.speciesId))
    expect(dutch.groups.some((g) => g.speciesId === "ammannia-gracilis")).toBe(true) // coral red

    const concave = getTemplate("nature-concave")!
    const masses = concave.hardscape.filter((h) => h.kind === "wood")
    expect(masses.some((h) => h.u < 0.3)).toBe(true)
    expect(masses.some((h) => h.u > 0.7)).toBe(true)
    expect(concave.hardscape.every((h) => h.u < 0.35 || h.u > 0.65)).toBe(true) // open centre
  })
})

describe("instantiate", () => {
  for (const t of TEMPLATES) {
    for (const tank of TANKS) {
      describe(`${t.id} @ ${tank.widthCm}×${tank.depthCm}×${tank.heightCm}`, () => {
        const out = instantiate(t, tank)

        it("is deterministic", () => {
          expect(instantiate(t, tank)).toEqual(out)
          expect(instantiate(t, tank, 0)).toEqual(out)
          expect(instantiate(t, tank, 7)).toEqual(instantiate(t, tank, 7))
        })

        it("stays within the sim budget and plants something", () => {
          expect(out.plants.length).toBeLessThanOrEqual(MAX_PLACEMENTS)
          expect(out.plants.length).toBeGreaterThan(15)
        })

        it("uses unique ids '<speciesId>-<n>' counted per species", () => {
          const ids = out.plants.map((p) => p.id)
          expect(new Set(ids).size).toBe(ids.length)
          const seen = new Map<string, number>()
          for (const p of out.plants) {
            const n = (seen.get(p.speciesId) ?? 0) + 1
            seen.set(p.speciesId, n)
            expect(p.id).toBe(`${p.speciesId}-${n}`)
            expect(BY_ID.has(p.speciesId)).toBe(true)
            expect(p.portions).toBeGreaterThanOrEqual(1)
          }
        })

        it("keeps every placement ≥1 cm inside the glass", () => {
          for (const p of out.plants) {
            expect(Math.abs(p.x)).toBeLessThanOrEqual(tank.widthCm / 2 - GLASS_MARGIN_CM + EPS)
            expect(Math.abs(p.z)).toBeLessThanOrEqual(tank.depthCm / 2 - GLASS_MARGIN_CM + EPS)
            expect(p.y).toBeGreaterThanOrEqual(0)
            expect(p.y).toBeLessThan(tank.heightCm)
          }
        })

        it("never plants inside a stone footprint (epiphytes on hardscape excepted)", () => {
          const stones = out.hardscape.filter((h) => h.kind === "stone")
          const epi = new Set(t.groups.filter((g) => g.onHardscape).map((g) => g.speciesId))
          for (const p of out.plants) {
            if (epi.has(p.speciesId) && p.y > 0) continue
            for (const s of stones) expect(insideFootprint(s, p.x, p.z), `${p.id} in ${s.id}`).toBe(false)
          }
        })

        it("ties epiphytes onto their host piece", () => {
          for (const g of t.groups.filter((gg) => gg.onHardscape)) {
            const host = out.hardscape.find((h) => h.id === g.onHardscape)!
            for (const p of out.plants.filter((pp) => pp.speciesId === g.speciesId && pp.y > 0)) {
              expect(Math.abs(p.x - host.x)).toBeLessThanOrEqual(host.sizeCm[0] / 2)
              expect(Math.abs(p.z - host.z)).toBeLessThanOrEqual(host.sizeCm[2] / 2)
              expect(p.y).toBeLessThanOrEqual(host.sizeCm[1])
            }
          }
        })

        it("scales hardscape, focal point and bed with the tank", () => {
          for (const [i, h] of t.hardscape.entries()) {
            const v = out.hardscape[i]!
            expect(v.x).toBeCloseTo((h.u - 0.5) * tank.widthCm, 1)
            expect(v.z).toBeCloseTo((h.v - 0.5) * tank.depthCm, 1)
            expect(v.sizeCm[0]).toBeCloseTo(h.wFrac * tank.widthCm, 1)
            expect(v.sizeCm[1]).toBeCloseTo(h.hFrac * tank.heightCm, 1)
          }
          expect(out.focalPoint.x).toBeCloseTo((t.focal.u - 0.5) * tank.widthCm, 1)
          expect(out.focalPoint.y).toBeCloseTo(t.focal.h * tank.heightCm, 1)
          expect(out.bed.backCm).toBeGreaterThan(out.bed.frontCm)
        })
      })
    }
  }

  it("keeps the same layout (in normalised units) across tank sizes", () => {
    const t = getTemplate("dutch-streets")!
    const a = instantiate(t, TANKS[0]!)
    const b = instantiate(t, TANKS[2]!)
    expect(a.plants.map((p) => p.id)).toEqual(b.plants.map((p) => p.id))
    // mean normalised x per species agrees within a few %
    for (const sid of new Set(a.plants.map((p) => p.speciesId))) {
      const mean = (o: typeof a, W: number) => {
        const xs = o.plants.filter((p) => p.speciesId === sid).map((p) => p.x / W)
        return xs.reduce((s, x) => s + x, 0) / xs.length
      }
      expect(Math.abs(mean(a, TANKS[0]!.widthCm) - mean(b, TANKS[2]!.widthCm))).toBeLessThan(0.03)
    }
    // bigger tank → more portions per placement
    expect(b.plants[0]!.portions).toBeGreaterThan(a.plants[0]!.portions)
  })

  it("caps an over-budget template at 60 placements", () => {
    const t = getTemplate("dutch-streets")!
    const big = { ...t, groups: t.groups.map((g) => ({ ...g, count: 20 })) }
    expect(instantiate(big, TANKS[1]!).plants.length).toBeLessThanOrEqual(MAX_PLACEMENTS)
  })
})

describe("URL params", () => {
  it("parses ?tpl", () => {
    expect(parseTemplateParam("iwagumi-sanzon")?.id).toBe("iwagumi-sanzon")
    expect(parseTemplateParam("dutch-streets")?.id).toBe("dutch-streets")
    for (const v of [null, undefined, "", "unknown", "IWAGUMI-SANZON"]) expect(parseTemplateParam(v)).toBeUndefined()
  })

  it("parses ?guides with a 'none' default", () => {
    expect(parseGuidesParam("thirds")).toBe("thirds")
    expect(parseGuidesParam("golden")).toBe("golden")
    for (const v of [null, undefined, "", "none", "Thirds", "x"]) expect(parseGuidesParam(v)).toBe("none")
  })
})

describe("buildTemplateInput", () => {
  it("builds a SimInput from the template on the URL's tank", () => {
    const t = getTemplate("iwagumi-sanzon")!
    const b = buildTemplateInput(t, new URLSearchParams("w=90&d=45&h=45"), PLANTS)
    expect(b.input.tank).toEqual({ widthCm: 90, depthCm: 45, heightCm: 45 })
    expect(b.input.plants).toEqual(instantiate(t, b.input.tank).plants)
    expect(b.light).toBe("High")
    expect(b.co2).toBe(true)
    expect(b.unknown).toEqual([])
    for (const p of b.input.plants) expect(b.input.species[p.speciesId]).toBeDefined()
    const portions = b.input.plants.reduce((a, p) => a + p.portions, 0)
    expect(b.resolved.reduce((a, r) => a + r.qty, 0)).toBe(portions)
    expect(buildTemplateInput(t, new URLSearchParams("w=90&d=45&h=45"), PLANTS)).toEqual(b)
  })

  it("defaults to the 60 cm tank and the template name", () => {
    const b = buildTemplateInput(getTemplate("dutch-streets")!, new URLSearchParams(""), PLANTS)
    expect(b.input.tank.widthCm).toBe(60)
    expect(b.name).toContain("荷兰街道")
    expect(b.scene.hardscape).toEqual([])
  })
})
