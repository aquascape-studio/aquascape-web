/**
 * Pure mapping sim-core (SimInput + Frame) → @aquascape-studio/render
 * FrontalTank props. Both contracts share one coordinate system (origin at the
 * tank-floor centre, x left → right, z back → front, y up, cm), so positions
 * pass through unchanged.
 */
import type { BotanyRecordLike, FrontalTankProps, HardscapeVisual, PlantVisual, SpeciesLook } from "@aquascape-studio/render"
import type { Frame, SimInput, TankDims } from "./vendor/sim-core/contract"

export type SpeciesLookFn = (record: BotanyRecordLike) => SpeciesLook

export type FrontalData = Pick<FrontalTankProps, "tank" | "species" | "plants"> & { hardscape: HardscapeVisual[] }

/**
 * PlantVisual = placement {id, speciesId, x, z, y} + frame {heightCm, spreadCm, health},
 * matched by id. Placements with no frame entry, or whose species has no botany
 * record, are dropped (FrontalTank requires every speciesId in `species`).
 */
export function toFrontal(
  input: Pick<SimInput, "tank" | "plants">,
  frame: Pick<Frame, "plants"> | undefined,
  byId: ReadonlyMap<string, BotanyRecordLike>,
  look: SpeciesLookFn,
): FrontalData {
  const { widthCm, depthCm, heightCm } = input.tank
  const tank = { widthCm, depthCm, heightCm }
  const pf = new Map((frame?.plants ?? []).map((p) => [p.id, p]))
  const species: Record<string, SpeciesLook> = {}
  const plants: PlantVisual[] = []
  for (const p of input.plants) {
    const f = pf.get(p.id)
    if (!f) continue
    if (!(p.speciesId in species)) {
      const rec = byId.get(p.speciesId)
      if (!rec) continue
      species[p.speciesId] = look(rec)
    }
    plants.push({
      id: p.id,
      speciesId: p.speciesId,
      x: p.x,
      z: p.z,
      y: p.y,
      heightCm: f.heightCm,
      spreadCm: f.spreadCm,
      health: f.health,
    })
  }
  return { tank, species, plants, hardscape: defaultHardscape(tank) }
}

/**
 * Visual-only default hardscape (the sim input has none): three smooth stones
 * on the rule-of-thirds verticals at mid-depth — a main stone on the left third,
 * a smaller companion tucked beside it and a secondary stone on the right third.
 * Deterministic for a given tank.
 */
export function defaultHardscape(tank: TankDims): HardscapeVisual[] {
  const { widthCm: W, depthCm: D, heightCm: H } = tank
  const third = W / 3
  const left = -W / 2 + third
  const right = -W / 2 + 2 * third
  const zMid = -0.08 * D
  const stone = (id: string, x: number, z: number, rotationY: number, w: number, h: number, d: number, seed: number): HardscapeVisual => ({
    id,
    kind: "stone",
    x: r2(x),
    z: r2(z),
    rotationY,
    sizeCm: [r2(w), r2(h), r2(d)],
    seed,
  })
  const mainW = Math.min(W * 0.2, H * 0.55)
  const mainH = Math.min(H * 0.32, mainW * 0.85)
  const mainD = Math.min(D * 0.38, mainW * 0.8)
  return [
    stone("stone-main", left, zMid, 0.35, mainW, mainH, mainD, 11),
    stone("stone-companion", left + mainW * 0.62, zMid + D * 0.1, -0.5, mainW * 0.45, mainH * 0.42, mainD * 0.6, 23),
    stone("stone-secondary", right, zMid - D * 0.04, -0.2, mainW * 0.62, mainH * 0.6, mainD * 0.75, 37),
  ]
}

function r2(v: number): number {
  return Math.round(v * 100) / 100
}
