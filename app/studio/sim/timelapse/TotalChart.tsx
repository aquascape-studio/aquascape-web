"use client"

import { useEffect, useId, useRef, useState } from "react"
import type { SimEvent, SimEventType } from "@/lib/sim/vendor/sim-core/contract"
import { EVENT_LABEL, EVENT_ORDER } from "./labels"
import { fmtG, niceMax, type SpeciesMeta } from "./derive"
import { c } from "./tokens"

const PAD = { top: 16, right: 12, bottom: 30, left: 44 }
const LANE_H = 34

interface Props {
  total: number[]
  days: number
  day: number
  events: Map<number, SimEvent[]>
  species: SpeciesMeta[]
  onSeek: (day: number) => void
}

export function eventColor(t: SimEventType): string {
  return EVENT_LABEL[t].warn ? c("coral") : t === "trimNeeded" ? c("accent") : c("muted")
}

export default function TotalChart({ total, days, day, events, species, onSeek }: Props) {
  const gid = useId().replace(/:/g, "")
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  // viewBox follows the rendered width so text stays at its real px size
  const wrapRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(1000)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = W < 640 ? 200 : 260
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const yMax = niceMax(Math.max(1, ...total) * 1.08)
  const x = (d: number) => PAD.left + (d / days) * cW
  const y = (g: number) => PAD.top + cH - (g / yMax) * cH

  const line = total.map((g, d) => `${d ? "L" : "M"}${x(d).toFixed(1)},${y(g).toFixed(1)}`).join("")
  const area = total.length > 1 ? `${line}L${x(total.length - 1).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z` : ""
  const cur = Math.min(day, total.length - 1)

  const dayFromEvent = (clientX: number) => {
    const el = ref.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const vx = ((clientX - r.left) / r.width) * W
    return Math.round(Math.min(days, Math.max(0, ((vx - PAD.left) / cW) * days)))
  }

  const nameOf = (plantId: string) => {
    const s = species.find((sp) => sp.instanceIds.includes(plantId))
    return s ? `${s.zh} #${plantId.split("#")[1] ?? ""}` : plantId
  }

  const hd = hover ?? null
  const hEvents = hd !== null ? (events.get(hd) ?? []) : []
  const yTicks = [0, 0.5, 1].map((t) => t * yMax)

  return (
    <div ref={wrapRef} className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H + LANE_H}`}
        className="block w-full touch-none select-none"
        role="img"
        aria-label={`总生物量曲线 Total biomass, day 0–${days}. 第 ${cur} 天 ${fmtG(total[cur] ?? 0)} g`}
        onPointerMove={(e) => setHover(dayFromEvent(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => onSeek(dayFromEvent(e.clientX))}
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={c("green2")} stopOpacity="0.55" />
            <stop offset="100%" stopColor={c("green0")} stopOpacity="0.2" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={c("hairline")} strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill={c("muted")} className="tl-num">
              {Math.round(t)}g
            </text>
          </g>
        ))}
        {(W < 640 ? [0, 30, 60, 90] : [0, 15, 30, 45, 60, 75, 90]).filter((d) => d <= days).map((d) => (
          <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="12" fill={c("muted")} className="tl-num">
            {d === 0 ? "第 0 天" : d}
          </text>
        ))}
        {area && <path d={area} fill={`url(#g${gid})`} />}
        {total.length > 1 && <path d={line} fill="none" stroke={c("green4")} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

        {/* current day */}
        <line x1={x(cur)} x2={x(cur)} y1={PAD.top} y2={PAD.top + cH} stroke={c("text")} strokeWidth="1" />
        <line x1={x(cur)} x2={x(cur)} y1={H - 2} y2={H + LANE_H - 4} stroke={c("text")} strokeWidth="1" />
        {total[cur] !== undefined && (
          <circle cx={x(cur)} cy={y(total[cur]!)} r="5" fill={c("bg")} stroke={c("green4")} strokeWidth="2.5" />
        )}
        {hd !== null && hd !== cur && (
          <line x1={x(hd)} x2={x(hd)} y1={PAD.top} y2={PAD.top + cH} stroke={c("muted")} strokeWidth="1" strokeDasharray="3 3" />
        )}

        {/* event lane */}
        <line x1={PAD.left} x2={W - PAD.right} y1={H + LANE_H / 2 - 4} y2={H + LANE_H / 2 - 4} stroke={c("hairline")} />
        {[...events.entries()].map(([d, evs]) => {
          const types = EVENT_ORDER.filter((t) => evs.some((e) => e.type === t))
          return types.map((t, i) => (
            <rect
              key={`${d}-${t}`}
              x={x(d) - 2}
              y={H + 2 + i * 6}
              width="4"
              height="18"
              rx="2"
              fill={eventColor(t)}
            >
              <title>{`第 ${d} 天 · ${EVENT_LABEL[t].zh} ${EVENT_LABEL[t].en}`}</title>
            </rect>
          ))
        })}
      </svg>

      {hd !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-[150px] max-w-[240px] rounded-[14px] px-3 py-2 text-xs tl-glass"
          style={{ left: `${(x(hd) / W) * 100}%`, transform: `translateX(${hd > days * 0.7 ? "-105%" : "8px"})` }}
        >
          <p className="font-semibold tl-num">第 {hd} 天 · Day {hd}</p>
          <p className="tl-num" style={{ color: c("muted") }}>
            {total[hd] !== undefined ? `${fmtG(total[hd]!)} g 总生物量` : "计算中… computing"}
          </p>
          {hEvents.slice(0, 4).map((e, i) => (
            <p key={i} className="mt-1 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: eventColor(e.type) }} />
              <span>
                {EVENT_LABEL[e.type].zh} {EVENT_LABEL[e.type].en} · {nameOf(e.plantId)}
              </span>
            </p>
          ))}
          {hEvents.length > 4 && <p style={{ color: c("muted") }}>+{hEvents.length - 4} more</p>}
        </div>
      )}
    </div>
  )
}
