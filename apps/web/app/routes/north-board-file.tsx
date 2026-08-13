import type { LoaderFunctionArgs } from "react-router";
import { apiFetch, fileProxyHeaders } from "../api.server";
import { cloudflare } from "../context";

// The rendered board pack, streamed through the app so the R2 object stays
// private and the download lands in the audit log (apps/api/src/routes/north.ts).
export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const upstream = await apiFetch(`/v1/north/boardpacks/${encodeURIComponent(id)}/file`, { env, request });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: fileProxyHeaders(upstream, "application/pdf")
  });
}
