/**
 * Feature flags. NEXT_PUBLIC_* values are inlined at build time, so a flag
 * change needs a rebuild. All flags default to off.
 */
export function parseFlag(value: string | undefined): boolean {
  return value === "1" || value === "true"
}

export const flags = {
  /** /studio/sim growth time-lapse driven by @aquascape/sim-core */
  growthTimelapse: parseFlag(process.env.NEXT_PUBLIC_FF_GROWTH_TIMELAPSE),
  /** stylized front-view 3D tank (@aquascape-studio/render FrontalTank) on the time-lapse */
  stylizedTank: parseFlag(process.env.NEXT_PUBLIC_FF_STYLIZED_TANK),
  /** /studio/sim style template picker (?tpl=) + composition guides */
  styleTemplates: parseFlag(process.env.NEXT_PUBLIC_FF_STYLE_TEMPLATES),
  /** /studio/sim drag editor (lib/editor contract 1.1.0); requires stylizedTank */
  dragEditor: parseFlag(process.env.NEXT_PUBLIC_FF_DRAG_EDITOR),
  /** ⌘K one-sentence scape (lib/compose contract 1.0.0); requires dragEditor + stylizedTank */
  commandPalette: parseFlag(process.env.NEXT_PUBLIC_FF_COMMAND_PALETTE),
} as const
