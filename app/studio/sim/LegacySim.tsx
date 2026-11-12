"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useMemo, useState, Suspense } from "react"
import Link from "next/link"

const BG = "#0F2A20"
const BORDER = "#1E3A2E"
const TEXT = "#EDE7D9"
const MUTED = "#8FAF9A"
const ACCENT = "#3A6B50"

const PLANT_COLORS: Record<string, string> = {
  "java-moss":            "#5a8a3c",
  "java-fern":            "#3d6b3a",
  "anubias-barteri":      "#2f5d34",
  "amazon-sword":         "#4a8a3e",
  "rotala-rotundifolia":  "#d37a9a",
  "ludwigia-repens":      "#c0514a",
  "dwarf-hairgrass":      "#5ea03b",
  "monte-carlo":          "#8fc25a",
  "hc-cuba":              "#7ab840",
  "cryptocoryne-wendtii": "#9b9b2e",
  "vallisneria":          "#4e8c3a",
  "hornwort":             "#78b84a",
  "water-wisteria":       "#92b65a",
}

const PLANT_NAMES: Record<string, string> = {
  "java-moss":            "Java Moss",
  "java-fern":            "Java Fern",
  "anubias-barteri":      "Anubias",
  "amazon-sword":         "Amazon Sword",
  "rotala-rotundifolia":  "Rotala",
  "ludwigia-repens":      "Ludwigia",
  "dwarf-hairgrass":      "Dwarf Hairgrass",
  "monte-carlo":          "Monte Carlo",
  "hc-cuba":              "HC Cuba",
  "cryptocoryne-wendtii": "Cryptocoryne",
  "vallisneria":          "Vallisneria",
  "hornwort":             "Hornwort",
  "water-wisteria":       "Water Wisteria",
}

// Growth parameters per plant type
const GROWTH_PARAMS: Record<string, { rMax: number; kLight: number; kCO2: number; capacity: number }> = {
  "java-moss":            { rMax: 0.08, kLight: 0.2, kCO2: 0.0, capacity: 200 },
  "java-fern":            { rMax: 0.06, kLight: 0.2, kCO2: 0.0, capacity: 150 },
  "anubias-barteri":      { rMax: 0.05, kLight: 0.2, kCO2: 0.0, capacity: 180 },
  "amazon-sword":         { rMax: 0.10, kLight: 0.4, kCO2: 0.0, capacity: 250 },
  "rotala-rotundifolia":  { rMax: 0.18, kLight: 0.5, kCO2: 0.1, capacity: 300 },
  "ludwigia-repens":      { rMax: 0.15, kLight: 0.5, kCO2: 0.1, capacity: 280 },
  "dwarf-hairgrass":      { rMax: 0.20, kLight: 0.8, kCO2: 0.6, capacity: 350 },
  "monte-carlo":          { rMax: 0.22, kLight: 0.8, kCO2: 0.5, capacity: 320 },
  "hc-cuba":              { rMax: 0.25, kLight: 0.9, kCO2: 0.8, capacity: 300 },
  "cryptocoryne-wendtii": { rMax: 0.07, kLight: 0.2, kCO2: 0.0, capacity: 200 },
  "vallisneria":          { rMax: 0.14, kLight: 0.4, kCO2: 0.0, capacity: 350 },
  "hornwort":             { rMax: 0.16, kLight: 0.2, kCO2: 0.0, capacity: 280 },
  "water-wisteria":       { rMax: 0.14, kLight: 0.4, kCO2: 0.0, capacity: 260 },
}

type LightLevel = "Low" | "Medium" | "High"

const LIGHT_VAL: Record<LightLevel, number> = { Low: 0.25, Medium: 0.6, High: 1.0 }

function simulate(
  plantId: string,
  qty: number,
  days: number,
  light: LightLevel,
  co2: boolean,
): number[] {
  const p = GROWTH_PARAMS[plantId] ?? { rMax: 0.1, kLight: 0.4, kCO2: 0.0, capacity: 200 }
  const lv = LIGHT_VAL[light]
  const cv = co2 ? 1.0 : 0.0

  // Liebig minimum: growth limited by least available resource
  const lightFactor = Math.min(1, lv / Math.max(p.kLight, 0.01))
  const co2Factor = p.kCO2 > 0 ? Math.min(1, cv / p.kCO2) : 1.0
  const rEffective = p.rMax * Math.min(lightFactor, co2Factor)

  const biomass: number[] = []
  let b = qty * 5 // 5g per plant starting point
  for (let d = 0; d <= days; d++) {
    biomass.push(b)
    b = b + rEffective * b * (1 - b / (p.capacity * qty))
    b = Math.max(b, 0)
  }
  return biomass
}

