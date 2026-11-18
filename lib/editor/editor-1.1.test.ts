/**
 * Editor contract 1.1.0 rules (lib/editor/contract.ts): resize, addHardscape,
 * setWoodStyle, previewBase, needsResim, clampHardscapeXZ, woodStyle links.
 */
import { describe, expect, it } from "vitest"
import { ANCHORS_PER_HOST, anchors, surfaceY } from "./surface"
import type { EditTarget, HardscapeVisual } from "@aquascape-studio/render"
import * as render from "@aquascape-studio/render"
import type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
import {
  MAX_HARDSCAPE_PIECES,
  RESIZE_DOWN,
  RESIZE_UP,
  clampHardscapeXZ,
  decodeScape,
  editorReducer,
  encodeScape,
  attachedTo,
  findHardscapeSpot,
  footprintsOverlap,
  hardscapeSpotCandidates,
  footprintContains,
  footprintHalfExtents,
  hashId,
  initEditor,
  isPreviewing,
  needsResim,
  nextHardscapeId,
  migrateAttach,
} from "./index"

const TANK = { widthCm: 60, depthCm: 30, heightCm: 36 }
const P = (id: string): EditTarget => ({ kind: "plant", id })
const H = (id: string): EditTarget => ({ kind: "hardscape", id })
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s)
const apply = (s: EditorState, op: EditOp) => editorReducer(s, { type: "apply", op })
const piece = (s: EditorState | ScapeDoc, id: string) => ("doc" in s ? s.doc : s).hardscape.find((h) => h.id === id)!
const plant = (s: EditorState | ScapeDoc, id: string) => ("doc" in s ? s.doc : s).plants.find((p) => p.id === id)!

