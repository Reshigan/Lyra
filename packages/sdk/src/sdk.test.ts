import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openapi } from "../../../apps/api/src/openapi.js";
import { emit, OUTPUT } from "../scripts/generate.js";
import { ApiError, LyraClient, type FetchLike } from "./client.js";
import { OPERATIONS } from "./generated.js";
import { verifyWebhook, WebhookError } from "./webhooks.js";

/* -------------------------------------------------------------- contract */

describe("contract", () => {
  // CLAUDE.md §6. The committed file is what reviewers read and what callers
  // compile against; if it drifts from the live document, an endpoint has moved
  // or a column has changed type and nobody was told.
  it("generated.ts matches the current openapi document", () => {
    expect(readFileSync(OUTPUT, "utf8")).toBe(emit(openapi()));
  });

  it("carries the permission the endpoint actually checks", () => {
    expect(OPERATIONS["POST /v1/core/customers"]).toEqual({
      tag: "core",
      summary: "Create a customer",
      permission: "core:customers:create",
      public: false
    });
    expect(OPERATIONS["POST /v1/auth/login"]?.public).toBe(true);
  });
});

/* ---------------------------------------------------------------- client */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function stub(...responses: Response[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined
    });
    const next = queue.shift();
    if (!next) throw new Error("no stubbed response left");
    return Promise.resolve(next);
  };
  return { fetch: fetchImpl, calls };
}

function problem(status: number, body: Record<string, unknown>, requestId = "req-1"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": requestId }
  });
}

