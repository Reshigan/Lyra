import { ApiError, api, type ApiOptions, type Problem as ProblemShape } from "./api.server";
import { actionUrl, bodyFrom, type ActionSpec, type ResourceSpec } from "./modules/spec";

/**
 * One declared action, posted. Lives outside `routes/record.tsx` because a route
 * module may only export the names React Router knows: anything else is bundled
 * for the browser, and this reaches `api.server`. The handler finds its spec
 * through the module registry and so cannot be exercised through `action()`;
 * this is the part worth a test.
 */
export async function runAction(
  tab: ResourceSpec,
  spec: ActionSpec,
  id: string,
  form: FormData,
  options: ApiOptions
): Promise<{ problem: ProblemShape | null; done: string | null }> {
  try {
    await api(actionUrl(tab, spec, id), {
      ...options,
      method: spec.method,
      body: bodyFrom(spec.fields ?? [], form)
    });
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, done: null };
    throw error;
  }
  return { problem: null, done: spec.intent };
}