function fixture(): ScapeDoc {
  // 1.2.0: the 1.0-shaped doc (epiphytes with y > 0 on the rock / wood) migrated — both are attached
  return migrateAttach({
    v: 1,
    tank: { ...TANK },
    bed: { frontCm: 2, backCm: 9 },
    hardscape: [
      { id: "rock", kind: "stone", x: 0, z: 0, rotationY: 0, sizeCm: [10, 8, 6], seed: 1, role: "oyaishi" },
      { id: "wood", kind: "wood", x: 18, z: -4, rotationY: 0, sizeCm: [12, 20, 6], seed: 2 },
    ],
    plants: [
      { id: "hemianthus-callitrichoides-cuba-1", speciesId: "hemianthus-callitrichoides-cuba", x: -20, z: 10, y: 0, portions: 2 },
      { id: "bucephalandra-sp-mini-1", speciesId: "bucephalandra-sp-mini", x: 1, z: 1, y: 5, portions: 1 },
      { id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", x: 19, z: -4, y: 8, portions: 1 },
    ],
  })
}

/** an empty-plants doc so additions are never blocked */
function bare(hardscape: HardscapeVisual[] = []): ScapeDoc {
  return { v: 1, tank: { ...TANK }, bed: { frontCm: 2, backCm: 9 }, hardscape, plants: [] }
}

describe("clampHardscapeXZ (render 1.3.0 export, re-exported by lib/editor)", () => {
  const h: HardscapeVisual = { id: "h", kind: "wood", x: 0, z: 0, seed: 1, rotationY: 0, sizeCm: [12, 20, 6] }
  it("keeps the axis-aligned footprint ≥ 1 cm inside the glass", () => {
    expect(clampHardscapeXZ(h, TANK, 100, -100)).toEqual({ x: 23, z: -11 })
    expect(clampHardscapeXZ(h, TANK, -100, 100)).toEqual({ x: -23, z: 11 })
    expect(clampHardscapeXZ(h, TANK, 5, 2)).toEqual({ x: 5, z: 2 })
  })
  it("uses the rotated footprint's extent", () => {
    const r = clampHardscapeXZ({ ...h, rotationY: Math.PI / 2 }, TANK, 100, 100)
    expect(r.x).toBeCloseTo(26, 6) // half-extent on x is now d/2 = 3
    expect(r.z).toBeCloseTo(8, 6) // and w/2 = 6 on z
    const e = footprintHalfExtents({ rotationY: Math.PI / 4, sizeCm: [10, 1, 6] })
    expect(e.x).toBeCloseTo(Math.sqrt((25 + 9) / 2), 6)
    expect(e.z).toBeCloseTo(Math.sqrt((25 + 9) / 2), 6)
  })
  it("centres an axis on which the footprint is wider than the tank interior", () => {
    expect(clampHardscapeXZ({ ...h, sizeCm: [59, 5, 4] }, TANK, 7, 3)).toEqual({ x: 0, z: 3 })
    expect(clampHardscapeXZ({ ...h, sizeCm: [10, 5, 29] }, TANK, 7, 3)).toEqual({ x: 7, z: 0 })
  })
  it("maps NaN to the centre; the reducer never stores -0", () => {
    expect(clampHardscapeXZ(h, TANK, 0, Number.NaN).z).toBe(0)
    const s = apply(initEditor(bare([{ ...h, x: 3, z: 3 }])), { type: "move", target: H("h"), x: -0, z: -0 })
    expect(Object.is(piece(s, "h").x, -0)).toBe(false)
    expect(Object.is(piece(s, "h").z, -0)).toBe(false)
  })
  it("is render's own export — the local copy is gone (1.2.0)", () => {
    expect(clampHardscapeXZ).toBe(render.clampHardscapeXZ)
  })
  // render 1.4.1 (editor 1.2.2): the clamp keeps the REAL above-bed extent (render hardscapeExtent) ≥ 1 cm
  // inside the glass — was the footprint ellipse in 1.3.0; an axis wider than the interior is centred
  it("keeps render 1.4.1's real extent ≥ 1 cm inside the glass (1.2.2 semantics)", () => {
    for (let i = 0; i < 200; i++) {
      const p: HardscapeVisual = { id: "p", kind: i % 3 === 0 ? "wood" : "stone", seed: 1 + i, rotationY: (i * 0.37) % 6.28 - 3.14, sizeCm: [4 + (i % 40), 5, 3 + (i % 25)], x: 0, z: 0 }
      if (p.kind === "wood") p.woodStyle = (["branchy", "root", "log"] as const)[i % 3]
      const x = ((i * 13) % 90) - 45
      const z = ((i * 7) % 40) - 20
      const a = clampHardscapeXZ(p, TANK, x, z)
      const e = render.hardscapeExtent({ ...p, x: a.x, z: a.z })
      const inside = (c: number, lo: number, hi: number, half: number) => {
        if (hi - lo > 2 * half - 2) return // wider than the interior: centred on that axis
        expect(c + lo).toBeGreaterThanOrEqual(-half + 1 - 0.05)
        expect(c + hi).toBeLessThanOrEqual(half - 1 + 0.05)
      }
      inside(a.x, e.minX, e.maxX, TANK.widthCm / 2)
      inside(a.z, e.minZ, e.maxZ, TANK.depthCm / 2)
    }
  })
})

describe("previewBase (1.1.0)", () => {
  it("is null when idle, the pre-drag doc while previewing, null again after commit / cancel / undo / redo / apply", () => {
    const s0 = initEditor(fixture())
    expect(s0.previewBase).toBeNull()
    const s1 = run(s0, { type: "preview", target: H("rock"), x: -5, z: 0 })
    expect(s1.previewBase).toBe(s0.doc)
    expect(isPreviewing(s1)).toBe(true)
    // select keeps the preview
    expect(run(s1, { type: "select", target: H("wood") }).previewBase).toBe(s0.doc)
    expect(run(s1, { type: "commitPreview" }).previewBase).toBeNull()
    expect(run(s1, { type: "cancelPreview" }).previewBase).toBeNull()
    expect(run(s1, { type: "undo" }).previewBase).toBeNull()
    expect(run(s1, { type: "redo" }).previewBase).toBeNull()
    expect(run(s1, { type: "apply", op: { type: "resize", id: "rock", scale: RESIZE_UP } }).previewBase).toBeNull()
  })
  it("every state the reducer returns has previewBase set (null or a doc)", () => {
    const actions: EditorAction[] = [
      { type: "select", target: H("rock") },
      { type: "preview", target: H("rock"), x: -3, z: 2 },
      { type: "commitPreview" },
      { type: "apply", op: { type: "resize", id: "rock", scale: 1.1 } },
      { type: "apply", op: { type: "addHardscape", kind: "stone", x: -20, z: -8 } },
      { type: "apply", op: { type: "setWoodStyle", id: "wood", woodStyle: "log" } },
      { type: "preview", target: P("hemianthus-callitrichoides-cuba-1"), x: -22, z: 9 },
      { type: "cancelPreview" },
      { type: "undo" },
      { type: "redo" },
      { type: "select", target: null },
    ]
    let s = initEditor(fixture())
    for (const a of actions) {
      s = editorReducer(s, a)
      expect("previewBase" in s).toBe(true)
      expect(s.previewBase === null || typeof s.previewBase === "object").toBe(true)
    }
  })
  it("tolerates 1.0.0-shaped states without the field", () => {
    const old: EditorState = { doc: fixture(), past: [], future: [], selected: null }
    expect(isPreviewing(old)).toBe(false)
    expect(editorReducer(old, { type: "commitPreview" })).toBe(old)
    const p = editorReducer(old, { type: "preview", target: H("rock"), x: 2, z: 0 })
    expect(p.previewBase).toBe(old.doc)
  })
})

describe("hardscape clamping in move / preview / rotate", () => {
  it("move and preview clamp the whole footprint", () => {
    const s0 = initEditor(fixture())
    // 1.2.2: the same position render 1.4.1 clampHardscapeXZ gives (real extent, not the ellipse)
    const rock = piece(s0, "rock")
    expect(piece(apply(s0, { type: "move", target: H("rock"), x: -99, z: 99 }), "rock")).toMatchObject(clampHardscapeXZ(rock, TANK, -99, 99))
    expect(piece(run(s0, { type: "preview", target: H("rock"), x: 99, z: -99 }), "rock")).toMatchObject(clampHardscapeXZ(rock, TANK, 99, -99))
    const far = clampHardscapeXZ(rock, TANK, -99, 99)
    const e = render.hardscapeExtent({ ...rock, ...far })
    expect(far.x + e.minX).toBeGreaterThanOrEqual(-TANK.widthCm / 2 + 1 - 0.05)
    expect(far.z + e.maxZ).toBeLessThanOrEqual(TANK.depthCm / 2 - 1 + 0.05)
  })
  it("rotate re-clamps (rotation changes the extent) and carried epiphytes follow the shift", () => {
    // a long log against the left glass: rotating it 90° frees x but needs room on z
    const doc = bare([{ id: "log", kind: "wood", woodStyle: "log", x: 0, z: 10, rotationY: 0, sizeCm: [20, 6, 4], seed: 3 }])
    doc.plants = [{ id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", x: 0, z: 10, y: 4, portions: 1 }]
    doc.attach = { "taxiphyllum-barbieri-1": "log" }
    const s = apply(initEditor(doc), { type: "rotate", id: "log", dRad: Math.PI / 2 })
    const log = piece(s, "log")
    expect(log.rotationY).toBeCloseTo(Math.PI / 2, 9)
    expect(log.z).toBeCloseTo(15 - 1 - 10, 6) // half-extent on z is now 10
    expect(plant(s, "taxiphyllum-barbieri-1").z).toBeCloseTo(log.z, 6)
    // 1.2.0: re-seated on the log's top (its centre, the highest point)
    expect(plant(s, "taxiphyllum-barbieri-1").y).toBeCloseTo(surfaceY(log, log.x, log.z)!, 2)
  })
})

describe("resize (1.1.0)", () => {
  it("scales all three axes uniformly (×1.1 / ×0.9), pushes history, keeps the selection", () => {
    const s0 = run(initEditor(fixture()), { type: "select", target: H("rock") })
    const up = apply(s0, { type: "resize", id: "rock", scale: RESIZE_UP })
    expect(piece(up, "rock").sizeCm.map((v) => +v.toFixed(6))).toEqual([11, 8.8, 6.6])
    expect(up.past).toEqual([s0.doc])
    expect(up.selected).toEqual(H("rock"))
    const down = apply(s0, { type: "resize", id: "rock", scale: RESIZE_DOWN })
    expect(piece(down, "rock").sizeCm.map((v) => +v.toFixed(6))).toEqual([9, 7.2, 5.4])
  })
  it("caps growth at width ≤ W − 2, depth ≤ D − 2, height ≤ 0.9 H, keeping proportions", () => {
    const s = apply(initEditor(fixture()), { type: "resize", id: "rock", scale: 100 })
    const [w, h, d] = piece(s, "rock").sizeCm
    // depth hits D − 2 = 28 first (6 → 28: ×4.667); height 8 × 4.667 = 37.3 > 32.4 → height binds: ×4.05
    expect(h).toBeCloseTo(0.9 * 36, 6)
    expect(w / h).toBeCloseTo(10 / 8, 6)
    expect(d / h).toBeCloseTo(6 / 8, 6)
    expect(w).toBeLessThanOrEqual(58)
    expect(d).toBeLessThanOrEqual(28)
    // at the bound, growing again is a same-reference no-op
    expect(apply(s, { type: "resize", id: "rock", scale: 1.1 })).toBe(s)
  })
  it("caps shrinking at 2 cm per axis, keeping proportions", () => {
    const s = apply(initEditor(fixture()), { type: "resize", id: "rock", scale: 0.01 })
    const [w, h, d] = piece(s, "rock").sizeCm
    expect(d).toBeCloseTo(2, 6) // the smallest axis binds
    expect(w).toBeCloseTo(10 / 3, 6)
    expect(h).toBeCloseTo(8 / 3, 6)
    expect(apply(s, { type: "resize", id: "rock", scale: 0.9 })).toBe(s)
  })
  it("re-clamps x / z after growing next to the glass; attached plants' offsets scale (1.2.0)", () => {
    const s0 = apply(initEditor(fixture()), { type: "move", target: H("wood"), x: 99, z: 0 })
    expect(piece(s0, "wood").x).toBe(23)
    const before = plant(s0, "taxiphyllum-barbieri-1")
    const s1 = apply(s0, { type: "resize", id: "wood", scale: 1.5 })
    const w = piece(s1, "wood")
    expect(w.sizeCm[0]).toBeCloseTo(18, 6)
    expect(w.x).toBeCloseTo(30 - 1 - 9, 6)
    const after = plant(s1, "taxiphyllum-barbieri-1")
    expect(after.x - w.x).toBeCloseTo((before.x - 23) * 1.5, 6)
    expect(after.z - w.z).toBeCloseTo((before.z - 0) * 1.5, 6)
    expect(after.y).toBeCloseTo(surfaceY(w, after.x, after.z)!, 2)
    // a planted plant stays put
    expect(plant(s1, "hemianthus-callitrichoides-cuba-1")).toBe(plant(s0, "hemianthus-callitrichoides-cuba-1"))
  })
  it("is a same-reference no-op for unknown ids, scale 1, non-finite and non-positive scales", () => {
    const s0 = initEditor(fixture())
    for (const scale of [1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(apply(s0, { type: "resize", id: "rock", scale })).toBe(s0)
    expect(apply(s0, { type: "resize", id: "nope", scale: 1.1 })).toBe(s0)
  })
  it("never pushes an out-of-bounds piece further out", () => {
    const tall = bare([{ id: "t", kind: "stone", x: 0, z: 0, rotationY: 0, sizeCm: [10, 35, 6], seed: 1 }])
    const s0 = initEditor(tall)
    expect(apply(s0, { type: "resize", id: "t", scale: 1.1 })).toBe(s0)
    expect(piece(apply(s0, { type: "resize", id: "t", scale: 0.9 }), "t").sizeCm[1]).toBeCloseTo(31.5, 6)
  })
  it("1.2.0: over a bound, scale > 1 is a no-op and scale < 1 is applied proportionally — never re-grows", () => {
    // height 50 > 0.9·36 = 32.4: three ×0.9 steps shrink it proportionally; ×1.1 in between does nothing
    let s = initEditor(bare([{ id: "t", kind: "stone", x: 0, z: 0, rotationY: 0, sizeCm: [10, 50, 6], seed: 1 }]))
    for (let i = 0; i < 3; i++) {
      const up = apply(s, { type: "resize", id: "t", scale: RESIZE_UP })
      expect(up).toBe(s)
      const prev = piece(s, "t").sizeCm
      s = apply(s, { type: "resize", id: "t", scale: RESIZE_DOWN })
      const next = piece(s, "t").sizeCm
      for (let k = 0; k < 3; k++) expect(next[k]).toBeCloseTo(prev[k]! * RESIZE_DOWN, 6)
    }
    expect(piece(s, "t").sizeCm[1]).toBeCloseTo(50 * 0.9 ** 3, 6) // 36.45: still over the bound
    expect(apply(s, { type: "resize", id: "t", scale: RESIZE_UP })).toBe(s)
  })
})

describe("addHardscape (1.1.0)", () => {
  it("adds a stone with id stone-<n>, hashed seed, rotationY 0, default size, role soeishi — selected", () => {
    const s = apply(initEditor(bare()), { type: "addHardscape", kind: "stone", x: 0, z: 0 })
    const st = piece(s, "stone-1")
    expect(st).toMatchObject({ kind: "stone", x: 0, z: 0, rotationY: 0, role: "soeishi", seed: hashId("stone-1") })
    expect(st.sizeCm).toEqual([9.6, 7.9, 4.8]) // [0.16W, 0.22H, 0.16D] rounded to 0.1
    expect(st.buriedFrac).toBeUndefined()
    expect(s.selected).toEqual(H("stone-1"))
    expect(s.past).toHaveLength(1)
    expect(Number.isInteger(st.seed)).toBe(true)
    expect(hashId("stone-1")).toBe(hashId("stone-1"))
    expect(hashId("stone-1")).not.toBe(hashId("stone-2"))
  })
  it("uses the per-style wood sizes (default branchy)", () => {
    const s0 = initEditor(bare())
    const add = (woodStyle?: "branchy" | "root" | "log") => piece(apply(s0, { type: "addHardscape", kind: "wood", woodStyle, x: 0, z: 0 }), "wood-1")
    expect(add()).toMatchObject({ kind: "wood", woodStyle: "branchy", sizeCm: [27, 19.8, 9] })
    expect(add("branchy").sizeCm).toEqual([27, 19.8, 9])
    expect(add("root").sizeCm).toEqual([30, 21.6, 9])
    expect(add("log").sizeCm).toEqual([24, 6.5, 6.6])
    expect(add("log").role).toBeUndefined()
  })
  it("ids take the smallest unused n", () => {
    const doc = bare([{ id: "stone-2", kind: "stone", x: -20, z: 0, rotationY: 0, sizeCm: [4, 4, 4], seed: 1 }])
    expect(nextHardscapeId(doc, "stone")).toBe("stone-1")
    const s = run(initEditor(doc),
      { type: "apply", op: { type: "addHardscape", kind: "stone", x: 20, z: 0 } },
      { type: "apply", op: { type: "addHardscape", kind: "stone", x: 0, z: -8 } })
    expect(s.doc.hardscape.map((h) => h.id)).toEqual(["stone-2", "stone-1", "stone-3"])
  })
  it("clamps the size like resize and the position with clampHardscapeXZ", () => {
    // a tiny, very shallow tank: root wood [0.5W, 0.6H, 0.3D] would be fine, but the depth bound bites on a 4 cm deep tank
    const tank = { widthCm: 30, depthCm: 10, heightCm: 12 }
    const s = apply(initEditor({ ...bare(), tank }), { type: "addHardscape", kind: "wood", woodStyle: "root", x: 99, z: 99 })
    const w = piece(s, "wood-1")
    expect(w.sizeCm[0]).toBeLessThanOrEqual(28)
    expect(w.sizeCm[2]).toBeLessThanOrEqual(8)
    expect(w.sizeCm[1]).toBeLessThanOrEqual(0.9 * 12 + 1e-9)
    const e = footprintHalfExtents(w)
    expect(w.x).toBeCloseTo(15 - 1 - e.x, 6)
    expect(w.z).toBeCloseTo(5 - 1 - e.z, 6)
  })
  it("raises tiny default sizes to the 2 cm floor", () => {
    const tank = { widthCm: 10, depthCm: 10, heightCm: 10 }
    const st = piece(apply(initEditor({ ...bare(), tank }), { type: "addHardscape", kind: "stone", x: 0, z: 0 }), "stone-1")
    expect(Math.min(...st.sizeCm)).toBeGreaterThanOrEqual(2)
  })
  it(`is a no-op beyond ${MAX_HARDSCAPE_PIECES} pieces`, () => {
    // 11 pebbles along the front glass, then the 12th piece is added at the centre
    const pebbles: HardscapeVisual[] = Array.from({ length: MAX_HARDSCAPE_PIECES - 1 }, (_, i) => ({
      id: `p${i}`, kind: "stone", x: -25 + i * 5, z: 12, rotationY: 0, sizeCm: [3, 2, 3], seed: i,
    }))
    let s = apply(initEditor(bare(pebbles)), { type: "addHardscape", kind: "stone", x: 0, z: -5 })
    expect(s.doc.hardscape).toHaveLength(MAX_HARDSCAPE_PIECES)
    expect(apply(s, { type: "addHardscape", kind: "wood", x: 0, z: -10 })).toBe(s)
    expect(findHardscapeSpot(s.doc, "stone")).toBeNull()
  })
  it("is rejected when the footprint (+0.5 cm) would cover a planted plant — epiphytes do not block", () => {
    const s0 = initEditor(fixture())
    // hemianthus at (-20, 10); stone footprint half-axes 4.8 × 2.4 (+0.5)
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: -20, z: 8 })).toBe(s0)
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: -15.1, z: 10 })).toBe(s0) // 4.9 < 4.8 + 0.5
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: -14.6, z: 10 })).not.toBe(s0) // 5.4 > 5.3
    // attached plants never block — but (1.2.0) a new piece may not overlap an existing one
    const lone = initEditor(migrateAttach({ ...fixture(), hardscape: [fixture().hardscape[1]!] }))
    expect(plant(lone, "bucephalandra-sp-mini-1").y).toBe(0) // the rock is gone: its buce dropped to the bed
    const tied = apply(initEditor(fixture()), { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "wood" })
    const tiedPlant = tied.doc.plants[tied.doc.plants.length - 1]!
    const minus = apply(tied, { type: "remove", target: H("wood") }) // wood + its epiphytes go
    expect(minus.doc.plants.some((p) => p.id === tiedPlant.id)).toBe(false)
  })
  it("rejects unknown kinds / styles and non-finite positions", () => {
    const s0 = initEditor(bare())
    expect(apply(s0, { type: "addHardscape", kind: "glass" as "stone", x: 0, z: 0 })).toBe(s0)
    expect(apply(s0, { type: "addHardscape", kind: "wood", woodStyle: "bonsai" as "log", x: 0, z: 0 })).toBe(s0)
    expect(apply(s0, { type: "addHardscape", kind: "wood", x: Number.NaN, z: 0 })).toBe(s0)
  })
})