describe("client", () => {
  it("builds the path, query and bearer header", async () => {
    const { fetch, calls } = stub(
      new Response(JSON.stringify({ data: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const client = new LyraClient({ baseUrl: "https://api.example.com/", token: "sess_1", fetch });

    const page = await client.call("GET /v1/core/customers", { query: { limit: 10, kycStatus: "verified" } });

    expect(page.data).toEqual([]);
    expect(calls[0]?.url).toBe("https://api.example.com/v1/core/customers?limit=10&kycStatus=verified");
    expect(calls[0]?.headers.authorization).toBe("Bearer sess_1");
  });

  it("escapes path parameters", async () => {
    const { fetch, calls } = stub(new Response(null, { status: 204 }));
    const client = new LyraClient({ baseUrl: "https://api.example.com", fetch });

    await client.call("DELETE /v1/core/customers/{id}", { params: { id: "cu 1/2" } });

    expect(calls[0]?.url).toBe("https://api.example.com/v1/core/customers/cu%201%2F2");
  });

  it("maps a problem document onto a typed error", async () => {
    const { fetch } = stub(
      problem(403, {
        type: "https://lyra.app/problems/mfa_required",
        title: "Second factor required",
        status: 403,
        code: "mfa_required",
        detail: "verify",
        step: "verify"
      })
    );
    const client = new LyraClient({ baseUrl: "https://api.example.com", fetch });

    const error = await client.call("GET /v1/me", {}).catch((e: unknown) => e as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe("mfa_required");
    expect((error as ApiError).mfaStep).toBe("verify");
    expect((error as ApiError).requestId).toBe("req-1");
  });

  it("still throws an ApiError when the failure is not a problem document", async () => {
    const { fetch } = stub(new Response("<html>502</html>", { status: 502, statusText: "Bad Gateway" }));
    const client = new LyraClient({ baseUrl: "https://api.example.com", fetch });

    const error = (await client.call("GET /v1/me", {}).catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(502);
    expect(error.code).toBe("unknown");
    expect(error.problem.detail).toContain("502");
  });

  it("passes the idempotency key through", async () => {
    const { fetch, calls } = stub(new Response("{}", { status: 200 }));
    const client = new LyraClient({ baseUrl: "https://api.example.com", fetch });

    await client.call("POST /v1/ledger/txn/{type}", {
      params: { type: "payment" },
      body: { amountMinor: 100 },
      idempotencyKey: "key-1"
    });

    expect(calls[0]?.headers["idempotency-key"]).toBe("key-1");
    expect(calls[0]?.headers["x-approval-id"]).toBeUndefined();
  });

  it("replays the byte-identical body with x-approval-id once approved", async () => {
    const { fetch, calls } = stub(
      problem(403, {
        type: "https://lyra.app/problems/approval_required",
        title: "Approval required",
        status: 403,
        code: "approval_required",
        detail: "ledger.payout",
        policy_key: "ledger.payout",
        approval_id: "apr_1"
      }),
      new Response(JSON.stringify({ id: "txn_1" }), { status: 200 })
    );
    const seen: string[] = [];
    const client = new LyraClient({
      baseUrl: "https://api.example.com",
      fetch,
      onApprovalRequired: (error) => {
        seen.push(error.approvalId ?? "");
        return true;
      }
    });

    const result = await client.call("POST /v1/ledger/txn/{type}", {
      params: { type: "payout" },
      body: { amountMinor: 5000, currency: "ZAR" },
      idempotencyKey: "key-2"
    });

    expect(result).toEqual({ id: "txn_1" });
    expect(seen).toEqual(["apr_1"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toBe(calls[0]?.body);
    expect(calls[1]?.headers["idempotency-key"]).toBe("key-2");
    expect(calls[0]?.headers["x-approval-id"]).toBeUndefined();
    expect(calls[1]?.headers["x-approval-id"]).toBe("apr_1");
  });

  it("throws without retrying when the caller declines to wait for approval", async () => {
    const { fetch, calls } = stub(
      problem(403, {
        type: "https://lyra.app/problems/approval_required",
        title: "Approval required",
        status: 403,
        code: "approval_required",
        approval_id: "apr_2"
      })
    );
    const client = new LyraClient({ baseUrl: "https://api.example.com", fetch, onApprovalRequired: () => false });

    const error = (await client
      .call("POST /v1/ledger/txn/{type}", { params: { type: "payout" }, body: {} })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("approval_required");
    expect(error.approvalId).toBe("apr_2");
    expect(calls).toHaveLength(1);
  });

  it("stores the session token from a login and reports the mfa step", async () => {
    const { fetch, calls } = stub(
      new Response(
        JSON.stringify({
          token: "sess_2",
          expiresAt: 1,
          mfaRequired: true,
          mfaStep: "verify",
          user: { id: "us_1", name: "A", email: "a@b.c", locale: "en", tenantId: "tn_1" },
          roles: ["core.admin"]
        }),
        { status: 200 }
      ),
      new Response("{}", { status: 200 })
    );
    const client = new LyraClient({ baseUrl: "https://api.example.com", fetch });

    const login = await client.login("a@b.c", "pw");
    await client.call("GET /v1/me", {});

    expect(login.mfaRequired).toBe(true);
    expect(login.mfaStep).toBe("verify");
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(calls[1]?.headers.authorization).toBe("Bearer sess_2");
  });
});

/* -------------------------------------------------------------- webhooks */

describe("webhooks", () => {
  const secret = "whsec_test";
  const now = 1_730_000_000_000;
  const payload = JSON.stringify({
    id: "ev_1",
    ts: now,
    tenant_id: "tn_1",
    module: "axis",
    type: "axis.case.issued",
    actor: "user:us_1",
    subject: "cas_1",
    data: { id: "cas_1" },
    v: 1
  });

  // Computed with node:crypto, not with the verifier's own WebCrypto path, so
  // this is a cross-implementation check of the scheme in apps/api dispatch.ts:
  // HMAC-SHA256 over `${timestamp}.${body}`, hex, prefixed `v1=`.
  const signature = `v1=${createHmac("sha256", secret).update(`${now}.${payload}`).digest("hex")}`;

  const headers = (over: Record<string, string> = {}): Record<string, string> => ({
    "x-lyra-event": "axis.case.issued",
    "x-lyra-event-id": "ev_1",
    "x-lyra-timestamp": String(now),
    "x-lyra-signature": signature,
    ...over
  });

  it("accepts a known-good delivery and returns the envelope", async () => {
    const event = await verifyWebhook(secret, payload, headers(), { now });
    expect(event.type).toBe("axis.case.issued");
    expect(event.tenant_id).toBe("tn_1");
  });

  it("accepts a Headers object as well as a plain bag", async () => {
    const event = await verifyWebhook(secret, payload, new Headers(headers()), { now });
    expect(event.id).toBe("ev_1");
  });

  it("rejects a tampered payload", async () => {
    const tampered = payload.replace('"cas_1"', '"cas_2"');
    await expect(verifyWebhook(secret, tampered, headers(), { now })).rejects.toBeInstanceOf(WebhookError);
  });

  it("rejects a wrong secret, a stale timestamp and a missing signature", async () => {
    await expect(verifyWebhook("whsec_other", payload, headers(), { now })).rejects.toThrow("signature mismatch");
    await expect(verifyWebhook(secret, payload, headers(), { now: now + 600_000 })).rejects.toThrow(
      "timestamp outside tolerance"
    );
    const { "x-lyra-signature": _drop, ...rest } = headers();
    await expect(verifyWebhook(secret, payload, rest, { now })).rejects.toThrow("missing x-lyra-signature");
  });
});
