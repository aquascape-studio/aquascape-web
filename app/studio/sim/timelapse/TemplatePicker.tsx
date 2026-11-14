"use client"

/**
 * Style-template picker + composition-guide toggle (behind `flags.styleTemplates`).
 * Frosted control bar with capsule / segmented controls; selected template's
 * blurb in a card below.
 */
import { TEMPLATES, type GuideMode, type ScapeTemplate } from "@/lib/templates"
import { c } from "./tokens"

const GUIDE_LABEL: Record<GuideMode, { zh: string; en: string }> = {
  none: { zh: "无", en: "None" },
  thirds: { zh: "三分线", en: "Thirds" },
  golden: { zh: "黄金分割", en: "Golden" },
}
const GUIDES: GuideMode[] = ["none", "thirds", "golden"]
const LIGHT_ZH = { Low: "低光", Medium: "中光", High: "高光" } as const

export const PICKER_CSS = `
.tl-root .tl-bar {
  background: rgba(255,255,255,0.78);
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 10px 30px -16px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06);
}
.tl-root .tl-cap { transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease; }
.tl-root .tl-cap:hover:not([aria-checked="true"]) { background: rgba(0,0,0,0.05); }
`

interface BarProps {
  selected: ScapeTemplate | undefined
  onPick: (id: string | null) => void
  guides: GuideMode
  onGuides: (g: GuideMode) => void
  /** guides only draw on the stylized tank */
  showGuides: boolean
}

/**
 * Compact frosted control bar: template capsules (scrolls horizontally inside
 * the bar on narrow screens — never the page) + guides segmented control.
 */
export function TemplateBar({ selected, onPick, guides, onGuides, showGuides }: BarProps) {
  return (
    <div className="tl-bar flex flex-col gap-1 rounded-[28px] p-1.5 lg:flex-row lg:items-center lg:justify-between lg:rounded-full">
      <div
        role="radiogroup"
        aria-label="风格模板 Style template"
        className="-m-0.5 flex min-w-0 gap-1 overflow-x-auto p-0.5 lg:flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TEMPLATES.map((t) => {
          const on = selected?.id === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(t.id)}
              className="tl-cap flex min-h-11 shrink-0 items-baseline gap-1.5 whitespace-nowrap rounded-full px-4 py-2.5"
              style={{ background: on ? c("accent") : "transparent", color: on ? c("bg") : c("text") }}
            >
              <span className="text-[15px] font-semibold tracking-tight">{t.nameZh}</span>
              <span className="text-[13px] font-medium" style={{ color: on ? c("bg") : c("muted") }}>
                {/* style is already in the Chinese name; the full English name is in the note card */}
                {t.nameEn.split(" · ").pop()}
              </span>
            </button>
          )
        })}
      </div>

      {showGuides && (
        <div className="flex shrink-0 items-center gap-2 pl-3 lg:pl-2">
          <span id="tl-guides" className="whitespace-nowrap text-[12px] font-medium" style={{ color: c("muted") }}>
            构图线 Guides
          </span>
          <div role="radiogroup" aria-labelledby="tl-guides" className="flex flex-1 rounded-full p-[3px] lg:flex-none" style={{ background: c("segTrack") }}>
            {GUIDES.map((g) => {
              const on = guides === g
              return (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${GUIDE_LABEL[g].zh} ${GUIDE_LABEL[g].en}`}
                  title={GUIDE_LABEL[g].en}
                  onClick={() => onGuides(g)}
                  className="tl-cap flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                  style={{
                    background: on ? c("bg") : "transparent",
                    color: on ? c("text") : c("ink2"),
                    boxShadow: on ? "0 1px 3px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  {GUIDE_LABEL[g].zh}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** The selected template's story (or the "your own setup" note) + reset. */
export function TemplateNote({ selected, onPick }: Pick<BarProps, "selected" | "onPick">) {
  return (
    <section aria-labelledby="tl-tpl" className="pt-10 sm:pt-14">
      <div className="rounded-[28px] p-6 sm:p-8" style={{ background: c("surface") }}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="tl-tpl" className="tl-h3">
            {selected ? selected.nameZh : "自定配置"}
            <span style={{ color: c("muted") }}> {selected ? selected.nameEn : "Your own setup"}</span>
          </h2>
          {selected && (
            <button
              type="button"
              onClick={() => onPick(null)}
              className="inline-flex min-h-11 items-center rounded-full text-[15px] font-medium hover:underline"
              style={{ color: c("accent") }}
            >
              恢复默认 Reset
            </button>
          )}
        </div>
        <div aria-live="polite" className="mt-2">
          {selected ? (
            <>
              <p className="text-[17px] leading-snug sm:text-[19px]">{selected.blurbZh}</p>
              <p className="mt-1 text-[15px] leading-snug" style={{ color: c("muted") }}>{selected.blurbEn}</p>
              <p className="mt-4 flex flex-wrap gap-2 text-[13px] font-medium">
                {[
                  `${LIGHT_ZH[selected.light]} ${selected.light}`,
                  `CO₂ ${selected.co2 ? "开 On" : "关 Off"}`,
                  selected.hardscape.length ? `${selected.hardscape.length} 件硬景 Hardscape` : "无硬景 No hardscape",
                ].map((t) => (
                  <span key={t} className="rounded-full px-3 py-1" style={{ background: c("bg"), color: c("text") }}>{t}</span>
                ))}
              </p>
            </>
          ) : (
            <>
              <p className="text-[17px] leading-snug sm:text-[19px]">选一种风格，水草与硬景将按它的构图法则重新排布。</p>
              <p className="mt-1 text-[15px] leading-snug" style={{ color: c("muted") }}>
                Pick a style above to re-lay plants and hardscape by its composition rules.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
