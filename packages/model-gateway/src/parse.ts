// The two steps every `parseX(reply)` in this package starts with. A model reply
// is untrusted input and each parser is the trust boundary, so their shared
// contract is "never throws — unparseable input yields a safe zero-valued
// result". Both steps live here rather than per parser so a fence-format or
// guard fix lands once instead of in six places (it previously landed in one and
// missed four copies).
//
// extract.ts re-exports `stripFence` for callers that already import it from there.

/** Models sometimes wrap JSON in a code fence despite `responseSchema`; strip it before parsing. */
export function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? text).trim();
}

/**
 * One model reply to a plain JSON object, or null when the reply is not one.
 *
 * The null return is the point: `JSON.parse` succeeds on `null`, `42` and
 * `"a string"` — all valid JSON — so assigning its result straight to a
 * `Record<string, unknown>` is a lie, and the first property read on `null`
 * throws a `TypeError` straight past the parser's try/catch and the never-throws
 * contract with it. Arrays are rejected too: no schema in this package asks for
 * one, and a parser reading named fields off an array only ever gets undefined.
 */
export function parseJsonObject(reply: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(stripFence(reply));
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
