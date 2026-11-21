"use client"

/**
 * ⌘K one-sentence scape (lib/compose contract 1.0.0) on /studio/sim, behind
 * `flags.commandPalette` (+ dragEditor + stylizedTank). Owns the dialog's open
 * state, the ⌘K / Ctrl+K shortcut, and the post-apply notes line:
 * Enter → parseIntent → composeScape → editor "replace" (one undo step; the
 * sim re-runs through needsResim). "Try another" re-composes the same intent
 * with seed + 1 in place of the previous result (still one undo step).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { buildSpeciesIndex, composeScape, parseIntent, type ComposeResult, type ScapeIntent, type SpeciesIndex } from "@/lib/compose"
import type { ScapeDoc } from "@/lib/editor"
import type { BotanyRecord } from "@/lib/sim/buildInput"
import { isTextField, type ScapeEditor } from "./useScapeEditor"

/** how long the notes line stays (paused while hovered / focused) */
export const NOTES_MS = 6000

export interface ComposeNotice {
  /** bumps on every apply, so the timer restarts */
  key: number
  result: ComposeResult
  /** "Swapped …", notes — what the line shows after the template name */
  lines: string[]
}

/** the page reacts to compose / undo (template pill selection) — the doc itself is the editor's */
export interface PaletteHooks {
  /** a compose (or "try another") was applied: `templateId` is the template the doc was built from */
  onComposed?: (templateId: string) => void
  /** "Undo" on the notes line: the compose was reverted */
  onUndone?: () => void
}

export interface CommandPalette {
  index: SpeciesIndex
  open: boolean
  setOpen: (open: boolean) => void
  /** compose `text` and apply it (closes the dialog) */
  submit: (text: string) => void
  notice: ComposeNotice | null
  dismiss: () => void
  undo: () => void
  tryAnother: () => void
}

/** "Swapped HC Cuba, Glosso for Four-leaf clover (needs CO2)" — substitutions grouped by target + reason */
export function substitutionLines(result: ComposeResult, nameOf: (id: string) => string): string[] {
  const groups = new Map<string, string[]>()
  for (const s of result.substitutions) {
    const k = `${s.to}|${s.reason}`
    groups.set(k, [...(groups.get(k) ?? []), nameOf(s.from)])
  }
  return [...groups].map(([k, from]) => {
    const [to, reason] = k.split("|") as [string, string]
    return `Swapped ${from.join(", ")} for ${nameOf(to)} (${reason})`
  })
}

export function useCommandPalette(editor: ScapeEditor | null, plants: readonly BotanyRecord[], hooks?: PaletteHooks): CommandPalette {
  const index = useMemo(() => buildSpeciesIndex(plants), [plants])
  const [open, setOpenState] = useState(false)
  const [notice, setNotice] = useState<ComposeNotice | null>(null)
  const last = useRef<{ intent: ScapeIntent; seed: number; doc: ScapeDoc } | null>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const keyRef = useRef(0)
  const hooksRef = useRef(hooks)
  hooksRef.current = hooks

  const setOpen = useCallback((v: boolean) => setOpenState(v), [])

  const nameOf = useCallback((id: string) => index.byId.get(id)?.name ?? id, [index])
  const show = useCallback(
    (result: ComposeResult) => {
      keyRef.current++
      setNotice({ key: keyRef.current, result, lines: [...substitutionLines(result, nameOf), ...result.notes] })
    },
    [nameOf],
  )

  const apply = useCallback(
    (intent: ScapeIntent, seed: number, replacePrevious: boolean) => {
      const ed = editorRef.current
      if (!ed) return
      const result = composeScape(intent, index, seed)
      // "Try another": swap out our own previous result so one Undo still returns to the pre-⌘K scape
      if (replacePrevious && last.current && ed.committed === last.current.doc) ed.undo()
      ed.replace(result.doc)
      last.current = { intent, seed, doc: result.doc }
      hooksRef.current?.onComposed?.(result.templateId)
      show(result)
    },
    [index, show],
  )

  const submit = useCallback(
    (text: string) => {
      setOpenState(false)
      apply(parseIntent(text, index), 0, false)
    },
    [apply, index],
  )
  const tryAnother = useCallback(() => {
    const l = last.current
    if (l) apply(l.intent, l.seed + 1, true)
  }, [apply])
  const undo = useCallback(() => {
    editorRef.current?.undo()
    hooksRef.current?.onUndone?.()
    last.current = null
    setNotice(null)
  }, [])
  const dismiss = useCallback(() => setNotice(null), [])

  // ⌘K / Ctrl+K toggles the dialog; never fires while typing in another field (only the dialog's own input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k" || e.repeat) return
      const t = e.target as Element | null
      if (isTextField(t) && !t?.closest?.("[data-compose-dialog]")) return
      e.preventDefault()
      e.stopPropagation()
      setOpenState((v) => !v)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  return { index, open, setOpen, submit, notice, dismiss, undo, tryAnother }
}
