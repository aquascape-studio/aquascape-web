"use client"

import type { CSSProperties } from "react"
import type { SimEvent } from "@/lib/sim/vendor/sim-core/contract"
import { EVENT_LABEL, EVENT_ORDER } from "./labels"
import { eventColor } from "./TotalChart"
import { c } from "./tokens"

const JUMPS = [10, 35, 60, 90]

interface Props {
  day: number
  days: number
  available: number
  playing: boolean
  computing: boolean
  total: number[]
  events: Map<number, SimEvent[]>
  onDay: (d: number) => void
  onTogglePlay: () => void
}

export default function ControlBar({ day, days, available, playing, computing, total, events, onDay, onTogglePlay }: Props) {
  const pct = (day / days) * 100
  const max = Math.max(1, ...total)
  const W = 400
  const H = 22
  const line = total.map((g, d) => `${d ? "L" : "M"}${((d / days) * W).toFixed(1)},${(H - (g / max) * (H - 2)).toFixed(1)}`).join("")
  const area = total.length > 1 ? `${line}L${((total.length - 1) / days) * W},${H}L0,${H}Z` : ""

  return (
    <div
      role="toolbar"
      aria-label="时间轴 Timeline"
      className="tl-glass mx-auto flex max-w-[760px] flex-wrap items-center gap-x-3 gap-y-1 rounded-[28px] px-3 py-2 sm:flex-nowrap sm:rounded-full sm:pl-2.5 sm:pr-2"
    >
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? "暂停 Pause" : "播放 Play"}
        aria-pressed={playing}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-95"
        style={{ background: c("text"), color: c("bg") }}
      >
        {playing ? (
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden>
            <rect x="1" y="1" width="4" height="14" rx="1.2" fill="currentColor" />
            <rect x="9" y="1" width="4" height="14" rx="1.2" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden>
            <path d="M2 1.8v12.4c0 .8.9 1.3 1.6.8l9.3-6.2c.6-.4.6-1.3 0-1.7L3.6 1C2.9.6 2 1 2 1.8z" fill="currentColor" />
          </svg>
        )}
      </button>

      <div className="w-[76px] shrink-0 leading-tight" aria-live="polite">
        <p className="text-[15px] font-semibold tracking-tight tl-num">第 {day} 天</p>
        <p className="text-[11px] tl-num" style={{ color: c("muted") }}>
          {computing ? `计算中 ${available}/${days}` : `Day ${day} / ${days}`}
        </p>
      </div>

      <div className="relative min-w-0 flex-1" style={{ ["--pct" as string]: `${pct}%` } as CSSProperties}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 h-[14px] w-full" aria-hidden>
          {area && <path d={area} fill={c("green1")} />}
          {total.length > 1 && <path d={line} fill="none" stroke={c("green3")} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />}
        </svg>
        <input
          type="range"
          min={0}
          max={days}
          step={1}
          value={day}
          onChange={(e) => onDay(Number(e.target.value))}
          className="tl-range relative"
          aria-label="模拟天数 Simulation day"
          aria-valuetext={`第 ${day} 天 Day ${day}`}
        />
        <div className="pointer-events-none absolute inset-x-[11px] bottom-[4px] h-[5px]" aria-hidden>
          {[...events.entries()].map(([d, evs]) => {
            const t = EVENT_ORDER.find((k) => EVENT_LABEL[k].warn && evs.some((e) => e.type === k)) ?? evs[0]!.type
            return (
              <span
                key={d}
                className="absolute top-0 h-[5px] w-[3px] rounded-full"
                style={{ left: `calc(${(d / days) * 100}% - 1.5px)`, background: eventColor(t) }}
              />
            )
          })}
        </div>
      </div>

      <div
        role="group"
        aria-label="快速跳转 Jump to day"
        className="flex w-full shrink-0 items-center justify-between rounded-full sm:w-auto"
        style={{ background: c("segTrack") }}
      >
        {JUMPS.map((d) => {
          const on = day === d
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDay(d)}
              aria-pressed={on}
              className="group flex h-11 min-w-[56px] flex-1 items-center justify-center px-[3px] sm:flex-none"
            >
              <span
                className="flex h-[36px] w-full items-center justify-center rounded-full px-3 text-[13px] font-medium tl-num transition-colors duration-150"
                style={{
                  background: on ? c("bg") : "transparent",
                  color: on ? c("text") : c("ink2"),
                  boxShadow: on ? "0 1px 3px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)" : "none",
                }}
              >
                {d} 天
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
