import { describe, expect, it } from "vitest";
import type { Message, ModelRequest } from "../types.js";
import { approxTokens, makeStub } from "./stub.js";

function req(messages: Message[]): ModelRequest {
  return { module: "m", purpose: "p", tier: "fast", messages };
}

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

describe("approxTokens", () => {
  it("ceils length/4 for a variety of lengths, including a non-multiple-of-4 boundary", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("a")).toBe(1); // 1/4 = 0.25 -> ceil 1
    expect(approxTokens("abcd")).toBe(1); // exact multiple: 4/4 = 1
    expect(approxTokens("abcde")).toBe(2); // 5/4 = 1.25 -> ceil 2 (proves ceil, not floor)
    expect(approxTokens("abcdefg")).toBe(2); // 7/4 = 1.75 -> ceil 2
    expect(approxTokens("abcdefgh")).toBe(2); // 8/4 = 2 exact
    expect(approxTokens("x".repeat(9))).toBe(3); // 9/4 = 2.25 -> ceil 3
  });
});

describe("makeStub().complete", () => {
  it("records every request pushed onto calls, in call order", async () => {
    const stub = makeStub();
    const r1 = req([msg("user", "first")]);
    const r2 = req([msg("user", "second")]);
    await stub.complete(r1, "model", {});
    await stub.complete(r2, "model", {});
    expect(stub.calls).toEqual([r1, r2]);
  });

  it("throws the exact Error instance from script.fail", async () => {
    const err = new Error("boom");
    const stub = makeStub({ fail: err });
    let caught: unknown;
    try {
      await stub.complete(req([msg("user", "hi")]), "model", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
  });

  it("still records the request on calls even when it fails", async () => {
    const err = new Error("boom");
    const stub = makeStub({ fail: err });
    const r = req([msg("user", "hi")]);
    await expect(stub.complete(r, "model", {})).rejects.toBe(err);
    expect(stub.calls).toEqual([r]);
  });

  it("cycles replies in order across calls (post-increment, not pre or reverse)", async () => {
    const stub = makeStub({ replies: ["a", "b"] });
    const r1 = await stub.complete(req([msg("user", "hi")]), "model", {});
    const r2 = await stub.complete(req([msg("user", "hi")]), "model", {});
    expect(r1.text).toBe("a");
    expect(r2.text).toBe("b");
  });

  it("falls back to echoing the last user message once replies are exhausted", async () => {
    const stub = makeStub({ replies: ["a", "b"] });
    await stub.complete(req([msg("user", "hi")]), "model", {});
    await stub.complete(req([msg("user", "hi")]), "model", {});
    const r3 = await stub.complete(req([msg("user", "third-call-message")]), "model", {});
    expect(r3.text).toBe("echo: third-call-message");
  });

  it("echoes the LAST user-role message, not the first, among interleaved roles", async () => {
    const stub = makeStub();
    const r = await stub.complete(
      req([
        msg("system", "sys"),
        msg("user", "first user"),
        msg("assistant", "reply"),
        msg("user", "second user"),
        msg("assistant", "reply2")
      ]),
      "model",
      {}
    );
    expect(r.text).toBe("echo: second user");
  });

  it("echoes an empty string when there is no user message at all", async () => {
    const stub = makeStub();
    const r = await stub.complete(req([msg("system", "sys"), msg("assistant", "reply")]), "model", {});
    expect(r.text).toBe("echo: ");
  });

  it("sums tokensIn over every message's content, not just user messages", async () => {
    const stub = makeStub();
    const r = await stub.complete(
      req([msg("system", "abcdefgh"), msg("user", "abcde"), msg("assistant", "ab")]),
      "model",
      {}
    );
    // approxTokens: "abcdefgh"=2, "abcde"=2, "ab"=1 -> 5
    expect(r.tokensIn).toBe(5);
  });

  it("sets tokensOut to approxTokens of the returned text", async () => {
    const stub = makeStub({ replies: ["abcdefgh"] });
    const r = await stub.complete(req([msg("user", "hi")]), "model", {});
    expect(r.tokensOut).toBe(2);
  });

  it("defaults toolCalls to an empty array when script.toolCalls is unset", async () => {
    const stub = makeStub();
    const r = await stub.complete(req([msg("user", "hi")]), "model", {});
    expect(r.toolCalls).toEqual([]);
  });

  it("passes through script.toolCalls verbatim (same reference) when set", async () => {
    const toolCalls = [{ id: "1", name: "lookup", args: { q: "x" } }];
    const stub = makeStub({ toolCalls });
    const r = await stub.complete(req([msg("user", "hi")]), "model", {});
    expect(r.toolCalls).toBe(toolCalls);
  });

  it("defaults finishReason to 'stop' when script.finishReason is unset", async () => {
    const stub = makeStub();
    const r = await stub.complete(req([msg("user", "hi")]), "model", {});
    expect(r.finishReason).toBe("stop");
  });

  it("passes through an explicit script.finishReason", async () => {
    const stub = makeStub({ finishReason: "length" });
    const r = await stub.complete(req([msg("user", "hi")]), "model", {});
    expect(r.finishReason).toBe("length");
  });
});

describe("makeStub().embed", () => {
  it("is deterministic: the same text twice yields identical vectors", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["hello", "hello"] }, "model", {});
    expect(r.vectors[0]).toEqual(r.vectors[1]);
  });

  it("gives different texts different vectors", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["hello", "world"] }, "model", {});
    expect(r.vectors[0]).not.toEqual(r.vectors[1]);
  });

  it("returns 8-length vectors", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["anything"] }, "model", {});
    expect(r.vectors[0]).toHaveLength(8);
  });

  it("unit-normalizes each vector (sum of squares ~= 1)", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["some longer text here"] }, "model", {});
    const sumSquares = r.vectors[0]!.reduce((s, x) => s + x * x, 0);
    expect(sumSquares).toBeCloseTo(1, 10);
  });

  it("produces only finite numbers for a single-character text (no NaN/divide-by-zero)", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["a"] }, "model", {});
    for (const x of r.vectors[0]!) expect(Number.isFinite(x)).toBe(true);
    // "a" = charCode 97 lands in bucket 0, norm = 97, so it normalizes to exactly 1
    expect(r.vectors[0]).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("pins the exact char-code accumulation + normalization math for a fixed short string", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["ab"] }, "model", {});
    // v[0] += 'a'.charCodeAt(0) = 97 (i=0, i%8=0); v[1] += 'b'.charCodeAt(0) = 98 (i=1, i%8=1)
    const norm = Math.hypot(97, 98, 0, 0, 0, 0, 0, 0);
    expect(r.vectors[0]).toEqual([97 / norm, 98 / norm, 0, 0, 0, 0, 0, 0]);
  });

  it("sums tokensIn over all input texts", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["abcdefgh", "abcde"] }, "model", {});
    // approxTokens: "abcdefgh"=2, "abcde"=2 -> 4
    expect(r.usage.tokensIn).toBe(4);
  });

  it("pins tokensOut and costMicro at exactly 0", async () => {
    const stub = makeStub();
    const r = await stub.embed!({ module: "m", purpose: "p", texts: ["x"] }, "model", {});
    expect(r.usage.tokensOut).toBe(0);
    expect(r.usage.costMicro).toBe(0);
  });
});
