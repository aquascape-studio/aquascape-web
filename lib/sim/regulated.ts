/**
 * Regulated-species flag (botany schema 0.7.0, optional `regulated[]`).
 * The field may be missing on every record (older vendored data) — all
 * helpers treat missing / malformed data as "not regulated".
 */
export interface RegulatedEntry {
  /** ISO 3166-1 alpha-2, optionally with a subdivision ("US", "AU-QLD") */
  jurisdiction: string
  status: "prohibited" | "restricted" | "watch" | (string & {})
  listName: string
  since?: number | undefined
  citationKey: string
}

/** neutral caption shown with the species' add chip */
export const REGULATED_CAPTION = "Regulated in some regions"

/** valid regulated entries of a record (empty when the field is absent or malformed) */
export function regulatedEntries(rec: { regulated?: unknown } | null | undefined): RegulatedEntry[] {
  const raw = rec?.regulated
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is RegulatedEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as RegulatedEntry).jurisdiction === "string" &&
      typeof (e as RegulatedEntry).status === "string" &&
      typeof (e as RegulatedEntry).listName === "string" &&
      typeof (e as RegulatedEntry).citationKey === "string",
  )
}

export function isRegulated(rec: { regulated?: unknown } | null | undefined): boolean {
  return regulatedEntries(rec).length > 0
}

/** "EU, US" — the jurisdictions, for tooltips */
export function regulatedJurisdictions(rec: { regulated?: unknown } | null | undefined): string {
  return [...new Set(regulatedEntries(rec).map((e) => e.jurisdiction))].join(", ")
}
