"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { flags } from "@/lib/flags"
import plantsJson from "@/lib/sim/vendor/plants.json"
import vendorInfo from "@/lib/sim/vendor/VENDOR.json"
import { buildInput, type BotanyRecord, type BuildResult } from "@/lib/sim/buildInput"
import { defaultHardscape } from "@/lib/sim/toFrontal"
import { parseGuidesParam, parseTemplateParam, type GuideMode, type InstantiatedTemplate } from "@/lib/templates"
import { buildTemplateInput } from "@/lib/templates/buildTemplateInput"
import { useGrowthSim } from "@/lib/sim/useGrowthSim"
import type { PlantFrame } from "@/lib/sim/vendor/sim-core/contract"
import { eventsByDay, fmtG, lowLightFraction, speciesMeta, speciesSeries, totalSeries, type SpeciesMeta } from "./derive"
import { EVENT_LABEL, EVENT_ORDER, FACTOR_LABEL, LIGHT_LABEL } from "./labels"
import { c } from "./tokens"
import TotalChart, { eventColor } from "./TotalChart"
import LightMap from "./LightMap"
import SpeciesMultiples from "./SpeciesMultiples"
import ControlBar from "./ControlBar"
import { PICKER_CSS, TemplateBar, TemplateNote } from "./TemplatePicker"

const PLANTS = plantsJson as unknown as BotanyRecord[]
const BY_ID = new Map(PLANTS.map((p) => [p.id, p]))
/** names the legacy UI used, for "替代 …" substitution notes */
const LEGACY_NAMES: Record<string, string> = {
  "java-fern": "Java Fern", "amazon-sword": "Amazon Sword", "hc-cuba": "HC Cuba",
  "vallisneria": "Vallisneria", "hornwort": "Hornwort", "water-wisteria": "Water Wisteria",
  "aponogeton-ulvaceus": "Aponogeton",
}
const PLAY_MS_PER_DAY = 110

/** Stylized 3D tank — only referenced (and its chunk only requested) when the flag is on. */
const FrontalHero = flags.stylizedTank ? dynamic(() => import("./FrontalHero"), { ssr: false }) : null

/** "rotala-rotundifolia#2" (legacy) or "rotala-rotundifolia-2" (templates) → "2" */
function instanceNo(id: string): string | undefined {
  return id.includes("#") ? id.split("#")[1] : id.slice(id.lastIndexOf("-") + 1)
}

function clampDay(raw: string | null, days: number): number {
  const n = raw === null ? NaN : Math.round(Number(raw))
  return Number.isFinite(n) ? Math.min(days, Math.max(0, n)) : 0
}

