import { describe, expect, it } from "vitest"
import { composeTpl, initTplSelection, pickTpl, undoComposeTpl, withTplParam } from "./tplSelection"

describe("template pill selection", () => {
  it("starts with shown = seed", () => {
    expect(initTplSelection("a")).toEqual({ shown: "a", seed: "a" })
    expect(initTplSelection(null)).toEqual({ shown: null, seed: null })
  })

  it("compose moves the pill but never the seed (doc is not re-instantiated)", () => {
    const s = composeTpl(initTplSelection("a"), "b")
    expect(s).toEqual({ shown: "b", seed: "a" })
    expect(composeTpl(initTplSelection(null), "b")).toEqual({ shown: "b", seed: null })
  })

  it("compose twice (try another) keeps the original seed", () => {
    const s = composeTpl(composeTpl(initTplSelection("a"), "b"), "c")
    expect(s).toEqual({ shown: "c", seed: "a" })
  })

  it("undo restores the previous pill, including none", () => {
    expect(undoComposeTpl(composeTpl(initTplSelection("a"), "b"))).toEqual({ shown: "a", seed: "a" })
    expect(undoComposeTpl(composeTpl(initTplSelection(null), "b"))).toEqual({ shown: null, seed: null })
  })

  it("a manual pick after compose moves both", () => {
    expect(pickTpl(composeTpl(initTplSelection("a"), "b"), "a")).toEqual({ shown: "a", seed: "a" })
    expect(pickTpl(initTplSelection("a"), null)).toEqual({ shown: null, seed: null })
  })

  it("is a no-op where nothing changes (same reference)", () => {
    const s = initTplSelection("a")
    expect(composeTpl(s, "a")).toBe(s)
    expect(undoComposeTpl(s)).toBe(s)
  })

  it("withTplParam sets / removes tpl without touching other params", () => {
    const p = new URLSearchParams("scape=x&tpl=a")
    expect(withTplParam(p, "b").toString()).toBe("scape=x&tpl=b")
    expect(withTplParam(p, null).toString()).toBe("scape=x")
    expect(p.toString()).toBe("scape=x&tpl=a")
  })
})
