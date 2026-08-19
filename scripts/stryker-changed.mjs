import { execSync } from "node:child_process";

/**
 * Source files under `dir` that changed since `STRYKER_SINCE` (a git revision
 * expression set by the `mutation` job in .github/workflows/ci.yml — a plain
 * ref for a push, `origin/<base>...` for a PR so the diff starts at the merge
 * base). Returns null when the variable is unset or unusable, so a local or
 * nightly run keeps its whole-tree globs.
 *
 * Stryker 9 has no `--since` of its own — it dropped the git-diff selector and
 * kept only `incremental`, which needs a prior full run to compare against.
 * `git diff` against the working tree is the same idea in one line.
 */
export function changedSources(dir) {
  const ref = process.env.STRYKER_SINCE;
  if (!ref) return null;
  let out;
  try {
    out = execSync(`git diff --name-only --diff-filter=ACMR ${ref} -- ${dir}`, {
      encoding: "utf8"
    });
  } catch {
    // A revision git cannot resolve — e.g. an all-zero `github.event.before`
    // on a branch's first push. Fall back to the whole-tree sweep: a broken
    // scope must widen the gate, never narrow it, or it would silently pass by
    // mutating nothing. On CI that sweep is fail-closed rather than slow —
    // packages/core whole-tree is ~45h, so it will hit the job's
    // `timeout-minutes` and go red. That is the intended outcome for a scope
    // nobody can compute; fix the ref, do not narrow the fallback.
    return null;
  }
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}
