/**
 * Editor contract 1.2.2 (lib/editor/contract.ts): frozen root-wood lean side,
 * setWoodStyle dropping / re-freezing leanSide, migrateAttach honouring
 * canAttach, one ANCHORS_PER_HOST for editor + templates, and "replace"
 * running the decoded-link invariants.
 */
import { describe, expect, it } from "vitest"
import type { EditTarget, HardscapeVisual } from "@aquascape-studio/render"
import * as templates from "../templates"
import type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
import {
  ANCHORS_PER_HOST,
  MAX_PLANTS,
  canAttach,
  decodeScape,
  editorReducer,
  encodeScape,
  footprintContains,
  footprintHalfExtents,
  hostOf,
  initEditor,
  migrateAttach,
  needsResim,
  resolveLeanSide,
  sanitizeDoc,
} from "./index"
import { anchors } from "./surface"

const TANK = { widthCm: 60, depthCm: 30, heightCm: 36 }
const H = (id: string): EditTarget => ({ kind: "hardscape", id })
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s)
const apply = (s: EditorState, op: EditOp) => editorReducer(s, { type: "apply", op })
const piece = (s: EditorState | ScapeDoc, id: string) => ("doc" in s ? s.doc : s).hardscape.find((h) => h.id === id)!
const plant = (s: EditorState | ScapeDoc, id: string) => ("doc" in s ? s.doc : s).plants.find((p) => p.id === id)!

const ROOT: HardscapeVisual = { id: "root", kind: "wood", woodStyle: "root", x: -6, z: -2, rotationY: 0, sizeCm: [28, 22, 8], seed: 5 }
const ROCK: HardscapeVisual = { id: "rock", kind: "stone", role: "fukuishi", x: 18, z: 6, rotationY: 0.3, sizeCm: [8, 8, 7], seed: 9 }

function doc(hardscape: HardscapeVisual[] = [ROOT, ROCK], plants: ScapeDoc["plants"] = []): ScapeDoc {
  return {
    v: 1,
    tank: { ...TANK },
    bed: { frontCm: 2, backCm: 9 },
    hardscape: hardscape.map((h) => ({ ...h, sizeCm: [...h.sizeCm] })),
    plants: plants.map((p) => ({ ...p })),
  }
}

describe("resolveLeanSide (render 1.4.1, re-exported by the editor)", () => {
  it("returns an explicit side as is; auto / missing leans towards the centre", () => {
    expect(resolveLeanSide({ x: -10, leanSide: "left" })).toBe("left")
    expect(resolveLeanSide({ x: 10, leanSide: "right" })).toBe("right")
    expect(resolveLeanSide({ x: -0.1, leanSide: "auto" })).toBe("right")
    expect(resolveLeanSide({ x: 0, leanSide: "auto" })).toBe("left")
    expect(resolveLeanSide({ x: 3 })).toBe("left")
    expect(resolveLeanSide({ x: -3 })).toBe("right")
  })
})

