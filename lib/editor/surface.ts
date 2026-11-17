/**
 * Hardscape surface heights + attachment anchors for epiphytes (editor 1.2.0,
 * templates 1.1.0).
 *
 * 2026-11-17 (orchestrator): render 1.4.0 has landed — `surfaceY` / `anchors`
 * now delegate to the render exports, which match the rendered mesh to
 * ≤ 0.5 cm. The geometric approximation below is kept as `approxSurfaceY` /
 * `approxAnchors` for reference and tests only.
 *
 * (Original note) SWAP POINT: this was a local geometric APPROXIMATION of render 1.4.0
 * `hardscapeSurfaceY()` / `hardscapeAnchors()` (contract:
 * ../aquascape-render/src/contract.ts, 1.4.0 block), which are not exported
 * from render main yet. Every editor and template call site goes through this
 * file, so once render 1.4.0 is installed the orchestrator can replace the
 * two function bodies below with re-exports of the render functions
 * (`surfaceY = hardscapeSurfaceY`, `anchors = hardscapeAnchors`) in one place.
 *
 * Model: the piece's footprint ellipse (render 1.2.0: half-axes sizeCm[0]/2
 * along local x, sizeCm[2]/2 along local z, rotated by rotationY) times a
 * per-style / per-role height profile of the exposed height
 * sizeCm[1] · (1 − buriedFrac):
 *  - stones: a rounded dome, flatter-topped for the taller roles;
 *  - wood "log": a low lying cylinder along local x with rounded ends;
 *  - wood "branchy": a canopy that rises from the base towards the outer
 *    branches;
 *  - wood "root": a trunk that rises along world x towards its lean side
 *    (leanSide, "auto" = towards the tank centre), highest near the far end.
 * Same frame as PlantVisual.y (above the local bed surface).
 */
import type { HardscapeVisual, LeanSide, SurfaceAnchor } from "@aquascape-studio/render"
import { hardscapeAnchors, hardscapeSurfaceY } from "@aquascape-studio/render"

export type { SurfaceAnchor } from "@aquascape-studio/render"

export type SurfacePiece = Pick<HardscapeVisual, "kind" | "x" | "z" | "rotationY" | "sizeCm"> &
  Partial<Pick<HardscapeVisual, "role" | "woodStyle" | "leanSide" | "buriedFrac" | "seed">>

/** default buriedFrac (render 1.2.0 / 1.3.0): wood 0.05, suteishi 0.35, other stones 0.15 */
export function buriedFracOf(h: SurfacePiece): number {
  if (h.buriedFrac !== undefined && Number.isFinite(h.buriedFrac)) return Math.min(0.6, Math.max(0, h.buriedFrac))
  if (h.kind === "wood") return 0.05
  return h.role === "suteishi" ? 0.35 : 0.15
}

/** exposed height of the piece above the local bed surface */
export function exposedHeight(h: SurfacePiece): number {
  return Math.max(0, h.sizeCm[1] * (1 - buriedFracOf(h)))
}

/** resolved lean direction of root wood: +1 = top leans right (+x), −1 = left */
export function leanSign(h: Pick<HardscapeVisual, "x"> & { leanSide?: LeanSide | undefined }): 1 | -1 {
  const side = h.leanSide ?? "auto"
  if (side === "left") return -1
  if (side === "right") return 1
  // "auto": towards the tank centre (render 1.4.0: x < 0 → right, x ≥ 0 → left)
  return h.x < 0 ? 1 : -1
}

const STONE_EXP: Record<string, number> = { oyaishi: 0.3, fukuishi: 0.4, soeishi: 0.5, suteishi: 0.6 }

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * Height (cm) of the top surface of piece `h` at floor column (x, z), or null
 * when the column misses the piece (outside its footprint ellipse).
 * Signature and frame as render 1.4.0 `hardscapeSurfaceY(h, x, z)`.
 */
export function approxSurfaceY(h: SurfacePiece, x: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const a = h.sizeCm[0] / 2
  const b = h.sizeCm[2] / 2
  if (!(a > 0 && b > 0)) return null
  const dx = x - h.x
  const dz = z - h.z
  const c = Math.cos(h.rotationY)
  const s = Math.sin(h.rotationY)
  const u = (c * dx - s * dz) / a
  const v = (s * dx + c * dz) / b
  const r2 = u * u + v * v
  if (r2 > 1 + 1e-9) return null
  const r = Math.sqrt(Math.min(1, r2))
  const he = exposedHeight(h)
  let y: number
  if (h.kind === "stone") {
    y = he * Math.pow(Math.max(0, 1 - r2), STONE_EXP[h.role ?? ""] ?? 0.5)
  } else {
    switch (h.woodStyle ?? "branchy") {
      case "log": {
        // lying cylinder along local x, rounded ends
        y = he * Math.sqrt(Math.max(0, 1 - v * v)) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 6)))
        break
      }
      case "root": {
        // trunk rising along world x towards the lean side, crown near the far end
        const ext = Math.sqrt(a * a * c * c + b * b * s * s) || 1
        const t = Math.min(1, Math.max(-1, dx / ext))
        const along = (leanSign(h) * t + 1) / 2 // 0 at the root flare, 1 at the far (lean) side
        const rise = 0.18 + 0.82 * smoothstep(along / 0.8)
        y = he * rise * (1 - 0.3 * v * v) * Math.sqrt(Math.max(0, 1 - Math.pow(r, 8)))
        break
      }
      default: {
        // branchy canopy: low base, branches fanning up and outward
        y = he * (0.5 + 0.5 * Math.sqrt(r)) * Math.sqrt(Math.max(0, 1 - Math.pow(r, 6)))
      }
    }
  }
  return Math.max(0, y)
}

