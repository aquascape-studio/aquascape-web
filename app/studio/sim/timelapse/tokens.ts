/**
 * Growth time-lapse design tokens ("v3 · 超白玻璃"). The ONLY place colours for
 * this view are defined. Components use the CSS variables (`var(--tl-*)`),
 * exposed on the view root by `tokenVars`.
 */
import type { CSSProperties } from "react"

export const TOKENS = {
  bg: "#FFFFFF",
  text: "#1D1D1F",
  /** 5.07:1 on bg, 4.66:1 on surface */
  muted: "#6E6E73",
  /** for text on the segmented-control track (#EDEDF0) */
  ink2: "#3A3A3C",
  surface: "#F5F5F7",
  segTrack: "#EDEDF0",
  hairline: "rgba(0,0,0,0.08)",
  accent: "#0A6F78",
  accentHover: "#064C52",
  good: "#1D7A3E",
  /** warning / low-light text (5.16:1 on surface) */
  warn: "#B2441F",
  /** coral — fills only, never text */
  coral: "#FF7F50",
  coralSoft: "rgba(255,127,80,0.16)",
  glass: "rgba(255,255,255,0.82)",
  glassCard: "rgba(255,255,255,0.8)",
  /** frosted control bar (style-template picker) — use with blur(20px) saturate(180%) */
  glassBar: "rgba(255,255,255,0.78)",
  /** sequential light → dark green ramp (heatmap, biomass fills) */
  green0: "#F3FAF4",
  green1: "#CDEBD5",
  green2: "#8FD0A0",
  green3: "#3FAE62",
  green4: "#1D7A3E",
} as const

export type TokenName = keyof typeof TOKENS

export const tokenVars = Object.fromEntries(
  Object.entries(TOKENS).map(([k, v]) => [`--tl-${k}`, v]),
) as CSSProperties

export const v = (name: TokenName) => `var(--tl-${name})`

/** Ramp stops used by the heatmap (interpolated in JS, so raw values are needed). */
export const GREEN_RAMP = [TOKENS.green0, TOKENS.green1, TOKENS.green2, TOKENS.green3, TOKENS.green4] as const

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** t in 0..1 → colour along GREEN_RAMP */
export function rampColor(t: number): string {
  // cap at 75% of the ramp: the brightest floor reads as a fresh mid-green, not a heavy dark block
  const x = Math.min(1, Math.max(0, t)) * 0.75 * (GREEN_RAMP.length - 1)
  const i = Math.min(GREEN_RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = hexToRgb(GREEN_RAMP[i]!)
  const b = hexToRgb(GREEN_RAMP[i + 1]!)
  const c = a.map((av, k) => Math.round(av + (b[k]! - av) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** Raw token value — for SVG presentation attributes and canvas, where var() is not reliable. */
export const c = (name: TokenName): string => TOKENS[name]