describe("frozen lean side (1.2.2)", () => {
  it("addHardscape root stores the resolved side; other styles have no leanSide", () => {
    const s0 = initEditor(doc([]))
    const left = apply(s0, { type: "addHardscape", kind: "wood", woodStyle: "root", x: -12, z: 0 })
    expect(piece(left, "wood-1").leanSide).toBe("right")
    const right = apply(s0, { type: "addHardscape", kind: "wood", woodStyle: "root", x: 12, z: 0 })
    expect(piece(right, "wood-1").leanSide).toBe("left")
    const centre = apply(s0, { type: "addHardscape", kind: "wood", woodStyle: "root", x: 0, z: 0 })
    expect(piece(centre, "wood-1").leanSide).toBe("left")
    expect(piece(apply(s0, { type: "addHardscape", kind: "wood", x: -12, z: 0 }), "wood-1").leanSide).toBeUndefined()
    expect(piece(apply(s0, { type: "addHardscape", kind: "wood", woodStyle: "log", x: -12, z: 0 }), "wood-1").leanSide).toBeUndefined()
    expect(piece(apply(s0, { type: "addHardscape", kind: "stone", x: -12, z: 0 }), "stone-1").leanSide).toBeUndefined()
  })

  it("dragging added root wood across the centre never flips it", () => {
    let s = apply(initEditor(doc([])), { type: "addHardscape", kind: "wood", woodStyle: "root", x: -10, z: 0 })
    expect(piece(s, "wood-1").leanSide).toBe("right")
    s = apply(s, { type: "move", target: H("wood-1"), x: 10, z: 0 })
    expect(piece(s, "wood-1").x).toBeGreaterThan(0)
    expect(piece(s, "wood-1").leanSide).toBe("right")
    s = run(s, { type: "preview", target: H("wood-1"), x: -8, z: 0 }, { type: "preview", target: H("wood-1"), x: 6, z: 0 }, { type: "commitPreview" })
    expect(piece(s, "wood-1").leanSide).toBe("right")
  })

  it("a committed move of an 'auto' piece stores the side it resolved to BEFORE the move", () => {
    // ROOT has no leanSide (= auto) at x = −6 → right
    const s0 = initEditor(doc())
    const moved = apply(s0, { type: "move", target: H("root"), x: 12, z: -2 })
    expect(piece(moved, "root").x).toBeGreaterThan(0)
    expect(piece(moved, "root").leanSide).toBe("right")
    // explicit "auto" behaves the same, via a drag preview + commit
    const auto = initEditor(doc([{ ...ROOT, x: 8, leanSide: "auto" }]))
    const s1 = run(auto, { type: "preview", target: H("root"), x: 2, z: -2 }, { type: "preview", target: H("root"), x: -9, z: -2 })
    expect(piece(s1, "root").leanSide).toBe("left") // the preview already shows the frozen side
    const s2 = run(s1, { type: "commitPreview" })
    expect(piece(s2, "root").leanSide).toBe("left")
    expect(s2.past).toEqual([auto.doc])
    // cancelling restores "auto"
    expect(piece(run(s1, { type: "cancelPreview" }), "root").leanSide).toBe("auto")
  })

  it("explicit sides survive moves; setLeanSide 'auto' is re-frozen by the next committed move", () => {
    let s = initEditor(doc([{ ...ROOT, leanSide: "left" }]))
    s = apply(s, { type: "move", target: H("root"), x: 14, z: 0 })
    expect(piece(s, "root").leanSide).toBe("left")
    s = apply(s, { type: "setLeanSide", id: "root", leanSide: "auto" })
    expect(piece(s, "root").leanSide).toBe("auto")
    // at x > 0, auto resolves to left; moving to the left half keeps "left"
    s = apply(s, { type: "move", target: H("root"), x: -12, z: 0 })
    expect(piece(s, "root").leanSide).toBe("left")
  })

  it("a move that changes nothing stays a no-op (no freezing without a move)", () => {
    const s0 = initEditor(doc())
    expect(apply(s0, { type: "move", target: H("root"), x: ROOT.x, z: ROOT.z })).toBe(s0)
  })

  it("setWoodStyle away from root removes leanSide; back to root freezes a new one", () => {
    let s = initEditor(doc([{ ...ROOT, x: -8, leanSide: "left" }]))
    s = apply(s, { type: "setWoodStyle", id: "root", woodStyle: "branchy" })
    expect("leanSide" in piece(s, "root")).toBe(false)
    s = apply(s, { type: "move", target: H("root"), x: 10, z: 0 })
    s = apply(s, { type: "setWoodStyle", id: "root", woodStyle: "root" })
    // frozen from the piece's position now (x > 0 → left), not the old explicit side
    expect(piece(s, "root").leanSide).toBe(resolveLeanSide({ x: piece(s, "root").x }))
    s = apply(s, { type: "setWoodStyle", id: "root", woodStyle: "log" })
    expect("leanSide" in piece(s, "root")).toBe(false)
    s = apply(s, { type: "move", target: H("root"), x: -10, z: 0 })
    s = apply(s, { type: "setWoodStyle", id: "root", woodStyle: "root" })
    expect(piece(s, "root").leanSide).toBe("right")
  })

  it("frozen sides survive a share link", () => {
    let s = apply(initEditor(doc([])), { type: "addHardscape", kind: "wood", woodStyle: "root", x: -10, z: 0 })
    s = apply(s, { type: "move", target: H("wood-1"), x: 10, z: 0 })
    expect(piece(decodeScape(encodeScape(s.doc))!, "wood-1").leanSide).toBe("right")
  })
})

