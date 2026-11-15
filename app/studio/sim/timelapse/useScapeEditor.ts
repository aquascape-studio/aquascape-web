"use client"

/**
 * Drag-editor wiring for /studio/sim (behind `flags.dragEditor` +
 * `flags.stylizedTank`). Owns the EditorState, turns FrontalTank pick / drag
 * events and keyboard shortcuts into editor actions, builds the sim input
 * from the COMMITTED doc (previews never re-run the sim), and writes the doc
 * back to `?scape=` (history.replaceState, debounced 500 ms).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { EditMoveEvent, EditTarget } from "@aquascape-studio/render"
import {
  NUDGE_CM,
  NUDGE_FAST_CM,
  ROTATE_STEP_RAD,
  canRedo,
  canUndo,
  committedDoc,
  decodeScape,
  editorReducer,
  encodeScape,
  findFreeSpot,
  initEditor,
  isPreviewing,
  targetPosition,
  type EditorAction,
  type EditorState,
  type ScapeDoc,
} from "@/lib/editor"
import { buildDocInput, type DocBuild } from "@/lib/editor/buildDocInput"
import type { BotanyRecord } from "@/lib/sim/buildInput"

/** keyboard nudges are previews, committed once the keys settle */
export const NUDGE_SETTLE_MS = 300
/** ?scape= write-back debounce */
export const URL_WRITE_MS = 500

export interface ScapeEditor {
  state: EditorState
  /** what the 3D view shows (includes a live drag / nudge preview) */
  viewDoc: ScapeDoc
  /** what the sim runs */
  committed: ScapeDoc
  built: DocBuild
  simKey: string
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  removeSelected: () => void
  addPlant: (speciesId: string) => void
  select: (t: EditTarget | null) => void
  onMove: (e: EditMoveEvent) => void
  copyLink: () => Promise<boolean>
}

interface Options {
  /** doc for the current template / URL plants — loaded when it changes */
  seedDoc: ScapeDoc
  /** raw `?scape=` at mount (takes precedence over the seed doc) */
  initialScape: string | null
  /** URL params without day / guides / scape (name, light, co2, …) */
  baseQuery: string
  plants: readonly BotanyRecord[]
  /** a plant was picked in the tank (sync the plant card) */
  onPlantPicked?: ((id: string) => void) | undefined
}

function scapeUrl(doc: ScapeDoc): URL {
  const url = new URL(window.location.href)
  url.searchParams.set("scape", encodeScape(doc))
  return url
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path (permissions / insecure context)
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function isTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && (el as HTMLInputElement).type !== "range" && (el as HTMLInputElement).type !== "button")
}

