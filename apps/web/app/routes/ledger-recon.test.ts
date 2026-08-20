import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action } from "./ledger-recon";

// The evidence-bundle intent posts no body of its own — the run id is the
// only thing it asks for — so what these tests guard is the branch routing:
// the right runId reaches the right URL, a missing one never reaches fetch at
// all, and a server refusal comes back as `problem`, same as every other
// intent on this screen.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET" });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/ledger/recon", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BUNDLE = {
  id: "evb_1",
  tenantId: "ten_1",
  purpose: "audit",
  bundleHash: "abc123",
  fileId: "file_1",
  requestedBy: "user:u1",
  approvedBy: null,
  state: "ready",
  deliveredTo: null,
  createdAt: 1_750_000_000_000,
  updatedAt: 1_750_000_000_000,
  manifest: {
    version: 1,
    tenantId: "ten_1",
    generatedAt: 1_750_000_000_000,
    requestedBy: "user:u1",
    scope: { runId: "rcn_1", process: "insurer", period: "2026-08", purpose: "audit" },
    files: [
      { path: "run.json", sizeBytes: 512, sha256: "h1" },
      { path: "matches.jsonl", sizeBytes: 1024, sha256: "h2" },
      { path: "summary.pdf", sizeBytes: 4096, sha256: "h3" }
    ]
  }
};

describe("action / generate-evidence-bundle", () => {
  it("posts to the run's evidence-bundle endpoint and returns the bundle", async () => {
    const calls = stubFetch(json(BUNDLE, 201));
    const result = await action(args(form({ intent: "generate-evidence-bundle", runId: "rcn_1" })));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.test/v1/ledger/recon/runs/rcn_1/evidence-bundle");
    expect(calls[0]!.method).toBe("POST");
    expect(result.problem).toBeNull();
    expect(result.bundle).toEqual(BUNDLE);
  });

  it("refuses without calling the API when no run is loaded", async () => {
    const calls = stubFetch(json(BUNDLE, 201));
    const result = await action(args(form({ intent: "generate-evidence-bundle", runId: "" })));

    expect(calls).toHaveLength(0);
    expect(result.problem).toEqual({ title: "runId", status: 400 });
    expect(result.bundle).toBeNull();
  });

  it("carries a server refusal back as problem", async () => {
    stubFetch(json({ title: "forbidden", status: 403, detail: "missing permission" }, 403));
    const result = await action(args(form({ intent: "generate-evidence-bundle", runId: "rcn_1" })));

    expect(result.problem).toEqual(
      expect.objectContaining({ title: "forbidden", status: 403, detail: "missing permission" })
    );
    expect(result.bundle).toBeNull();
  });
});
