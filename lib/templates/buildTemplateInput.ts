/**
 * Template → /studio/sim BuildResult. Tank size, name and the other URL params
 * are read exactly as buildInput() does; light / CO₂ come from the template
 * and the plants from instantiate().
 */
import { buildInput, hashSeed, type BotanyRecord, type BuildResult } from "../sim/buildInput"
import { instantiate, type InstantiatedTemplate, type ScapeTemplate } from "./index"

type ParamSource = { get(key: string): string | null }

export interface TemplateBuild extends BuildResult {
  template: ScapeTemplate
  scene: InstantiatedTemplate
}

export function buildTemplateInput(t: ScapeTemplate, params: ParamSource, plants: readonly BotanyRecord[]): TemplateBuild {
  // first pass: tank dims only (template plants need them)
  const tank = buildInput(params, plants).input.tank
  const scene = instantiate(t, tank)

  const qty: Record<string, number> = {}
  for (const p of scene.plants) qty[p.speciesId] = (qty[p.speciesId] ?? 0) + p.portions

  const p = new URLSearchParams()
  for (const k of ["w", "d", "h"]) {
    const v = params.get(k)
    if (v !== null) p.set(k, v)
  }
  p.set("name", params.get("name") ?? `${t.nameZh} ${t.nameEn}`)
  p.set("light", t.light)
  if (t.co2) p.set("co2", "true")
  p.set("plants", JSON.stringify(qty))

  const built = buildInput(p, plants)
  const input = {
    ...built.input,
    plants: scene.plants,
    seed: hashSeed(JSON.stringify([t.id, built.input.tank])),
  }
  return { ...built, input, template: t, scene }
}
