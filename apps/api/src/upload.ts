// The one place a multipart file part becomes bytes we are willing to store.
// Shared by the public portal (portal.ts, an unauthenticated stranger) and by
// AXIS document capture (routes/axis.ts, a signed-in field agent) so the size
// ceiling and the accepted types cannot drift apart between the two doors.

import { badRequest } from "@lyra/core";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** What a phone camera or a scanner produces, and nothing executable. */
export const UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/pdf"
]);

// Hono types a form entry as `string | null` (the Workers `File` global is not
// in this project's lib), so an upload is narrowed structurally instead.
interface UploadedFile {
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The `file` part of a form, validated. Throws 400 rather than storing junk. */
export async function readUpload(form: {
  get(name: string): unknown;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const file = form.get("file") as UploadedFile | string | null;
  if (!file || typeof file === "string") throw badRequest("file is required");
  if (file.size > UPLOAD_MAX_BYTES) throw badRequest("file is larger than 10MB");
  const contentType = file.type || "application/octet-stream";
  if (!UPLOAD_TYPES.has(contentType)) throw badRequest(`${contentType} is not an accepted document type`);
  return { bytes: new Uint8Array(await file.arrayBuffer()), contentType };
}