describe("findHardscapeSpot (1.2.0 candidate spots)", () => {
  it("tries centre, ±W/4, ±3W/8 at z = 0, then the same at z = −D/4", () => {
    const c = hardscapeSpotCandidates(TANK)
    expect(c).toEqual([
      { x: 0, z: 0 }, { x: -15, z: 0 }, { x: 15, z: 0 }, { x: -22.5, z: 0 }, { x: 22.5, z: 0 },
      { x: 0, z: -7.5 }, { x: -15, z: -7.5 }, { x: 15, z: -7.5 }, { x: -22.5, z: -7.5 }, { x: 22.5, z: -7.5 },
    ])
  })
  it("returns the first candidate where addHardscape succeeds: no overlap, no planted plant covered", () => {
    const doc = fixture()
    for (const [kind, style] of [["stone", undefined], ["wood", "log"]] as const) {
      const spot = findHardscapeSpot(doc, kind, style)
      expect(spot).not.toBeNull()
      expect(hardscapeSpotCandidates(TANK)).toContainEqual(spot)
      const s = apply(initEditor(doc), { type: "addHardscape", kind, woodStyle: style, x: spot!.x, z: spot!.z })
      expect(s.doc.hardscape).toHaveLength(3)
      const added = s.doc.hardscape[2]!
      for (const h of doc.hardscape) expect(footprintsOverlap(h, added)).toBe(false)
      for (const p of s.doc.plants.filter((pp) => pp.y === 0)) expect(footprintContains(added, p.x, p.z, 0.5)).toBe(false)
    }
    // the rock sits at the centre: a stone goes elsewhere
    const st = findHardscapeSpot(doc, "stone")!
    expect(st).not.toEqual({ x: 0, z: 0 })
  })
  it("returns null when every candidate is taken (the page shows \"No free spot\")", () => {
    // a root piece needs half the tank: after two of them nothing fits
    let s = initEditor(bare())
    for (let i = 0; i < 3; i++) {
      const spot = findHardscapeSpot(s.doc, "wood", "root")
      if (!spot) break
      s = apply(s, { type: "addHardscape", kind: "wood", woodStyle: "root", x: spot.x, z: spot.z })
    }
    expect(findHardscapeSpot(s.doc, "wood", "root")).toBeNull()
    for (const c of hardscapeSpotCandidates(TANK)) expect(apply(s, { type: "addHardscape", kind: "wood", woodStyle: "root", x: c.x, z: c.z })).toBe(s)
  })
})

