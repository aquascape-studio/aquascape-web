"use client"

/**
 * Style-template picker + composition-guide toggle (behind `flags.styleTemplates`).
 * Frosted control bar with capsule / segmented controls; selected template's
 * blurb in a card below.
 */
import { useId } from "react"
import { TEMPLATES, type GuideMode, type ScapeTemplate } from "@/lib/templates"
import { c } from "./tokens"

const GUIDE_LABEL: Record<GuideMode, { label: string; hint: string }> = {
  none: { label: "None", hint: "No guides" },
  thirds: { label: "Thirds", hint: "Rule of thirds" },
  golden: { label: "Golden", hint: "Golden ratio" },
}
const GUIDES: GuideMode[] = ["none", "thirds", "golden"]

/** "Iwagumi · Sanzon" → style in semibold, composition muted */
function TemplateName({ t, on }: { t: ScapeTemplate; on: boolean }) {
  const [style, comp] = t.name.split(" · ")
  return (
    <>
      <span className="text-[15px] font-semibold tracking-tight">{style}</span>
      {comp && (
        <span className="text-[15px] font-medium tracking-tight" style={{ color: on ? c("bg") : c("muted") }}>
          {comp}
        </span>
      )}
    </>
  )
}

export const PICKER_CSS = `
.tl-root .tl-bar {
  background: rgba(255,255,255,0.78);
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 10px 30px -16px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06);
}
.tl-root .tl-cap { transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease; }
.tl-root .tl-cap:hover:not([aria-checked="true"]) { background: rgba(0,0,0,0.05); }
/* sticky bar: sits below the 52 px frosted nav (never under it); focus never lands under nav + bar */
html:has(.tl-tplsticky) { scroll-padding-top: 132px; }
`

interface BarProps {
  selected: ScapeTemplate | undefined
  onPick: (id: string | null) => void
  guides: GuideMode
  onGuides: (g: GuideMode) => void
  /** guides only draw on the stylized tank */
  showGuides: boolean
  /**
   * Sticky under the 52 px nav (stylized-tank layout). On phones the bar then
   * holds only the template capsules (one compact row) and the guides control
   * sits below it in the page flow, so the stuck bar stays small.
   */
  sticky?: boolean | undefined
}

/**
 * Compact frosted control bar: template capsules (scrolls horizontally inside
 * the bar on narrow screens — never the page) + guides segmented control.
 */
export function TemplateBar({ selected, onPick, guides, onGuides, showGuides, sticky }: BarProps) {
  if (sticky) {
    return (
      <>
        <div className="tl-tplsticky sticky top-[52px] z-30 pt-2" data-testid="template-bar">
          <div className="tl-bar flex items-center justify-between gap-1 rounded-full p-1.5">
            <TemplateCapsules selected={selected} onPick={onPick} />
            {showGuides && <GuidesControl guides={guides} onGuides={onGuides} className="hidden lg:flex lg:pl-2" />}
          </div>
        </div>
        {showGuides && <GuidesControl guides={guides} onGuides={onGuides} className="flex justify-center pt-3 lg:hidden" />}
      </>
    )
  }
  return (
    <div className="tl-bar flex flex-col gap-1 rounded-[28px] p-1.5 lg:flex-row lg:items-center lg:justify-between lg:rounded-full">
      <div
        role="radiogroup"
        aria-label="Style template"
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
              <TemplateName t={t} on={on} />
            </button>
          )
        })}
      </div>

      {showGuides && (
        <div className="flex shrink-0 items-center gap-2 pl-3 lg:pl-2">
          <span id="tl-guides" className="whitespace-nowrap text-[12px] font-medium" style={{ color: c("muted") }}>
            Guides
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
                  aria-label={GUIDE_LABEL[g].hint}
                  title={GUIDE_LABEL[g].hint}
                  onClick={() => onGuides(g)}
                  className="tl-cap flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                  style={{
                    background: on ? c("bg") : "transparent",
                    color: on ? c("text") : c("ink2"),
                    boxShadow: on ? "0 1px 3px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  {GUIDE_LABEL[g].label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateCapsules({ selected, onPick }: Pick<BarProps, "selected" | "onPick">) {
  return (
    <div
      role="radiogroup"
      aria-label="Style template"
      className="-m-0.5 flex min-w-0 flex-1 gap-1 overflow-x-auto p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            <TemplateName t={t} on={on} />
          </button>
        )
      })}
    </div>
  )
}

function GuidesControl({ guides, onGuides, className }: Pick<BarProps, "guides" | "onGuides"> & { className: string }) {
  const id = useId()
  return (
    <div className={`shrink-0 items-center gap-2 ${className}`}>
      <span id={id} className="whitespace-nowrap text-[12px] font-medium" style={{ color: c("muted") }}>
        Guides
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex rounded-full p-[3px]" style={{ background: c("segTrack") }}>
        {GUIDES.map((g) => {
          const on = guides === g
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={GUIDE_LABEL[g].hint}
              title={GUIDE_LABEL[g].hint}
              onClick={() => onGuides(g)}
              className="tl-cap flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
              style={{
                background: on ? c("bg") : "transparent",
                color: on ? c("text") : c("ink2"),
                boxShadow: on ? "0 1px 3px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)" : "none",
              }}
            >
              {GUIDE_LABEL[g].label}
            </button>
          )
        })}
      </div>
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
            {selected ? selected.name : "Your own setup"}
          </h2>
          {selected && (
            <button
              type="button"
              onClick={() => onPick(null)}
              className="inline-flex min-h-11 items-center rounded-full text-[15px] font-medium hover:underline"
              style={{ color: c("accent") }}
            >
              Reset
            </button>
          )}
        </div>
        <div aria-live="polite" className="mt-2">
          {selected ? (
            <>
              <p className="text-[17px] leading-snug sm:text-[19px]">{selected.blurb}</p>
              <p className="mt-4 flex flex-wrap gap-2 text-[13px] font-medium">
                {[
                  `${selected.light} light`,
                  `CO₂ ${selected.co2 ? "on" : "off"}`,
                  selected.hardscape.length
                    ? `${selected.hardscape.length} hardscape piece${selected.hardscape.length === 1 ? "" : "s"}`
                    : "No hardscape",
                ].map((t) => (
                  <span key={t} className="rounded-full px-3 py-1" style={{ background: c("bg"), color: c("text") }}>{t}</span>
                ))}
              </p>
            </>
          ) : (
            <>
              <p className="text-[17px] leading-snug sm:text-[19px]">
                Pick a style above to re-lay plants and hardscape by its composition rules.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
