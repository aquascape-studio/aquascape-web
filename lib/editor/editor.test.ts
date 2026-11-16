import { describe, expect, it } from "vitest"
import type { EditTarget, HardscapeVisual } from "@aquascape-studio/render"
import * as render from "@aquascape-studio/render"
import plantsJson from "../sim/vendor/plants.json"
import type { BotanyRecord } from "../sim/buildInput"
import { TEMPLATES, getTemplate, insideFootprint, instantiate } from "../templates"
import { buildTemplateInput } from "../templates/buildTemplateInput"
import type { EditorAction, EditorState, ScapeDoc } from "./contract"
import {
  EDITOR_CONTRACT_VERSION,
  HISTORY_CAP,
  MAX_PLANTS,
  ROTATE_STEP_RAD,
  blockedByStone,
  canRedo,
  canUndo,
  committedDoc,
  decodeScape,
  docFromTemplate,
  editorReducer,
  encodeScape,
  findFreeSpot,
  footprintContains,
  footprintDistance,
  initEditor,
  isKnownSpecies,
  isPreviewing,
  nextPlantId,
  targetPosition,
} from "./index"
import { buildDocInput, defaultBed, docFromInput } from "./buildDocInput"

const PLANTS = plantsJson as unknown as BotanyRecord[]
const TANK = { widthCm: 60, depthCm: 30, heightCm: 36 }

const stone = (id: string, x: number, z: number, w = 10, d = 6, rotationY = 0, extra: Partial<HardscapeVisual> = {}): HardscapeVisual => ({
  id, kind: "stone", x, z, rotationY, sizeCm: [w, 8, d], seed: 1, ...extra,
})

/** small hand-built doc: one stone at the origin, one wood on the right, planted + epiphytes */
function fixture(): ScapeDoc {
  return {
    v: 1,
    tank: { ...TANK },
    bed: { frontCm: 2, backCm: 9 },
    hardscape: [
      stone("rock", 0, 0, 10, 6),
      { id: "wood", kind: "wood", x: 18, z: -4, rotationY: 0, sizeCm: [12, 20, 6], seed: 2 },
    ],
    plants: [
      { id: "hemianthus-callitrichoides-cuba-1", speciesId: "hemianthus-callitrichoides-cuba", x: -20, z: 10, y: 0, portions: 2 },
      { id: "hemianthus-callitrichoides-cuba-2", speciesId: "hemianthus-callitrichoides-cuba", x: -10, z: 10, y: 0, portions: 2 },
      { id: "bucephalandra-sp-mini-1", speciesId: "bucephalandra-sp-mini", x: 1, z: 1, y: 5, portions: 1 },
      { id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", x: 19, z: -4, y: 8, portions: 1 },
    ],
  }
}

const P = (id: string): EditTarget => ({ kind: "plant", id })
const H = (id: string): EditTarget => ({ kind: "hardscape", id })
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s)
const plant = (s: EditorState | ScapeDoc, id: string) => ("doc" in s ? s.doc : s).plants.find((p) => p.id === id)!
const piece = (s: EditorState, id: string) => s.doc.hardscape.find((h) => h.id === id)!

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

describe("contract", () => {
  it("is version 1.1.0", () => expect(EDITOR_CONTRACT_VERSION).toBe("1.1.0"))
  it("initEditor starts with empty history and no selection", () => {
    const doc = fixture()
    expect(initEditor(doc)).toEqual({ doc, past: [], future: [], selected: null, previewBase: null })
    expect(initEditor(doc).doc).toBe(doc)
    expect(isPreviewing(initEditor(doc))).toBe(false)
  })
})

describe("footprintContains (local copy of render 1.2.0)", () => {
  it("tests the axis-aligned ellipse with half-axes w/2, d/2", () => {
    const h = stone("s", 0, 0, 10, 6)
    expect(footprintContains(h, 0, 0)).toBe(true)
    expect(footprintContains(h, 4.9, 0)).toBe(true)
    expect(footprintContains(h, 5.1, 0)).toBe(false)
    expect(footprintContains(h, 0, 2.9)).toBe(true)
    expect(footprintContains(h, 0, 3.1)).toBe(false)
    expect(footprintContains(h, 4, 2.5)).toBe(false) // corner of the bounding box is outside the ellipse
  })
  it("grows by marginCm", () => {
    const h = stone("s", 0, 0, 10, 6)
    expect(footprintContains(h, 5.4, 0, 0.5)).toBe(true)
    expect(footprintContains(h, 5.6, 0, 0.5)).toBe(false)
  })
  it("rotates with rotationY about +y and follows the centre", () => {
    const h = stone("s", 3, -2, 10, 2, Math.PI / 2)
    // rotated 90°: the long axis now runs along z
    expect(footprintContains(h, 3, -2 + 4.5)).toBe(true)
    expect(footprintContains(h, 3 + 4.5, -2)).toBe(false)
    // three.js Ry(θ): local +x → world (cos θ, −sin θ)
    const r = stone("r", 0, 0, 10, 1, 0.5)
    expect(footprintContains(r, 4 * Math.cos(0.5), -4 * Math.sin(0.5))).toBe(true)
    expect(footprintContains(r, 4 * Math.cos(0.5), 4 * Math.sin(0.5))).toBe(false)
  })
  it("agrees with render's exported footprintContains (render ≥ 1.2.0 installed)", () => {
    const renderFc = (render as { footprintContains?: (h: HardscapeVisual, x: number, z: number, m?: number) => boolean }).footprintContains
    if (typeof renderFc !== "function") return // older render build: local helper only
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 500; i++) {
      const h = stone("s", rnd() * 20 - 10, rnd() * 10 - 5, 2 + rnd() * 12, 2 + rnd() * 8, rnd() * 6 - 3)
      const [x, z, m] = [rnd() * 30 - 15, rnd() * 16 - 8, rnd()]
      // skip points within float noise of the boundary
      const d = Math.abs(footprintDistance(h, x, z, m) - 1)
      if (d < 1e-9) continue
      expect(footprintContains(h, x, z, m), `#${i}`).toBe(renderFc(h, x, z, m))
      expect(footprintContains(h, x, z), `#${i} m0`).toBe(renderFc(h, x, z))
    }
  })

  it("agrees with the templates' footprint test", () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 500; i++) {
      const h = stone("s", rnd() * 20 - 10, rnd() * 10 - 5, 2 + rnd() * 12, 2 + rnd() * 8, rnd() * 6 - 3)
      const [x, z, m] = [rnd() * 30 - 15, rnd() * 16 - 8, rnd()]
      expect(footprintContains(h, x, z, m)).toBe(insideFootprint(h, x, z, m))
    }
  })
})

