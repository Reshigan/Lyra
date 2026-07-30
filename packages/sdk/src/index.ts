export * from "./generated.js";
export * from "./client.js";
export * from "./webhooks.js";

// The OpenAPI document documents `Problem` as a schema, so the generator emits
// one with every field optional. The client's is the type errors are actually
// thrown with — required fields, and the extensions (`approval_id`, `step`) the
// API attaches. An explicit re-export wins over the two `export *` above.
export type { Problem } from "./client.js";
