/**
 * One-sentence scape ("⌘K compose") — contract v1.0.0 (2026-11-18).
 *
 * OWNER: orchestrator only. Sub-agents MUST NOT edit this file; report
 * disagreements in the PR instead.
 *
 * The user presses ⌘K (Ctrl+K off macOS) on /studio/sim, types one English
 * sentence such as
 *     "60P iwagumi with a carpet, low tech"
 *     "nature scape with driftwood and moss in a 20 gallon long"
 *     "dutch 90x45x45 with red stems, high light, CO2"
 * and gets a complete ScapeDoc (editor contract ≥ 1.2.1), applied through
 * the editor as ONE undoable "replace" op. v1 is rule-based and runs fully in
 * the browser (no network, no LLM): parseIntent() → composeScape(). An LLM
 * front-end (P3 "AI features") may later produce the same ScapeIntent, so the
 * intent is the stable seam.
 *
 * Research (2026-11-18):
 *  - Prompt for broad-strokes generation, canvas for refinement; natural
 *    language is "just another input method" next to the canvas.
 *    https://resources.sticklight.com/blog/the-canvas-makes-a-comeback-why-2026-ai-design-trends-are-re-embracing-visual-control
 *    https://uxdesign.cc/beyond-conversations-natural-language-as-interaction-influencer-8b39ed123c39
 *  - No special prompt syntax; show what was understood (prompt as a form).
 *    https://theuxshop-project.pages.dev/tools/prompt-engineering-for-ux
 *  - Command palette: real command inventory first, Esc closes and restores
 *    the previous focus. https://open-design.ai/prompts/command-palette/
 *  - Tank presets: ADA Cube Garden 30-C 30×30×30, 45-P 45×27×30,
 *    60-P 60×30×36, 90-P 90×45×45 (https://aquasabi.com/ADA-Cube-Garden);
 *    US glass: 10 gal 20×10×12 in, 20 long 30×12×12 in, 29 gal 30×12×18 in,
 *    40 breeder 36×18×16 in (https://aquifarm.com/fish-tank-dimensions-chart/).
 *    120-P is omitted (sources disagree: 120×45×45 vs 120×50×50).
 */
import type { TankDims } from "../sim/vendor/sim-core/contract"
import type { WoodStyle } from "@aquascape-studio/render"
import type { ScapeStyle, Composition, LightLevel } from "../templates/contract"
import type { ScapeDoc } from "../editor/contract"

export const COMPOSE_CONTRACT_VERSION = "1.0.0" as const

/** Tank presets, cm (W × D × H water column = glass height − 4 cm, min 20). */
export const TANK_PRESETS: Readonly<Record<string, { label: string; glass: [number, number, number] }>> = {
  "30c": { label: "ADA 30-C", glass: [30, 30, 30] },
  "45p": { label: "ADA 45-P", glass: [45, 27, 30] },
  "60p": { label: "ADA 60-P", glass: [60, 30, 36] },
  "90p": { label: "ADA 90-P", glass: [90, 45, 45] },
  "10g": { label: "10 gallon", glass: [50.8, 25.4, 30.5] },
  "20l": { label: "20 gallon long", glass: [76.2, 30.5, 30.5] },
  "29g": { label: "29 gallon", glass: [76.2, 30.5, 45.7] },
  "40b": { label: "40 breeder", glass: [91.4, 45.7, 40.6] },
}
/** Used when the sentence names no tank: ADA 60-P. */
export const DEFAULT_PRESET = "60p" as const

export type SpanKind = "style" | "composition" | "tank" | "light" | "co2" | "hardscape" | "species" | "feature" | "negation"

/** A piece of the sentence that was understood — rendered as a chip. */
export interface IntentSpan {
  /** UTF-16 offsets into the original text, end exclusive */
  start: number
  end: number
  kind: SpanKind
  /** short English label for the chip, e.g. "Iwagumi", "60 × 30 × 32 cm", "Low light" */
  label: string
}

/** Plant "features" a sentence can ask for (or exclude). */
export type Feature = "carpet" | "moss" | "epiphytes" | "red" | "stems" | "crypts" | "grass"