describe("addHardscape overlap rejection (1.2.0)", () => {
  it("is a no-op when the centre distance < sum of the radii along the centre line − 1 cm", () => {
    // existing stone 10 × 6 at the origin; a new default stone is 9.6 × 4.8 (half 4.8 × 2.4)
    const s0 = initEditor(bare([{ id: "a", kind: "stone", x: 0, z: 0, rotationY: 0, sizeCm: [10, 8, 6], seed: 1 }]))
    // along x: radii 5 + 4.8 − 1 = 8.8
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: 8.7, z: 0 })).toBe(s0)
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: 8.9, z: 0 }).doc.hardscape).toHaveLength(2)
    // along z: radii 3 + 2.4 − 1 = 4.4
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: 0, z: 4.3 })).toBe(s0)
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: 0, z: 4.5 }).doc.hardscape).toHaveLength(2)
    expect(apply(s0, { type: "addHardscape", kind: "stone", x: 0, z: 0 })).toBe(s0)
  })
})

describe("setWoodStyle (1.1.0)", () => {
  it("changes a wood piece's style, undoably", () => {
    const s0 = initEditor(fixture())
    const s1 = apply(s0, { type: "setWoodStyle", id: "wood", woodStyle: "root" })
    expect(piece(s1, "wood").woodStyle).toBe("root")
    expect(run(s1, { type: "undo" }).doc).toBe(s0.doc)
  })
  it("1.2.0: keeps the width and resets height / depth to the style's default proportions, clamped like resize", () => {
    const s0 = initEditor(fixture()) // wood 12 × 20 × 6
    // root default [0.5W, 0.6H, 0.3D] = [30, 21.6, 9] → ×12/30
    expect(piece(apply(s0, { type: "setWoodStyle", id: "wood", woodStyle: "root" }), "wood").sizeCm.map((v) => +v.toFixed(6))).toEqual([12, 8.64, 3.6])
    // log default [24, 6.48, 6.6] → ×0.5
    expect(piece(apply(s0, { type: "setWoodStyle", id: "wood", woodStyle: "log" }), "wood").sizeCm.map((v) => +v.toFixed(6))).toEqual([12, 3.24, 3.3])
    // a very wide branchy piece → root: the depth / height bound shrinks it proportionally
    const wide = initEditor(bare([{ id: "w", kind: "wood", x: 0, z: 0, rotationY: 0, sizeCm: [58, 10, 4], seed: 1 }]))
    const r = piece(apply(wide, { type: "setWoodStyle", id: "w", woodStyle: "root" }), "w").sizeCm
    expect(r[1]).toBeLessThanOrEqual(0.9 * 36 + 1e-9)
    expect(r[0] / r[1]).toBeCloseTo(30 / 21.6, 6)
    expect(r[2] / r[1]).toBeCloseTo(9 / 21.6, 6)
  })
  it("1.2.0: re-seats attached plants on the nearest free anchors", () => {
    const s0 = apply(initEditor(fixture()), { type: "attachPlant", speciesId: "anubias-barteri-nana", hardscapeId: "wood" })
    const s1 = apply(s0, { type: "setWoodStyle", id: "wood", woodStyle: "log" })
    const w = piece(s1, "wood")
    const list = anchors(w, ANCHORS_PER_HOST)
    const seats = attachedTo(s1.doc, "wood").map((id) => plant(s1, id))
    expect(seats).toHaveLength(2)
    for (const p of seats) expect(list.some((a) => a.x === p.x && a.z === p.z && Math.abs(a.y - p.y) < 0.1)).toBe(true)
    expect(seats[0]!.x === seats[1]!.x && seats[0]!.z === seats[1]!.z).toBe(false) // distinct anchors
  })
  it("is a no-op on stones, unknown ids, unknown styles and the current style (missing = branchy)", () => {
    const s0 = initEditor(fixture())
    expect(apply(s0, { type: "setWoodStyle", id: "rock", woodStyle: "log" })).toBe(s0)
    expect(apply(s0, { type: "setWoodStyle", id: "nope", woodStyle: "log" })).toBe(s0)
    expect(apply(s0, { type: "setWoodStyle", id: "wood", woodStyle: "bonsai" as "log" })).toBe(s0)
    expect(apply(s0, { type: "setWoodStyle", id: "wood", woodStyle: "branchy" })).toBe(s0)
    const s1 = apply(s0, { type: "setWoodStyle", id: "wood", woodStyle: "log" })
    expect(apply(s1, { type: "setWoodStyle", id: "wood", woodStyle: "log" })).toBe(s1)
  })
})

