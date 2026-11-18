"use client"

/**
 * The toast-like line above the timeline after a ⌘K scape was applied: what
 * was built, substitutions and notes, plus "Undo" and "Try another" pills.
 * Stays 6 s (NOTES_MS) once the re-run simulation has finished; the timer
 * pauses while the line is hovered or focused.
 */
import { useEffect, useRef, useState } from "react"
import { getTemplate } from "@/lib/templates"
import { c } from "./tokens"
import { NOTES_MS, type ComposeNotice } from "./useCommandPalette"

export const COMPOSE_NOTES_CSS = `
.tl-root .tl-cnotes {
  background: ${c("glassBar")};
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 10px 30px -16px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06);
  animation: tl-cnotes-in 200ms ease-out;
}
.tl-root .tl-cnotes .tl-cpill { transition: background-color 150ms ease; }
.tl-root .tl-cnotes .tl-cpill:hover { background: rgba(0,0,0,0.06) !important; }
.tl-root .tl-cnotes .tl-cprimary:hover { background: ${c("accentHover")} !important; }
@keyframes tl-cnotes-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) {
  .tl-root .tl-cnotes { animation: none; }
  .tl-root .tl-cnotes .tl-cpill { transition: none; }
}
`

export interface ComposeNotesProps {
  notice: ComposeNotice | null
  onUndo: () => void
  onTryAnother: () => void
  onDismiss: () => void
  /** the sim is re-running: the 6 s start once the new result is on screen */
  holding?: boolean | undefined
}

export default function ComposeNotes({ notice, onUndo, onTryAnother, onDismiss, holding }: ComposeNotesProps) {
  const [hovered, setPaused] = useState(false)
  const paused = hovered || !!holding
  const left = useRef(NOTES_MS)
  const startedAt = useRef(0)

  // a new notice restarts the 6 s
  useEffect(() => {
    left.current = NOTES_MS
  }, [notice?.key])
  useEffect(() => {
    if (!notice || paused) return
    startedAt.current = Date.now()
    const t = window.setTimeout(onDismiss, left.current)
    return () => {
      window.clearTimeout(t)
      left.current = Math.max(1500, left.current - (Date.now() - startedAt.current))
    }
  }, [notice, paused, onDismiss])

  if (!notice) return <div role="status" aria-live="polite" className="tl-sr" />
  const name = getTemplate(notice.result.templateId)?.name ?? "Scape"
  const detail = notice.lines.length ? notice.lines.join(" · ") : "Everything understood."
  return (
    <div
      role="status"
      aria-live="polite"
      className="tl-cnotes mb-3 flex flex-col gap-2 rounded-[28px] px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:rounded-full sm:py-1.5 sm:pl-5 sm:pr-1.5"
      data-testid="compose-notes"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className="min-w-0 flex-1 text-[13px] leading-snug sm:truncate" title={detail}>
        <span className="font-semibold" style={{ color: c("text") }}>
          Built {name}
        </span>
        <span style={{ color: c("muted") }}> · {detail}</span>
      </p>
      <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
        <button
          type="button"
          onClick={onUndo}
          className="tl-cpill inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold"
          style={{ background: c("surface"), color: c("text") }}
          data-testid="compose-undo"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onTryAnother}
          className="tl-cpill tl-cprimary inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold"
          style={{ background: c("accent"), color: c("bg") }}
          data-testid="compose-try-another"
        >
          Try another
        </button>
      </div>
    </div>
  )
}
