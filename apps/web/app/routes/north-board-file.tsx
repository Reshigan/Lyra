import type { LoaderFunctionArgs } from "react-router";
import { proxyFile } from "../api.server";
import { cloudflare } from "../context";

// The rendered board pack, streamed through the app so the R2 object stays
// private and the download lands in the audit log (apps/api/src/routes/north.ts).
export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  return proxyFile(`/v1/north/boardpacks/${encodeURIComponent(id)}/file`, { env, request }, "application/pdf");
}