describe("editorReducer · move", () => {
  it("moves a plant and pushes the previous doc onto past", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, { type: "apply", op: { type: "move", target: P("hemianthus-callitrichoides-cuba-1"), x: -22, z: 8 } })
    expect(plant(s1, "hemianthus-callitrichoides-cuba-1")).toMatchObject({ x: -22, z: 8, y: 0 })
    expect(s1.past).toEqual([s0.doc])
    expect(s1.future).toEqual([])
  })

  it("clamps plants 1 cm inside the glass, hardscape by its whole footprint (clampHardscapeXZ)", () => {
    const s = run(initEditor(fixture()),
      { type: "apply", op: { type: "move", target: P("hemianthus-callitrichoides-cuba-1"), x: -100, z: 100 } },
      { type: "apply", op: { type: "move", target: H("wood"), x: 999, z: -999 } })
    expect(plant(s, "hemianthus-callitrichoides-cuba-1")).toMatchObject({ x: -29, z: 14 })
    // wood 12 × 6 cm: footprint half-extents 6 / 3 → centre ≤ 30 − 1 − 6 = 23, ≥ −(15 − 1 − 3) = −11
    expect(piece(s, "wood")).toMatchObject({ x: 23, z: -11 })
  })

  it("rejects a plant dropped on a stone footprint (+0.5 cm margin) as a same-reference no-op", () => {
    const s0 = initEditor(fixture())
    const into = (x: number, z: number) => editorReducer(s0, { type: "apply", op: { type: "move", target: P("hemianthus-callitrichoides-cuba-1"), x, z } })
    expect(into(0, 0)).toBe(s0)
    expect(into(5.3, 0)).toBe(s0) // inside the 0.5 cm margin
    expect(into(5.6, 0)).not.toBe(s0) // just outside
    expect(into(0, 3.4)).toBe(s0)
  })

  it("lets an epiphyte (y > 0) move onto hardscape, and plants it (y = 0) off hardscape", () => {
    const s0 = initEditor(fixture())
    const onWood = run(s0, { type: "apply", op: { type: "move", target: P("bucephalandra-sp-mini-1"), x: 17, z: -3 } })
    expect(plant(onWood, "bucephalandra-sp-mini-1")).toMatchObject({ x: 17, z: -3, y: 5 })
    const onBed = run(s0, { type: "apply", op: { type: "move", target: P("bucephalandra-sp-mini-1"), x: -15, z: 5 } })
    expect(plant(onBed, "bucephalandra-sp-mini-1")).toMatchObject({ x: -15, z: 5, y: 0 })
    // an epiphyte dropped into a stone's margin ring (off the stone itself) is a planted plant → rejected
    expect(editorReducer(s0, { type: "apply", op: { type: "move", target: P("bucephalandra-sp-mini-1"), x: 5.3, z: 0 } })).toBe(s0)
  })

  it("carries the epiphytes inside a moved piece by the same dx, dz — and nothing else", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, { type: "apply", op: { type: "move", target: H("rock"), x: -6, z: 3 } })
    expect(piece(s1, "rock")).toMatchObject({ x: -6, z: 3 })
    expect(plant(s1, "bucephalandra-sp-mini-1")).toMatchObject({ x: -5, z: 4, y: 5 })
    expect(plant(s1, "taxiphyllum-barbieri-1")).toEqual(plant(s0, "taxiphyllum-barbieri-1"))
    expect(plant(s1, "hemianthus-callitrichoides-cuba-1")).toEqual(plant(s0, "hemianthus-callitrichoides-cuba-1"))
    // wood carries its moss too
    const s2 = run(s0, { type: "apply", op: { type: "move", target: H("wood"), x: 10, z: 0 } })
    expect(plant(s2, "taxiphyllum-barbieri-1")).toMatchObject({ x: 11, z: 0, y: 8 })
  })

  it("keeps the plants array reference when a piece carries nothing", () => {
    const doc = fixture()
    const s = run(initEditor(doc), { type: "apply", op: { type: "move", target: H("wood"), x: 10, z: 0 } }) // wood carries moss
    expect(s.doc.plants).not.toBe(doc.plants)
    const bare: ScapeDoc = { ...doc, plants: doc.plants.filter((p) => p.y === 0) }
    const t = run(initEditor(bare), { type: "apply", op: { type: "move", target: H("rock"), x: -8, z: 2 } })
    expect(t.doc.plants).toBe(bare.plants)
  })

  it("does not carry planted (y = 0) plants or epiphytes outside the footprint", () => {
    const doc = fixture()
    doc.plants.push({ id: "anubias-barteri-1", speciesId: "anubias-barteri", x: 8, z: 0, y: 4, portions: 1 }) // y > 0 but off the rock
    const s = run(initEditor(doc), { type: "apply", op: { type: "move", target: H("rock"), x: -10, z: 0 } })
    expect(plant(s, "anubias-barteri-1")).toMatchObject({ x: 8, z: 0 })
  })

  it("is a same-reference no-op for unknown ids, non-finite input and zero-distance moves", () => {
    const s0 = initEditor(fixture())
    const ops: EditorAction[] = [
      { type: "apply", op: { type: "move", target: P("nope"), x: 0, z: 0 } },
      { type: "apply", op: { type: "move", target: H("nope"), x: 0, z: 0 } },
      { type: "apply", op: { type: "move", target: P("hemianthus-callitrichoides-cuba-1"), x: NaN, z: 0 } },
      { type: "apply", op: { type: "move", target: H("rock"), x: 0, z: Infinity } },
      { type: "apply", op: { type: "move", target: P("hemianthus-callitrichoides-cuba-1"), x: -20, z: 10 } },
      { type: "apply", op: { type: "move", target: H("rock"), x: 0, z: 0 } },
    ]
    for (const a of ops) expect(editorReducer(s0, a)).toBe(s0)
  })
})

