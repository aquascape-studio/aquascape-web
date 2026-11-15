import { describe, expect, it } from "vitest"
import plantsJson from "../sim/vendor/plants.json"
import type { BotanyRecord } from "../sim/buildInput"
import {
  GLASS_MARGIN_CM,
  MAX_PLACEMENTS,
  REF_AREA_CM2,
  TEMPLATES,
  defaultBuriedFrac,
  getTemplate,
  hardscapeFor,
  insideFootprint,
  instantiate,
  parseGuidesParam,
  parseTemplateParam,
  scaledCounts,
} from "./index"
import { TEMPLATE_CONTRACT_VERSION, type ScapeTemplate, type TemplatePlantGroup } from "./contract"
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
    expect(new Set(a.plants.map((p) => p.speciesId))).toEqual(new Set(b.plants.map((p) => p.speciesId)))
    // mean normalised x per species agrees within a few % (a 1-clump street on the small tank vs 4 on the big one)
    for (const sid of new Set(a.plants.map((p) => p.speciesId))) {
      const mean = (o: typeof a, W: number) => {
        const xs = o.plants.filter((p) => p.speciesId === sid).map((p) => p.x / W)
        return xs.reduce((s, x) => s + x, 0) / xs.length
      }
      expect(Math.abs(mean(a, TANKS[0]!.widthCm) - mean(b, TANKS[2]!.widthCm)), sid).toBeLessThan(0.04)
    }
    // bigger tank → more placements (1.0.1 count scaling), never more than the budget
    expect(b.plants.length).toBeGreaterThan(a.plants.length)
    expect(b.plants.length).toBeLessThanOrEqual(MAX_PLACEMENTS)
  })

  it("caps an over-budget template at 60 placements", () => {
    const t = getTemplate("dutch-streets")!
    const big = { ...t, groups: t.groups.map((g) => ({ ...g, count: 20 })) }
    expect(instantiate(big, TANKS[1]!).plants.length).toBeLessThanOrEqual(MAX_PLACEMENTS)
  })
})

