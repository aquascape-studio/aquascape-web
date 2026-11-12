import type { LimitingFactor, SimEventType } from "@/lib/sim/vendor/sim-core/contract"

export const FACTOR_LABEL: Record<LimitingFactor, { zh: string; en: string }> = {
  light: { zh: "光照", en: "Light" },
  co2: { zh: "CO₂", en: "CO₂" },
  temperature: { zh: "水温", en: "Temp" },
  pH: { zh: "pH", en: "pH" },
  gh: { zh: "GH", en: "GH" },
  kh: { zh: "KH", en: "KH" },
  no3: { zh: "硝酸盐", en: "NO₃" },
  po4: { zh: "磷酸盐", en: "PO₄" },
  k: { zh: "钾", en: "K" },
  fe: { zh: "铁", en: "Fe" },
  space: { zh: "空间", en: "Space" },
}

export const EVENT_LABEL: Record<SimEventType, { zh: string; en: string; warn: boolean }> = {
  shaded: { zh: "遮光", en: "Shaded", warn: true },
  overtaken: { zh: "被遮挡", en: "Overtaken", warn: false },
  deficiency: { zh: "缺肥", en: "Deficiency", warn: true },
  melt: { zh: "融叶", en: "Melt", warn: true },
  trimNeeded: { zh: "需修剪", en: "Trim needed", warn: false },
}

export const EVENT_ORDER: SimEventType[] = ["shaded", "overtaken", "deficiency", "melt", "trimNeeded"]

export const LIGHT_LABEL = { Low: "弱光 Low", Medium: "中光 Medium", High: "强光 High" } as const
