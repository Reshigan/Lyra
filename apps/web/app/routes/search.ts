import type { LoaderFunctionArgs } from "react-router";
import { api } from "../api.server";
import { cloudflare } from "../context";

// A resource route, not a screen: the command palette is the only caller. It
// exists because the session cookie is server-only by design (api.server.ts), so
// the browser cannot reach /v1/search itself.

export interface SearchHit {
  resource: string;
  module: string;
  row: Record<string, unknown>;
}

export interface SearchItem {
  id: string;
  label: string;
  hint: string;
  href: string;
}

/** Whatever a row calls its human name. Ordered most to least specific; every
 *  resource has an id, so there is always something to render. */
const NAME_FIELDS = ["name", "title", "reference", "code", "subject", "email", "key", "label"];

export function hitToItem(hit: SearchHit): SearchItem | null {
  const id = hit.row.id;
  if (typeof id !== "string" || !id) return null;
  const named = NAME_FIELDS.map((field) => hit.row[field]).find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  return {
    id,
    label: named ?? id,
    hint: hit.resource,
    href: `/${hit.module}/${hit.resource}/${id}`
  };
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflare);
  const term = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (term.length < 2) return Response.json({ items: [] });

  // A palette that throws on a 403 would be worse than one that finds nothing:
  // the query is speculative, and the API already filters per-resource.
  const body = await api<{ results: SearchHit[] }>(`/v1/search?q=${encodeURIComponent(term)}`, {
    env,
    request
  }).catch(() => ({ results: [] as SearchHit[] }));

  const items = body.results.map(hitToItem).filter((item): item is SearchItem => item !== null);
  return Response.json({ items });
}
