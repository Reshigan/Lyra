import { request } from "./api";

// Mobile's half of /v1/names (apps/api/src/routes/names.ts). The approvals
// queue was rendering `subjectRef` and `requestedBy` as raw ULIDs — the web
// console resolves both, and a phone is where most approvals are actually
// decided, so it needs the same names.
//
// The web app leans on @lyra/ui for `shortRef`; that package is DOM React and
// must not be imported into React Native, so the shortening rule is repeated
// here — eight lines against pulling a whole DOM package into the bundle.

/** Ref → display name. A ref that resolved to nothing is absent, not null. */
export type Names = Readonly<Record<string, string>>;

/** A page shows 50-100 refs; the API caps a batch at 200. */
const MAX_REFS = 200;

/** `us_01KE…`, or `user:us_01KE…` with a scope on the front. */
const OPAQUE_REF = /^(?:([a-z][a-z0-9]*):)?([a-z][a-z0-9]*_)([0-9a-hjkmnp-tv-z]{16,})$/i;

/** Head and tail of an opaque ref; anything that is not one, untouched. */
export function shortRef(value: string): string {
  const match = OPAQUE_REF.exec(value.trim());
  if (!match) return value;
  const [, scope, prefix, body] = match;
  return `${scope ? `${scope}:` : ""}${prefix}${body!.slice(0, 4)}…${body!.slice(-4)}`;
}

/** Ref → the name a person expects, or the shortest honest thing we have. */
export function who(ref: string | null | undefined, resolved: Names): string | null {
  if (!ref) return null;
  return resolved[ref] ?? shortRef(ref);
}

/**
 * Resolve a batch of refs. Never throws: a name is decoration over a ref the
 * screen already holds, so a failed lookup renders short refs rather than
 * taking down the queue the user came to decide.
 */
export async function fetchNames(
  token: string,
  refs: (string | null | undefined)[],
  signal?: AbortSignal
): Promise<Names> {
  const asked = [...new Set(refs.filter((one): one is string => Boolean(one)))].slice(0, MAX_REFS);
  if (!asked.length) return {};
  try {
    const body = await request<{ names: Names }>(
      `/v1/names?refs=${encodeURIComponent(asked.join(","))}`,
      { token, ...(signal ? { signal } : {}) }
    );
    return body.names ?? {};
  } catch {
    return {};
  }
}