describe("needsResim (1.1.0)", () => {
  const d0 = fixture()
  it("is false for the same doc and for hardscape-only edits", () => {
    expect(needsResim(d0, d0)).toBe(false)
    expect(needsResim(d0, fixture())).toBe(false)
    // nothing tied onto the wood, so resize / setWoodStyle carry nothing
    const s0 = initEditor(d0)
    const noWoodEpi = migrateAttach({ ...d0, plants: d0.plants.filter((p) => !p.id.startsWith("taxiphyllum")), attach: { "bucephalandra-sp-mini-1": "rock" } })
    const hardscapeOnly: EditOp[] = [
      { type: "move", target: H("rock"), x: -12, z: -5 }, // the rock's epiphyte is at (1, 1): carried → see below
      { type: "resize", id: "wood", scale: 1.1 },
      { type: "addHardscape", kind: "stone", x: -20, z: -8 },
      { type: "addHardscape", kind: "wood", woodStyle: "log", x: 0, z: -10 },
      { type: "setWoodStyle", id: "wood", woodStyle: "root" },
    ]
    for (const op of hardscapeOnly.slice(1)) {
      const s = apply(initEditor(noWoodEpi), op)
      expect(s.doc).not.toBe(noWoodEpi)
      expect(needsResim(noWoodEpi, s.doc)).toBe(false)
    }
    expect(s0.doc).toBe(d0)
    // a bare stone (nothing carried) moved / rotated
    const bareDoc = { ...d0, plants: d0.plants.filter((p) => p.y === 0) }
    const b = initEditor(bareDoc)
    expect(needsResim(bareDoc, apply(b, { type: "move", target: H("rock"), x: -5, z: -5 }).doc)).toBe(false)
    expect(needsResim(bareDoc, apply(b, { type: "rotate", id: "rock", dRad: 0.3 }).doc)).toBe(false)
  })
  it("is true when an edit carries an epiphyte (plants changed)", () => {
    const s = apply(initEditor(d0), { type: "move", target: H("rock"), x: -12, z: -5 })
    expect(needsResim(d0, s.doc)).toBe(true)
    expect(needsResim(d0, apply(initEditor(d0), { type: "rotate", id: "wood", dRad: 0.5 }).doc)).toBe(true)
  })
  it("is true when the tank, the bed or any plant field changed", () => {
    expect(needsResim(d0, { ...d0, tank: { ...d0.tank, heightCm: 40 } })).toBe(true)
    expect(needsResim(d0, { ...d0, bed: { ...d0.bed, backCm: 10 } })).toBe(true)
    for (const k of ["x", "z", "y", "portions", "id", "speciesId"] as const) {
      const plants = d0.plants.map((p, i) => (i === 0 ? { ...p, [k]: typeof p[k] === "number" ? (p[k] as number) + 1 : `${p[k]}x` } : p))
      expect(needsResim(d0, { ...d0, plants })).toBe(true)
    }
    expect(needsResim(d0, { ...d0, plants: d0.plants.slice(1) })).toBe(true)
    expect(needsResim(d0, apply(initEditor(d0), { type: "addPlant", speciesId: "rotala-rotundifolia", x: -20, z: -10 }).doc)).toBe(true)
  })
  it("1.2.0: is true when the templateId changed", () => {
    expect(needsResim(d0, { ...d0, templateId: "nature-triangle" })).toBe(true)
    expect(needsResim({ ...d0, templateId: "a" }, { ...d0, templateId: "b" })).toBe(true)
    expect(needsResim({ ...d0, templateId: "a" }, { ...d0, templateId: "a" })).toBe(false)
  })
})