describe("editorReducer · rotate / remove / addPlant / replace", () => {
  it("rotates a piece by dRad (normalised to (−π, π]) and keeps its epiphytes on it", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, { type: "apply", op: { type: "rotate", id: "rock", dRad: ROTATE_STEP_RAD } })
    expect(ROTATE_STEP_RAD).toBeCloseTo((15 * Math.PI) / 180, 12)
    expect(piece(s1, "rock").rotationY).toBeCloseTo(Math.PI / 12, 12)
    expect(s1.past).toHaveLength(1)
    const epi = plant(s1, "bucephalandra-sp-mini-1")
    expect(footprintContains(piece(s1, "rock"), epi.x, epi.z)).toBe(true)
    expect(Math.hypot(epi.x, epi.z)).toBeCloseTo(Math.SQRT2, 9) // rotated about the centre
    // 24 × 15° = 360°: back where it started
    let s = s0
    for (let i = 0; i < 24; i++) s = editorReducer(s, { type: "apply", op: { type: "rotate", id: "rock", dRad: ROTATE_STEP_RAD } })
    expect(Math.abs(piece(s, "rock").rotationY)).toBeLessThan(1e-9)
    expect(plant(s, "bucephalandra-sp-mini-1").x).toBeCloseTo(1, 9)
    for (let i = 0; i < 13; i++) s = editorReducer(s, { type: "apply", op: { type: "rotate", id: "rock", dRad: -ROTATE_STEP_RAD } })
    expect(piece(s, "rock").rotationY).toBeGreaterThan(-Math.PI)
    expect(piece(s, "rock").rotationY).toBeLessThanOrEqual(Math.PI)
  })

  it("rotate is a no-op for unknown ids and dRad = 0", () => {
    const s0 = initEditor(fixture())
    expect(editorReducer(s0, { type: "apply", op: { type: "rotate", id: "nope", dRad: 0.2 } })).toBe(s0)
    expect(editorReducer(s0, { type: "apply", op: { type: "rotate", id: "rock", dRad: 0 } })).toBe(s0)
    expect(editorReducer(s0, { type: "apply", op: { type: "rotate", id: "rock", dRad: NaN } })).toBe(s0)
  })

  it("removes plants and pieces, clears a removed selection, drops orphaned epiphytes to the bed", () => {
    const s0 = run(initEditor(fixture()), { type: "select", target: H("rock") })
    const s1 = run(s0, { type: "apply", op: { type: "remove", target: H("rock") } })
    expect(s1.doc.hardscape.map((h) => h.id)).toEqual(["wood"])
    expect(s1.selected).toBeNull()
    expect(plant(s1, "bucephalandra-sp-mini-1").y).toBe(0)
    expect(plant(s1, "taxiphyllum-barbieri-1").y).toBe(8)
    const s2 = run(s1, { type: "select", target: P("hemianthus-callitrichoides-cuba-2") }, { type: "apply", op: { type: "remove", target: P("hemianthus-callitrichoides-cuba-1") } })
    expect(s2.doc.plants.map((p) => p.id)).not.toContain("hemianthus-callitrichoides-cuba-1")
    expect(s2.selected).toEqual(P("hemianthus-callitrichoides-cuba-2")) // other selection survives
    expect(editorReducer(s2, { type: "apply", op: { type: "remove", target: P("hemianthus-callitrichoides-cuba-1") } })).toBe(s2)
  })

  it("adds a plant with id '<speciesId>-<smallest unused n>', clamped, selected", () => {
    const doc = fixture()
    doc.plants.push({ id: "hemianthus-callitrichoides-cuba-4", speciesId: "hemianthus-callitrichoides-cuba", x: 20, z: 10, y: 0, portions: 1 })
    expect(nextPlantId(doc, "hemianthus-callitrichoides-cuba")).toBe("hemianthus-callitrichoides-cuba-3")
    expect(nextPlantId(doc, "rotala-rotundifolia")).toBe("rotala-rotundifolia-1")
    const s = run(initEditor(doc), { type: "apply", op: { type: "addPlant", speciesId: "hemianthus-callitrichoides-cuba", x: -50, z: 50 } })
    const added = s.doc.plants[s.doc.plants.length - 1]!
    expect(added).toEqual({ id: "hemianthus-callitrichoides-cuba-3", speciesId: "hemianthus-callitrichoides-cuba", x: -29, z: 14, y: 0, portions: 1 })
    expect(s.selected).toEqual(P(added.id))
    const s2 = run(s, { type: "apply", op: { type: "addPlant", speciesId: "hemianthus-callitrichoides-cuba", x: 0, z: 10, portions: 3 } })
    expect(s2.doc.plants.at(-1)).toMatchObject({ id: "hemianthus-callitrichoides-cuba-5", portions: 3 })
  })

  it("rejects addPlant on a stone, for unknown species, and beyond 60 plants", () => {
    const s0 = initEditor(fixture())
    expect(editorReducer(s0, { type: "apply", op: { type: "addPlant", speciesId: "hemianthus-callitrichoides-cuba", x: 0, z: 0 } })).toBe(s0)
    expect(editorReducer(s0, { type: "apply", op: { type: "addPlant", speciesId: "not-a-plant", x: -20, z: 0 } })).toBe(s0)
    let s = s0
    for (let i = 0; i < 80; i++) {
      s = editorReducer(s, { type: "apply", op: { type: "addPlant", speciesId: "eleocharis-parvula", x: -28 + (i % 14) * 4, z: -12 + Math.floor(i / 14) * 5 } })
    }
    expect(MAX_PLANTS).toBe(60)
    expect(s.doc.plants).toHaveLength(60)
    expect(editorReducer(s, { type: "apply", op: { type: "addPlant", speciesId: "eleocharis-parvula", x: -25, z: 13 } })).toBe(s)
  })

  it("replace swaps the doc (undoable); an identical doc is a no-op", () => {
    const s0 = initEditor(fixture())
    const other = docFromTemplate(instantiate(getTemplate("dutch-streets")!, TANK), TANK, "dutch-streets")
    const s1 = run(s0, { type: "select", target: H("rock") }, { type: "apply", op: { type: "replace", doc: other } })
    expect(s1.doc).toBe(other)
    expect(s1.selected).toBeNull()
    expect(run(s1, { type: "undo" }).doc).toBe(s0.doc)
    expect(editorReducer(s0, { type: "apply", op: { type: "replace", doc: fixture() } })).toBe(s0)
  })
})