const NORMAL_STEP_CM = 0.25

/** approximate unit surface normal at (x, z) by central differences (one-sided at the rim) */
function surfaceNormal(h: SurfacePiece, x: number, z: number, y: number): { nx: number; ny: number; nz: number } {
  const e = NORMAL_STEP_CM
  const slope = (p: number | null, m: number | null): number => {
    if (p !== null && m !== null) return (p - m) / (2 * e)
    if (p !== null) return (p - y) / e
    if (m !== null) return (y - m) / e
    return 0
  }
  const gx = slope(approxSurfaceY(h, x + e, z), approxSurfaceY(h, x - e, z))
  const gz = slope(approxSurfaceY(h, x, z + e), approxSurfaceY(h, x, z - e))
  const n = Math.hypot(gx, 1, gz)
  return { nx: -gx / n, ny: 1 / n, nz: -gz / n }
}

const r2 = (v: number) => Math.round(v * 100) / 100 + 0

/**
 * n deterministic attachment points on the piece's upward-facing surface
 * (normal.y ≥ 0.35), spread out by farthest-point sampling with a bias to
 * higher points (upper trunk / shoulders), sorted front-to-back (+z first)
 * then left-to-right. Signature as render 1.4.0 `hardscapeAnchors(h, n)`.
 * Returns [] for n ≤ 0.
 */
export function approxAnchors(h: SurfacePiece, n: number): SurfaceAnchor[] {
  if (!(n > 0)) return []
  const count = Math.floor(n)
  const a = h.sizeCm[0] / 2
  const b = h.sizeCm[2] / 2
  if (!(a > 0 && b > 0)) return []
  const c = Math.cos(h.rotationY)
  const s = Math.sin(h.rotationY)
  const all: SurfaceAnchor[] = []
  const RINGS = 9
  const SPOKES = 18
  for (let i = 0; i <= RINGS; i++) {
    const rr = (i / RINGS) * 0.88
    const steps = i === 0 ? 1 : SPOKES
    for (let k = 0; k < steps; k++) {
      // odd rings are offset half a spoke so the grid does not line up radially
      const th = ((k + (i % 2) * 0.5) / steps) * 2 * Math.PI
      const lx = rr * Math.cos(th) * a
      const lz = rr * Math.sin(th) * b
      const x = h.x + lx * c + lz * s
      const z = h.z - lx * s + lz * c
      const y = approxSurfaceY(h, x, z)
      if (y === null || y <= 0) continue
      all.push({ x, z, y, ...surfaceNormal(h, x, z, y) })
    }
  }
  if (all.length === 0) return []
  const up = all.filter((p) => p.ny >= 0.35)
  // very steep pieces: fall back to the flattest points so a piece always offers a seat
  const pool = up.length > 0 ? up : [...all].sort((p, q) => q.ny - p.ny).slice(0, Math.max(1, count))
  const maxY = Math.max(...pool.map((p) => p.y)) || 1
  const picked: SurfaceAnchor[] = []
  const used = new Set<number>()
  // start at the highest point
  let first = 0
  pool.forEach((p, i) => {
    if (p.y > pool[first]!.y + 1e-9) first = i
  })
  picked.push(pool[first]!)
  used.add(first)
  const minD = pool.map((p) => Math.hypot(p.x - pool[first]!.x, p.y - pool[first]!.y, p.z - pool[first]!.z))
  while (picked.length < Math.min(count, pool.length)) {
    let best = -1
    let bestScore = -1
    pool.forEach((p, i) => {
      if (used.has(i)) return
      const score = minD[i]! * (0.6 + 0.4 * (p.y / maxY))
      if (score > bestScore + 1e-9) {
        bestScore = score
        best = i
      }
    })
    if (best < 0) break
    used.add(best)
    const q = pool[best]!
    picked.push(q)
    pool.forEach((p, i) => {
      minD[i] = Math.min(minD[i]!, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))
    })
  }
  return picked
    .map((p) => ({ x: r2(p.x), z: r2(p.z), y: r2(p.y), nx: r2(p.nx), ny: r2(p.ny), nz: r2(p.nz) }))
    .sort((p, q) => q.z - p.z || p.x - q.x)
}

/** a full render piece from the editor's structural subset (id is not part of the geometry) */
function asPiece(h: SurfacePiece): HardscapeVisual {
  return {
    id: "",
    kind: h.kind,
    x: h.x,
    z: h.z,
    rotationY: h.rotationY,
    sizeCm: h.sizeCm,
    seed: h.seed ?? 0,
    role: h.role,
    buriedFrac: h.buriedFrac,
    woodStyle: h.woodStyle,
    leanSide: h.leanSide,
  }
}

/** top-surface height at (x, z) — render 1.4.0 hardscapeSurfaceY */
export function surfaceY(h: SurfacePiece, x: number, z: number): number | null {
  return hardscapeSurfaceY(asPiece(h), x, z)
}

/** attachment anchors — render 1.4.0 hardscapeAnchors */
export function anchors(h: SurfacePiece, n: number): SurfaceAnchor[] {
  return hardscapeAnchors(asPiece(h), n)
}
