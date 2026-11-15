"use client"

/**
 * Drag-editor toolbar (behind `flags.dragEditor`): a small frosted-glass
 * capsule under the tank — undo / redo / delete / copy share link — with the
 * selection + "模拟中…" status above it and a compact species palette below.
 */
import { useEffect, useState, type ReactNode } from "react"
import type { EditTarget, StoneRole } from "@aquascape-studio/render"
import type { ScapeDoc } from "@/lib/editor"
import { MAX_PLANTS } from "@/lib/editor"
import type { BotanyRecord } from "@/lib/sim/buildInput"
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
@keyframes tl-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }
.tl-root .tl-pulse { animation: tl-pulse 1.2s ease-in-out infinite; }
`

const ROLE_LABEL: Record<StoneRole, { zh: string; en: string }> = {
  oyaishi: { zh: "主石", en: "Oyaishi" },
  fukuishi: { zh: "副石", en: "Fukuishi" },
  soeishi: { zh: "添石", en: "Soeishi" },
  suteishi: { zh: "捨石", en: "Suteishi" },
}

function shortZh(rec: BotanyRecord | undefined, fallback: string): string {
  return rec?.commonNames?.zh?.[0]?.replace(/（.*?）/g, "") ?? fallback
}

function selectionLabel(doc: ScapeDoc, sel: EditTarget, byId: ReadonlyMap<string, BotanyRecord>): { zh: string; en: string } | null {
  if (sel.kind === "hardscape") {
    const h = doc.hardscape.find((x) => x.id === sel.id)
    if (!h) return null
    if (h.kind === "wood") return { zh: "沉木", en: "Wood" }
    return h.role ? ROLE_LABEL[h.role] : { zh: "石头", en: "Stone" }
  }
  const p = doc.plants.find((x) => x.id === sel.id)
  if (!p) return null
  const rec = byId.get(p.speciesId)
  const no = p.id.slice(p.id.lastIndexOf(p.id.includes("#") ? "#" : "-") + 1)
  return { zh: `${shortZh(rec, p.speciesId)} #${no}`, en: rec?.commonNames?.en?.[0] ?? rec?.scientificName ?? "" }
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
}

/** "主石", "捨石 1", "捨石 2" … (numbered only when a label repeats) */
function hardscapeChips(doc: ScapeDoc): { id: string; zh: string; en: string }[] {
  const base = doc.hardscape.map((h) => (h.kind === "wood" ? { zh: "沉木", en: "Wood" } : h.role ? ROLE_LABEL[h.role] : { zh: "石头", en: "Stone" }))
  const total = new Map<string, number>()
  for (const b of base) total.set(b.zh, (total.get(b.zh) ?? 0) + 1)
  const seen = new Map<string, number>()
  return doc.hardscape.map((h, i) => {
    const b = base[i]!
    const n = (seen.get(b.zh) ?? 0) + 1
    seen.set(b.zh, n)
    const suffix = (total.get(b.zh) ?? 0) > 1 ? ` ${n}` : ""
    return { id: h.id, zh: b.zh + suffix, en: b.en + suffix }
  })
}

