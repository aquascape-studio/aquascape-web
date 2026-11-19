/**
 * ScapeDoc → /studio/sim BuildResult (drag editor). Mirrors
 * buildTemplateInput(): tank and plants come from the doc; light / CO2 from
 * effectiveConditions() (editor 1.3.0): doc.conditions, else the doc's known
 * template, else the URL params exactly as buildInput() reads them. The sim
 * mapping (LIGHT_PAR / CO2_PPM) is buildInput's, unchanged.
 */
import type { HardscapeVisual } from "@aquascape-studio/render"
import { buildInput, hashSeed, type BotanyRecord, type BuildResult } from "../sim/buildInput"
import type { SimInput, TankDims } from "../sim/vendor/sim-core/contract"
import { getTemplate, type ScapeTemplate } from "../templates"
import type { InstantiatedTemplate } from "../templates/contract"
import type { ScapeDoc } from "./contract"
import { docFromTemplate, effectiveConditions, migrateAttach } from "./index"

type ParamSource = { get(key: string): string | null }

export interface DocBuild extends BuildResult {
  template: ScapeTemplate | undefined
}

/** FrontalTank's built-in bed when no `bed` prop is given (render tankGeom, 1.0.1 default). */
export function defaultBed(tank: TankDims): { frontCm: number; backCm: number } {
  const front = Math.min(4, Math.max(1.5, tank.heightCm * 0.08))
  const rise = Math.min(tank.depthCm * 0.2, tank.heightCm * 0.18)
  return { frontCm: r2(front), backCm: r2(front + rise) }
}

/**
 * Doc for the non-template page: the URL's plants on the default visual
 * hardscape. Epiphytes buildInput() lifts (y > 0) are tied onto the piece
 * under them, or planted when there is none (editor 1.2.0 migrateAttach).
 */
export function docFromInput(input: Pick<SimInput, "tank" | "plants">, hardscape: HardscapeVisual[]): ScapeDoc {
  const { widthCm, depthCm, heightCm } = input.tank
  const tank = { widthCm, depthCm, heightCm }
  return migrateAttach({
    v: 1,
    tank,
    bed: defaultBed(tank),
    hardscape: hardscape.map((h) => ({ ...h, sizeCm: [h.sizeCm[0], h.sizeCm[1], h.sizeCm[2]] })),
    plants: input.plants.map((p) => ({ ...p })),
  })
}

/**
 * Editor 1.3.0: the doc a pick in the template bar starts from — the
 * template's layout with conditions set to the template's { light, co2 }, so
 * the bar visibly drives the sim (and overrides conditions edited before).
 */
export function docFromTemplatePick(inst: InstantiatedTemplate, tank: TankDims, template: Pick<ScapeTemplate, "id" | "light" | "co2">): ScapeDoc {
  return { ...docFromTemplate(inst, tank, template.id), conditions: { light: template.light, co2: template.co2 } }
}

export function buildDocInput(doc: ScapeDoc, params: ParamSource, plants: readonly BotanyRecord[]): DocBuild {
  const template = doc.templateId !== undefined ? getTemplate(doc.templateId) : undefined
  const qty: Record<string, number> = {}
  for (const p of doc.plants) qty[p.speciesId] = (qty[p.speciesId] ?? 0) + p.portions

  const p = new URLSearchParams()
  p.set("w", String(doc.tank.widthCm))
  p.set("d", String(doc.tank.depthCm))
  p.set("h", String(doc.tank.heightCm))
  const name = params.get("name") ?? (template ? template.name : null)
  if (name !== null) p.set("name", name)
  const cond = effectiveConditions(doc, params)
  p.set("light", cond.light)
  if (cond.co2) p.set("co2", "true")
  // an empty doc still needs a valid plants param (buildInput falls back to its defaults otherwise)
  p.set("plants", JSON.stringify(qty))

  const built = buildInput(p, plants)
  const species = doc.plants.length ? built.input.species : {}
  const resolved = doc.plants.length ? built.resolved : []
  const input: SimInput = {
    ...built.input,
    tank: { ...doc.tank },
    plants: doc.plants.map((pp) => ({ ...pp })),
    species,
    // stable per scape, independent of plant positions: an edit changes only what it touches
    seed: hashSeed(JSON.stringify([doc.templateId ?? "scape", doc.tank])),
  }
  return { ...built, input, resolved, unknown: [], template }
}

function r2(v: number): number {
  return Math.round(v * 100) / 100
}
