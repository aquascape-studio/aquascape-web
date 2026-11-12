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
} as const