describe("editorReducer · preview / commitPreview / cancelPreview", () => {
  const T = P("hemianthus-callitrichoides-cuba-1")

  it("previews without touching history, commits the pre-drag doc once", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, { type: "preview", target: T, x: -21, z: 9 }, { type: "preview", target: T, x: -23, z: 7 }, { type: "preview", target: T, x: -25, z: 5 })
    expect(plant(s1, T.id)).toMatchObject({ x: -25, z: 5 })
    expect(s1.past).toEqual([])
    expect(isPreviewing(s1)).toBe(true)
    expect(committedDoc(s1)).toBe(s0.doc)
    const s2 = run(s1, { type: "commitPreview" })
    expect(s2.past).toHaveLength(1)
    expect(s2.past[0]).toBe(s0.doc)
    expect(plant(s2, T.id)).toMatchObject({ x: -25, z: 5 })
    expect(isPreviewing(s2)).toBe(false)
    expect(committedDoc(s2)).toBe(s2.doc)
    expect(Object.keys(s2).sort()).toEqual(["doc", "future", "past", "previewBase", "selected"])
    expect(s2.previewBase).toBeNull() // 1.1.0: always set, null when idle
  })

  it("cancelPreview restores the pre-drag doc without history", () => {
    const s0 = run(initEditor(fixture()), { type: "apply", op: { type: "move", target: T, x: -21, z: 9 } })
    const s1 = run(s0, { type: "preview", target: T, x: 0, z: 12 }, { type: "cancelPreview" })
    expect(s1.doc).toBe(s0.doc)
    expect(s1.past).toBe(s0.past)
    expect(isPreviewing(s1)).toBe(false)
  })

  it("commit / cancel without a preview are same-reference no-ops", () => {
    const s0 = initEditor(fixture())
    expect(editorReducer(s0, { type: "commitPreview" })).toBe(s0)
    expect(editorReducer(s0, { type: "cancelPreview" })).toBe(s0)
  })

  it("a drag that returns to its start commits nothing", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, { type: "preview", target: T, x: -10, z: 0 }, { type: "preview", target: T, x: -20, z: 10 }, { type: "commitPreview" })
    expect(s1.past).toEqual([])
    expect(s1.doc).toEqual(s0.doc)
    expect(isPreviewing(s1)).toBe(false)
  })

  it("rejects preview positions on a stone, keeping the last valid one", () => {
    const s1 = run(initEditor(fixture()), { type: "preview", target: T, x: -8, z: 0 })
    expect(editorReducer(s1, { type: "preview", target: T, x: 0, z: 0 })).toBe(s1)
    expect(plant(run(s1, { type: "preview", target: T, x: 0, z: 0 }, { type: "commitPreview" }), T.id)).toMatchObject({ x: -8, z: 0 })
  })

  it("computes a hardscape preview from the pre-drag doc: carried epiphytes do not drift", () => {
    const s0 = initEditor(fixture())
    let s = s0
    for (let i = 1; i <= 20; i++) s = editorReducer(s, { type: "preview", target: H("rock"), x: -i, z: i * 0.4 })
    // a stone dragged far away, then back: epiphytes follow exactly
    s = run(s, { type: "preview", target: H("rock"), x: 22, z: -10 }, { type: "preview", target: H("rock"), x: -4, z: 2 }, { type: "commitPreview" })
    expect(plant(s, "bucephalandra-sp-mini-1")).toMatchObject({ x: -3, z: 3, y: 5 })
    expect(s.past).toEqual([s0.doc])
  })

  it("discards an active preview when an op is applied (ops apply to the committed doc)", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, { type: "preview", target: T, x: -25, z: 5 }, { type: "apply", op: { type: "remove", target: P("hemianthus-callitrichoides-cuba-2") } })
    expect(isPreviewing(s1)).toBe(false)
    expect(plant(s1, T.id)).toMatchObject({ x: -20, z: 10 })
    expect(s1.past).toEqual([s0.doc])
    // a no-op op leaves the preview alone
    const s2 = run(s0, { type: "preview", target: T, x: -25, z: 5 })
    expect(editorReducer(s2, { type: "apply", op: { type: "remove", target: P("nope") } })).toBe(s2)
  })
})

