/**
 * Editor contract 1.2.0 (lib/editor/contract.ts): epiphytes tied onto
 * hardscape — attach map, migrateAttach, canAttach, attachPlant / detachPlant /
 * setLeanSide, carrying rules, share links — plus a seeded property test that
 * checks the invariants after every op of random op sequences.
 */
import { describe, expect, it } from "vitest"
import type { EditTarget, HardscapeVisual } from "@aquascape-studio/render"
import { TEMPLATES, instantiate } from "../templates"
import type { EditOp, EditorAction, EditorState, ScapeDoc } from "./contract"
import {
  ANCHOR_TAKEN_CM,
  MAX_PLANTS,
  attachableSpeciesIds,
  attachedTo,
  canAttach,
  decodeScape,
  detachSpot,
  docFromTemplate,
  editorReducer,
  encodeScape,
  footprintContains,
  footprintHalfExtents,
  hostOf,
  initEditor,
  migrateAttach,
  needsResim,
} from "./index"
import { anchors, exposedHeight, leanSign, surfaceY } from "./surface"

const TANK = { widthCm: 60, depthCm: 30, heightCm: 36 }
const P = (id: string): EditTarget => ({ kind: "plant", id })
const H = (id: string): EditTarget => ({ kind: "hardscape", id })
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s)
const apply = (s: EditorState, op: EditOp) => editorReducer(s, { type: "apply", op })
const piece = (s: EditorState | ScapeDoc, id: string) => ("doc" in s ? s.doc : s).hardscape.find((h) => h.id === id)!
const plant = (s: EditorState | ScapeDoc, id: string) => ("doc" in s ? s.doc : s).plants.find((p) => p.id === id)!
const last = (s: EditorState) => s.doc.plants[s.doc.plants.length - 1]!

const ROOT: HardscapeVisual = { id: "root", kind: "wood", woodStyle: "root", x: -6, z: -2, rotationY: 0, sizeCm: [28, 22, 8], seed: 5 }
const ROCK: HardscapeVisual = { id: "rock", kind: "stone", role: "fukuishi", x: 18, z: 6, rotationY: 0.3, sizeCm: [8, 8, 7], seed: 9 }

function doc0(): ScapeDoc {
  return {
    v: 1,
    tank: { ...TANK },
    bed: { frontCm: 2, backCm: 9 },
    hardscape: [{ ...ROOT, sizeCm: [...ROOT.sizeCm] }, { ...ROCK, sizeCm: [...ROCK.sizeCm] }],
    plants: [{ id: "hemianthus-callitrichoides-cuba-1", speciesId: "hemianthus-callitrichoides-cuba", x: -20, z: 11, y: 0, portions: 2 }],
  }
}

/** check every 1.2.0 invariant (plus the 1.0 glass / budget rules) */
function checkInvariants(doc: ScapeDoc, label = ""): void {
  const plantIds = new Set(doc.plants.map((p) => p.id))
  const hs = new Map(doc.hardscape.map((h) => [h.id, h]))
  expect(plantIds.size, `${label} unique plant ids`).toBe(doc.plants.length)
  expect(doc.plants.length).toBeLessThanOrEqual(MAX_PLANTS)
  if (doc.attach !== undefined) expect(Object.keys(doc.attach).length, `${label} empty attach is normalised away`).toBeGreaterThan(0)
  for (const [pid, hid] of Object.entries(doc.attach ?? {})) {
    expect(plantIds.has(pid), `${label} attach key ${pid}`).toBe(true)
    expect(hs.has(hid), `${label} attach value ${hid}`).toBe(true)
  }
  for (const p of doc.plants) {
    expect(Math.abs(p.x), `${label} ${p.id} x`).toBeLessThanOrEqual(doc.tank.widthCm / 2 - 1 + 1e-9)
    expect(Math.abs(p.z), `${label} ${p.id} z`).toBeLessThanOrEqual(doc.tank.depthCm / 2 - 1 + 1e-9)
    const hid = hostOf(doc, p.id)
    if (hid === undefined) {
      expect(p.y, `${label} ${p.id} planted y`).toBe(0)
    } else {
      const h = hs.get(hid)!
      expect(p.y, `${label} ${p.id} attached y`).toBeGreaterThan(0)
      expect(footprintContains(h, p.x, p.z, 0.01), `${label} ${p.id} on ${hid}`).toBe(true)
      expect(p.y).toBeCloseTo(Math.max(0.1, surfaceY(h, p.x, p.z)!), 2)
      expect(canAttach(p.speciesId), `${label} ${p.id} species`).toBe(true)
    }
  }
  // canonical: migrating a doc the editor produced changes nothing
  expect(migrateAttach(doc), `${label} migrateAttach is a no-op`).toBe(doc)
}