// SVG line chart
function GrowthChart({
  series,
  days,
}: {
  series: { id: string; label: string; color: string; data: number[] }[]
  days: number
}) {
  const W = 600, H = 280
  const PAD = { top: 16, right: 16, bottom: 36, left: 48 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const maxVal = Math.max(...series.flatMap((s) => s.data), 1)

  function toX(i: number) { return PAD.left + (i / days) * cW }
  function toY(v: number) { return PAD.top + cH - (v / maxVal) * cH }

  function toPath(data: number[]) {
    return data
      .map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
      .join(" ")
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    v: t * maxVal,
    y: toY(t * maxVal),
    label: Math.round(t * maxVal) + "g",
  }))

  const xTicks = [0, Math.round(days / 4), Math.round(days / 2), Math.round((days * 3) / 4), days]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 300 }}>
      {/* Grid lines */}
      {yTicks.map(({ y, label }) => (
        <g key={label}>
          <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
            stroke="#1E3A2E" strokeWidth="1" strokeDasharray="4 3" />
          <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#8FAF9A">
            {label}
          </text>
        </g>
      ))}
      {/* X axis ticks */}
      {xTicks.map((d) => (
        <text key={d} x={toX(d)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8FAF9A">
          {d}d
        </text>
      ))}
      {/* Series */}
      {series.map((s) => (
        <path key={s.id} d={toPath(s.data)} fill="none" stroke={s.color} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {/* Axis lines */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + cH}
        stroke="#2D5A38" strokeWidth="1" />
      <line x1={PAD.left} y1={PAD.top + cH} x2={W - PAD.right} y2={PAD.top + cH}
        stroke="#2D5A38" strokeWidth="1" />
    </svg>
  )
}

function SimContent() {
  const searchParams = useSearchParams()
  const params = searchParams
  const router = useRouter()

  const name = params.get("name") ?? "My Aquascape"
  const initLight = (params.get("light") ?? "Medium") as LightLevel
  const initCo2 = params.get("co2") === "true"
  const plantsRaw = params.get("plants")
  const initPlants: Record<string, number> = plantsRaw
    ? JSON.parse(plantsRaw)
    : { "rotala-rotundifolia": 5, "java-fern": 2, "amazon-sword": 1 }

  const [days, setDays] = useState(30)
  const [light, setLight] = useState<LightLevel>(initLight)
  const [co2, setCo2] = useState(initCo2)

  const series = useMemo(() =>
    Object.entries(initPlants).map(([id, qty]) => ({
      id,
      label: PLANT_NAMES[id] ?? id,
      color: PLANT_COLORS[id] ?? "#8FAF9A",
      data: simulate(id, qty, days, light, co2),
    })),
    [days, light, co2] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const finalBiomass = series.reduce((sum, s) => sum + (s.data[s.data.length - 1] ?? 0), 0)

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/studio" className="text-sm hover:opacity-70" style={{ color: MUTED }}>← 工作室</Link>
        <span style={{ color: BORDER }}>/</span>
        <span className="text-sm" style={{ color: TEXT }}>{name}</span>
      </div>

      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold" style={{ color: TEXT }}>生长模拟</h1>
        <button
          onClick={() => router.push(`/studio/scene?${params.toString()}`)}
          className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
          style={{ backgroundColor: ACCENT, color: TEXT }}
        >
          🌿 3D 预览
        </button>
        <button
          onClick={() => router.push("/studio/new")}
          className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ backgroundColor: BORDER, color: MUTED }}
        >
          重新配置
        </button>
      </div>

      {/* Controls */}
      <div
        className="rounded-xl border p-5 mb-6 flex flex-wrap gap-5 items-center"
        style={{ backgroundColor: BG, borderColor: BORDER }}
      >
        {/* Horizon */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: MUTED }}>模拟天数</span>
          <div className="flex gap-2">
            {[7, 14, 30, 60, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
                style={{ backgroundColor: days === d ? ACCENT : BORDER, color: TEXT }}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>

        {/* Light */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: MUTED }}>光照</span>
          <div className="flex gap-2">
            {(["Low", "Medium", "High"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLight(l)}
                className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
                style={{ backgroundColor: light === l ? ACCENT : BORDER, color: TEXT }}
              >
                {l === "Low" ? "弱" : l === "Medium" ? "中" : "强"}
              </button>
            ))}
          </div>
        </div>

        {/* CO2 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: MUTED }}>CO₂</span>
          <button
            onClick={() => setCo2(!co2)}
            className="relative w-11 h-6 rounded-full transition-colors"
            style={{ backgroundColor: co2 ? ACCENT : BORDER }}
          >
            <span
              className="absolute top-1 w-4 h-4 rounded-full transition-all"
              style={{ backgroundColor: TEXT, left: co2 ? "calc(100% - 20px)" : "4px" }}
            />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div
        className="rounded-xl border p-5 mb-6"
        style={{ backgroundColor: BG, borderColor: BORDER }}
      >
        <p className="text-xs mb-3" style={{ color: MUTED }}>生物量 (g) · {days} 天</p>
        <GrowthChart series={series} days={days} />
      </div>

      {/* Legend + stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-5" style={{ backgroundColor: BG, borderColor: BORDER }}>
          <p className="text-xs mb-3" style={{ color: MUTED }}>植物图例</p>
          <div className="flex flex-col gap-2">
            {series.map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-sm" style={{ color: TEXT }}>{s.label}</span>
                </div>
                <span className="text-xs" style={{ color: MUTED }}>
                  {Math.round(s.data[s.data.length - 1] ?? 0)}g
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: BG, borderColor: BORDER }}>
          <p className="text-xs mb-3" style={{ color: MUTED }}>第 {days} 天统计</p>
          <div className="flex flex-col gap-3">
            <Stat label="总生物量" value={`${Math.round(finalBiomass)} g`} />
            <Stat label="植物种类" value={`${series.length} 种`} />
            <Stat label="光照" value={light === "Low" ? "弱光" : light === "Medium" ? "中光" : "强光"} />
            <Stat label="CO₂" value={co2 ? "开启" : "关闭"} />
          </div>
        </div>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm" style={{ color: MUTED }}>{label}</span>
      <span className="text-sm font-medium" style={{ color: TEXT }}>{value}</span>
    </div>
  )
}

export default function SimPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center" style={{ color: "#8FAF9A" }}>加载中…</div>}>
      <SimContent />
    </Suspense>
  )
}
