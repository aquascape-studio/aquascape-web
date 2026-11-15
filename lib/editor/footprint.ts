/**
 * Local copy of render 1.2.0 `footprintContains()` (contract:
 * ../aquascape-render/src/contract.ts). Render-agent is implementing it in
 * parallel; until a render release that exports it is installed, web uses
 * this identical helper so it never depends on unreleased code.
 *
 * Footprint = ellipse centred at (x, z) with half-axes sizeCm[0]/2 (local x)
 * and sizeCm[2]/2 (local z), rotated by rotationY about +y (three.js
 * convention), grown by `marginCm`.
 */
import type { HardscapeVisual } from "@aquascape-studio/render"

export type FootprintShape = Pick<HardscapeVisual, "x" | "z" | "rotationY" | "sizeCm">

/** Normalised elliptical distance: ≤ 1 inside the (grown) footprint. */
export function footprintDistance(h: FootprintShape, x: number, z: number, marginCm = 0): number {
  const dx = x - h.x
  const dz = z - h.z
  const c = Math.cos(h.rotationY)
  const s = Math.sin(h.rotationY)
  // world → local: inverse of Ry(θ) (local→world is x = lx·c + lz·s, z = −lx·s + lz·c)
  const lx = c * dx - s * dz
  const lz = s * dx + c * dz
  const a = Math.max(1e-6, h.sizeCm[0] / 2 + marginCm)
  const b = Math.max(1e-6, h.sizeCm[2] / 2 + marginCm)
  return (lx / a) ** 2 + (lz / b) ** 2
}

export function footprintContains(h: FootprintShape, x: number, z: number, marginCm = 0): boolean {
  return footprintDistance(h, x, z, marginCm) <= 1
}
