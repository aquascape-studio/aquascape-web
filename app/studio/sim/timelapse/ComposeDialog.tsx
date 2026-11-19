"use client"

/**
 * ⌘K "Describe a scape" dialog (lib/compose contract 1.0.0 UI). A centred
 * frosted-glass dialog (a full-width bottom sheet below 640 px) with one
 * combobox input. While typing (debounced 120 ms) the understood phrases show
 * as chips plus a one-line summary; an empty input lists EXAMPLE_PROMPTS
 * (↑ / ↓ + Enter). Enter builds the scape. Esc or a click outside closes and
 * gives focus back to where it was.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { EXAMPLE_PROMPTS, parseIntent, summarizeIntent, type ScapeIntent, type SpeciesIndex } from "@/lib/compose"
import { c } from "./tokens"

export const PARSE_DEBOUNCE_MS = 120

export const COMPOSE_DIALOG_CSS = `
/* scrim and panel are siblings: a translucent / animated ancestor would become the panel's backdrop root and stop the blur */
.tl-cmdk-scrim { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.12); animation: tl-cmdk-fade 160ms ease-out; }
.tl-cmdk-wrap {
  position: fixed; inset: 0; z-index: 61; pointer-events: none;
  display: flex; justify-content: center; align-items: flex-start; padding: 14vh 16px 16px;
}
.tl-cmdk-wrap > * { pointer-events: auto; }
.tl-cmdk textarea { resize: none; overflow: hidden; line-height: 1.3; padding: 9px 0; }
.tl-cmdk {
  width: min(640px, 100%); max-height: 72vh; display: flex; flex-direction: column; overflow: hidden;
  background: rgba(255,255,255,0.78);
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
  border-radius: 28px;
  box-shadow: 0 30px 80px -24px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
  font-family: var(--tl-font-latin), -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  color: ${c("text")};
  animation: tl-cmdk-in 180ms cubic-bezier(.2,.8,.2,1);
}
.tl-cmdk textarea::placeholder { color: ${c("muted")}; opacity: 1; }
.tl-cmdk textarea:focus { outline: none; }
.tl-cmdk .tl-cmdk-opt { transition: background-color 120ms ease; }
.tl-cmdk .tl-cmdk-opt[aria-selected="true"] { background: rgba(0,0,0,0.05); }
.tl-cmdk .tl-cmdk-opt:hover { background: rgba(0,0,0,0.05); }
.tl-cmdk .tl-cmdk-go { transition: background-color 150ms ease; }
.tl-cmdk .tl-cmdk-go:hover:not(:disabled) { background: ${c("accentHover")} !important; }
.tl-cmdk .tl-cmdk-go:disabled { opacity: 0.4; cursor: default; }
.tl-cmdk .tl-cmdk-x:hover { background: rgba(0,0,0,0.05); }
.tl-cmdk :focus-visible { outline: 2px solid ${c("accent")}; outline-offset: 2px; }
@keyframes tl-cmdk-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes tl-cmdk-in { from { opacity: 0; transform: scale(0.98) translateY(-4px) } to { opacity: 1; transform: none } }
@keyframes tl-cmdk-up { from { transform: translateY(24px); opacity: 0 } to { transform: none; opacity: 1 } }
@media (max-width: 639.98px) {
  /* phones: the sheet covers the editor chips behind it — a darker scrim and an opaque sheet,
     so nothing (e.g. the "Add" chips) bleeds through the frosted glass */
  .tl-cmdk-scrim { background: rgba(0,0,0,0.32); }
  .tl-cmdk-wrap { align-items: flex-end; padding: 0; }
  .tl-cmdk {
    background: ${c("bg")}; -webkit-backdrop-filter: none; backdrop-filter: none;
    width: 100%; max-height: 88vh; border-radius: 28px 28px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    animation-name: tl-cmdk-up;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tl-cmdk-scrim, .tl-cmdk { animation: tl-cmdk-fade 1ms linear !important; }
  .tl-cmdk .tl-cmdk-opt, .tl-cmdk .tl-cmdk-go { transition: none !important; }
}
`

export interface ComposeDialogProps {
  open: boolean
  index: SpeciesIndex
  onClose: () => void
  onSubmit: (text: string) => void
  /** shortcut hint; default "⌘K" on Apple platforms, else "Ctrl K" */
  shortcut?: string | undefined
}

const Sparkle = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d="M12 3.5l1.9 5.2 5.1 1.8-5.1 1.8L12 17.5l-1.9-5.2L5 10.5l5.1-1.8L12 3.5zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" fill="currentColor" />
  </svg>
)

export default function ComposeDialog({ open, index, onClose, onSubmit, shortcut: shortcutProp }: ComposeDialogProps) {
  // client-only component (next/dynamic, ssr: false): navigator is available
  const shortcut = shortcutProp ?? (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K")
  const uid = useId()
  const [text, setText] = useState("")
  const [intent, setIntent] = useState<ScapeIntent | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  // open: remember focus, reset, focus the input; close: give focus back
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setText("")
    setIntent(null)
    setActive(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(t)
      const el = restoreRef.current
      if (el && el.isConnected) el.focus({ preventScroll: true })
    }
  }, [open])

  // grow with the text (1–3 lines)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 3 * 1.3 * parseFloat(getComputedStyle(el).fontSize) + 18)}px`
  }, [text, open])

  // debounced parse
  useEffect(() => {
    if (!open) return
    const src = text.trim()
    if (!src) {
      setIntent(null)
      return
    }
    const t = window.setTimeout(() => setIntent(parseIntent(src, index)), PARSE_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [text, open, index])

  const showExamples = text.trim().length === 0
  const listId = `${uid}-examples`
  const optId = (i: number) => `${uid}-ex-${i}`
  const summary = useMemo(() => (intent ? summarizeIntent(intent) : ""), [intent])
  const src = text.trim()

  if (!open) return null

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    } else if (showExamples && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault()
      const n = EXAMPLE_PROMPTS.length
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (showExamples) onSubmit(EXAMPLE_PROMPTS[active]!)
      else onSubmit(src)
    }
  }
  // Esc from the close / build buttons; Tab cycles inside the modal dialog
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== "Tab") return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("textarea, button:not(:disabled)") ?? [])
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1
    e.preventDefault()
    items[next]!.focus()
  }

  return (
    <>
    <style dangerouslySetInnerHTML={{ __html: COMPOSE_DIALOG_CSS }} />
    <div className="tl-cmdk-scrim" data-testid="compose-backdrop" onMouseDown={onClose} aria-hidden="true" />
    <div
      className="tl-cmdk-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        className="tl-cmdk"
        data-compose-dialog=""
        data-testid="compose-dialog"
        onKeyDown={trapTab}
      >
        <h2 id={`${uid}-title`} className="tl-sr">
          Describe a scape
        </h2>
        <div className="flex items-center gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <span style={{ color: c("accent") }}>
            <Sparkle />
          </span>
          {/* a one-line textarea that grows to 3 lines, so a long sentence stays readable on phones */}
          <textarea
            ref={inputRef}
            rows={1}
            role="combobox"
            aria-expanded={showExamples}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showExamples ? optId(active) : undefined}
            aria-describedby={`${uid}-summary`}
            aria-label="Describe a scape"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={280}
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, " "))}
            onKeyDown={onKeyDown}
            placeholder="Describe a scape in one sentence"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[17px] font-medium tracking-tight sm:text-[21px]"
            style={{ color: c("text") }}
            data-testid="compose-input"
          />
          <button
            type="button"
            onClick={onClose}
            className="tl-cmdk-x inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
            style={{ color: c("muted") }}
            aria-label="Close"
            title="Close (Esc)"
          >
            <span className="hidden rounded-md px-1.5 py-0.5 sm:inline" style={{ background: c("segTrack"), color: c("ink2") }} aria-hidden="true">
              esc
            </span>
            <svg className="sm:hidden" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        <div className="h-px" style={{ background: c("hairline") }} />

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {showExamples ? (
            <>
              <p className="px-3 pb-1.5 pt-1 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: c("muted") }} id={`${uid}-exlabel`}>
                Try
              </p>
              <ul role="listbox" id={listId} aria-labelledby={`${uid}-exlabel`} className="flex flex-col">
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <li
                    key={p}
                    id={optId(i)}
                    role="option"
                    aria-selected={i === active}
                    className="tl-cmdk-opt flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 text-[15px]"
                    style={{ color: c("text") }}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSubmit(p)}
                    data-testid="compose-example"
                  >
                    <span className="min-w-0 truncate">{p}</span>
                    <span className="shrink-0 text-[13px]" style={{ color: c("muted"), visibility: i === active ? "visible" : "hidden" }} aria-hidden="true">
                      ↵
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="px-2 pb-1 pt-1" aria-live="polite">
              <ul className="flex flex-wrap gap-1.5" aria-label="Understood" data-testid="compose-chips">
                {(intent?.spans ?? []).map((s) => (
                  <li
                    key={`${s.start}-${s.end}`}
                    className="inline-flex min-h-8 items-center rounded-full px-3 text-[13px] font-semibold"
                    style={{ background: "rgba(10,111,120,0.10)", color: c("accent") }}
                    title={src.slice(s.start, s.end)}
                  >
                    {s.label}
                  </li>
                ))}
                {intent && intent.spans.length === 0 && (
                  <li className="inline-flex min-h-8 items-center text-[13px]" style={{ color: c("muted") }}>
                    Nothing recognised yet — try a style, a tank size or a plant.
                  </li>
                )}
              </ul>
              <p id={`${uid}-summary`} className="mt-3 text-[14px] leading-snug sm:truncate font-medium tl-num" style={{ color: c("muted") }} data-testid="compose-summary">
                {intent ? summary : " "}
              </p>
              {intent && intent.unknown.length > 0 && (
                <p className="mt-1 truncate text-[13px]" style={{ color: c("muted") }}>
                  Not understood: {intent.unknown.slice(0, 6).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-1 sm:px-6 sm:pb-5">
          <p className="hidden text-[12px] sm:block" style={{ color: c("muted") }}>
            {shortcut} to toggle · ↑↓ examples · runs in your browser
          </p>
          <p className="text-[12px] sm:hidden" style={{ color: c("muted") }}>
            Runs in your browser
          </p>
          <button
            type="button"
            className="tl-cmdk-go inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold"
            style={{ background: c("accent"), color: c("bg") }}
            onClick={() => onSubmit(showExamples ? EXAMPLE_PROMPTS[active]! : src)}
            data-testid="compose-build"
          >
            Build scape <span aria-hidden="true">↵</span>
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