describe("editorReducer · undo / redo / select", () => {
  const T = P("hemianthus-callitrichoides-cuba-1")
  const mv = (x: number): EditorAction => ({ type: "apply", op: { type: "move", target: T, x, z: 10 } })

  it("undoes and redoes; a new edit clears the redo stack", () => {
    const s0 = initEditor(fixture())
    const s2 = run(s0, mv(-21), mv(-22))
    expect(canUndo(s2)).toBe(true)
    expect(canRedo(s2)).toBe(false)
    const u1 = run(s2, { type: "undo" })
    expect(plant(u1, T.id).x).toBe(-21)
    expect(canRedo(u1)).toBe(true)
    const u2 = run(u1, { type: "undo" })
    expect(u2.doc).toBe(s0.doc)
    expect(editorReducer(u2, { type: "undo" })).toBe(u2)
    const r1 = run(u2, { type: "redo" })
    expect(plant(r1, T.id).x).toBe(-21)
    const r2 = run(r1, { type: "redo" })
    expect(r2.doc).toBe(s2.doc)
    expect(editorReducer(r2, { type: "redo" })).toBe(r2)
    const branched = run(u1, mv(-25))
    expect(branched.future).toEqual([])
  })

  it("caps history at 100", () => {
    let s = initEditor(fixture())
    for (let i = 0; i < 130; i++) s = editorReducer(s, mv(-28 + (i % 2) * 0.5 + i * 0.01))
    expect(HISTORY_CAP).toBe(100)
    expect(s.past).toHaveLength(100)
    let undone = 0
    while (canUndo(s)) {
      s = editorReducer(s, { type: "undo" })
      undone++
    }
    expect(undone).toBe(100)
    expect(s.future).toHaveLength(100)
    // the oldest 30 edits fell off: we land on edit #30, not the initial doc
    expect(plant(s, T.id).x).not.toBe(-20)
  })

  it("undo / redo clear an active preview", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, mv(-22), { type: "preview", target: T, x: -27, z: 3 })
    const u = run(s1, { type: "undo" })
    expect(isPreviewing(u)).toBe(false)
    expect(u.doc).toBe(s0.doc)
    expect(plant(u.future[0]!, T.id).x).toBe(-22) // the committed doc, not the preview, goes to future
    const r = run(u, { type: "preview", target: T, x: -27, z: 3 }, { type: "redo" })
    expect(isPreviewing(r)).toBe(false)
    expect(plant(r, T.id)).toMatchObject({ x: -22, z: 10 })
    // undo with nothing to undo still drops the preview
    const p0 = run(s0, { type: "preview", target: T, x: -27, z: 3 }, { type: "undo" })
    expect(p0.doc).toBe(s0.doc)
    expect(isPreviewing(p0)).toBe(false)
  })

  it("keeps the selection across undo only while the target exists", () => {
    const s = run(initEditor(fixture()),
      { type: "apply", op: { type: "addPlant", speciesId: "rotala-rotundifolia", x: -20, z: -10 } })
    expect(s.selected).toEqual(P("rotala-rotundifolia-1"))
    expect(run(s, { type: "undo" }).selected).toBeNull()
    const k = run(s, { type: "select", target: H("rock") }, { type: "undo" })
    expect(k.selected).toEqual(H("rock"))
  })

  it("select sets / clears selection without history; unknown targets and re-selects are no-ops", () => {
    const s0 = initEditor(fixture())
    const s1 = run(s0, { type: "select", target: H("rock") })
    expect(s1.selected).toEqual(H("rock"))
    expect(s1.past).toBe(s0.past)
    expect(editorReducer(s1, { type: "select", target: H("rock") })).toBe(s1)
    expect(editorReducer(s1, { type: "select", target: P("ghost") })).toBe(s1)
    expect(run(s1, { type: "select", target: null }).selected).toBeNull()
    expect(editorReducer(s0, { type: "select", target: null })).toBe(s0)
    // selecting during a preview keeps the preview
    const p = run(s0, { type: "preview", target: P("hemianthus-callitrichoides-cuba-1"), x: -25, z: 5 }, { type: "select", target: H("wood") })
    expect(isPreviewing(p)).toBe(true)
  })
})

