import { afterEach, describe, expect, it, vi } from "vitest"
import { parseFlag } from "./flags"

describe("parseFlag", () => {
  it("is on only for '1' and 'true'", () => {
    expect(parseFlag("1")).toBe(true)
    expect(parseFlag("true")).toBe(true)
    for (const v of [undefined, "", "0", "false", "TRUE", "yes", " 1"]) expect(parseFlag(v)).toBe(false)
  })
})

describe("flags.growthTimelapse", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("defaults to off", async () => {
    vi.stubEnv("NEXT_PUBLIC_FF_GROWTH_TIMELAPSE", undefined as unknown as string)
    const { flags } = await import("./flags")
    expect(flags.growthTimelapse).toBe(false)
  })

  it.each(["1", "true"])("is on for %s", async (v) => {
    vi.stubEnv("NEXT_PUBLIC_FF_GROWTH_TIMELAPSE", v)
    const { flags } = await import("./flags")
    expect(flags.growthTimelapse).toBe(true)
  })
})

describe("flags.stylizedTank", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("defaults to off", async () => {
    vi.stubEnv("NEXT_PUBLIC_FF_STYLIZED_TANK", undefined as unknown as string)
    const { flags } = await import("./flags")
    expect(flags.stylizedTank).toBe(false)
  })

  it.each(["0", "false", ""])("is off for %j", async (v) => {
    vi.stubEnv("NEXT_PUBLIC_FF_STYLIZED_TANK", v)
    const { flags } = await import("./flags")
    expect(flags.stylizedTank).toBe(false)
  })

  it.each(["1", "true"])("is on for %s", async (v) => {
    vi.stubEnv("NEXT_PUBLIC_FF_STYLIZED_TANK", v)
    const { flags } = await import("./flags")
    expect(flags.stylizedTank).toBe(true)
  })

  it("is independent of growthTimelapse", async () => {
    vi.stubEnv("NEXT_PUBLIC_FF_GROWTH_TIMELAPSE", "1")
    vi.stubEnv("NEXT_PUBLIC_FF_STYLIZED_TANK", undefined as unknown as string)
    const { flags } = await import("./flags")
    expect(flags.growthTimelapse).toBe(true)
    expect(flags.stylizedTank).toBe(false)
  })
})

describe("flags.styleTemplates", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("defaults to off", async () => {
    vi.stubEnv("NEXT_PUBLIC_FF_STYLE_TEMPLATES", undefined as unknown as string)
    const { flags } = await import("./flags")
    expect(flags.styleTemplates).toBe(false)
  })

  it.each(["0", "false", ""])("is off for %j", async (v) => {
    vi.stubEnv("NEXT_PUBLIC_FF_STYLE_TEMPLATES", v)
    const { flags } = await import("./flags")
    expect(flags.styleTemplates).toBe(false)
  })

  it.each(["1", "true"])("is on for %s", async (v) => {
    vi.stubEnv("NEXT_PUBLIC_FF_STYLE_TEMPLATES", v)
    const { flags } = await import("./flags")
    expect(flags.styleTemplates).toBe(true)
  })

  it("is independent of the other flags", async () => {
    vi.stubEnv("NEXT_PUBLIC_FF_GROWTH_TIMELAPSE", "1")
    vi.stubEnv("NEXT_PUBLIC_FF_STYLIZED_TANK", "1")
    vi.stubEnv("NEXT_PUBLIC_FF_STYLE_TEMPLATES", undefined as unknown as string)
    const { flags } = await import("./flags")
    expect(flags.styleTemplates).toBe(false)
  })
})
