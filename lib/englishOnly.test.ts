/**
 * English-only guard (owner decision 2026-11-17): the web app ships English
 * UI copy only, and botany 0.8.0 dropped Chinese plant names. Fails on any CJK
 * ideograph, CJK symbol / punctuation, or full-width form in app source and in
 * the vendored species database. The ASCII-range middle dot "·" (U+00B7) is fine.
 *
 * Vendored sim-core (lib/sim/vendor/sim-core) is upstream code and is skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "..")
const SCAN_DIRS = ["app", "components", "lib"]
const EXTRA_FILES = ["lib/sim/vendor/plants.json"]
const SKIP = [join("lib", "sim", "vendor", "sim-core")]
const EXT = /\.(tsx?|jsx?|cjs|mjs|css|mdx?|json)$/

/** CJK Ext-A + Unified Ideographs, Compatibility Ideographs, CJK Symbols & Punctuation, Half/Full-width Forms */
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const abs = join(dir, name)
    const rel = relative(ROOT, abs)
    if (SKIP.some((s) => rel === s || rel.startsWith(s + sep))) continue
    if (statSync(abs).isDirectory()) walk(abs, out)
    else if (EXT.test(name)) out.push(abs)
  }
}

function sourceFiles(): string[] {
  const out: string[] = []
  for (const d of SCAN_DIRS) {
    const abs = join(ROOT, d)
    if (existsSync(abs)) walk(abs, out)
  }
  for (const f of EXTRA_FILES) {
    const abs = join(ROOT, f)
    if (!out.includes(abs)) out.push(abs)
  }
  return out
}

describe("English-only source", () => {
  const files = sourceFiles()

  it("scans the app, lib and vendored plants.json", () => {
    const rel = files.map((f) => relative(ROOT, f).split(sep).join("/"))
    expect(rel).toContain("lib/sim/vendor/plants.json")
    expect(rel).toContain("app/layout.tsx")
    expect(rel.some((f) => f.startsWith("lib/sim/vendor/sim-core/"))).toBe(false)
  })

  it("contains no CJK characters", () => {
    const hits: string[] = []
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n")
      lines.forEach((line, i) => {
        const m = CJK.exec(line)
        if (m) hits.push(`${relative(ROOT, f)}:${i + 1}: ${JSON.stringify(m[0])} in ${line.trim().slice(0, 80)}`)
      })
    }
    expect(hits).toEqual([])
  })

  it("flags full-width punctuation but not the middle dot", () => {
    expect(CJK.test("Day 45 · Stylized preview")).toBe(false)
    expect(CJK.test("Light\uff0cCO₂")).toBe(true)
    expect(CJK.test("\u7b2c 45 \u5929")).toBe(true)
    expect(CJK.test("\u3002")).toBe(true)
  })

  it("plants.json carries English names only (botany 0.8.0)", () => {
    const plants = JSON.parse(readFileSync(join(ROOT, "lib/sim/vendor/plants.json"), "utf8")) as {
      id: string
      commonNames?: Record<string, unknown>
      pinyin?: unknown
    }[]
    for (const p of plants) {
      expect(Object.keys(p.commonNames ?? {}), p.id).toEqual(["en"])
      expect(p, p.id).not.toHaveProperty("pinyin")
    }
  })
})