describe("migrateAttach honours canAttach (1.2.2)", () => {
  const HC = "hemianthus-callitrichoides-cuba"
  const MOSS = "taxiphyllum-barbieri"

  it("drops attach entries of non-attachable species; the plant lands on the bed at the same spot", () => {
    expect(canAttach(HC)).toBe(false)
    const d = { ...doc(), plants: [{ id: `${HC}-1`, speciesId: HC, x: -8, z: -1, y: 9, portions: 1 }], attach: { [`${HC}-1`]: "root" } }
    const m = migrateAttach(d)
    expect(m.attach).toBeUndefined()
    expect(plant(m, `${HC}-1`)).toMatchObject({ x: -8, z: -1, y: 0 })
    expect(migrateAttach(m)).toBe(m)
  })

  it("1.0 / 1.1 docs: a lifted non-attachable plant over wood drops to y = 0 in place", () => {
    const d = doc([ROOT], [{ id: `${HC}-1`, speciesId: HC, x: -8, z: -1, y: 9, portions: 1 }])
    const m = migrateAttach(d)
    expect(hostOf(m, `${HC}-1`)).toBeUndefined()
    expect(plant(m, `${HC}-1`)).toMatchObject({ x: -8, z: -1, y: 0 })
  })

  it("a lifted non-attachable plant on a stone moves to the stone's front edge + 2 cm", () => {
    const d = doc([ROCK], [{ id: `${HC}-1`, speciesId: HC, x: 18, z: 6, y: 5, portions: 2 }])
    const m = migrateAttach(d)
    const p = plant(m, `${HC}-1`)
    expect(p.y).toBe(0)
    expect(p.x).toBe(18)
    expect(p.z).toBeCloseTo(Math.min(TANK.depthCm / 2 - 1, ROCK.z + footprintHalfExtents(ROCK).z + 2), 6)
    expect(footprintContains(ROCK, p.x, p.z, 0.5)).toBe(false)
    expect(migrateAttach(m)).toBe(m)
  })

  it("attachable lifted plants are still attached to the piece under them", () => {
    const d = doc([ROCK], [{ id: `${MOSS}-1`, speciesId: MOSS, x: 18, z: 6, y: 5, portions: 1 }])
    const m = migrateAttach(d)
    expect(m.attach).toEqual({ [`${MOSS}-1`]: "rock" })
    expect(plant(m, `${MOSS}-1`).y).toBeGreaterThan(0)
  })

  it("decodeScape applies the rule to links that lift a non-attachable plant", () => {
    const d = doc([ROOT], [{ id: `${HC}-1`, speciesId: HC, x: -8, z: -1, y: 0, portions: 1 }])
    // hand-built 1.1-style link with HC lifted to y = 9 (encode stores y·10·100 + portions)
    const raw = JSON.parse(atob(encodeScape(d).replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    ;(raw[7] as number[])[4] = 90 * 100 + 1
    const link = btoa(JSON.stringify(raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const back = decodeScape(link)!
    expect(back.attach).toBeUndefined()
    expect(plant(back, `${HC}-1`).y).toBe(0)
  })
})

describe("ANCHORS_PER_HOST (1.2.2)", () => {
  it("is 12 and the same constant for editor and templates", () => {
    expect(ANCHORS_PER_HOST).toBe(12)
    expect(templates.ANCHORS_PER_HOST).toBe(ANCHORS_PER_HOST)
  })
  it("attachPlant walks all 12 anchors before falling back to anchor 0", () => {
    let s = initEditor(doc())
    const list = anchors(piece(s, "root"), ANCHORS_PER_HOST)
    const seen = new Set<string>()
    for (let i = 0; i < ANCHORS_PER_HOST; i++) {
      s = apply(s, { type: "attachPlant", speciesId: "bucephalandra-sp-mini", hardscapeId: "root" })
      const p = s.doc.plants[s.doc.plants.length - 1]!
      seen.add(`${p.x},${p.z}`)
    }
    // every seat is one of the 12 anchors (rounded / snapped seats stay within 1.5 cm)
    for (const k of seen) {
      const [x, z] = k.split(",").map(Number) as [number, number]
      expect(list.some((a) => Math.hypot(a.x - x, a.z - z) <= 1.5)).toBe(true)
    }
    expect(seen.size).toBeGreaterThan(8)
  })
})

describe('"replace" runs migrateAttach and the invariants (1.2.2)', () => {
  it("drops unknown species / duplicate ids, clamps into the glass, caps at 60, fixes attach; one history step", () => {
    const s0 = initEditor(doc())
    const many = Array.from({ length: 70 }, (_, i) => ({ id: `rotala-rotundifolia-${i + 1}`, speciesId: "rotala-rotundifolia", x: -25 + (i % 10), z: -12, y: 0, portions: 2 }))
    const incoming: ScapeDoc = {
      ...doc([ROOT]),
      plants: [
        { id: "x-1", speciesId: "not-a-plant", x: 0, z: 0, y: 0, portions: 1 },
        { id: "hemianthus-callitrichoides-cuba-1", speciesId: "hemianthus-callitrichoides-cuba", x: 99, z: -99, y: 7, portions: 400 },
        { id: "hemianthus-callitrichoides-cuba-1", speciesId: "hemianthus-callitrichoides-cuba", x: 0, z: 0, y: 0, portions: 1 },
        ...many,
      ],
      attach: { "hemianthus-callitrichoides-cuba-1": "root", "ghost-1": "root" },
    }
    const s1 = apply(s0, { type: "replace", doc: incoming })
    expect(s1.past).toEqual([s0.doc])
    const d = s1.doc
    expect(d.plants).toHaveLength(MAX_PLANTS)
    expect(d.plants.some((p) => p.speciesId === "not-a-plant")).toBe(false)
    expect(new Set(d.plants.map((p) => p.id)).size).toBe(d.plants.length)
    const hc = plant(d, "hemianthus-callitrichoides-cuba-1")
    expect(hc).toMatchObject({ x: TANK.widthCm / 2 - 1, z: -(TANK.depthCm / 2 - 1), y: 0, portions: 99 })
    expect(d.attach).toBeUndefined()
    expect(needsResim(s0.doc, d)).toBe(true)
    expect(migrateAttach(d)).toBe(d)
    expect(decodeScape(encodeScape(d))).not.toBeNull()
    // undo restores in one step
    expect(run(s1, { type: "undo" }).doc).toBe(s0.doc)
  })

  it("clamps hardscape by its real extent; a tank outside the link ranges is a no-op", () => {
    const s0 = initEditor(doc())
    const s1 = apply(s0, { type: "replace", doc: doc([{ ...ROCK, x: 40, z: 30 }]) })
    const r = piece(s1, "rock")
    expect(Math.abs(r.x)).toBeLessThan(TANK.widthCm / 2)
    expect(Math.abs(r.z)).toBeLessThan(TANK.depthCm / 2)
    expect(apply(s0, { type: "replace", doc: { ...doc(), tank: { widthCm: 5, depthCm: 30, heightCm: 36 } } })).toBe(s0)
    expect(apply(s0, { type: "replace", doc: { ...doc(), tank: { widthCm: Number.NaN, depthCm: 30, heightCm: 36 } } })).toBe(s0)
    expect(sanitizeDoc({ ...doc(), tank: { widthCm: 400, depthCm: 30, heightCm: 36 } })).toBeNull()
  })

  it("a canonical doc passes through unchanged (no-op when identical to the current doc)", () => {
    const d = migrateAttach(doc())
    expect(sanitizeDoc(d)).toBe(d)
    const s0 = initEditor(d)
    expect(apply(s0, { type: "replace", doc: doc() })).toBe(s0)
  })
})
