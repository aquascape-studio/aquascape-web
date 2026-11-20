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
import { anchors, surfaceY } from "../editor/surface"
import { canAttach } from "../editor"

const PLANTS = plantsJson as unknown as BotanyRecord[]
const BY_ID = new Map(PLANTS.map((p) => [p.id, p]))
const TANKS = [
  { widthCm: 45, depthCm: 27, heightCm: 30 },
  { widthCm: 60, depthCm: 30, heightCm: 36 },
  { widthCm: 90, depthCm: 45, heightCm: 45 },
]
const REQUIRED = ["iwagumi-sanzon", "nature-triangle", "nature-concave", "dutch-streets", "nature-lowtech"]
const EPS = 0.011 // r2 rounding

describe("TEMPLATES", () => {
  it("contains the five required templates with unique ids", () => {
    const ids = TEMPLATES.map((t) => t.id)
    for (const id of REQUIRED) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of REQUIRED) expect(getTemplate(id)?.id).toBe(id)
    expect(getTemplate("nope")).toBeUndefined()
  })

  it("uses only species from the vendored botany plants.json", () => {
    for (const t of TEMPLATES) for (const g of t.groups) expect(BY_ID.has(g.speciesId), `${t.id}: ${g.speciesId}`).toBe(true)
  })

  it("has English names and short one-sentence blurbs", () => {
    for (const t of TEMPLATES) {
      // 1.2.0: the composition part may be two words ("Nature · Low tech")
      expect(t.name).toMatch(/^[A-Z][a-z]+ · [A-Z][a-z]+( [a-z]+)?$/)
      expect(t.blurb.length).toBeGreaterThan(0)
      expect(t.blurb.length).toBeLessThanOrEqual(110)
      expect(t.blurb.endsWith(".")).toBe(true)
      expect(t).not.toHaveProperty("nameZh")
      expect(t).not.toHaveProperty("blurbZh")
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

describe("contract 1.0.1 / 1.0.2", () => {
  const group = (count: number, extra: Partial<TemplatePlantGroup> = {}): TemplatePlantGroup => ({
    speciesId: "hemianthus-callitrichoides-cuba", u: 0.5, v: 0.5, ru: 0.2, rv: 0.1, count, portions: 1, ...extra,
  })
  const bare = (groups: TemplatePlantGroup[]): ScapeTemplate => ({
    ...getTemplate("dutch-streets")!, id: "test", hardscape: [], groups,
  })

  it("is version 1.1.0 and the Iwagumi template uses the iwagumi composition", () => {
    expect(TEMPLATE_CONTRACT_VERSION).toBe("1.2.0")
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
    expect(b.name).toBe("Dutch · Streets")
    expect(b.scene.hardscape).toEqual([])
  })
})

describe("contract 1.1.0 — epiphytes on hardscape", () => {
  const rec = (id: string) => BY_ID.get(id) as (BotanyRecord & { regulated?: unknown[] }) | undefined

  it("uses no species with a non-empty botany `regulated` list (every template)", () => {
    for (const t of TEMPLATES) for (const g of t.groups) {
      const r = rec(g.speciesId)
      expect(r?.regulated ?? [], `${t.id}: ${g.speciesId}`).toHaveLength(0)
    }
    const concave = getTemplate("nature-concave")!.groups.map((g) => g.speciesId)
    expect(concave).not.toContain("limnophila-sessiliflora")
    expect(concave).not.toContain("hygrophila-polysperma")
    // the replacements are stems too (same look: fine-leaved Limnophila, broad-leaved Hygrophila)
    for (const id of ["limnophila-heterophylla", "hygrophila-corymbosa-siamensis-53b"]) {
      expect(concave).toContain(id)
      expect(rec(id)?.growthForm).toBe("stem")
    }
  })

  const nature = TEMPLATES.filter((t) => t.style === "nature")
  it("has at least two Nature templates", () => expect(nature.length).toBeGreaterThanOrEqual(2))

  for (const t of nature) {
    describe(t.id, () => {
      it("has a root driftwood focal piece: wFrac ≥ 0.45, v ≥ 0.45, a lean side", () => {
        const roots = t.hardscape.filter((h) => h.kind === "wood" && h.woodStyle === "root")
        const focal = roots.find((h) => h.wFrac >= 0.45 && h.v >= 0.45)
        expect(focal, `${t.id}: focal root wood`).toBeDefined()
        expect(focal!.leanSide).toMatch(/^(left|right|auto)$/)
        // the widest piece is the focal one
        expect(Math.max(...t.hardscape.map((h) => h.wFrac))).toBe(focal!.wFrac)
      })
      it("has ≥ 2 epiphyte groups on hardscape: one moss, one Anubias / Bucephalandra / Java fern", () => {
        const epi = t.groups.filter((g) => g.onHardscape)
        expect(epi.length).toBeGreaterThanOrEqual(2)
        expect(epi.some((g) => rec(g.speciesId)?.growthForm === "moss")).toBe(true)
        expect(epi.some((g) => /^(anubias|bucephalandra|microsorum)-/.test(g.speciesId))).toBe(true)
        for (const g of epi) expect(canAttach(g.speciesId), g.speciesId).toBe(true)
      })
      for (const tank of TANKS) {
        it(`seats every epiphyte on a host anchor and lists it in attach (${tank.widthCm} cm)`, () => {
          const out = instantiate(t, tank)
          expect(out.attach).toBeDefined()
          const hostIds = new Set(t.groups.filter((g) => g.onHardscape).map((g) => g.onHardscape))
          for (const [pid, hid] of Object.entries(out.attach!)) {
            const p = out.plants.find((pp) => pp.id === pid)!
            const host = out.hardscape.find((h) => h.id === hid)!
            expect(p, pid).toBeDefined()
            expect(hostIds.has(hid)).toBe(true)
            // on one of the host's anchors (to the 0.01 cm rounding), y = surface height there
            expect(anchors(host, 12).some((a) => Math.abs(a.x - p.x) <= 0.011 && Math.abs(a.z - p.z) <= 0.011), pid).toBe(true)
            expect(p.y).toBeGreaterThan(0)
            expect(p.y).toBeCloseTo(Math.max(0.1, surfaceY(host, p.x, p.z)!), 2)
          }
          // exactly the onHardscape placements are attached; everything else is planted
          const epiSpecies = new Map(t.groups.filter((g) => g.onHardscape).map((g) => [g.speciesId, g.onHardscape]))
          for (const p of out.plants) {
            if (epiSpecies.has(p.speciesId)) expect(out.attach![p.id], p.id).toBe(epiSpecies.get(p.speciesId))
            else {
              expect(out.attach![p.id]).toBeUndefined()
              expect(p.y).toBe(0)
            }
          }
          // epiphyte groups on the same host take distinct anchors
          const seats = Object.keys(out.attach!).map((pid) => out.plants.find((pp) => pp.id === pid)!)
          const keys = seats.map((p) => `${out.attach![p.id]}@${p.x},${p.z}`)
          expect(new Set(keys).size).toBe(keys.length)
        })
      }
    })
  }

  it("every template returns attach (empty without epiphytes)", () => {
    for (const t of TEMPLATES) {
      const out = instantiate(t, TANKS[1]!)
      expect(out.attach).toBeDefined()
      if (!t.groups.some((g) => g.onHardscape)) expect(out.attach).toEqual({})
    }
  })

  it("hardscapeFor carries woodStyle / leanSide (wood only)", () => {
    const tri = getTemplate("nature-triangle")!
    const wood = hardscapeFor(tri.hardscape.find((h) => h.kind === "wood")!, TANKS[1]!)
    expect(wood.woodStyle).toBe("root")
    expect(wood.leanSide).toBe("left")
    const stone = hardscapeFor({ ...tri.hardscape.find((h) => h.kind === "stone")!, woodStyle: "root", leanSide: "left" }, TANKS[1]!)
    expect(stone.woodStyle).toBeUndefined()
    expect(stone.leanSide).toBeUndefined()
  })
})

describe("contract 1.2.0 — nature-lowtech", () => {
  type Rec = BotanyRecord & { regulated?: unknown[]; difficulty: number; envelope: { co2: { min: number }; light: { min: number } } }
  const rec = (id: string) => BY_ID.get(id) as Rec
  const t = getTemplate("nature-lowtech")!
  const ELIGIBLE = PLANTS.filter((p) => {
    const r = p as Rec
    return r.envelope.co2.min <= 5 && r.envelope.light.min <= 40 && r.difficulty <= 2 && (r.regulated ?? []).length === 0
  })

  it("exists with the required metadata", () => {
    expect(t).toBeDefined()
    expect(t.style).toBe("nature")
    expect(t.composition).toBe("triangle")
    expect(t.name).toBe("Nature · Low tech")
    expect(t.light).toBe("Low")
    expect(t.co2).toBe(false)
    expect(t.guide).toBe("thirds")
  })

  it("uses only species that grow without CO2 in low light (co2.min ≤ 5, light.min ≤ 40, difficulty ≤ 2, unregulated)", () => {
    expect(ELIGIBLE.length).toBeGreaterThanOrEqual(60) // ~73 in botany 0.8
    for (const g of t.groups) {
      const r = rec(g.speciesId)
      expect(r, g.speciesId).toBeDefined()
      expect(r.envelope.co2.min, g.speciesId).toBeLessThanOrEqual(5)
      expect(r.envelope.light.min, g.speciesId).toBeLessThanOrEqual(40)
      expect(r.difficulty, g.speciesId).toBeLessThanOrEqual(2)
      expect(r.regulated ?? [], g.speciesId).toHaveLength(0)
    }
  })

  it("has one root driftwood focal piece (1.1.0 wood rules) plus ≤ 2 stones", () => {
    const woods = t.hardscape.filter((h) => h.kind === "wood")
    expect(woods).toHaveLength(1)
    const w = woods[0]!
    expect(w.woodStyle).toBe("root")
    expect(w.wFrac).toBeGreaterThanOrEqual(0.45)
    expect(w.v).toBeGreaterThanOrEqual(0.45)
    expect(Math.abs(w.u - 0.5)).toBeLessThanOrEqual(0.1) // centred in front of the background
    expect(t.hardscape.filter((h) => h.kind === "stone").length).toBeLessThanOrEqual(2)
    // the background groups sit behind the wood
    const bg = t.groups.filter((g) => !g.onHardscape && g.v < 0.3)
    expect(bg.length).toBeGreaterThan(0)
    for (const g of bg) expect(g.v, g.speciesId).toBeLessThan(w.v)
  })

  it("has ≥ 3 epiphyte groups on hardscape: ≥ 1 moss, ≥ 2 Anubias / Bucephalandra / Java fern", () => {
    const epi = t.groups.filter((g) => g.onHardscape)
    expect(epi.length).toBeGreaterThanOrEqual(3)
    expect(epi.filter((g) => rec(g.speciesId).growthForm === "moss").length).toBeGreaterThanOrEqual(1)
    expect(epi.filter((g) => /^(anubias|bucephalandra|microsorum)-/.test(g.speciesId)).length).toBeGreaterThanOrEqual(2)
    for (const g of epi) expect(canAttach(g.speciesId), g.speciesId).toBe(true)
  })

  it("has ≥ 2 Cryptocoryne groups in the mid / foreground", () => {
    const crypts = t.groups.filter((g) => g.speciesId.startsWith("cryptocoryne-") && !g.onHardscape && g.v >= 0.35)
    expect(crypts.length).toBeGreaterThanOrEqual(2)
    for (const g of crypts) expect((rec(g.speciesId).placement ?? []).some((z) => z === "midground" || z === "foreground"), g.speciesId).toBe(true)
  })

  it("has ≥ 1 easy background stem / rosette group", () => {
    const bg = t.groups.filter(
      (g) => !g.onHardscape && (rec(g.speciesId).placement ?? []).includes("background") && /^(stem|rosette)$/.test(rec(g.speciesId).growthForm),
    )
    expect(bg.length).toBeGreaterThanOrEqual(1)
    expect(bg.some((g) => /^(hygrophila|vallisneria|echinodorus)-/.test(g.speciesId) && rec(g.speciesId).difficulty <= 1)).toBe(true)
  })

  it("has no carpet plant that needs CO2", () => {
    for (const g of t.groups) {
      const r = rec(g.speciesId)
      if (r.growthForm === "carpeting") expect(r.envelope.co2.min, g.speciesId).toBeLessThanOrEqual(5)
    }
  })

  it("is dense: many placements on every tank, all within the budget", () => {
    for (const tank of TANKS) {
      const out = instantiate(t, tank)
      expect(out.plants.length).toBeLessThanOrEqual(MAX_PLACEMENTS)
      // ≥ 0.75 placements per 100 cm² of footprint (capped by the 60 budget on big tanks)
      expect(out.plants.length, `${tank.widthCm}`).toBeGreaterThanOrEqual(Math.min(55, Math.floor((0.75 * tank.widthCm * tank.depthCm) / 100)))
    }
    // layered: back, mid and front thirds of the depth are all planted
    const out = instantiate(t, TANKS[1]!)
    const D = TANKS[1]!.depthCm
    for (const [lo, hi] of [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]) {
      const n = out.plants.filter((p) => p.z / D + 0.5 >= lo! && p.z / D + 0.5 < hi!).length
      expect(n, `${lo}–${hi}`).toBeGreaterThanOrEqual(8)
    }
  })

  it("picking it sets the conditions to Low light · No CO2 (editor 1.3.0)", async () => {
    const { docFromTemplatePick } = await import("../editor/buildDocInput")
    const tank = TANKS[1]!
    const doc = docFromTemplatePick(instantiate(t, tank), tank, t)
    expect(doc.templateId).toBe("nature-lowtech")
    expect(doc.conditions).toEqual({ light: "Low", co2: false })
    const b = buildTemplateInput(t, new URLSearchParams(""), PLANTS)
    expect(b.light).toBe("Low")
    expect(b.co2).toBe(false)
  })
})
