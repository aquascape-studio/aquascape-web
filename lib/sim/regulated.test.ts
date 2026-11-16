import { describe, expect, it } from "vitest"
import plantsJson from "./vendor/plants.json"
import vendor from "./vendor/VENDOR.json"
import { isRegulated, regulatedEntries, regulatedJurisdictions } from "./regulated"

const PLANTS = plantsJson as unknown as { id: string; regulated?: unknown }[]

describe("regulated species (botany schema 0.7.0, optional)", () => {
  it("treats a missing or malformed field as not regulated", () => {
    expect(isRegulated({})).toBe(false)
    expect(isRegulated(undefined)).toBe(false)
    expect(isRegulated({ regulated: [] })).toBe(false)
    expect(isRegulated({ regulated: "EU" })).toBe(false)
    expect(isRegulated({ regulated: [{ jurisdiction: "EU" }] })).toBe(false)
  })
  it("reads valid entries", () => {
    const rec = {
      regulated: [
        { jurisdiction: "EU", status: "prohibited", listName: "EU IAS list", since: 2016, citationKey: "k" },
        { jurisdiction: "US", status: "watch", listName: "x", citationKey: "k2" },
        { jurisdiction: "EU", status: "restricted", listName: "dup", citationKey: "k3" },
        null,
      ],
    }
    expect(regulatedEntries(rec)).toHaveLength(3)
    expect(isRegulated(rec)).toBe(true)
    expect(regulatedJurisdictions(rec)).toBe("EU, US")
  })
  it("vendored data: 157 species; every regulated[] present is well-formed", () => {
    expect(PLANTS).toHaveLength(157)
    expect(new Set(PLANTS.map((p) => p.id)).size).toBe(157)
    expect(vendor.plants.ref).toBe("origin/main")
    for (const p of PLANTS) {
      if (p.regulated === undefined) continue
      expect(Array.isArray(p.regulated)).toBe(true)
      expect(regulatedEntries(p)).toHaveLength((p.regulated as unknown[]).length)
    }
  })
})
