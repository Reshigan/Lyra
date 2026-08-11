import { api, names } from "./api.server";
import type { RefOption } from "./components/ref-picker";

/**
 * The options behind a `RefPicker`: a short list of records, named by the same
 * batch resolver every table uses (docs/07). A page the actor's role cannot
 * read yields nothing at all rather than a failed screen — the picker degrades
 * to the plain box it replaced.
 */
export async function refOptions(
  path: string,
  env: Parameters<typeof api>[1]["env"],
  request: Request
): Promise<RefOption[]> {
  const page = await api<{ data: { id: string }[] }>(path, { env, request }).catch(() => null);
  const rows = page?.data ?? [];
  if (!rows.length) return [];
  const named = await names(
    rows.map((row) => row.id),
    { env, request }
  );
  return rows.flatMap((row) => (named[row.id] ? [{ id: row.id, label: named[row.id]! }] : []));
}