describe("woodStyle in share links (1.1.0)", () => {
  /**
   * Produced by the 1.0.0 encoder on main (621aff3) for V100_DOC below — old
   * links must keep decoding.
   */
  const V100_LINK =
    "WzEsWzYwMCwzMDAsMzYwXSwibmF0dXJlIixbMjAsOTBdLFstNjAsMTQwXSxbImhlbWlhbnRodXMtY2FsbGl0cmljaG9pZGVzLWN1YmEiLCJidWNlcGhhbGFuZHJhLXNwLW1pbmkiLCJ0YXhpcGh5bGx1bS1iYXJiaWVyaSJdLFtbInJvY2siLDAsMCwwLDI2LDEwMCw4MCw2MCwxLDEsMjBdLFsid29vZCIsMSwxODAsLTQwLC01MCwxMjAsMjAwLDYwLDIsMCwtMV1dLFswLDAsLTIwMCwxMDAsMiwxLDAsMTAsMTAsNTAwMSwyLDAsMTkwLC00MCw4MDAxXV0"
  const V100_DOC: ScapeDoc = {
    v: 1,
    tank: { widthCm: 60, depthCm: 30, heightCm: 36 },
    templateId: "nature",
    bed: { frontCm: 2, backCm: 9 },
    focalPoint: { x: -6, y: 14 },
    hardscape: [
      { id: "rock", kind: "stone", x: 0, z: 0, rotationY: 0.26, sizeCm: [10, 8, 6], seed: 1, role: "oyaishi", buriedFrac: 0.2 },
      { id: "wood", kind: "wood", x: 18, z: -4, rotationY: -0.5, sizeCm: [12, 20, 6], seed: 2 },
    ],
    plants: [
      { id: "hemianthus-callitrichoides-cuba-1", speciesId: "hemianthus-callitrichoides-cuba", x: -20, z: 10, y: 0, portions: 2 },
      { id: "bucephalandra-sp-mini-1", speciesId: "bucephalandra-sp-mini", x: 1, z: 1, y: 5, portions: 1 },
      { id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", x: 19, z: -4, y: 8, portions: 1 },
    ],
  }

  it("decodes a link made by the 1.0.0 encoder (woodStyle undefined = branchy; epiphytes migrated, 1.2.0)", () => {
    const doc = decodeScape(V100_LINK)
    expect(doc).toEqual(migrateAttach(V100_DOC))
    expect(doc!.hardscape[1]!.woodStyle).toBeUndefined()
    expect(doc!.attach).toEqual({ "bucephalandra-sp-mini-1": "rock", "taxiphyllum-barbieri-1": "wood" })
  })
  it("encodes docs without woodStyle exactly as 1.0.0 did", () => {
    expect(encodeScape(V100_DOC)).toBe(V100_LINK)
  })
  it("round-trips every woodStyle", () => {
    for (const style of ["branchy", "root", "log"] as const) {
      const doc: ScapeDoc = migrateAttach({ ...V100_DOC, hardscape: V100_DOC.hardscape.map((h) => (h.kind === "wood" ? { ...h, woodStyle: style } : h)) })
      const back = decodeScape(encodeScape(doc))
      expect(back).toEqual(doc)
      expect(back!.hardscape[1]!.woodStyle).toBe(style)
    }
    // an added piece round-trips too
    const s = apply(initEditor(bare()), { type: "addHardscape", kind: "wood", woodStyle: "root", x: 3, z: 1 })
    expect(decodeScape(encodeScape(s.doc))).toEqual(s.doc)
  })
  it("rejects a woodStyle on a stone, unknown style codes and extra entries", () => {
    const raw = JSON.parse(atob(V100_LINK.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[][]
    const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const withHs = (i: number, extra: unknown[]) => {
      const c = JSON.parse(JSON.stringify(raw)) as unknown[][]
      ;(c[6] as unknown[][])[i]!.push(...extra)
      return enc(c)
    }
    expect(decodeScape(withHs(1, [2]))!.hardscape[1]!.woodStyle).toBe("root")
    expect(decodeScape(withHs(0, [1]))).toBeNull() // stone
    expect(decodeScape(withHs(1, [0]))).toBeNull()
    expect(decodeScape(withHs(1, [4]))).toBeNull()
    expect(decodeScape(withHs(1, ["log"]))).toBeNull()
    expect(decodeScape(withHs(1, [1, 1]))).toBeNull()
  })
})