export function useScapeEditor({ seedDoc, initialScape, baseQuery, plants, onPlantPicked }: Options): ScapeEditor {
  const [state, rawDispatch] = useReducer(editorReducer, null, () => initEditor((initialScape ? decodeScape(initialScape) : null) ?? seedDoc))
  const stateRef = useRef(state)
  stateRef.current = state
  const nudgeTimer = useRef<number | null>(null)
  /** target of the pointer drag in progress (null: ignore stray move / end events) */
  const dragRef = useRef<EditTarget | null>(null)
  const pickedRef = useRef(onPlantPicked)
  pickedRef.current = onPlantPicked

  const dispatch = useCallback((a: EditorAction) => {
    // keep stateRef current between dispatches in the same tick (keyboard repeat, drag end)
    stateRef.current = editorReducer(stateRef.current, a)
    rawDispatch(a)
  }, [])

  /** commit a pending keyboard nudge now */
  const flushNudge = useCallback(() => {
    if (nudgeTimer.current !== null) {
      window.clearTimeout(nudgeTimer.current)
      nudgeTimer.current = null
      dispatch({ type: "commitPreview" })
    }
  }, [dispatch])

  // a new template / tank (seed doc) replaces the doc — undoable; the first seed is the initial doc
  const seedKey = useMemo(() => encodeScape(seedDoc), [seedDoc])
  const lastSeedKey = useRef(seedKey)
  useEffect(() => {
    if (lastSeedKey.current === seedKey) return
    lastSeedKey.current = seedKey
    flushNudge()
    dragRef.current = null
    dispatch({ type: "apply", op: { type: "replace", doc: seedDoc } })
  }, [seedKey, seedDoc, dispatch, flushNudge])

  const committed = committedDoc(state)
  const built = useMemo(() => buildDocInput(committed, new URLSearchParams(baseQuery), plants), [committed, baseQuery, plants])
  // hardscape is visual only (sim-core has none): moving a bare stone does not re-run the sim
  const simKey = useMemo(() => `${baseQuery}|${JSON.stringify([committed.tank, committed.plants])}`, [committed, baseQuery])

  // ?scape= write-back after each committed edit, debounced
  const initialCommitted = useRef(committed)
  useEffect(() => {
    if (committed === initialCommitted.current) return
    const t = window.setTimeout(() => {
      window.history.replaceState(window.history.state, "", scapeUrl(committed))
    }, URL_WRITE_MS)
    return () => window.clearTimeout(t)
  }, [committed])

  const undo = useCallback(() => {
    flushNudge()
    dragRef.current = null
    dispatch({ type: "undo" })
  }, [dispatch, flushNudge])
  const redo = useCallback(() => {
    flushNudge()
    dragRef.current = null
    dispatch({ type: "redo" })
  }, [dispatch, flushNudge])
  const removeSelected = useCallback(() => {
    flushNudge()
    const sel = stateRef.current.selected
    if (sel) dispatch({ type: "apply", op: { type: "remove", target: sel } })
  }, [dispatch, flushNudge])
  const addPlant = useCallback(
    (speciesId: string) => {
      flushNudge()
      const doc = committedDoc(stateRef.current)
      const spot = findFreeSpot(doc, 0, 0)
      if (spot) dispatch({ type: "apply", op: { type: "addPlant", speciesId, x: spot.x, z: spot.z } })
    },
    [dispatch, flushNudge],
  )
  const select = useCallback(
    (t: EditTarget | null) => {
      if (t === null && dragRef.current) return
      dispatch({ type: "select", target: t })
      if (t?.kind === "plant") pickedRef.current?.(t.id)
    },
    [dispatch],
  )

  const onMove = useCallback(
    (e: EditMoveEvent) => {
      switch (e.phase) {
        case "start":
          flushNudge()
          dragRef.current = e.target
          dispatch({ type: "select", target: e.target })
          if (e.target.kind === "plant") pickedRef.current?.(e.target.id)
          return
        case "move":
          if (!dragRef.current || dragRef.current.id !== e.target.id) return
          dispatch({ type: "preview", target: e.target, x: e.x, z: e.z })
          return
        case "end":
          if (!dragRef.current || dragRef.current.id !== e.target.id) return
          dragRef.current = null
          dispatch({ type: "preview", target: e.target, x: e.x, z: e.z })
          dispatch({ type: "commitPreview" })
          return
        case "cancel":
          dragRef.current = null
          dispatch({ type: "cancelPreview" })
          return
      }
    },
    [dispatch, flushNudge],
  )

  const copyLink = useCallback(async () => {
    const url = scapeUrl(committedDoc(stateRef.current))
    window.history.replaceState(window.history.state, "", url)
    return writeClipboard(url.toString())
  }, [])

  // keyboard (capture phase, so handled keys never reach the page's day-stepping shortcuts)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextField(e.target)) return
      const s = stateRef.current
      const mod = e.metaKey || e.ctrlKey
      const key = e.key
      const consume = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (mod && !e.altKey) {
        const k = key.toLowerCase()
        if (k === "z" && !e.shiftKey) {
          consume()
          undo()
        } else if ((k === "z" && e.shiftKey) || (k === "y" && e.ctrlKey && !e.metaKey)) {
          consume()
          redo()
        }
        return
      }
      if (e.altKey) return
      if (key === "Escape") {
        if (nudgeTimer.current !== null) {
          window.clearTimeout(nudgeTimer.current)
          nudgeTimer.current = null
          dispatch({ type: "cancelPreview" })
          consume()
        } else if (dragRef.current) {
          // not consumed: FrontalTank also sees Escape and emits its own "cancel"
          dragRef.current = null
          dispatch({ type: "cancelPreview" })
        } else if (s.selected) {
          dispatch({ type: "select", target: null })
          consume()
        }
        return
      }
      const sel = s.selected
      if (!sel) return
      // the day slider keeps its own arrow keys
      const onRange = (e.target as HTMLElement | null)?.tagName === "INPUT"
      if (!onRange && (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown")) {
        const pos = targetPosition(s.doc, sel)
        if (!pos) return
        consume()
        if (dragRef.current) return
        const step = e.shiftKey ? NUDGE_FAST_CM : NUDGE_CM
        // front view: up = towards the back glass (−z), as when dragging
        const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0
        const dz = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0
        dispatch({ type: "preview", target: sel, x: pos.x + dx, z: pos.z + dz })
        if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current)
        nudgeTimer.current = window.setTimeout(() => {
          nudgeTimer.current = null
          dispatch({ type: "commitPreview" })
        }, NUDGE_SETTLE_MS)
      } else if ((key === "[" || key === "]") && sel.kind === "hardscape") {
        consume()
        flushNudge()
        dispatch({ type: "apply", op: { type: "rotate", id: sel.id, dRad: key === "]" ? ROTATE_STEP_RAD : -ROTATE_STEP_RAD } })
      } else if (key === "Delete" || key === "Backspace") {
        consume()
        removeSelected()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [dispatch, flushNudge, undo, redo, removeSelected])

  useEffect(
    () => () => {
      if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current)
    },
    [],
  )

  return {
    state,
    viewDoc: state.doc,
    committed,
    built,
    simKey,
    canUndo: canUndo(state) || isPreviewing(state),
    canRedo: canRedo(state),
    undo,
    redo,
    removeSelected,
    addPlant,
    select,
    onMove,
    copyLink,
  }
}

/** keep the copied-state flag for a moment (toolbar feedback) */
export function useFlag(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const t = useRef<number | null>(null)
  const fire = useCallback(() => {
    setOn(true)
    if (t.current !== null) window.clearTimeout(t.current)
    t.current = window.setTimeout(() => setOn(false), ms)
  }, [ms])
  useEffect(() => () => {
    if (t.current !== null) window.clearTimeout(t.current)
  }, [])
  return [on, fire]
}