describe("contract 1.0.1", () => {
  const group = (count: number, extra: Partial<TemplatePlantGroup> = {}): TemplatePlantGroup => ({
    speciesId: "hemianthus-callitrichoides-cuba", u: 0.5, v: 0.5, ru: 0.2, rv: 0.1, count, portions: 1, ...extra,
  })
  const bare = (groups: TemplatePlantGroup[]): ScapeTemplate => ({
    ...getTemplate("dutch-streets")!, id: "test", hardscape: [], groups,
  })

  it("is version 1.0.1 and the Iwagumi template uses the iwagumi composition", () => {
    expect(TEMPLATE_CONTRACT_VERSION).toBe("1.0.1")
    expect(getTemplate("iwagumi-sanzon")!.composition).toBe("iwagumi")
    for (const t of TEMPLATES) if (t.style === "iwagumi") expect(t.composition).toBe("iwagumi")
    for (const t of TEMPLATES) if (t.style !== "iwagumi") expect(t.composition).not.toBe("iwagumi")
  })

  describe("count scaling by tank area (ref 60 × 30)", () => {
    const groups = [group(10), group(6), group(3), group(1)]
    it("keeps reference counts on the reference tank", () => {
      expect(REF_AREA_CM2).toBe(1800)
      expect(scaledCounts(groups, { widthCm: 60, depthCm: 30, heightCm: 36 })).toEqual([10, 6, 3, 1])
    })
    it("scales by W·D / 1800, rounds, keeps ≥ 1", () => {
      // 45 × 27 → ×0.675
      expect(scaledCounts(groups, { widthCm: 45, depthCm: 27, heightCm: 30 })).toEqual([7, 4, 2, 1])
      // 30 × 20 → ×0.333: the single-plant group survives
      expect(scaledCounts(groups, { widthCm: 30, depthCm: 20, heightCm: 25 })).toEqual([3, 2, 1, 1])
      // 80 × 35 → ×1.556
      expect(scaledCounts(groups, { widthCm: 80, depthCm: 35, heightCm: 40 })).toEqual([16, 9, 5, 2])
    })
    it("scales all groups down proportionally when the total exceeds 60", () => {
      const big = [group(20), group(10), group(5), group(1)]
      const out = scaledCounts(big, { widthCm: 120, depthCm: 50, heightCm: 50 }) // ×3.33 → 67+33+17+3 = 120
      expect(out.reduce((a, n) => a + n, 0)).toBe(MAX_PLACEMENTS)
      for (const n of out) expect(n).toBeGreaterThanOrEqual(1)
      expect(out[0]! / out[1]!).toBeCloseTo(2, 0)
      expect(out[0]!).toBeGreaterThan(out[1]!)
      expect(out[1]!).toBeGreaterThan(out[2]!)
      expect(out[2]!).toBeGreaterThan(out[3]!)
    })
    it("drives instantiate(): placements follow the scaled counts", () => {
      const t = bare([group(10, { u: 0.25 }), group(6, { u: 0.75, speciesId: "glossostigma-elatinoides" })])
      expect(instantiate(t, { widthCm: 60, depthCm: 30, heightCm: 36 }).plants).toHaveLength(16)
      expect(instantiate(t, { widthCm: 45, depthCm: 27, heightCm: 30 }).plants).toHaveLength(11)
      expect(instantiate(t, { widthCm: 90, depthCm: 45, heightCm: 45 }).plants).toHaveLength(37) // 22.5→23, 13.5→14
      for (const tpl of TEMPLATES) {
        const ref = instantiate(tpl, TANKS[1]!).plants.length
        expect(instantiate(tpl, TANKS[0]!).plants.length, tpl.id).toBeLessThan(ref)
        expect(instantiate(tpl, TANKS[2]!).plants.length, tpl.id).toBeGreaterThan(ref)
      }
    })
    it("makes up capped placements with portions, never shrinks portions", () => {
      const t = bare([group(30, { portions: 1 }), group(30, { portions: 1, u: 0.2, speciesId: "glossostigma-elatinoides" })])
      const capped = instantiate(t, { widthCm: 90, depthCm: 45, heightCm: 45 }) // wants 2 × 68
      expect(capped.plants).toHaveLength(60)
      for (const p of capped.plants) expect(p.portions).toBe(2)
      const small = instantiate(t, { widthCm: 45, depthCm: 27, heightCm: 30 })
      for (const p of small.plants) expect(p.portions).toBe(1)
    })
  })

  it("applies group angle in cm space (same street angle in any aspect ratio)", () => {
    const angle = 0.5
    const t = bare([group(40, { ru: 0.4, rv: 0.04, angle })])
    for (const tank of [
      { widthCm: 60, depthCm: 30, heightCm: 36 },
      { widthCm: 60, depthCm: 60, heightCm: 36 },
      { widthCm: 120, depthCm: 40, heightCm: 50 },
    ]) {
      const pts = instantiate(t, tank).plants
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length
      const mz = pts.reduce((a, p) => a + p.z, 0) / pts.length
      let sxx = 0, szz = 0, sxz = 0
      for (const p of pts) {
        sxx += (p.x - mx) ** 2
        szz += (p.z - mz) ** 2
        sxz += (p.x - mx) * (p.z - mz)
      }
      // principal-axis angle in the floor plane (cm), measured from +x towards +z
      const principal = 0.5 * Math.atan2(2 * sxz, sxx - szz)
      expect(Math.abs(principal - angle), `${tank.widthCm}×${tank.depthCm}`).toBeLessThan(0.08)
    }
  })

  it("defaults suteishi buriedFrac to 0.35 (other roles keep the renderer default)", () => {
    expect(defaultBuriedFrac("suteishi")).toBe(0.35)
    expect(defaultBuriedFrac("oyaishi")).toBe(0.15)
    expect(defaultBuriedFrac(undefined)).toBe(0.15)
    const tank = TANKS[1]!
    const base = { id: "s", kind: "stone" as const, u: 0.5, v: 0.5, wFrac: 0.1, hFrac: 0.1, dFrac: 0.1, rotationY: 0, seed: 1 }
    expect(hardscapeFor({ ...base, role: "suteishi" }, tank).buriedFrac).toBe(0.35)
    expect(hardscapeFor({ ...base, role: "suteishi", buriedFrac: 0.5 }, tank).buriedFrac).toBe(0.5)
    expect(hardscapeFor({ ...base, role: "oyaishi" }, tank).buriedFrac).toBeUndefined()
    const iw = instantiate(getTemplate("iwagumi-sanzon")!, tank)
    for (const h of iw.hardscape.filter((hh) => hh.role === "suteishi")) expect(h.buriedFrac).toBeGreaterThanOrEqual(0.35)
    expect(iw.hardscape.find((h) => h.id === "suteishi-1")!.buriedFrac).toBe(0.35)
  })
})

