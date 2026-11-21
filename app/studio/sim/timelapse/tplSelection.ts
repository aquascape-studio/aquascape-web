/**
 * Template pill selection on /studio/sim, split in two (pure, no React):
 *  - `shown`: the highlighted pill (and the ?tpl= the address bar shows)
 *  - `seed`:  the template the doc was last instantiated from
 *
 * A manual pick moves both (the doc restarts from that template). A ⌘K compose
 * moves only `shown` — the composed doc stays as built — and Undo puts `shown`
 * back on `seed`. Ids are template ids, null = no template ("your own setup").
 */
export interface TplSelection {
  shown: string | null
  seed: string | null
}

export function initTplSelection(urlTpl: string | null): TplSelection {
  return { shown: urlTpl, seed: urlTpl }
}

/** manual pill click: the doc restarts from the template */
export function pickTpl(_: TplSelection, id: string | null): TplSelection {
  return { shown: id, seed: id }
}

/** successful compose: highlight the composed template, keep the seed (no re-instantiate) */
export function composeTpl(s: TplSelection, templateId: string): TplSelection {
  return s.shown === templateId ? s : { ...s, shown: templateId }
}

/** compose Undo: the pill goes back to the template the doc was seeded from */
export function undoComposeTpl(s: TplSelection): TplSelection {
  return s.shown === s.seed ? s : { ...s, shown: s.seed }
}

/** share-link query with the template param set to `id` (or removed) */
export function withTplParam(params: URLSearchParams, id: string | null): URLSearchParams {
  const next = new URLSearchParams(params)
  if (id) next.set("tpl", id)
  else next.delete("tpl")
  return next
}
