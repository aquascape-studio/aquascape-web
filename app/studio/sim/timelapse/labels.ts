import type { LimitingFactor, SimEventType } from "@/lib/sim/vendor/sim-core/contract"

export const FACTOR_LABEL: Record<LimitingFactor, string> = {
  light: "Light",
  co2: "CO₂",
  temperature: "Temp",
  pH: "pH",
  gh: "GH",
  kh: "KH",
  no3: "NO₃",
  po4: "PO₄",
  k: "K",
  fe: "Fe",
  space: "Space",
}

export const EVENT_LABEL: Record<SimEventType, { label: string; warn: boolean }> = {
  shaded: { label: "Shaded", warn: true },
  overtaken: { label: "Overtaken", warn: false },
  deficiency: { label: "Deficiency", warn: true },
  melt: { label: "Melt", warn: true },
  trimNeeded: { label: "Trim needed", warn: false },
}

export const EVENT_ORDER: SimEventType[] = ["shaded", "overtaken", "deficiency", "melt", "trimNeeded"]

export const LIGHT_LABEL = { Low: "Low light", Medium: "Medium light", High: "High light" } as const
