"use client"

/**
 * Drag-editor toolbar (behind `flags.dragEditor`): a small frosted-glass
 * capsule under the tank — undo / redo / delete / − + size / copy share link —
 * with the selection + "Simulating…" status above it, the driftwood style (and,
 * for root wood, lean) control when a wood piece is selected, and the
 * tie-on / select / add chip rows below (chips wrap; nothing scrolls sideways).
 * 1.2.0: a selected piece offers a "Tie on" row of attachable mosses and
 * epiphytes; a selected attached plant swaps the size pills for "Untie".
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import type { EditTarget, LeanSide, StoneRole, WoodStyle } from "@aquascape-studio/render"
import type { ScapeDoc } from "@/lib/editor"
import { LEAN_SIDES, MAX_HARDSCAPE_PIECES, MAX_PLANTS, RESIZE_DOWN, RESIZE_UP, WOOD_STYLES, attachableSpeciesIds, attachedTo, hostOf } from "@/lib/editor"
import { speciesName, type BotanyRecord } from "@/lib/sim/buildInput"
import { REGULATED_CAPTION, isRegulated, regulatedJurisdictions } from "@/lib/sim/regulated"
import { c } from "./tokens"
import { useFlag } from "./useScapeEditor"

export const EDITOR_CSS = `
.tl-root .tl-edit {
  background: ${c("glassBar")};
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 10px 30px -16px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06);
}
.tl-root .tl-ebtn { transition: background-color 150ms ease, color 150ms ease; }
.tl-root .tl-ebtn:hover:not(:disabled) { background: rgba(0,0,0,0.05); }
.tl-root .tl-ebtn:disabled { cursor: default; opacity: 0.38; }
.tl-root .tl-eprimary { transition: background-color 150ms ease; }
.tl-root .tl-eprimary:hover { background: ${c("accentHover")} !important; }
.tl-root .tl-chip { transition: background-color 150ms ease; }
.tl-root .tl-chip:hover:not(:disabled):not([aria-pressed="true"]) { background: rgba(0,0,0,0.06) !important; }
.tl-root .tl-chip:disabled { cursor: default; opacity: 0.38; }
.tl-root .tl-seg { transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease; }
.tl-root .tl-seg:hover:not([aria-checked="true"]) { background: rgba(0,0,0,0.05); }
.tl-root .tl-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
/* floating timeline: hidden while the editor (with the docked timeline) is on screen */
.tl-root .tl-float { transition: opacity 200ms ease, transform 200ms ease, visibility 0s linear 0s; }
.tl-root .tl-float[data-docked="1"] { opacity: 0; transform: translateY(12px); visibility: hidden; pointer-events: none; transition: opacity 200ms ease, transform 200ms ease, visibility 0s linear 200ms; }
@keyframes tl-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }
.tl-root .tl-pulse { animation: tl-pulse 1.2s ease-in-out infinite; }
.tl-root .tl-chip:focus-visible, .tl-root .tl-seg:focus-visible, .tl-root .tl-ebtn:focus-visible, .tl-root .tl-eprimary:focus-visible { outline: 2px solid ${c("accent")}; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .tl-root .tl-ebtn, .tl-root .tl-eprimary, .tl-root .tl-chip, .tl-root .tl-seg, .tl-root .tl-float { transition: none !important; }
  .tl-root .tl-pulse { animation: none; }
}
`

export const WOOD_STYLE_LABEL: Record<WoodStyle, string> = {
  branchy: "Branchy",
  root: "Root",
  log: "Log",
}

export const LEAN_LABEL: Record<LeanSide, string> = {
  auto: "Auto",
  left: "Left",
  right: "Right",
}

/** "Tie on" chips shown before the "More" disclosure */
export const TIE_ON_VISIBLE = 8

/** attachable species (canAttach): mosses first, then by display name */
export function tieOnSpecies(byId: ReadonlyMap<string, BotanyRecord>): { id: string; name: string; moss: boolean; rec: BotanyRecord | undefined }[] {
  return attachableSpeciesIds()
    .map((id) => {
      const rec = byId.get(id)
      return { id, name: speciesName(rec, id), moss: rec?.growthForm === "moss", rec }
    })
    .sort((a, b) => Number(b.moss) - Number(a.moss) || a.name.localeCompare(b.name, "en"))
}

/** Iwagumi stone roles keep their standard Japanese names; `hint` explains them. */
const ROLE_LABEL: Record<StoneRole, { label: string; hint: string }> = {
  oyaishi: { label: "Oyaishi", hint: "main stone" },
  fukuishi: { label: "Fukuishi", hint: "secondary stone" },
  soeishi: { label: "Soeishi", hint: "accent stone" },
  suteishi: { label: "Suteishi", hint: "fill stone" },
}

function pieceLabel(h: ScapeDoc["hardscape"][number]): string {
  if (h.kind === "wood") return "Driftwood"
  return h.role ? ROLE_LABEL[h.role].label : "Stone"
}

function selectionLabel(doc: ScapeDoc, sel: EditTarget, byId: ReadonlyMap<string, BotanyRecord>): string | null {
  if (sel.kind === "hardscape") {
    const h = doc.hardscape.find((x) => x.id === sel.id)
    if (!h) return null
    const tied = attachedTo(doc, h.id).length
    return tied > 0 ? `${pieceLabel(h)} · ${tied} tied on` : pieceLabel(h)
  }
  const p = doc.plants.find((x) => x.id === sel.id)
  if (!p) return null
  const no = p.id.slice(p.id.lastIndexOf(p.id.includes("#") ? "#" : "-") + 1)
  const hid = hostOf(doc, p.id)
  const host = hid !== undefined ? doc.hardscape.find((x) => x.id === hid) : undefined
  return `${speciesName(byId.get(p.speciesId), p.speciesId)} #${no}${host ? ` · tied to ${pieceLabel(host)}` : ""}`
}