export interface ScapeIntent {
  /** null = not stated */
  style: ScapeStyle | null
  composition: Composition | null
  /** water-column dims (cm) after preset / unit conversion; null = not stated */
  tank: TankDims | null
  /** preset key if the tank came from one */
  tankPreset: string | null
  light: LightLevel | null
  /** true = "CO2", "high tech"; false = "no CO2", "low tech", "easy"; null = not stated */
  co2: boolean | null
  /** stated hardscape; "none" for "no hardscape" / "plants only" */
  hardscape: "stone" | "wood" | "both" | "none" | null
  woodStyle: WoodStyle | null
  /** features asked for / excluded ("no moss", "without carpet") */
  want: Feature[]
  avoid: Feature[]
  /** botany ids named explicitly (scientific or English common name, case-insensitive, longest match) */
  species: string[]
  /** botany ids explicitly excluded ("no monte carlo") */
  avoidSpecies: string[]
  spans: IntentSpan[]
  /** words (lower-case) that were not understood, excluding stop words */
  unknown: string[]
}

export interface Substitution {
  from: string
  to: string
  /** short English reason, e.g. "needs CO2", "needs high light", "regulated" */
  reason: string
}

export interface ComposeResult {
  doc: ScapeDoc
  /** template the doc was built from */
  templateId: string
  intent: ScapeIntent
  substitutions: Substitution[]
  /** ≤ 4 short English notes shown under the preview, e.g. "Tank size not given — using ADA 60-P." */
  notes: string[]
}

/**
 * Rules (normative, tested):
 *
 * parseIntent(text, index)
 *  - Pure, deterministic, never throws; text is trimmed and capped at 280
 *    chars. English only; case-insensitive; tolerant of punctuation.
 *  - Style keywords: iwagumi | nature / natural / nature aquarium / jungle →
 *    "nature" | dutch. Composition: triangle / triangular, concave / u-shape /
 *    valley, convex / mound / island, streets (Dutch), sanzon / three stones →
 *    "iwagumi".
 *  - Tank: preset keys and spellings ("60p", "60-p", "60 p", "ada 60p",
 *    "30c", "10 gal", "10 gallon", "20 long", "20l", "29 gallon", "40 breeder");
 *    explicit "W×D×H" with x / × / * and optional cm / in / "; a lone length
 *    "60 cm" → W = 60, D = round(W/2), H glass = round(0.6·W) (clamped 25–60).
 *    Inches convert at 2.54. Water column H = glass − 4 cm (min 20). Final
 *    dims clamped to W 20–180, D 15–75, H 20–70.
 *  - Light: low / medium / high light (also "low-light", "bright" → High,
 *    "dim" → Low). co2: "co2" / "co₂" / "pressurized" / "high tech" → true;
 *    "no co2" / "without co2" / "low tech" / "easy" / "beginner" → false
 *    ("easy" / "beginner" also imply light Low when light is unstated).
 *  - Hardscape: stone(s) / rock(s) / seiryu / dragon stone → stone;
 *    wood / driftwood / branch → wood (+ "spider wood" → branchy, "root" /
 *    "tree" → root, "log" → log); both → "both"; "no hardscape" /
 *    "plants only" → "none".
 *  - Negation: "no X", "without X", "not X", "skip X" negates the next
 *    feature / species / co2 phrase only.
 *  - Spans never overlap; each understood phrase yields exactly one span.
 *
 * composeScape(intent, index, seed = 0)
 *  - Pure, deterministic in (intent, seed); never throws; always returns a
 *    valid ScapeDoc that passes the editor invariants (decodeScape(
 *    encodeScape(doc)) round-trips; ≤ 60 plants; attach map valid).
 *  - Template choice: exact (style, composition) match → style match → by
 *    hardscape ("stone" → iwagumi-sanzon, "wood"/"both" → nature-triangle,
 *    "none" → dutch-streets) → "nature-triangle". `seed` picks among equally
 *    good matches (seed mod n).
 *  - Tank: intent.tank ?? preset DEFAULT_PRESET. Built with instantiate()
 *    (templates contract ≥ 1.1.0) + docFromTemplate().
 *  - Hardscape override: "none" removes all hardscape (and attached
 *    plants); "wood" on an iwagumi template keeps the stones and adds one
 *    root wood piece via the same rules as editor addHardscape; woodStyle
 *    sets every wood piece's style (setWoodStyle rules).
 *  - Species substitution, applied per placement group (same species →
 *    same substitute), substitutes chosen from the vendored botany index:
 *     · co2 === false: species whose envelope.co2.min ≥ 10 ppm OR difficulty ≥ 4
 *       → reason "needs CO2". (Botany 0.8: 66 species have min 0 and 27
 *       have min 5 — those grow without injection; 10+ means injected CO2.)
 *     · light "Low" (or co2 === false with light unstated): species whose
 *       envelope.light.min > 40 → "needs high
 *       light". (µmol/m²/s; 40 ≈ low-light ceiling used by the sim.)
 *     · avoid / avoidSpecies hits → "excluded".
 *     · species with non-empty `regulated` → never chosen (templates
 *       already avoid them).
 *    A substitute has the same growthForm, overlapping placement zone
 *    (foreground / midground / background / attached), passes the same
 *    filters, and is the closest by |maxHeightCm Δ| then id; if none
 *    exists the group is dropped and a note says so.
 *  - want: "carpet" ensures a foreground carpet group exists; "moss" /
 *    "epiphytes" ensure ≥ 1 attached group when there is wood or stone
 *    (otherwise a note); "red" swaps one stem group for a red stem
 *    (any colorRange entry matching /red|orange|pink|magenta|wine|copper|bronze|purple/
 *    — botany uses free-form tokens such as "red-high-light"); "crypts" / "grass" /
 *    "stems" ensure one group of that growthForm. Explicit `species` are
 *    added as one group each (attached if canAttach and a host exists)
 *    within the 60-plant cap.
 *  - SimInput-facing extras (light level, co2) are returned via the doc's
 *    existing fields only; v1 does not change sim parameters.
 *  - notes: max 4, most useful first (missing tank, dropped groups,
 *    unattachable moss, unknown words "Didn't understand: …").
 */