describe("editorReducer · purity", () => {
  it("never mutates its inputs (deep-frozen state through every action) and is deterministic", () => {
    const actions: EditorAction[] = [
      { type: "select", target: H("rock") },
      { type: "apply", op: { type: "move", target: H("rock"), x: -5, z: 2 } },
      { type: "apply", op: { type: "rotate", id: "rock", dRad: 0.3 } },
      { type: "preview", target: P("hemianthus-callitrichoides-cuba-1"), x: -24, z: 4 },
      { type: "commitPreview" },
      { type: "preview", target: H("wood"), x: 10, z: 2 },
      { type: "cancelPreview" },
      { type: "apply", op: { type: "addPlant", speciesId: "rotala-rotundifolia", x: -20, z: -10 } },
      { type: "apply", op: { type: "remove", target: H("wood") } },
      { type: "undo" },
      { type: "redo" },
      { type: "apply", op: { type: "replace", doc: fixture() } },
      { type: "undo" },
    ]
    const snapshot = JSON.stringify(fixture())
    let s: EditorState = deepFreeze(initEditor(deepFreeze(fixture())))
    const trace: string[] = []
    for (const a of actions) {
      const before = JSON.stringify(s)
      const next = editorReducer(s, deepFreeze(a))
      expect(JSON.stringify(s)).toBe(before)
      s = deepFreeze(next)
      trace.push(JSON.stringify(s))
    }
    expect(JSON.stringify(fixture())).toBe(snapshot)
    let t: EditorState = initEditor(fixture())
    actions.forEach((a, i) => {
      t = editorReducer(t, a)
      expect(JSON.stringify(t)).toBe(trace[i])
    })
  })
})

describe("docFromTemplate", () => {
  for (const tpl of TEMPLATES) {
    it(`${tpl.id} → doc carries the instantiated scene`, () => {
      const inst = instantiate(tpl, TANK)
      const doc = docFromTemplate(inst, TANK, tpl.id)
      expect(doc).toEqual({ v: 1, tank: TANK, templateId: tpl.id, bed: inst.bed, focalPoint: inst.focalPoint, hardscape: inst.hardscape, plants: inst.plants })
      expect(doc.plants).not.toBe(inst.plants)
      if (inst.hardscape[0]) expect(doc.hardscape[0]!.sizeCm).not.toBe(inst.hardscape[0].sizeCm)
      expect(doc.tank).not.toBe(TANK)
    })
  }
  it("omits templateId when not given", () => {
    expect("templateId" in docFromTemplate(instantiate(TEMPLATES[0]!, TANK), TANK)).toBe(false)
  })
})