describe("surface.ts (render 1.4.0 stand-in)", () => {
  it("surfaceY is null off the footprint, ≥ 0 on it, ≤ the exposed height", () => {
    for (const h of [ROOT, ROCK, { ...ROOT, woodStyle: "log" as const }, { ...ROOT, woodStyle: "branchy" as const }]) {
      expect(surfaceY(h, h.x + h.sizeCm[0], h.z)).toBeNull()
      expect(surfaceY(h, Number.NaN, h.z)).toBeNull()
      for (let i = 0; i < 50; i++) {
        const x = h.x + ((i * 7) % 11 - 5) * 0.08 * h.sizeCm[0]
        const z = h.z + ((i * 3) % 7 - 3) * 0.1 * h.sizeCm[2]
        const y = surfaceY(h, x, z)
        if (y === null) expect(footprintContains(h, x, z, 0)).toBe(false)
        else {
          expect(footprintContains(h, x, z, 1e-6)).toBe(true)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(exposedHeight(h) + 1e-9)
        }
      }
    }
  })
  it("root wood is highest towards its lean side; auto leans towards the centre", () => {
    const left = { ...ROOT, leanSide: "left" as const }
    const right = { ...ROOT, leanSide: "right" as const }
    const dx = ROOT.sizeCm[0] * 0.3
    expect(surfaceY(left, ROOT.x - dx, ROOT.z)!).toBeGreaterThan(surfaceY(left, ROOT.x + dx, ROOT.z)!)
    expect(surfaceY(right, ROOT.x + dx, ROOT.z)!).toBeGreaterThan(surfaceY(right, ROOT.x - dx, ROOT.z)!)
    expect(leanSign({ x: -5 })).toBe(1) // x < 0 → right
    expect(leanSign({ x: 0 })).toBe(-1) // x ≥ 0 → left
    expect(leanSign({ x: 5, leanSide: "right" })).toBe(1)
  })
  it("anchors: [] for n ≤ 0; n spread, upward-facing points on the piece, sorted front-to-back, deterministic", () => {
    expect(anchors(ROOT, 0)).toEqual([])
    expect(anchors(ROOT, -3)).toEqual([])
    for (const h of [ROOT, ROCK, { ...ROOT, woodStyle: "log" as const }]) {
      const a = anchors(h, 8)
      expect(a).toHaveLength(8)
      expect(anchors(h, 8)).toEqual(a)
      for (const p of a) {
        expect(footprintContains(h, p.x, p.z, 0)).toBe(true)
        expect(p.ny).toBeGreaterThanOrEqual(0.35)
        expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 1)
        expect(p.y).toBeCloseTo(surfaceY(h, p.x, p.z)!, 0)
      }
      for (let i = 1; i < a.length; i++) expect(a[i - 1]!.z > a[i]!.z || (a[i - 1]!.z === a[i]!.z && a[i - 1]!.x <= a[i]!.x)).toBe(true)
      // spread out: no two anchors closer than 1 cm
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i]!.x - a[j]!.x, a[i]!.y - a[j]!.y, a[i]!.z - a[j]!.z)).toBeGreaterThan(1)
    }
  })
})

describe("canAttach (1.2.0)", () => {
  it("accepts botany epiphytes / mosses whose placement includes 'attached' only", () => {
    expect(canAttach("taxiphyllum-barbieri")).toBe(true)
    expect(canAttach("vesicularia-montagnei")).toBe(true)
    expect(canAttach("anubias-barteri-nana")).toBe(true)
    expect(canAttach("bucephalandra-sp-mini")).toBe(true)
    expect(canAttach("microsorum-pteropus")).toBe(true)
    expect(canAttach("hygrophila-pinnatifida")).toBe(false) // placement "attached" but growthForm rosette
    expect(canAttach("hemianthus-callitrichoides-cuba")).toBe(false)
    expect(canAttach("nope")).toBe(false)
    expect(attachableSpeciesIds().length).toBeGreaterThanOrEqual(20)
    for (const id of attachableSpeciesIds()) expect(canAttach(id)).toBe(true)
  })
})

