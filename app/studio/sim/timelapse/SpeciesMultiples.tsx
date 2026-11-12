"use client"

import type { SpeciesMeta } from "./derive"
import { fmtG, niceMax } from "./derive"
import { c } from "./tokens"

const ZONE_LABEL = { foreground: "前景", midground: "中景", background: "后景", floating: "浮水" } as const

interface Props {
  species: SpeciesMeta[]
  series: Map<string, number[]>
  days: number
  day: number
  selectedSpecies: string | null
  onSelect: (speciesId: string) => void
}

/** One panel per species, shared y-scale so panels compare honestly. */
export default function SpeciesMultiples({ species, series, days, day, selectedSpecies, onSelect }: Props) {
  const yMax = niceMax(Math.max(1, ...[...series.values()].flat()) * 1.05)
  const W = 300
  const H = 96
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {species.map((s) => {
        const data = series.get(s.id) ?? []
        const cur = Math.min(day, data.length - 1)
        const x = (d: number) => (d / days) * W
        const y = (g: number) => H - 2 - (g / yMax) * (H - 6)
        const line = data.map((g, d) => `${d ? "L" : "M"}${x(d).toFixed(1)},${y(g).toFixed(1)}`).join("")
        const area = data.length > 1 ? `${line}L${x(data.length - 1)},${H}L0,${H}Z` : ""
        const stroke = s.red ? c("coral") : c("green4")
        const fill = s.red ? c("coralSoft") : c("green1")
        const sel = s.id === selectedSpecies
        const start = data[0] ?? 0
        const now = data[cur] ?? 0
        const pct = start > 0 ? Math.round(((now - start) / start) * 100) : 0
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-pressed={sel}
            className="group flex flex-col rounded-[28px] p-5 text-left transition-shadow duration-200"
            style={{
              background: c("surface"),
              boxShadow: sel ? `inset 0 0 0 2px ${c("accent")}` : "none",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[17px] font-semibold tracking-tight">{s.zh}</p>
                <p className="truncate text-[13px]" style={{ color: c("muted") }}>
                  {s.en} · <i>{s.latin}</i>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[22px] font-semibold tracking-tight tl-num">
                  {fmtG(now)}
                  <span className="ml-0.5 text-[13px] font-medium" style={{ color: c("muted") }}>g</span>
                </p>
                <p className="text-[12px] font-medium tl-num" style={{ color: pct < 0 ? c("warn") : c("good") }}>
                  {pct >= 0 ? "+" : ""}
                  {pct}%
                </p>
              </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-[88px] w-full" preserveAspectRatio="none" aria-hidden>
              <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke={c("hairline")} />
              {area && <path d={area} fill={fill} fillOpacity="0.7" />}
              {data.length > 1 && (
                <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              )}
              {data.length > 0 && (
                <line x1={x(cur)} x2={x(cur)} y1="0" y2={H} stroke={c("text")} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            <p className="mt-3 text-[12px]" style={{ color: c("muted") }}>
              {ZONE_LABEL[s.zone]} · ×{s.qty}
              {s.substituteFor && <> · 替代 {s.substituteFor}</>}
            </p>
          </button>
        )
      })}
    </div>
  )
}