export default function EditorToolbar({ doc, selected, canUndo, canRedo, simulating, byId, onUndo, onRedo, onDelete, onCopy, onAdd, onSelect }: EditorToolbarProps) {
  const [copied, flashCopied] = useFlag(2000)
  const [copyFailed, flashFailed] = useFlag(2500)
  const sel = selected ? selectionLabel(doc, selected, byId) : null
  const species = [...new Set(doc.plants.map((p) => p.speciesId))]
  const full = doc.plants.length >= MAX_PLANTS
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
            <span style={{ color: c("muted") }}>已选 Selected · </span>
            <span style={{ color: c("text") }}>{sel.zh}</span>
            {sel.en && <span style={{ color: c("muted") }}> {sel.en}</span>}
          </span>
        ) : (
          <span style={{ color: c("muted") }}>
            拖动石头或水草调整布局 <span className="hidden sm:inline">· Drag stones or plants to edit</span>
          </span>
        )}
        {simulating && (
          <span className="inline-flex items-center gap-1.5" style={{ color: c("accent") }} data-testid="editor-simulating">
            <span className="tl-pulse inline-block h-1.5 w-1.5 rounded-full" style={{ background: c("accent") }} />
            模拟中… Simulating…
          </span>
        )}
      </p>

      <div role="toolbar" aria-label="编辑 Edit" className="tl-edit flex items-center gap-0.5 rounded-full p-1">
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-medium"
          style={{ color: c("text") }}
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="撤销 Undo"
          title={`撤销 Undo (${mod}Z)`}
        >
          <Svg>{Icon.undo}</Svg>
          <span className="hidden sm:inline">撤销</span>
        </button>
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-medium"
          style={{ color: c("text") }}
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="重做 Redo"
          title={`重做 Redo (${isMac ? "⇧⌘Z" : "Ctrl+Y"})`}
        >
          <Svg>{Icon.redo}</Svg>
          <span className="hidden sm:inline">重做</span>
        </button>
        <button
          type="button"
          className="tl-ebtn inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-medium"
          style={{ color: selected ? c("warn") : c("text") }}
          onClick={onDelete}
          disabled={!selected}
          aria-label="删除 Delete"
          title="删除 Delete (⌫)"
        >
          <Svg>{Icon.trash}</Svg>
          <span className="hidden sm:inline">删除</span>
        </button>
        <span className="mx-1 h-6 w-px" style={{ background: c("hairline") }} aria-hidden="true" />
        <button
          type="button"
          className="tl-eprimary inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold"
          style={{ background: c("accent"), color: c("bg") }}
          onClick={() => {
            void onCopy().then((ok) => (ok ? flashCopied() : flashFailed()))
          }}
        >
          <Svg>{copied ? Icon.check : Icon.link}</Svg>
          <span aria-live="polite">
            {copied ? "已复制 Copied" : copyFailed ? "地址栏已更新 URL updated" : (
              <>
                复制分享链接<span className="hidden sm:inline"> Copy link</span>
              </>
            )}
          </span>
        </button>
      </div>

      {/* select + add: one row on wider screens, stacked on phones */}
      <div className="flex w-full max-w-full flex-col items-center gap-2 lg:w-auto lg:flex-row lg:gap-6">
      {doc.hardscape.length > 0 && (
        <div className="flex w-full max-w-full items-center gap-2 lg:w-auto">
          <span className="shrink-0 text-[12px] font-medium" style={{ color: c("muted") }}>
            选择 <span className="hidden sm:inline">Select</span>
          </span>
          <div
            role="group"
            aria-label="选择硬景 Select hardscape"
            className="-my-0.5 flex min-w-0 gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {hardscapeChips(doc).map((h) => {
              const on = selected?.kind === "hardscape" && selected.id === h.id
              return (
                <button
                  key={h.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(on ? null : { kind: "hardscape", id: h.id })}
                  className="tl-chip inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                  style={on ? { background: c("text"), color: c("bg") } : { background: c("surface"), color: c("text") }}
                  title={`${h.en} — ←↑→↓ 移动 move · [ ] 旋转 rotate`}
                >
                  {h.zh}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {species.length > 0 && (
        <div className="flex w-full max-w-full items-center gap-2 lg:w-auto">
          <span className="shrink-0 text-[12px] font-medium" style={{ color: c("muted") }}>
            添加 <span className="hidden sm:inline">Add</span>
          </span>
          <div
            role="group"
            aria-label="添加水草 Add plant"
            className="-my-0.5 flex min-w-0 gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {species.map((sid) => (
              <button
                key={sid}
                type="button"
                disabled={full}
                onClick={() => onAdd(sid)}
                className="tl-chip inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium"
                style={{ background: c("surface"), color: c("text") }}
                title={`${byId.get(sid)?.scientificName ?? sid} — 添加到中央 Add at centre`}
              >
                <span aria-hidden="true" style={{ color: c("accent") }}>+</span> {shortZh(byId.get(sid), sid)}
              </button>
            ))}
          </div>
        </div>
      )}
      </div>
      {full && (
        <p className="text-[12px]" style={{ color: c("muted") }}>
          已达 {MAX_PLANTS} 丛上限 · {MAX_PLANTS}-plant limit reached
        </p>
      )}
    </div>
  )
}