describe("migrateAttach (1.2.0)", () => {
  it("attaches a y > 0 plant to the topmost piece whose footprint holds it; others are planted", () => {
    const d = doc0()
    d.hardscape.push({ id: "pebble", kind: "stone", role: "suteishi", x: 2, z: -2, rotationY: 0, sizeCm: [3, 2, 3], seed: 1 }) // under the trunk
    d.plants.push(
      { id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", x: 2, z: -2, y: 3, portions: 1 },
      { id: "anubias-barteri-nana-1", speciesId: "anubias-barteri-nana", x: 18, z: 6, y: 4, portions: 1 },
      { id: "anubias-barteri-nana-2", speciesId: "anubias-barteri-nana", x: 25, z: -10, y: 4, portions: 1 }, // off every piece
    )
    const m = migrateAttach(d)
    // the root wood's surface over (2, −2) is higher than the pebble's
    expect(surfaceY(ROOT, 2, -2)!).toBeGreaterThan(surfaceY(d.hardscape[2]!, 2, -2)!)
    expect(m.attach).toEqual({ "taxiphyllum-barbieri-1": "root", "anubias-barteri-nana-1": "rock" })
    expect(plant(m, "taxiphyllum-barbieri-1").y).toBeCloseTo(surfaceY(ROOT, 2, -2)!, 2)
    expect(plant(m, "anubias-barteri-nana-2").y).toBe(0)
    expect(migrateAttach(m)).toBe(m) // idempotent
    checkInvariants(m)
  })
  it("with an attach map: drops dangling entries, re-seats y, plants the rest; same doc when canonical", () => {
    const d = doc0()
    d.plants.push({ id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", x: -6, z: -2, y: 0, portions: 1 })
    d.plants.push({ id: "anubias-barteri-nana-1", speciesId: "anubias-barteri-nana", x: 18, z: 6, y: 4, portions: 1 }) // y > 0 but not listed
    d.attach = { "taxiphyllum-barbieri-1": "root", "ghost-1": "root", "hemianthus-callitrichoides-cuba-1": "nope" }
    const m = migrateAttach(d)
    expect(m.attach).toEqual({ "taxiphyllum-barbieri-1": "root" })
    expect(plant(m, "taxiphyllum-barbieri-1").y).toBeGreaterThan(0)
    expect(plant(m, "anubias-barteri-nana-1").y).toBe(0)
    expect(migrateAttach(m)).toBe(m)
    const plain = doc0()
    expect(migrateAttach(plain)).toBe(plain)
    expect("attach" in migrateAttach({ ...plain, attach: {} })).toBe(false)
  })
  it("is safe against prototype keys", () => {
    const d = doc0()
    d.plants.push({ id: "__proto__", speciesId: "taxiphyllum-barbieri", x: -6, z: -2, y: 0, portions: 1 })
    d.attach = JSON.parse('{"__proto__":"root"}') as Record<string, string>
    const m = migrateAttach(d)
    expect(Object.prototype.hasOwnProperty.call(m.attach, "__proto__")).toBe(true)
    expect(hostOf(m, "__proto__")).toBe("root")
    expect(hostOf(m, "toString")).toBeUndefined()
  })
  it("docFromTemplate output is canonical for every template and tank", () => {
    for (const t of TEMPLATES) for (const tank of [TANK, { widthCm: 90, depthCm: 45, heightCm: 45 }, { widthCm: 45, depthCm: 27, heightCm: 30 }]) {
      const d = docFromTemplate(instantiate(t, tank), tank, t.id)
      checkInvariants(d, `${t.id}@${tank.widthCm}`)
    }
  })
})

describe("attachPlant (1.2.0)", () => {
  it("x/z omitted: ties onto the first anchor not within 3 cm of an attached plant; id '<species>-<n>'; host stays selected", () => {
    const s0 = run(initEditor(doc0()), { type: "select", target: H("root") })
    const s1 = apply(s0, { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root" })
    const a = anchors(piece(s1, "root"), 8)
    const p1 = last(s1)
    expect(p1).toMatchObject({ id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", portions: 1, x: a[0]!.x, z: a[0]!.z })
    expect(p1.y).toBeCloseTo(a[0]!.y, 1)
    expect(s1.doc.attach).toEqual({ "taxiphyllum-barbieri-1": "root" })
    expect(s1.selected).toEqual(H("root"))
    expect(s1.past).toEqual([s0.doc])
    const s2 = apply(s1, { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root", portions: 3 })
    const p2 = last(s2)
    expect(p2.id).toBe("taxiphyllum-barbieri-2")
    expect(p2.portions).toBe(3)
    const firstFree = a.find((q) => Math.hypot(q.x - p1.x, q.y - p1.y, q.z - p1.z) >= ANCHOR_TAKEN_CM)!
    expect([p2.x, p2.z]).toEqual([firstFree.x, firstFree.z])
    checkInvariants(s2.doc)
  })
  it("falls back to anchor 0 when every anchor is taken", () => {
    let s = initEditor(doc0())
    for (let i = 0; i < 9; i++) s = apply(s, { type: "attachPlant", speciesId: "bucephalandra-sp-mini", hardscapeId: "rock" })
    const a0 = anchors(piece(s, "rock"), 8)[0]!
    expect(last(s)).toMatchObject({ x: a0.x, z: a0.z })
    expect(attachedTo(s.doc, "rock")).toHaveLength(9)
  })
  it("x/z given: must be on the footprint with a surface", () => {
    const s0 = initEditor(doc0())
    const s1 = apply(s0, { type: "attachPlant", speciesId: "anubias-barteri-nana", hardscapeId: "root", x: -10, z: -1 })
    expect(last(s1)).toMatchObject({ x: -10, z: -1 })
    expect(last(s1).y).toBeCloseTo(surfaceY(ROOT, -10, -1)!, 2)
    expect(apply(s0, { type: "attachPlant", speciesId: "anubias-barteri-nana", hardscapeId: "root", x: 20, z: 12 })).toBe(s0)
    expect(apply(s0, { type: "attachPlant", speciesId: "anubias-barteri-nana", hardscapeId: "root", x: Number.NaN, z: 0 })).toBe(s0)
  })
  it("is a no-op for non-attachable species, unknown pieces and at the 60-plant cap", () => {
    const s0 = initEditor(doc0())
    expect(apply(s0, { type: "attachPlant", speciesId: "hemianthus-callitrichoides-cuba", hardscapeId: "root" })).toBe(s0)
    expect(apply(s0, { type: "attachPlant", speciesId: "hygrophila-pinnatifida", hardscapeId: "root" })).toBe(s0)
    expect(apply(s0, { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "nope" })).toBe(s0)
    const full = doc0()
    full.plants = Array.from({ length: MAX_PLANTS }, (_, i) => ({ id: `hemianthus-callitrichoides-cuba-${i + 1}`, speciesId: "hemianthus-callitrichoides-cuba", x: -28 + (i % 10), z: 10 + Math.floor(i / 10) * 0.5, y: 0, portions: 1 }))
    const sf = initEditor(full)
    expect(apply(sf, { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root" })).toBe(sf)
  })
})

describe("attached plants move with / stay on their host (1.2.0)", () => {
  const tied = () => apply(apply(initEditor(doc0()), { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root" }), { type: "attachPlant", speciesId: "anubias-barteri-nana", hardscapeId: "rock" })

  it("a drag preview of an attached plant never leaves the host; nearest anchor where the surface misses", () => {
    const s0 = tied()
    let s = s0
    for (const [x, z] of [[25, 12], [-29, -14], [0, 14], [-6, -2]] as const) {
      s = editorReducer(s, { type: "preview", target: P("taxiphyllum-barbieri-1"), x, z })
      const p = plant(s, "taxiphyllum-barbieri-1")
      expect(hostOf(s.doc, p.id)).toBe("root")
      expect(footprintContains(piece(s, "root"), p.x, p.z, 0)).toBe(true)
      checkInvariants(s.doc)
    }
    s = run(s, { type: "commitPreview" })
    expect(s.past).toHaveLength(s0.past.length + 1)
  })
  it("move / rotate / resize carry exactly the host's attached plants and recompute y", () => {
    const s0 = tied()
    const moss0 = plant(s0, "taxiphyllum-barbieri-1")
    const anu0 = plant(s0, "anubias-barteri-nana-1")
    const s1 = apply(s0, { type: "move", target: H("root"), x: -4, z: 0 })
    expect(plant(s1, "taxiphyllum-barbieri-1")).toMatchObject({ x: moss0.x + 2, z: moss0.z + 2, y: moss0.y })
    expect(plant(s1, "anubias-barteri-nana-1")).toBe(anu0)
    const s2 = apply(s1, { type: "rotate", id: "root", dRad: 0.4 })
    checkInvariants(s2.doc)
    const s3 = apply(s2, { type: "resize", id: "root", scale: 0.9 })
    const r2 = piece(s2, "root")
    const r3 = piece(s3, "root")
    const m2 = plant(s2, "taxiphyllum-barbieri-1")
    const m3 = plant(s3, "taxiphyllum-barbieri-1")
    expect(m3.x - r3.x).toBeCloseTo((m2.x - r2.x) * 0.9, 6)
    expect(m3.z - r3.z).toBeCloseTo((m2.z - r2.z) * 0.9, 6)
    expect(m3.y).toBeLessThan(m2.y) // smaller piece, lower surface
    checkInvariants(s3.doc)
    expect(needsResim(s0.doc, s1.doc)).toBe(true) // a carried plant moved
  })
  it("removing a piece removes its attached plants in one history step; undo restores both", () => {
    const s0 = tied()
    const s1 = apply(s0, { type: "remove", target: H("root") })
    expect(s1.doc.plants.map((p) => p.id)).toEqual(["hemianthus-callitrichoides-cuba-1", "anubias-barteri-nana-1"])
    expect(s1.doc.attach).toEqual({ "anubias-barteri-nana-1": "rock" })
    expect(s1.past).toHaveLength(s0.past.length + 1)
    expect(run(s1, { type: "undo" }).doc).toBe(s0.doc)
  })
  it("removing an attached plant drops its attach entry", () => {
    const s1 = apply(tied(), { type: "remove", target: P("anubias-barteri-nana-1") })
    expect(s1.doc.attach).toEqual({ "taxiphyllum-barbieri-1": "root" })
    const s2 = apply(s1, { type: "remove", target: P("taxiphyllum-barbieri-1") })
    expect("attach" in s2.doc).toBe(false)
  })
})

describe("detachPlant (1.2.0)", () => {
  it("drops the plant onto the bed 2 cm in front of the host's front edge (y = 0), keeps x", () => {
    const s0 = apply(initEditor(doc0()), { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root" })
    const before = last(s0)
    const s1 = apply(s0, { type: "detachPlant", id: before.id })
    const root = piece(s1, "root")
    expect(plant(s1, before.id)).toMatchObject({ x: before.x, z: root.z + footprintHalfExtents(root).z + 2, y: 0 })
    expect(hostOf(s1.doc, before.id)).toBeUndefined()
    expect("attach" in s1.doc).toBe(false)
    expect(apply(s1, { type: "detachPlant", id: before.id })).toBe(s1) // not attached any more
    checkInvariants(s1.doc)
  })
  it("clamps the drop spot to the glass and is a no-op when a stone blocks it", () => {
    const d = doc0()
    d.hardscape = [{ id: "front", kind: "stone", x: 0, z: 9, rotationY: 0, sizeCm: [10, 6, 8], seed: 1 }]
    const s0 = apply(initEditor(d), { type: "attachPlant", speciesId: "anubias-barteri-nana", hardscapeId: "front", x: 0, z: 9 })
    const id = last(s0).id
    expect(detachSpot(s0.doc, piece(s0, "front"), last(s0)).z).toBe(14) // 9 + 4 + 2 = 15 → clamped to 14
    const blocker: HardscapeVisual = { id: "blocker", kind: "stone", x: 0, z: 13, rotationY: 0, sizeCm: [4, 3, 1], seed: 2 }
    const s1 = initEditor(migrateAttach({ ...s0.doc, hardscape: [...s0.doc.hardscape, blocker] }))
    expect(apply(s1, { type: "detachPlant", id })).toBe(s1)
    expect(apply(s1, { type: "detachPlant", id: "nope" })).toBe(s1)
  })
})

describe("setLeanSide (1.2.0)", () => {
  it("root wood only; same side (missing = auto) is a no-op; re-seats attached plants on anchors", () => {
    const d = doc0()
    d.hardscape.push({ id: "log", kind: "wood", woodStyle: "log", x: 10, z: -10, rotationY: 0, sizeCm: [12, 4, 5], seed: 3 })
    let s = initEditor(d)
    expect(apply(s, { type: "setLeanSide", id: "rock", leanSide: "left" })).toBe(s)
    expect(apply(s, { type: "setLeanSide", id: "log", leanSide: "left" })).toBe(s)
    expect(apply(s, { type: "setLeanSide", id: "root", leanSide: "auto" })).toBe(s)
    expect(apply(s, { type: "setLeanSide", id: "root", leanSide: "up" as "left" })).toBe(s)
    s = apply(s, { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root" })
    s = apply(s, { type: "attachPlant", speciesId: "microsorum-pteropus", hardscapeId: "root" })
    // ROOT at x = −6: auto leans right; switch to left
    const s1 = apply(s, { type: "setLeanSide", id: "root", leanSide: "left" })
    expect(piece(s1, "root").leanSide).toBe("left")
    const list = anchors(piece(s1, "root"), 8)
    const seats = attachedTo(s1.doc, "root").map((id) => plant(s1, id))
    for (const p of seats) expect(list.some((a) => a.x === p.x && a.z === p.z)).toBe(true)
    expect(new Set(seats.map((p) => `${p.x},${p.z}`)).size).toBe(seats.length)
    checkInvariants(s1.doc)
    expect(apply(s1, { type: "setLeanSide", id: "root", leanSide: "left" })).toBe(s1)
    // leanSide is dropped when the piece stops being root wood
    expect(piece(apply(s1, { type: "setWoodStyle", id: "root", woodStyle: "log" }), "root").leanSide).toBeUndefined()
  })
})

describe("share links (1.2.0)", () => {
  /** Produced by the 1.1.0 encoder on main (c58e1b3) — must keep decoding. */
  const V110_LINK =
    "WzEsWzYwMCwzMDAsMzYwXSwibmF0dXJlLXRyaWFuZ2xlIixbMTgsOTddLFstNzEsMTk4XSxbInJvdGFsYS1yb3R1bmRpZm9saWEiLCJ0YXhpcGh5bGx1bS1iYXJiaWVyaSIsImJ1Y2VwaGFsYW5kcmEtc3AtbWluaSIsImFudWJpYXMtYmFydGVyaS1uYW5hIl0sW1sid29vZC1tYWluIiwxLC00OCwtNiwxMiwyODIsMjIzLDc4LDYwMSwwLC0xLDJdLFsic3RvbmUtYSIsMCwtMjEwLDYwLDMwLDcyLDc5LDY2LDYxMywxLDIwXV0sWzAsMCwyMDAsLTEwMCwyLDEsMCwtOTksNSwxMjAwMSwyLDAsLTIxMCw2MCw1MDAxLDMsMCwyMDAsODAsNDAwMV1d"
  const V110_DOC: ScapeDoc = {
    v: 1,
    tank: { widthCm: 60, depthCm: 30, heightCm: 36 },
    templateId: "nature-triangle",
    bed: { frontCm: 1.8, backCm: 9.7 },
    focalPoint: { x: -7.1, y: 19.8 },
    hardscape: [
      { id: "wood-main", kind: "wood", x: -4.8, z: -0.6, rotationY: 0.12, sizeCm: [28.2, 22.3, 7.8], seed: 601, woodStyle: "root" },
      { id: "stone-a", kind: "stone", x: -21, z: 6, rotationY: 0.3, sizeCm: [7.2, 7.9, 6.6], seed: 613, role: "oyaishi", buriedFrac: 0.2 },
    ],
    plants: [
      { id: "rotala-rotundifolia-1", speciesId: "rotala-rotundifolia", x: 20, z: -10, y: 0, portions: 2 },
      { id: "taxiphyllum-barbieri-1", speciesId: "taxiphyllum-barbieri", x: -9.9, z: 0.5, y: 12, portions: 1 },
      { id: "bucephalandra-sp-mini-1", speciesId: "bucephalandra-sp-mini", x: -21, z: 6, y: 5, portions: 1 },
      { id: "anubias-barteri-nana-1", speciesId: "anubias-barteri-nana", x: 20, z: 8, y: 4, portions: 1 },
    ],
  }

  it("decodes a 1.1.0 link and migrates it (epiphytes over a piece attached, the rest planted)", () => {
    const d = decodeScape(V110_LINK)!
    expect(d).toEqual(migrateAttach(V110_DOC))
    expect(d.attach).toEqual({ "taxiphyllum-barbieri-1": "wood-main", "bucephalandra-sp-mini-1": "stone-a" })
    expect(plant(d, "anubias-barteri-nana-1").y).toBe(0)
    checkInvariants(d)
  })
  it("a doc without attached plants or leanSide encodes exactly as 1.1.0 did", () => {
    const d = { ...V110_DOC, plants: V110_DOC.plants.map((p) => ({ ...p, y: 0 })) }
    const old = JSON.parse(atob(V110_LINK.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    const now = JSON.parse(atob(encodeScape(d).replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    expect(now).toHaveLength(8)
    expect(now.slice(0, 7)).toEqual(old.slice(0, 7))
  })
  it("carries attach and leanSide; round-trips to a canonical doc", () => {
    let s = initEditor(doc0())
    s = apply(s, { type: "setLeanSide", id: "root", leanSide: "left" })
    s = apply(s, { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root" })
    s = apply(s, { type: "attachPlant", speciesId: "bucephalandra-sp-mini", hardscapeId: "rock" })
    const back = decodeScape(encodeScape(s.doc))!
    expect(back.attach).toEqual(s.doc.attach)
    expect(piece(back, "root").leanSide).toBe("left")
    expect(back.plants.map((p) => [p.id, p.x, p.z])).toEqual(s.doc.plants.map((p) => [p.id, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]))
    checkInvariants(back)
    expect(encodeScape(back)).toBe(encodeScape(s.doc))
    for (const side of ["auto", "right"] as const) {
      const t = apply(s, { type: "setLeanSide", id: "root", leanSide: side })
      expect(piece(decodeScape(encodeScape(t.doc))!, "root").leanSide).toBe(side)
    }
  })
  it("rejects malformed attach / leanSide entries", () => {
    const s = apply(initEditor(doc0()), { type: "attachPlant", speciesId: "taxiphyllum-barbieri", hardscapeId: "root" })
    const raw = JSON.parse(atob(encodeScape(s.doc).replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const mut = (f: (c: unknown[]) => void) => {
      const c = JSON.parse(JSON.stringify(raw)) as unknown[]
      f(c)
      return decodeScape(enc(c))
    }
    expect(mut(() => {})).not.toBeNull()
    expect(mut((c) => (c[8] = [1]))).toBeNull() // odd length
    expect(mut((c) => (c[8] = [9, 0]))).toBeNull() // plant index out of range
    expect(mut((c) => (c[8] = [1, 7]))).toBeNull() // piece index out of range
    expect(mut((c) => (c[8] = [1, 0, 1, 1]))).toBeNull() // plant listed twice
    expect(mut((c) => (c[8] = ["1", 0]))).toBeNull()
    expect(mut((c) => c.push([]))).toBeNull() // 10 entries
    expect(mut((c) => ((c[6] as unknown[][])[0]!.push(2)))).not.toBeNull() // root + lean "left"
    expect(mut((c) => ((c[6] as unknown[][])[0]!.push(4)))).toBeNull()
    expect(mut((c) => ((c[6] as unknown[][])[1]!.push(1, 2)))).toBeNull() // stone
  })
  it("budget: 30 plants, 5 pieces, 8 attached encode to ≤ 2000 chars", () => {
    const longIds = attachableSpeciesIds().sort((a, b) => b.length - a.length)
    const plantedIds = ["alternanthera-reineckii-mini", "hygrophila-corymbosa-siamensis-53b", "micranthemum-tweediei-monte-carlo", "hemianthus-callitrichoides-cuba", "rotala-rotundifolia-blood-red"]
    const d: ScapeDoc = {
      v: 1,
      tank: { widthCm: 90, depthCm: 45, heightCm: 45 },
      templateId: "nature-triangle",
      bed: { frontCm: 2.48, backCm: 11.25 },
      focalPoint: { x: -14.37, y: 18.91 },
      hardscape: [
        { id: "wood-main", kind: "wood", woodStyle: "root", leanSide: "left", x: -8.13, z: -2.27, rotationY: 0.13, sizeCm: [40.5, 27.9, 10.8], seed: 601 },
        { id: "wood-2", kind: "wood", woodStyle: "log", x: 25.3, z: -12.1, rotationY: -0.41, sizeCm: [20.3, 6.1, 6.2], seed: 777 },
        { id: "stone-a", kind: "stone", role: "oyaishi", x: -31.5, z: 9.1, rotationY: 0.3, sizeCm: [10.8, 9.9, 9.9], seed: 613, buriedFrac: 0.2 },
        { id: "stone-b", kind: "stone", role: "fukuishi", x: 9.2, z: 10.8, rotationY: -0.4, sizeCm: [7.2, 5.4, 7.65], seed: 617, buriedFrac: 0.25 },
        { id: "stone-c", kind: "stone", role: "suteishi", x: 30.4, z: 14.6, rotationY: 1.1, sizeCm: [5.1, 3.3, 4.4], seed: 619, buriedFrac: 0.35 },
      ],
      plants: Array.from({ length: 22 }, (_, i) => {
        const sid = plantedIds[i % plantedIds.length]!
        return { id: `${sid}-${Math.floor(i / plantedIds.length) + 1}`, speciesId: sid, x: -43.21 + i * 3.913, z: 18.07 + (i % 3) * 1.37, y: 0, portions: 1 + (i % 4) }
      }),
    }
    let s = initEditor(d)
    const hosts = ["wood-main", "wood-main", "wood-main", "wood-2", "wood-2", "stone-a", "stone-b", "stone-c"]
    hosts.forEach((h, i) => (s = apply(s, { type: "attachPlant", speciesId: longIds[i]!, hardscapeId: h, portions: 7 })))
    expect(s.doc.plants).toHaveLength(30)
    expect(Object.keys(s.doc.attach!)).toHaveLength(8)
    const link = encodeScape(s.doc)
    expect(link.length).toBeLessThanOrEqual(2000)
    expect(decodeScape(link)!.attach).toEqual(s.doc.attach)
  })
})

describe("invariants under random op sequences (seeded property test)", () => {
  /** mulberry32 */
  function prng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const ATTACHABLE = attachableSpeciesIds()
  const PLANTED = ["hemianthus-callitrichoides-cuba", "rotala-rotundifolia", "cryptocoryne-parva"]

  function randomAction(s: EditorState, r: () => number): EditorAction {
    const d = s.doc
    const pick = <T,>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined)
    const X = () => (r() - 0.5) * (d.tank.widthCm + 10)
    const Z = () => (r() - 0.5) * (d.tank.depthCm + 10)
    const h = pick(d.hardscape)
    const p = pick(d.plants)
    const attached = d.plants.filter((pp) => hostOf(d, pp.id) !== undefined)
    const k = Math.floor(r() * 17)
    switch (k) {
      case 0:
        return p ? { type: "apply", op: { type: "move", target: P(p.id), x: X(), z: Z() } } : { type: "undo" }
      case 1: {
        const a = pick(attached)
        return a ? { type: "preview", target: P(a.id), x: X(), z: Z() } : { type: "commitPreview" }
      }
      case 2:
        return h ? { type: "apply", op: { type: "move", target: H(h.id), x: X(), z: Z() } } : { type: "redo" }
      case 3:
        return h ? { type: "preview", target: H(h.id), x: X(), z: Z() } : { type: "cancelPreview" }
      case 4:
        return h ? { type: "apply", op: { type: "rotate", id: h.id, dRad: (r() - 0.5) * 2 } } : { type: "undo" }
      case 5:
        return h ? { type: "apply", op: { type: "resize", id: h.id, scale: r() < 0.5 ? 0.9 : 1.1 + r() } } : { type: "undo" }
      case 6:
        return r() < 0.15 && h ? { type: "apply", op: { type: "remove", target: H(h.id) } } : p ? { type: "apply", op: { type: "remove", target: P(p.id) } } : { type: "undo" }
      case 7:
        return { type: "apply", op: { type: "addPlant", speciesId: pick(PLANTED)!, x: X(), z: Z() } }
      case 8:
        return { type: "apply", op: { type: "addHardscape", kind: r() < 0.5 ? "stone" : "wood", woodStyle: pick(["branchy", "root", "log"] as const), x: X(), z: Z() } }
      case 9:
        return h ? { type: "apply", op: { type: "setWoodStyle", id: h.id, woodStyle: pick(["branchy", "root", "log"] as const)! } } : { type: "undo" }
      case 10:
      case 11:
        return h
          ? { type: "apply", op: r() < 0.7
              ? { type: "attachPlant", speciesId: pick(ATTACHABLE)!, hardscapeId: h.id }
              : { type: "attachPlant", speciesId: pick(ATTACHABLE)!, hardscapeId: h.id, x: h.x + (r() - 0.5) * h.sizeCm[0], z: h.z + (r() - 0.5) * h.sizeCm[2] } }
          : { type: "undo" }
      case 12: {
        const a = pick(attached)
        return a ? { type: "apply", op: { type: "detachPlant", id: a.id } } : { type: "redo" }
      }
      case 13:
        return h ? { type: "apply", op: { type: "setLeanSide", id: h.id, leanSide: pick(["auto", "left", "right"] as const)! } } : { type: "undo" }
      case 14:
        return { type: "commitPreview" }
      case 15:
        return r() < 0.5 ? { type: "undo" } : { type: "redo" }
      default:
        return { type: "select", target: h ? H(h.id) : null }
    }
  }

  const starts: [string, ScapeDoc][] = [
    ["doc0", doc0()],
    ...TEMPLATES.map((t): [string, ScapeDoc] => [t.id, docFromTemplate(instantiate(t, TANK), TANK, t.id)]),
  ]
  for (const [name, start] of starts) {
    it(`${name}: 4 seeds × 150 random ops keep every invariant`, () => {
      const applied = new Map<string, number>()
      for (let seed = 1; seed <= 4; seed++) {
        const r = prng(seed * 7919 + name.length)
        let s = initEditor(start)
        for (let i = 0; i < 150; i++) {
          const a = randomAction(s, r)
          const next = editorReducer(s, a)
          const label = `${name} seed ${seed} op ${i} ${JSON.stringify(a).slice(0, 120)}`
          checkInvariants(next.doc, label)
          if (next.previewBase) checkInvariants(next.previewBase, `${label} (previewBase)`)
          // a no-op never pushes history
          if (next === s) expect(next.past).toBe(s.past)
          else {
            const kind = a.type === "apply" ? a.op.type : a.type
            applied.set(kind, (applied.get(kind) ?? 0) + 1)
          }
          s = next
        }
        // the final doc survives a share link
        checkInvariants(decodeScape(encodeScape(s.doc))!, `${name} seed ${seed} decoded`)
      }
      // the sequences really exercise the 1.2.0 ops
      for (const kind of ["attachPlant", "detachPlant", "move", "preview", "rotate", "resize", "remove", "undo"]) expect(applied.get(kind) ?? 0, `${name}: ${kind}`).toBeGreaterThan(0)
    })
  }
})
