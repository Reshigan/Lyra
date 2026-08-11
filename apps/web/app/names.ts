import { shortRef } from "@lyra/ui";

// The client half of /v1/names. The fetch lives in api.server.ts (server only);
// this is what a component renders with, so it may not import that file.

/** Ref → display name. A ref that resolved to nothing is absent, not null. */
export type Names = Readonly<Record<string, string>>;

/** Ref → the name a person expects, or the shortest honest thing we have. */
export function who(ref: string | null | undefined, resolved: Names): string | null {
  if (!ref) return null;
  return resolved[ref] ?? shortRef(ref);
}