describe("dutch-streets (11-14 feedback)", () => {
  const t = getTemplate("dutch-streets")!
  const back = t.groups.filter((g) => g.v < 0.5).sort((a, b) => a.u - b.u)
  const tank = TANKS[1]!
  const W = tank.widthCm
  const D = tank.depthCm

  it("keeps Hygrophila groups small next to their neighbours", () => {
    const hygro = t.groups.filter((g) => g.speciesId.startsWith("hygrophila"))
    expect(hygro.length).toBeGreaterThan(0)
    const others = back.filter((g) => !g.speciesId.startsWith("hygrophila"))
    for (const h of hygro) {
      for (const o of others) {
        expect(h.count * h.portions, o.speciesId).toBeLessThan(o.count * o.portions)
        expect(h.ru * h.rv).toBeLessThan(o.ru * o.rv)
      }
    }
    const out = instantiate(t, tank)
    const share = (sid: string) => out.plants.filter((p) => p.speciesId === sid).reduce((a, p) => a + p.portions, 0)
    const total = out.plants.reduce((a, p) => a + p.portions, 0)
    for (const h of hygro) expect(share(h.speciesId) / total).toBeLessThan(0.05)
  })

  it("lays the back streets out as parallel, long, thin diagonal bands", () => {
    expect(back.length).toBeGreaterThanOrEqual(6)
    const a0 = back[0]!.angle!
    expect(Math.abs(a0)).toBeGreaterThan(0.35) // clearly diagonal (> 20°)
    expect(Math.abs(a0)).toBeLessThan(0.9)
    for (const g of back) {
      expect(g.angle, g.speciesId).toBe(a0) // parallel
      expect((g.rv * D) / (g.ru * W), g.speciesId).toBeGreaterThanOrEqual(4) // long and thin (cm)
    }
    // gap between neighbouring band axes (perpendicular, cm) is at least twice the bands' half-widths
    for (let i = 1; i < back.length; i++) {
      const [p, q] = [back[i - 1]!, back[i]!]
      const dx = (q.u - p.u) * W
      const dz = (q.v - p.v) * D
      // band axis = local z rotated by angle → normal = (cos a, sin a)
      const perp = Math.abs(dx * Math.cos(a0) + dz * Math.sin(a0))
      expect(perp, `${p.speciesId} | ${q.speciesId}`).toBeGreaterThan(2 * (p.ru * W + q.ru * W))
    }
  })

  it("puts every back-street clump closer to its own band than to any other", () => {
    for (const tk of TANKS) {
      const out = instantiate(t, tk)
      const axis = (g: TemplatePlantGroup, x: number, z: number) => {
        const a = g.angle ?? 0
        return Math.abs((x - (g.u - 0.5) * tk.widthCm) * Math.cos(a) + (z - (g.v - 0.5) * tk.depthCm) * Math.sin(a))
      }
      for (const p of out.plants) {
        const own = back.find((g) => g.speciesId === p.speciesId)
        if (!own) continue
        const d = axis(own, p.x, p.z)
        for (const g of back) if (g !== own) expect(axis(g, p.x, p.z), `${p.id} @${tk.widthCm}`).toBeGreaterThan(d)
      }
    }
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
