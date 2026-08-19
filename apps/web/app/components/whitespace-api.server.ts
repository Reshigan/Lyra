import { api } from "../api.server";
import type { Env } from "../env";
import type { Page } from "../routes/scout.shared";
import type { WhitespaceCommentary } from "./whitespace-commentary";
import type { PromotedToSignal } from "./signal-handover";

// ponytail: the two calls this feature needs, in one file. Both endpoints now
// exist — apps/api/src/routes/scout.ts, registered ahead of the generated CRUD
// so `commentary` is read as a path and not as an id:
//
//   GET /v1/scout/whitespaces/commentary?limit=N
//     -> { data: WhitespaceCommentary[] }  — at most one row per whitespace,
//        keyed by whitespaceId, already stored (this endpoint reads, it does
//        not call a model), so the radar can prefetch every dot's commentary in
//        the same round as the dots themselves.
//     -> 403 when the actor may not read it: costs the commentary, not the page.
//
//   POST /v1/scout/whitespaces/:id/promote-to-signal   (idempotency-key required)
//     -> { state: "committed" | "pending_approval", campaignId, drafts }
//     -> 403 { code: "approval_required", policy_key: "scout.whitespace_promote" }
//
// `WhitespaceCommentary` is declared in ./whitespace-commentary and mirrors the
// engine's interface field for field. It was once an *assumed* contract written
// while the API was built in parallel, and it turned out to share exactly one
// field with what the server sends. Change it only against that file.

export function readCommentary(opts: { env: Env; request: Request; limit: number }) {
  return api<Page<WhitespaceCommentary>>(`/v1/scout/whitespaces/commentary?limit=${opts.limit}`, {
    env: opts.env,
    request: opts.request
  });
}

export function promoteToSignal(opts: { env: Env; request: Request; whitespaceId: string; key: string }) {
  return api<PromotedToSignal>(`/v1/scout/whitespaces/${encodeURIComponent(opts.whitespaceId)}/promote-to-signal`, {
    env: opts.env,
    request: opts.request,
    method: "POST",
    body: {},
    headers: { "idempotency-key": opts.key }
  });
}