const Icon = {
  undo: (
    <path d="M9 7H4V2M4.5 7A8 8 0 1 1 4 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  redo: (
    <path d="M15 7h5V2M19.5 7A8 8 0 1 0 20 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  trash: (
    <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  link: (
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  minus: <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  untie: (
    <path d="M9.5 14.5l-2 2a3.2 3.2 0 0 1-4.5-4.5l2-2M14.5 9.5l2-2a3.2 3.2 0 0 1 4.5 4.5l-2 2M8 4v2.5M4 8h2.5M16 20v-2.5M20 16h-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  plus: <path d="M6 12h12M12 6v12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export interface EditorToolbarProps {
  doc: ScapeDoc
  selected: EditTarget | null
  canUndo: boolean
  canRedo: boolean
  simulating: boolean
  byId: ReadonlyMap<string, BotanyRecord>
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onCopy: () => Promise<boolean>
  onAdd: (speciesId: string) => void
  /** select a hardscape piece without a pointer (keyboard / screen-reader path to nudge & rotate) */
  onSelect: (t: EditTarget | null) => void
  /** 1.1.0 — add a stone / driftwood at a free spot; false = no free spot (1.2.0) */
  onAddHardscape: (kind: "stone" | "wood") => boolean
  /** 1.1.0 — ×scale the selected piece */
  onResize: (scale: number) => void
  /** 1.1.0 — style of the selected wood piece */
  onWoodStyle: (style: WoodStyle) => void
  /** 1.2.0 — tie a new epiphyte of this species onto the selected piece */
  onAttach: (speciesId: string) => void
  /** 1.2.0 — untie the selected attached plant */
  onDetach: () => void
  /** 1.2.0 — lean of the selected root wood */
  onLeanSide: (side: LeanSide) => void
}

/** "Oyaishi", "Suteishi 1", "Suteishi 2" … (numbered only when a label repeats) */
function hardscapeChips(doc: ScapeDoc): { id: string; label: string; hint: string }[] {
  const base = doc.hardscape.map(pieceLabel)
  const total = new Map<string, number>()
  for (const b of base) total.set(b, (total.get(b) ?? 0) + 1)
  const seen = new Map<string, number>()
  return doc.hardscape.map((h, i) => {
    const b = base[i]!
    const n = (seen.get(b) ?? 0) + 1
    seen.set(b, n)
    const suffix = (total.get(b) ?? 0) > 1 ? ` ${n}` : ""
    const hint = h.kind === "stone" && h.role ? `${b}, ${ROLE_LABEL[h.role].hint}` : b
    return { id: h.id, label: b + suffix, hint }
  })
}

export default function EditorToolbar({
  doc, selected, canUndo, canRedo, simulating, byId, onUndo, onRedo, onDelete, onCopy, onAdd, onSelect, onAddHardscape, onResize, onWoodStyle,
  onAttach, onDetach, onLeanSide,
}: EditorToolbarProps) {
  const [copied, flashCopied] = useFlag(2000)
  const [copyFailed, flashFailed] = useFlag(2500)
  const uid = useId()
  const sel = selected ? selectionLabel(doc, selected, byId) : null
  const species = [...new Set(doc.plants.map((p) => p.speciesId))]
  const full = doc.plants.length >= MAX_PLANTS
  const hsFull = doc.hardscape.length >= MAX_HARDSCAPE_PIECES
  const selPiece = selected?.kind === "hardscape" ? doc.hardscape.find((h) => h.id === selected.id) : undefined
  const selWood = selPiece?.kind === "wood" ? selPiece : undefined
  const woodStyle: WoodStyle = selWood?.woodStyle ?? "branchy"
  const leanSide: LeanSide = selWood?.leanSide ?? "auto"
  const selAttached = selected?.kind === "plant" && hostOf(doc, selected.id) !== undefined
  const tieOn = useMemo(() => tieOnSpecies(byId), [byId])
  const [tieMore, setTieMore] = useState(false)
  const [noSpot, flashNoSpot] = useFlag(2500)
  // set after mount so server and client markup agree
  const [isMac, setIsMac] = useState(false)
  useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), [])
  const mod = isMac ? "⌘" : "Ctrl+"

  return (
    <div className="flex flex-col items-center gap-2.5 px-4 pt-4 sm:px-0" data-testid="editor-toolbar">
      {/* status: selection / hint + simulating */}
      <p className="flex min-h-6 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[13px] font-medium" aria-live="polite">
        {sel ? (
          <span>
            <span style={{ color: c("muted") }}>Selected · </span>
            <span style={{ color: c("text") }}>{sel}</span>
          </span>
        ) : (
          <span style={{ color: c("muted") }}>
            Drag stones or plants to edit
          </span>
        )}
        {noSpot && (
          <span style={{ color: c("warn") }} data-testid="no-free-spot">
            No free spot
          </span>
        )}
        {simulating && (
          <span className="inline-flex items-center gap-1.5" style={{ color: c("accent") }} data-testid="editor-simulating">
            <span className="tl-pulse inline-block h-1.5 w-1.5 rounded-full" style={{ background: c("accent") }} />
            Simulating…
          </span>
        )}
      </p>

      <div role="toolbar" aria-label="Edit" className="tl-edit flex items-center gap-0.5 rounded-full p-1">
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-[14px] font-medium sm:px-3"
          style={{ color: c("text") }}
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title={`Undo (${mod}Z)`}
        >
          <Svg>{Icon.undo}</Svg>
          <span className="hidden sm:inline" aria-hidden="true">Undo</span>
        </button>
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-[14px] font-medium sm:px-3"
          style={{ color: c("text") }}
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title={`Redo (${isMac ? "⇧⌘Z" : "Ctrl+Y"})`}
        >
          <Svg>{Icon.redo}</Svg>
          <span className="hidden sm:inline" aria-hidden="true">Redo</span>
        </button>
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-[14px] font-medium sm:px-3"
          style={{ color: selected ? c("warn") : c("text") }}
          onClick={onDelete}
          disabled={!selected}
          aria-label="Delete"
          title="Delete (⌫)"
        >
          <Svg>{Icon.trash}</Svg>
          <span className="hidden sm:inline" aria-hidden="true">Delete</span>
        </button>
        <span className="mx-0.5 h-6 w-px sm:mx-1" style={{ background: c("hairline") }} aria-hidden="true" />
        {selAttached ? (
          <button
            type="button"
            className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-medium"
            style={{ color: c("text") }}
            onClick={onDetach}
            title="Untie — drop it onto the bed in front of the piece"
            data-testid="editor-untie"
          >
            <Svg>{Icon.untie}</Svg>
            Untie
          </button>
        ) : (
          <>
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2.5"
          style={{ color: c("text") }}
          onClick={() => onResize(RESIZE_DOWN)}
          disabled={!selPiece}
          aria-label="Smaller"
          title="Smaller (−)"
          data-testid="editor-smaller"
        >
          <Svg>{Icon.minus}</Svg>
        </button>
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2.5"
          style={{ color: c("text") }}
          onClick={() => onResize(RESIZE_UP)}
          disabled={!selPiece}
          aria-label="Larger"
          title="Larger (+)"
          data-testid="editor-larger"
        >
          <Svg>{Icon.plus}</Svg>
        </button>
          </>
        )}
        <span className="mx-0.5 h-6 w-px sm:mx-1" style={{ background: c("hairline") }} aria-hidden="true" />
        <button
          type="button"
          className="tl-eprimary inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold sm:px-4"
          style={{ background: c("accent"), color: c("bg") }}
          onClick={() => {
            void onCopy().then((ok) => (ok ? flashCopied() : flashFailed()))
          }}
        >
          <Svg>{copied ? Icon.check : Icon.link}</Svg>
          <span aria-live="polite">
            {copied ? "Copied" : copyFailed ? "URL updated" : "Copy link"}
          </span>
        </button>
      </div>

      {/* driftwood style (wood selected) */}
      {selWood && (
        <div className="flex items-center gap-2" data-testid="wood-style">
          <span id={`${uid}-ws`} className="text-[12px] font-medium" style={{ color: c("muted") }}>
            Wood style
          </span>
          <div role="radiogroup" aria-labelledby={`${uid}-ws`} className="flex rounded-full p-[3px]" style={{ background: c("segTrack") }}>
            {WOOD_STYLES.map((ws) => {
              const on = woodStyle === ws
              return (
                <button
                  key={ws}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onWoodStyle(ws)}
                  className="tl-seg flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium"
                  style={{
                    background: on ? c("bg") : "transparent",
                    color: on ? c("text") : c("ink2"),
                    boxShadow: on ? "0 1px 3px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  {WOOD_STYLE_LABEL[ws]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 1.2.0: lean of root wood */}
      {selWood && woodStyle === "root" && (
        <div className="flex items-center gap-2" data-testid="lean-side">
          <span id={`${uid}-lean`} className="text-[12px] font-medium" style={{ color: c("muted") }}>
            Lean
          </span>
          <div role="radiogroup" aria-labelledby={`${uid}-lean`} className="flex rounded-full p-[3px]" style={{ background: c("segTrack") }}>
            {LEAN_SIDES.map((ls) => {
              const on = leanSide === ls
              return (
                <button
                  key={ls}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onLeanSide(ls)}
                  className="tl-seg flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium"
                  style={{
                    background: on ? c("bg") : "transparent",
                    color: on ? c("text") : c("ink2"),
                    boxShadow: on ? "0 1px 3px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)" : "none",
                  }}
                  title={ls === "auto" ? "Lean towards the tank centre" : `Lean the trunk to the ${ls}`}
                >
                  {LEAN_LABEL[ls]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* select + add: chips wrap on every width (no sideways scrolling) */}
      <div className="flex w-full max-w-[860px] flex-col gap-2" data-testid="editor-chips">
        {selPiece && (
          <div className="flex w-full items-start gap-2" data-testid="tie-on">
            <span className="flex min-h-11 w-12 shrink-0 items-center text-[12px] font-medium sm:w-[84px]" style={{ color: c("muted") }}>
              Tie on
            </span>
            <div role="group" aria-label={`Tie on to ${pieceLabel(selPiece)}`} id={`${uid}-tie`} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {(tieMore ? tieOn : tieOn.slice(0, TIE_ON_VISIBLE)).map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  disabled={full}
                  onClick={() => onAttach(sp.id)}
                  className="tl-chip inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                  style={{ background: c("surface"), color: c("text") }}
                  title={`${sp.rec?.scientificName ?? sp.id} — tie onto the ${pieceLabel(selPiece).toLowerCase()}`}
                  data-testid={`tie-${sp.id}`}
                >
                  <span aria-hidden="true" style={{ color: c("accent") }}>+</span> {sp.name}
                </button>
              ))}
              {tieOn.length > TIE_ON_VISIBLE && (
                <button
                  type="button"
                  aria-expanded={tieMore}
                  aria-controls={`${uid}-tie`}
                  onClick={() => setTieMore((v) => !v)}
                  className="tl-chip inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold"
                  style={{ background: c("surface"), color: c("accent") }}
                  data-testid="tie-more"
                >
                  {tieMore ? "Fewer" : `More (${tieOn.length - TIE_ON_VISIBLE})`}
                </button>
              )}
            </div>
          </div>
        )}
        {doc.hardscape.length > 0 && (
          <div className="flex w-full items-start gap-2">
            <span className="flex min-h-11 w-12 shrink-0 items-center text-[12px] font-medium sm:w-[84px]" style={{ color: c("muted") }}>
              Select
            </span>
            <div role="group" aria-label="Select hardscape" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {hardscapeChips(doc).map((h) => {
                const on = selected?.kind === "hardscape" && selected.id === h.id
                return (
                  <button
                    key={h.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSelect(on ? null : { kind: "hardscape", id: h.id })}
                    className="tl-chip inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                    style={on ? { background: c("text"), color: c("bg") } : { background: c("surface"), color: c("text") }}
                    title={`${h.hint} — ←↑→↓ move · [ ] rotate · − + size`}
                  >
                    {h.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className="flex w-full items-start gap-2">
          <span className="flex min-h-11 w-12 shrink-0 items-center text-[12px] font-medium sm:w-[84px]" style={{ color: c("muted") }}>
            Add
          </span>
          <div role="group" aria-label="Add" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {(
              [
                ["stone", "Stone"],
                ["wood", "Driftwood"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                disabled={hsFull}
                onClick={() => {
                  if (!onAddHardscape(kind)) flashNoSpot()
                }}
                className="tl-chip inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                style={{ background: c("surface"), color: c("text") }}
                title={hsFull ? `${MAX_HARDSCAPE_PIECES}-piece limit` : `${label} — add near the centre`}
                data-testid={`add-${kind}`}
              >
                <span aria-hidden="true" style={{ color: c("accent") }}>+</span> {label}
              </button>
            ))}
            {species.length > 0 && <span className="mx-0.5 my-2.5 w-px self-stretch" style={{ background: c("hairline") }} aria-hidden="true" />}
            {species.map((sid) => {
              const rec = byId.get(sid)
              const regulated = isRegulated(rec)
              const descId = `${uid}-reg-${sid}`
              return (
                <button
                  key={sid}
                  type="button"
                  disabled={full}
                  onClick={() => onAdd(sid)}
                  className="tl-chip inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                  style={{ background: c("surface"), color: c("text") }}
                  title={`${rec?.scientificName ?? sid} — add at centre${regulated ? `\n${REGULATED_CAPTION} (${regulatedJurisdictions(rec)})` : ""}`}
                  aria-describedby={regulated ? descId : undefined}
                  data-regulated={regulated ? "1" : undefined}
                >
                  <span aria-hidden="true" style={{ color: c("accent") }}>+</span> {speciesName(rec, sid)}
                  {regulated && (
                    <span id={descId} className="tl-sr">
                      {REGULATED_CAPTION} ({regulatedJurisdictions(rec)})
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {full && (
        <p className="text-[12px]" style={{ color: c("muted") }}>
          {MAX_PLANTS}-plant limit reached
        </p>
      )}
    </div>
  )
}