describe("encodeScape / decodeScape", () => {
  const ROLE_IDS = ["oyaishi", "fukuishi", "soeishi", "suteishi"] as const
  /** worst-ish case: 30 plants over 10 long-named species, non-default y / portions, 5 stones with roles */
  function bigDoc(): ScapeDoc {
    const longIds = PLANTS.map((p) => p.id).sort((a, b) => b.length - a.length).slice(0, 10)
    return {
      v: 1,
      tank: { widthCm: 90, depthCm: 45, heightCm: 45 },
      templateId: "iwagumi-sanzon",
      bed: { frontCm: 2.48, backCm: 11.25 },
      focalPoint: { x: -14.37, y: 18.91 },
      hardscape: Array.from({ length: 5 }, (_, i) =>
        stone(`${ROLE_IDS[i % 4]}-${i}`, -30 + i * 14.123, -8.456 + i * 3.21, 8.37 + i, 6.11, -2.9 + i * 1.37, { role: ROLE_IDS[i % 4], buriedFrac: 0.123 + i * 0.05, seed: 1000 + i * 977 })),
      plants: Array.from({ length: 30 }, (_, i) => {
        const sid = longIds[i % 10]!
        return { id: `${sid}-${Math.floor(i / 10) + 1}`, speciesId: sid, x: -43.21 + i * 2.913, z: -21.07 + ((i * 7) % 42) + 0.137, y: i % 3 ? 0 : 6.67, portions: 1 + (i % 4) }
      }),
    }
  }

  it("is URL-safe and ≤ 2000 chars for 30 plants + 5 stones", () => {
    const s = encodeScape(bigDoc())
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(s.length).toBeLessThanOrEqual(2000)
    expect(encodeURIComponent(s)).toBe(s)
  })

  it("keeps every template doc (all sizes) well under the limit", () => {
    for (const tpl of TEMPLATES) for (const tank of [TANK, { widthCm: 90, depthCm: 45, heightCm: 45 }]) {
      const s = encodeScape(docFromTemplate(instantiate(tpl, tank), tank, tpl.id))
      expect(s.length, `${tpl.id}@${tank.widthCm}`).toBeLessThanOrEqual(2000)
    }
  })

  it("round-trips stably to the rounding (0.1 cm / 0.01 rad)", () => {
    for (const doc of [bigDoc(), fixture(), ...TEMPLATES.map((t) => docFromTemplate(instantiate(t, TANK), TANK, t.id))]) {
      const s = encodeScape(doc)
      const back = decodeScape(s)
      expect(back).not.toBeNull()
      expect(encodeScape(back!)).toBe(s)
      expect(decodeScape(encodeScape(back!))).toEqual(back)
      expect(back!.templateId).toBe(doc.templateId)
      expect(back!.tank).toEqual(doc.tank)
      expect(back!.plants.map((p) => [p.id, p.speciesId, p.portions])).toEqual(doc.plants.map((p) => [p.id, p.speciesId, p.portions]))
      doc.plants.forEach((p, i) => {
        const q = back!.plants[i]!
        expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(0.05 + 1e-9)
        expect(Math.abs(q.z - p.z)).toBeLessThanOrEqual(0.05 + 1e-9)
        expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(0.05 + 1e-9)
      })
      doc.hardscape.forEach((h, i) => {
        const g = back!.hardscape[i]!
        expect([g.id, g.kind, g.role, g.seed]).toEqual([h.id, h.kind, h.role, h.seed])
        expect(Math.abs(g.rotationY - h.rotationY)).toBeLessThanOrEqual(0.005 + 1e-9)
        expect(Math.abs(g.x - h.x)).toBeLessThanOrEqual(0.05 + 1e-9)
        g.sizeCm.forEach((v, k) => expect(Math.abs(v - h.sizeCm[k]!)).toBeLessThanOrEqual(0.05 + 1e-9))
        if (h.buriedFrac === undefined) expect("buriedFrac" in g).toBe(false)
        else expect(Math.abs(g.buriedFrac! - h.buriedFrac)).toBeLessThanOrEqual(0.005 + 1e-9)
      })
      if (doc.focalPoint) expect(back!.focalPoint!.x).toBeCloseTo(doc.focalPoint.x, 1)
      else expect("focalPoint" in back!).toBe(false)
    }
  })

  it("round-trips ids that are not '<speciesId>-<n>' (legacy '#k', custom)", () => {
    const doc = fixture()
    doc.plants[0]!.id = "hemianthus-callitrichoides-cuba#3"
    doc.plants[1]!.id = "custom.id_7"
    const back = decodeScape(encodeScape(doc))!
    expect(back.plants.map((p) => p.id)).toEqual(doc.plants.map((p) => p.id))
  })

  it("round-trips an empty doc and wood pieces without role", () => {
    const doc: ScapeDoc = { v: 1, tank: TANK, bed: { frontCm: 2.9, backCm: 8.9 }, hardscape: [fixture().hardscape[1]!], plants: [] }
    expect(decodeScape(encodeScape(doc))).toEqual(doc)
  })

  it("returns null (never throws) on malformed, unknown-version or unknown-species input", () => {
    const good = JSON.parse(atob(encodeScape(fixture()).replace(/-/g, "+").replace(/_/g, "/")))
    const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const mut = (f: (a: any) => void) => {
      const a = structuredClone(good)
      f(a)
      return enc(a)
    }
    expect(decodeScape(enc(good))).not.toBeNull() // sanity: the re-encoder matches
    const bad: string[] = [
      "", " ", "!!!", "a", "abc=", "%7B%7D", "eyJ", "e30", btoa("not json"), enc(null), enc({}), enc([]), enc("x"),
      "x".repeat(9000),
      mut((a) => (a[0] = 2)), // unknown version
      mut((a) => (a[0] = "1")),
      mut((a) => a.push(0)),
      mut((a) => (a[5][0] = "not-a-species")), // unknown species
      mut((a) => (a[5][0] = 42)),
      mut((a) => (a[5] = [a[5][0], a[5][0]])), // duplicate species
      mut((a) => (a[1] = [5, 300, 360])), // tank too small
      mut((a) => (a[1] = [6000, 300, 360])),
      mut((a) => (a[1] = [600.5, 300, 360])),
      mut((a) => (a[2] = "Bad Id!")),
      mut((a) => (a[3] = [20])),
      mut((a) => (a[4] = [0, -1])),
      mut((a) => (a[6][0][1] = 2)), // kind
      mut((a) => (a[6][0][0] = "")),
      mut((a) => (a[6][1][0] = a[6][0][0])), // duplicate hardscape id
      mut((a) => (a[6][0][2] = 9999)), // outside glass
      mut((a) => (a[6][0][5] = 0)), // zero size
      mut((a) => (a[6][0][9] = 9)), // role
      mut((a) => (a[6][0][10] = 99)), // buried
      mut((a) => a[6][0].pop()),
      mut((a) => (a[7][0] = 99)), // species index
      mut((a) => (a[7][1] = -1)), // id
      mut((a) => (a[7][1] = "bad id")),
      mut((a) => (a[7][6] = 1)), // plant 2 claims "cuba-1", which plant 1 has (auto id)
      mut((a) => (a[7][2] = 1e6)), // outside glass
      mut((a) => (a[7][2] = 1.5)), // not quantised
      mut((a) => (a[7][4] = 500)), // portions 0
      mut((a) => (a[7][4] = -2)), // negative
      mut((a) => (a[7][4] = 99999999)), // y above the water
      mut((a) => (a[7] = Array.from({ length: 61 }, (_, i) => [0, i + 1, 0, 100, 1]).flat())), // > 60 plants
      mut((a) => a[7].pop()), // stride
      mut((a) => (a[6] = Array.from({ length: 30 }, (_, i) => ["s" + i, 0, 0, 0, 0, 10, 10, 10, 1, 0, -1]))),
    ]
    for (const s of bad) {
      expect(() => decodeScape(s)).not.toThrow()
      expect(decodeScape(s), `case ${bad.indexOf(s)}`).toBeNull()
    }
    // invalid UTF-8 bytes
    expect(decodeScape(btoa("\xff\xfe\xfd").replace(/=+$/, ""))).toBeNull()
    // non-string input from untyped callers
    expect(decodeScape(undefined as unknown as string)).toBeNull()
    expect(decodeScape(42 as unknown as string)).toBeNull()
  })

  it("survives fuzzing: truncations, bit flips and random strings never throw", () => {
    const s = encodeScape(bigDoc())
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/ %"
    let seed = 42
    const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n
    for (let i = 0; i < 400; i++) {
      const cut = s.slice(0, rnd(s.length))
      const flipAt = rnd(s.length)
      const flipped = s.slice(0, flipAt) + alphabet[rnd(64)] + s.slice(flipAt + 1)
      const random = Array.from({ length: 1 + rnd(200) }, () => alphabet[rnd(alphabet.length)]).join("")
      for (const v of [cut, flipped, random]) {
        expect(() => decodeScape(v)).not.toThrow()
        const d = decodeScape(v)
        if (d) {
          for (const p of d.plants) expect(isKnownSpecies(p.speciesId)).toBe(true)
        }
      }
    }
  })
})

