import { badRequest } from "@lyra/core";
import type { BrowserBinding } from "./export/render.js";

// AXIS §G.5, docs/decisions/ADR-0036. When an axisDocuments row has no
// rawText, /documents/:id/extract renders its file to page images and calls
// the vision extraction path (packages/model-gateway/src/extract.ts) instead.

export interface RenderedPage {
  data: string;
  mimeType: string;
  page: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * ponytail: page 1 only. Both doc types with an extraction schema today (eid,
 * mulkiya, docs/modules/axis.md §8) are single-page real-world documents. A
 * multi-page doc type needs a page-count call before this — add it then.
 */
export async function renderDocumentPages(
  browser: BrowserBinding,
  file: { bytes: Uint8Array; contentType: string }
): Promise<RenderedPage[]> {
  if (file.contentType.startsWith("image/")) {
    return [{ data: toBase64(file.bytes), mimeType: file.contentType, page: 1 }];
  }
  if (file.contentType !== "application/pdf") {
    throw badRequest(`cannot render ${file.contentType} for vision extraction`);
  }

  // Sibling verb to render.ts's /v1/pdf: same BrowserBinding contract, this
  // direction rasterizes a page instead of producing one. The on-prem `render`
  // HTTP service implements the same contract (docs/02 §9).
  const res = await browser.fetch(
    new Request("https://browser-rendering/v1/screenshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pdf: toBase64(file.bytes), page: 1 })
    })
  );
  if (!res.ok) throw badRequest("document page render failed");

  return [{ data: toBase64(new Uint8Array(await res.arrayBuffer())), mimeType: "image/png", page: 1 }];
}
