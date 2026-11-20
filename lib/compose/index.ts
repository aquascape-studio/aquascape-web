/**
 * One-sentence scape — implementation of compose contract v1.2.0
 * (lib/compose/contract.ts, orchestrator-owned).
 *
 *   const index = buildSpeciesIndex(plantsJson)
 *   const result = composeScape(parseIntent("60P iwagumi with a carpet, low tech", index), index)
 *   // → editor { type: "replace", doc: result.doc }
 *
 * Rule-based, fully in the browser; parse.ts recognises phrases, compose.ts
 * builds the doc from templates + editor ops.
 */
import { composeScapeImpl, chooseTemplate, resolveConditions } from "./compose"
import { conditionsLabel } from "../editor"
import { DEFAULT_PRESET, type ComposeResult, type ScapeIntent } from "./contract"
import { presetTank, tankLabel } from "./parse"
import type { SpeciesIndex } from "./species"

export { COMPOSE_CONTRACT_VERSION, DEFAULT_PRESET, TANK_PRESETS } from "./contract"
export type { ComposeResult, Feature, IntentSpan, ScapeIntent, SpanKind, Substitution } from "./contract"
export { buildSpeciesIndex, hasFeature, isRed, type SpeciesIndex, type SpeciesInfo } from "./species"
export { parseIntent, clampTank, presetTank, tankLabel, waterHeight, MAX_TEXT, STOP_WORDS } from "./parse"
export { chooseTemplate, resolveConditions, CO2_LIMITED_NOTE, MAX_NOTES, LOWTECH_TEMPLATE_ID } from "./compose"

/** 4–6 prompts shown when the input is empty; each parses with no unknown words */
export const EXAMPLE_PROMPTS: readonly string[] = [
  "60P iwagumi with a carpet, low tech",
  "nature scape with driftwood and moss in a 20 gallon long",
  "dutch 90x45x45 with red stems, high light, CO2",
  "low-light jungle with java fern and crypts, no CO2",
  "concave nature aquarium with spider wood in a 90P",
]

/** Never throws; always returns a doc that passes the editor invariants. */
export function composeScape(intent: ScapeIntent, index: SpeciesIndex, seed = 0): ComposeResult {
  try {
    return composeScapeImpl(intent, index, seed)
  } catch {
    // defensive: an empty intent is the contract's default scape
    return composeScapeImpl(
      { style: null, composition: null, tank: null, tankPreset: null, light: null, co2: null, hardscape: null, woodStyle: null, want: [], avoid: [], species: [], avoidSpecies: [], spans: [], unknown: [] },
      index,
      0,
    )
  }
}

/**
 * One-line summary for the dialog, e.g. "Iwagumi · Sanzon · 60 × 30 × 32 cm · Low light · No CO2":
 * the template the intent picks, the water-column dims, then the resolved
 * conditions (compose 1.1.0 — what the sim will run with).
 */
export function summarizeIntent(intent: ScapeIntent, seed = 0): string {
  const t = chooseTemplate(intent, seed)
  return [t.name, tankLabel(intent.tank ?? presetTank(DEFAULT_PRESET)!), conditionsLabel(resolveConditions(intent, t))].join(" · ")
}