/**
 * Required exports (lib/compose/index.ts, implemented by app-agent):
 *   export interface SpeciesIndex — built once from the vendored plants.json
 *   export function buildSpeciesIndex(plants: readonly unknown[]): SpeciesIndex
 *   export function parseIntent(text: string, index: SpeciesIndex): ScapeIntent
 *   export function composeScape(intent: ScapeIntent, index: SpeciesIndex, seed?: number): ComposeResult
 *   export const EXAMPLE_PROMPTS: readonly string[]   // 4–6, each must compose without notes about unknown words
 *
 * UI (app/studio/sim, behind flag `commandPalette`, NEXT_PUBLIC_FF_COMMAND_PALETTE,
 * default OFF; only mounted when dragEditor && stylizedTank are also on):
 *  - ⌘K / Ctrl+K and a "⌘K Describe a scape" pill in the existing frosted
 *    toolbar open a centred frosted dialog (role="dialog", aria-modal, one
 *    input with role="combobox"). Esc / click outside closes and restores focus.
 *  - While typing (debounced 120 ms): understood spans as chips under the
 *    input (same pill style as the template bar, primary #0A6F78 tint) and a
 *    one-line summary ("Iwagumi · Sanzon · 60 × 30 × 32 cm · low tech").
 *  - Empty input shows EXAMPLE_PROMPTS as selectable rows (arrow keys + Enter).
 *  - Enter → composeScape → editor "replace" op (one undo step) → sim re-runs
 *    (needsResim). The dialog closes; a toast-like line above the timeline
 *    shows the notes / substitutions for 6 s with an "Undo" pill and a
 *    "Try another" pill (same intent, seed + 1).
 *  - Light Apple style: white, rgba(255,255,255,.78) + blur(20px)
 *    saturate(180%), 28 px radius, Inter, text #1D1D1F / #6E6E73; touch
 *    targets ≥ 44 px; contrast ≥ 4.5:1; respects prefers-reduced-motion
 *    (no scale animation); full-width sheet on phones (< 640 px).
 *  - Flag off → /studio/sim DOM identical to main.
 */
