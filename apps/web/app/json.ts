/**
 * A `*Json` column as it actually arrives from the API.
 *
 * `apps/api/src/crud.ts` `hydrate()` parses every column whose name ends in
 * `Json` before the response is serialised, so a generic-CRUD resource sends
 * `valueJson`/`extractionJson`/`reasonJson` as an **object**, not as text.
 * Screens that typed those fields `string` and called `JSON.parse` again got
 * `"[object Object]"`, threw, and swallowed it in the `catch` beside the parse:
 * WIP overrides never applied, extracted fields never rendered, and the tests
 * stayed green because their fixtures stubbed the wrong shape. Same failure as
 * the `whitespace-commentary.tsx` precedent in CLAUDE.md.
 *
 * A string still arrives for the one case `hydrate()` leaves alone — a column
 * holding malformed JSON — so both shapes are handled here rather than at each
 * call site.
 */
export function jsonOf(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    // A row whose JSON does not parse is a data bug, not a request bug: the
    // caller reads "nothing there" and the rest of the page still renders.
    return null;
  }
}

/** A `*Json` column read as a bag or a list, or the fallback when it is absent,
 *  malformed, or a bare scalar the caller cannot index. */
export function asJson<T>(raw: unknown, fallback: T): T {
  const parsed = jsonOf(raw);
  return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
}
