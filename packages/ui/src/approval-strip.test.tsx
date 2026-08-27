/**
 * Approve and reject are irreversible, have no undo, and used to be one click
 * each — the home dashboard wired both straight to a fetcher submit. They now
 * take two: the first arms and restates the consequence, the second commits.
 *
 * `packages/ui` renders on the server only (vitest.config.ts: no jsdom), so
 * there is no click to simulate. Two assertions cover the property between
 * them: the rendered resting state must not carry a decision the actor can
 * commit, and the source must not hand either callback to a button directly —
 * which is the shape the bug had.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalStrip } from "./ai.js";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ai.tsx"), "utf8");

describe("ApprovalStrip commits only on a second click", () => {
  it("offers no confirmation until one is armed", () => {
    const markup = renderToStaticMarkup(
      <ApprovalStrip summary="Reserve increase" onApprove={() => {}} onReject={() => {}} />
    );
    expect(markup).toContain("Approve");
    expect(markup).toContain("Reject");
    // The consequence and its commit belong to the armed state only; showing
    // them at rest would put a one-click commit back on the screen.
    expect(markup).not.toContain("Confirm approve");
    expect(markup).not.toContain("is final");
  });

  it("still explains itself instead of rendering a dead control when blocked", () => {
    const markup = renderToStaticMarkup(
      <ApprovalStrip summary="Reserve increase" blockedReason="Deciding…" onApprove={() => {}} />
    );
    expect(markup).toContain("Deciding…");
    expect(markup).not.toContain("Approve");
  });

  it("hands neither callback to a button", () => {
    // `onClick={onApprove}` or `onClick: onApprove` is the one-click wiring.
    // Both handlers may only be called from inside the armed branch's own
    // handler, which is what makes the first click unable to commit.
    const direct = /onClick=\{\s*on(Approve|Reject)\s*\}|onClick:\s*on(Approve|Reject)\b/.exec(
      source
    );
    expect(direct?.[0] ?? null).toBeNull();
  });
});