export default function TimelapseView() {
  const sp = useSearchParams()
  const router = useRouter()
  const baseQuery = useMemo(() => {
    const p = new URLSearchParams(sp.toString())
    p.delete("day")
    // guides are view-only — changing them must not re-run the simulation
    if (flags.styleTemplates) p.delete("guides")
    return p.toString()
  }, [sp])
  const template = flags.styleTemplates ? parseTemplateParam(new URLSearchParams(baseQuery).get("tpl")) : undefined
  const built: BuildResult & { scene?: InstantiatedTemplate } = useMemo(
    () => (template ? buildTemplateInput(template, new URLSearchParams(baseQuery), PLANTS) : buildInput(new URLSearchParams(baseQuery), PLANTS)),
    [baseQuery, template],
  )
  const { input } = built
  const days = input.days
  const lowLightPar = input.lowLightPar ?? 30
  const sim = useGrowthSim(input, baseQuery)

  const [day, setDay] = useState(() => clampDay(sp.get("day"), days))
  const [playing, setPlaying] = useState(false)
  const species = useMemo(() => speciesMeta(built, BY_ID, LEGACY_NAMES), [built])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selId = selectedId && input.plants.some((p) => p.id === selectedId) ? selectedId : (input.plants[0]?.id ?? null)

  const frames = sim.frames
  const available = Math.max(0, frames.length - 1)
  const frame = frames[Math.min(day, available)]
  const total = useMemo(() => totalSeries(frames), [frames])
  const perSpecies = useMemo(() => speciesSeries(frames, species), [frames, species])
  const events = useMemo(() => eventsByDay(frames), [frames])
  // fixed colour scale for the whole run: brightest floor cell on day 0, never below 2× the low-light threshold
  const parMax = useMemo(() => {
    const f0 = frames[0]
    const m = f0 ? Math.max(...Array.from(f0.light.par)) : 0
    return Math.ceil(Math.max(m, lowLightPar * 2) / 10) * 10
  }, [frames, lowLightPar])
  const computing = sim.status === "running"

  // style templates (flag): ?tpl= picks the template, ?guides= the overlay
  const [guides, setGuides] = useState<GuideMode>(() => (flags.styleTemplates ? parseGuidesParam(sp.get("guides")) : "none"))
  const pickTemplate = useCallback(
    (id: string | null) => {
      const url = new URL(window.location.href)
      if (id) url.searchParams.set("tpl", id)
      else url.searchParams.delete("tpl")
      router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false })
    },
    [router],
  )
  const changeGuides = useCallback((g: GuideMode) => {
    setGuides(g)
    const url = new URL(window.location.href)
    if (g === "none") url.searchParams.delete("guides")
    else url.searchParams.set("guides", g)
    window.history.replaceState(window.history.state, "", url)
  }, [])
  const tankScene = useMemo(
    () =>
      flags.styleTemplates
        ? {
            hardscape: built.scene ? built.scene.hardscape : defaultHardscape(input.tank),
            bed: built.scene?.bed,
            focalPoint: built.scene?.focalPoint,
            guides,
          }
        : undefined,
    [built, input.tank, guides],
  )
  const tplBar = flags.styleTemplates ? (
    <TemplateBar selected={template} onPick={pickTemplate} guides={guides} onGuides={changeGuides} showGuides={!!FrontalHero} />
  ) : null
  const tplNote = flags.styleTemplates ? <TemplateNote selected={template} onPick={pickTemplate} /> : null

  // playback
  const dayRef = useRef(day)
  dayRef.current = day
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const next = dayRef.current + 1
      if (next > days) {
        setPlaying(false)
        return
      }
      if (next <= available) setDay(next)
    }, PLAY_MS_PER_DAY)
    return () => window.clearInterval(id)
  }, [playing, days, available])

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && dayRef.current >= days) setDay(0)
      return !p
    })
  }, [days])

  const seek = useCallback((d: number) => {
    setPlaying(false)
    setDay(Math.min(days, Math.max(0, d)))
  }, [days])

  // keep ?day= in the URL (for sharing / screenshots) without re-rendering via the router
  useEffect(() => {
    if (playing) return
    const t = window.setTimeout(() => {
      const url = new URL(window.location.href)
      if (url.searchParams.get("day") === String(day)) return
      url.searchParams.set("day", String(day))
      window.history.replaceState(window.history.state, "", url)
    }, 250)
    return () => window.clearTimeout(t)
  }, [day, playing])

  // keyboard: ←/→ step a day, Space play/pause, Home/End
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && (t as HTMLInputElement).type !== "range")) return
      const onRange = tag === "INPUT"
      const onButton = tag === "BUTTON" || tag === "A"
      if (e.key === " " && !onButton) {
        e.preventDefault()
        togglePlay()
      } else if (!onRange && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault()
        seek(dayRef.current + (e.key === "ArrowRight" ? 1 : -1))
      } else if (!onRange && (e.key === "Home" || e.key === "End")) {
        e.preventDefault()
        seek(e.key === "Home" ? 0 : days)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [togglePlay, seek, days])

  const selPlacement = input.plants.find((p) => p.id === selId)
  const selFrame = frame?.plants.find((p) => p.id === selId)
  const selSpecies = species.find((s) => selId !== null && s.instanceIds.includes(selId))
  const todaysEvents = frame?.events ?? []
  const lowFrac = lowLightFraction(frame, lowLightPar)
  const eventTotals = EVENT_ORDER.map((t) => ({ t, n: [...events.values()].flat().filter((e) => e.type === t).length }))
  const { tank } = input
  const breadcrumb = (
    <nav className="mb-8 flex items-center gap-2 text-[13px]" aria-label="Breadcrumb">
      <Link href="/studio" className="inline-flex min-h-11 items-center hover:underline" style={{ color: c("accent") }}>
        工作室 Studio
      </Link>
      <span style={{ color: c("muted") }}>/</span>
      <span className="truncate" style={{ color: c("muted") }}>{built.name}</span>
    </nav>
  )

  return (
    <main className="mx-auto max-w-[1080px] px-4 pb-10 sm:px-6">
      {FrontalHero && <div className="pt-4 [&>nav]:mb-0">{breadcrumb}</div>}
      {flags.styleTemplates && <style dangerouslySetInnerHTML={{ __html: PICKER_CSS }} />}
      {FrontalHero && tplBar && <div className="pt-2">{tplBar}</div>}
      {FrontalHero && (
        <StylizedTankHero tank={tank} day={day}>
          {(onReady) => <FrontalHero input={input} frame={frame} byId={BY_ID} onReady={onReady} scene={tankScene} />}
        </StylizedTankHero>
      )}
      {FrontalHero && tplNote}

      {/* hero */}
      <section className={FrontalHero ? "pb-14 pt-10 sm:pb-20 sm:pt-16" : "pb-14 pt-14 sm:pb-20 sm:pt-24"}>
        {!FrontalHero && breadcrumb}
        <p className="mb-4 text-[15px] font-semibold tracking-tight sm:text-[17px]" style={{ color: c("accent") }}>
          生长模拟 · Growth time-lapse
        </p>
        <h1 className="tl-h1 max-w-[16ch]">
          九十天，<br className="sm:hidden" />一眼看完。
        </h1>
        <p className="mt-6 max-w-[34em] text-[17px] leading-relaxed sm:text-[21px]" style={{ color: c("muted") }}>
          每一片叶子，都被单独计算。光照穿过水体与叶冠，养分被逐日分配。
          <span className="block text-[15px] sm:text-[17px]">Every leaf, computed on its own — 90 days of light, CO₂ and nutrients.</span>
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-2">
          {[
            `${tank.widthCm}×${tank.depthCm}×${tank.heightCm} cm`,
            `${LIGHT_LABEL[built.light]} · ${input.light.surfacePar} PAR`,
            `CO₂ ${built.co2 ? "开 On" : "关 Off"} · ${input.water.co2Ppm} ppm`,
            `${species.length} 种 · ${input.plants.length} 丛`,
          ].map((t) => (
            <span key={t} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium tl-num" style={{ background: c("surface"), color: c("text") }}>
              {t}
            </span>
          ))}
          <span className="mx-1 hidden h-5 w-px sm:inline-block" style={{ background: c("hairline") }} />
          <Link
            href={`/studio/scene?${baseQuery}`}
            className="inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-medium transition-colors duration-150 hover:[background:var(--tl-accentHover)]"
            style={{ background: c("accent"), color: c("bg") }}
          >
            3D 预览
          </Link>
          <Link
            href="/studio/new"
            className="inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium hover:underline"
            style={{ color: c("accent") }}
          >
            重新配置 ›
          </Link>
        </div>
        {built.unknown.length > 0 && (
          <p className="mt-4 text-[13px]" style={{ color: c("warn") }}>
            未识别的植物 Unknown plants: {built.unknown.join(", ")}
          </p>
        )}
      </section>

      {!FrontalHero && tplBar && <div className="pb-2">{tplBar}</div>}
      {!FrontalHero && tplNote && <div className="pb-14">{tplNote}</div>}

      {sim.status === "error" && (
        <div role="alert" className="mb-10 rounded-[28px] p-6" style={{ background: c("coralSoft") }}>
          <p className="font-semibold" style={{ color: c("warn") }}>模拟失败 Simulation failed</p>
          <p className="mt-1 text-sm" style={{ color: c("text") }}>{sim.error}</p>
        </div>
      )}

      {/* day readout + total */}
      <section aria-labelledby="tl-day" className="pb-16 sm:pb-24">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="tl-day" className="tl-h2 tl-num">
              第 {day} 天 <span style={{ color: c("muted") }}>· Day {day}</span>
            </h2>
            <p className="mt-3 text-[15px]" style={{ color: c("muted") }}>
              {computing ? `正在计算 Computing… ${available}/${days}` : `共 ${days} 天 · ${sim.elapsedMs !== null ? `${Math.round(sim.elapsedMs)} ms` : ""}`}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-6 sm:gap-10">
            <Metric label="总生物量" en="Biomass" value={`${fmtG(total[Math.min(day, available)] ?? 0)}`} unit="g" />
            <Metric
              label="缺光面积"
              en="Low light"
              value={`${Math.round(lowFrac * 100)}`}
              unit="%"
              tone={lowFrac > 0.25 ? "warn" : undefined}
            />
            <Metric label="当日事件" en="Events" value={`${todaysEvents.length}`} />
          </dl>
        </div>

        <div className="mt-10">
          <TotalChart total={total} days={days} day={day} events={events} species={species} onSeek={seek} />
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[12px]" style={{ color: c("muted") }}>
            {eventTotals.map(({ t, n }) => (
              <li key={t} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-1 rounded-full" style={{ background: eventColor(t) }} />
                <span style={{ color: c("text") }}>{EVENT_LABEL[t].zh}</span> {EVENT_LABEL[t].en}
                <span className="tl-num">×{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* light map + plant card */}
      <section aria-labelledby="tl-light" className="pb-16 sm:pb-24">
        <h2 id="tl-light" className="tl-h3">光，落在哪里。<span style={{ color: c("muted") }}> Where the light lands.</span></h2>
        <p className="mt-2 max-w-[40em] text-[15px]" style={{ color: c("muted") }}>
          俯视水底的 PAR 分布，已计入水深衰减与叶冠遮挡。点选植株查看限制因子。
        </p>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-[28px] p-4 sm:p-6" style={{ background: c("surface") }}>
            <LightMap
              frame={frame}
              tank={tank}
              placements={input.plants}
              species={species}
              lowLightPar={lowLightPar}
              parMax={parMax}
              selectedId={selId}
              onSelect={setSelectedId}
            />
          </div>
          <PlantCard meta={selSpecies} pf={selFrame} y={selPlacement?.y ?? 0} tankH={tank.heightCm} lowLightPar={lowLightPar} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="选择植株 Select plant">
          {input.plants.map((p) => {
            const s = species.find((m) => m.instanceIds.includes(p.id))
            const on = p.id === selId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-pressed={on}
                className="min-h-11 rounded-full px-4 text-[13px] font-medium tl-num transition-colors duration-150"
                style={{
                  background: on ? c("text") : c("surface"),
                  color: on ? c("bg") : c("text"),
                }}
              >
                {s?.zh ?? p.speciesId} <span style={{ opacity: 0.6 }}>#{instanceNo(p.id)}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* species */}
      <section aria-labelledby="tl-species" className="pb-16 sm:pb-20">
        <h2 id="tl-species" className="tl-h3">各物种生物量<span style={{ color: c("muted") }}> · Biomass by species</span></h2>
        <p className="mt-2 text-[15px]" style={{ color: c("muted") }}>共用纵轴，便于比较。Shared scale across panels.</p>
        <div className="mt-8">
          <SpeciesMultiples
            species={species}
            series={perSpecies}
            days={days}
            day={day}
            selectedSpecies={selSpecies?.id ?? null}
            onSelect={(sid) => {
              const first = species.find((s) => s.id === sid)?.instanceIds[0]
              if (first) setSelectedId(first)
            }}
          />
        </div>
      </section>

      <p className="pb-8 text-[12px]" style={{ color: c("muted") }}>
        引擎 Engine: @aquascape/sim-core {vendorInfo.simCore.commit.slice(0, 7)}
        {vendorInfo.simCore.placeholder && " · 占位模型 placeholder model (preview only)"} · 物种数据 botany {vendorInfo.plants.commit.slice(0, 7)}
        <span className="hidden sm:inline"> · 快捷键 ←/→ 逐日 · Space 播放 · Home/End</span>
      </p>

      <div className="sticky bottom-[max(16px,env(safe-area-inset-bottom))] z-30">
        <ControlBar
          day={day}
          days={days}
          available={available}
          playing={playing}
          computing={computing}
          total={total}
          events={events}
          onDay={seek}
          onTogglePlay={togglePlay}
        />
      </div>
    </main>
  )
}

/** Layout box for the stylized tank: full content width, tank aspect, white, no border; caption below. */
function StylizedTankHero({
  tank,
  day,
  children,
}: {
  tank: { widthCm: number; heightCm: number }
  day: number
  children: (onReady: () => void) => ReactNode
}) {
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  return (
    <figure className="-mx-4 pt-4 sm:mx-0 sm:pt-6" data-frontal-ready={ready ? "1" : "0"}>
      <div
        className="relative mx-auto w-full overflow-hidden sm:max-h-[62vh]"
        style={{
          aspectRatio: `${tank.widthCm} / ${tank.heightCm}`,
          background: c("bg"),
          // soften the renderer's floor shadow where the canvas edge would cut it off
          maskImage: "linear-gradient(to bottom, black 94%, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, black 94%, transparent)",
        }}
      >
        {children(onReady)}
      </div>
      <figcaption className="mt-3 px-4 text-center text-[13px] tl-num sm:px-0" style={{ color: c("muted") }}>
        第 {day} 天 · 风格化预览 (stylized preview)
      </figcaption>
    </figure>
  )
}

function Metric({ label, en, value, unit, tone }: { label: string; en: string; value: string; unit?: string; tone?: "warn" | undefined }) {
  return (
    <div>
      <dt className="text-[12px] font-medium" style={{ color: c("muted") }}>
        {label} <span className="hidden sm:inline">{en}</span>
      </dt>
      <dd className="mt-1 text-[28px] font-semibold tracking-tight tl-num sm:text-[34px]" style={{ color: tone === "warn" ? c("warn") : c("text") }}>
        {value}
        {unit && <span className="ml-0.5 text-[15px] font-medium" style={{ color: c("muted") }}>{unit}</span>}
      </dd>
    </div>
  )
}

function PlantCard({ meta, pf, y, tankH, lowLightPar }: { meta: SpeciesMeta | undefined; pf: PlantFrame | undefined; y: number; tankH: number; lowLightPar: number }) {
  if (!meta || !pf) {
    return <div className="rounded-[18px] p-5 text-sm" style={{ background: c("surface"), color: c("muted") }}>选择一株植物 Select a plant</div>
  }
  const healthPct = Math.round(pf.health * 100)
  const goodHealth = pf.health >= 0.6
  return (
    <aside
      aria-live="polite"
      className="tl-glass flex flex-col self-start rounded-[18px] p-5"
      style={{ background: c("glassCard") }}
    >
      <p className="text-[12px] font-medium tl-num" style={{ color: c("muted") }}>
        {pf.id.replace("#", " #")}
      </p>
      <p className="mt-1 text-[20px] font-semibold tracking-tight">
        {meta.zh} <span className="font-normal" style={{ color: c("muted") }}>·</span>{" "}
        <i className="text-[16px] font-normal">{meta.latin}</i>
      </p>
      {meta.substituteFor && (
        <p className="mt-1 text-[12px]" style={{ color: c("muted") }}>替代 Stand-in for {meta.substituteFor}</p>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
        <CardStat label="高度 Height" value={`${pf.heightCm.toFixed(1)}`} unit="cm" note={y + pf.heightCm > tankH * 0.85 ? "需修剪" : undefined} />
        <CardStat label="冠幅 Spread" value={`${pf.spreadCm.toFixed(1)}`} unit="cm" />
        <CardStat label="受光 PAR" value={`${Math.round(pf.parAtPlant)}`} warn={pf.parAtPlant < lowLightPar} />
        <CardStat label="生物量 Biomass" value={fmtG(pf.biomassG)} unit="g" />
      </dl>
      <div className="mt-5">
        <div className="flex items-baseline justify-between text-[12px] font-medium">
          <span style={{ color: c("muted") }}>健康度 Health</span>
          <span className="text-[15px] font-semibold tl-num" style={{ color: goodHealth ? c("good") : c("warn") }}>{healthPct}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: c("hairline") }}>
          <div className="h-full rounded-full" style={{ width: `${healthPct}%`, background: goodHealth ? c("good") : c("coral") }} />
        </div>
      </div>
      <div className="mt-5">
        <p className="text-[12px] font-medium" style={{ color: c("muted") }}>限制因子 Limiting factors</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pf.limiting.length === 0 ? (
            <span className="rounded-full px-3 py-1 text-[13px] font-medium" style={{ background: c("surface"), color: c("good") }}>
              无限制 Unconstrained
            </span>
          ) : (
            pf.limiting.map((f, i) => (
              <span
                key={f}
                className="rounded-full px-3 py-1 text-[13px] font-medium"
                style={
                  i === 0
                    ? { background: c("coralSoft"), color: c("warn") }
                    : { background: c("surface"), color: c("text") }
                }
              >
                {FACTOR_LABEL[f].zh}
                {FACTOR_LABEL[f].en !== FACTOR_LABEL[f].zh && <span style={{ opacity: 0.7 }}> {FACTOR_LABEL[f].en}</span>}
              </span>
            ))
          )}
        </div>
      </div>
    </aside>
  )
}

function CardStat({ label, value, unit, warn, note }: { label: string; value: string; unit?: string; warn?: boolean; note?: string | undefined }) {
  return (
    <div>
      <dt className="text-[12px] font-medium" style={{ color: c("muted") }}>{label}</dt>
      <dd className="mt-0.5 text-[22px] font-semibold tracking-tight tl-num" style={{ color: warn ? c("warn") : c("text") }}>
        {value}
        {unit && <span className="ml-0.5 text-[13px] font-medium" style={{ color: c("muted") }}>{unit}</span>}
        {note && <span className="ml-1.5 text-[12px] font-medium" style={{ color: c("warn") }}>{note}</span>}
      </dd>
    </div>
  )
}