describe("helpers", () => {
  it("findFreeSpot returns the nearest spot off the stones", () => {
    const doc = fixture()
    const spot = findFreeSpot(doc, 0, 0)!
    expect(blockedByStone(doc, spot.x, spot.z)).toBe(false)
    expect(Math.hypot(spot.x, spot.z)).toBeLessThan(7)
    expect(findFreeSpot(doc, -20, 0)).toEqual({ x: -20, z: 0 })
    const covered: ScapeDoc = { ...doc, hardscape: [stone("all", 0, 0, 200, 200)] }
    expect(findFreeSpot(covered, 0, 0)).toBeNull()
  })

  it("targetPosition finds plants and pieces", () => {
    const doc = fixture()
    expect(targetPosition(doc, H("wood"))).toEqual({ x: 18, z: -4 })
    expect(targetPosition(doc, P("hemianthus-callitrichoides-cuba-2"))).toEqual({ x: -10, z: 10 })
    expect(targetPosition(doc, P("x"))).toBeNull()
  })
})

describe("buildDocInput", () => {
  it("matches buildTemplateInput for an unedited template doc", () => {
    for (const tpl of TEMPLATES) {
      const params = new URLSearchParams("w=90&d=45&h=45")
      const viaTemplate = buildTemplateInput(tpl, params, PLANTS)
      const doc = docFromTemplate(viaTemplate.scene, viaTemplate.input.tank, tpl.id)
      const viaDoc = buildDocInput(doc, params, PLANTS)
      expect(viaDoc.input).toEqual(viaTemplate.input)
      expect(viaDoc.light).toBe(tpl.light)
      expect(viaDoc.co2).toBe(tpl.co2)
      expect(viaDoc.name).toBe(viaTemplate.name)
      expect(viaDoc.template?.id).toBe(tpl.id)
    }
  })

  it("feeds the doc's plants and tank to the sim, light / CO₂ from the URL without a template", () => {
    const doc = fixture()
    const b = buildDocInput(doc, new URLSearchParams("light=Low&co2=true&name=Mine&w=120"), PLANTS)
    expect(b.input.plants).toEqual(doc.plants)
    expect(b.input.tank).toEqual(TANK)
    expect(b.light).toBe("Low")
    expect(b.co2).toBe(true)
    expect(b.name).toBe("Mine")
    for (const p of doc.plants) expect(b.input.species[p.speciesId]).toBeDefined()
    expect(b.resolved.reduce((a, r) => a + r.qty, 0)).toBe(doc.plants.reduce((a, p) => a + p.portions, 0))
  })

  it("keeps the seed stable across position edits", () => {
    const doc = fixture()
    const moved = editorReducer(initEditor(doc), { type: "apply", op: { type: "move", target: P("hemianthus-callitrichoides-cuba-1"), x: -25, z: 0 } }).doc
    const params = new URLSearchParams("")
    expect(buildDocInput(moved, params, PLANTS).input.seed).toBe(buildDocInput(doc, params, PLANTS).input.seed)
  })

  it("handles an empty doc (no default plants sneak in)", () => {
    const doc: ScapeDoc = { ...fixture(), plants: [] }
    const b = buildDocInput(doc, new URLSearchParams(""), PLANTS)
    expect(b.input.plants).toEqual([])
    expect(b.input.species).toEqual({})
    expect(b.resolved).toEqual([])
  })

  it("docFromInput wraps the non-template page's plants on the default bed", () => {
    const b = buildDocInput(fixture(), new URLSearchParams(""), PLANTS)
    const doc = docFromInput(b.input, fixture().hardscape)
    expect(doc.plants).toEqual(b.input.plants)
    expect(doc.bed).toEqual(defaultBed(TANK))
    expect(defaultBed(TANK)).toEqual({ frontCm: 2.88, backCm: 8.88 })
  })
})
