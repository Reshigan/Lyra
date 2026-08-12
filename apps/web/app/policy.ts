import { humanise } from "./modules/spec";

/**
 * `axis.claim_payment` → "Claim payment". The heading of every card in the
 * approvals queue was the policy key as stored, and the module it starts with
 * is already a line below it — so the prefix goes when it is this row's own
 * module, and stays when the key came from somewhere else.
 *
 * Lives here rather than in routes/approvals.tsx because the shell's shift rail
 * says the same words in the same place, and a component may not import a route
 * module: that drags a loader into the browser bundle.
 */
export function policyTitle(policyKey: string, module: string): string {
  return humanise(policyKey.startsWith(`${module}.`) ? policyKey.slice(module.length + 1) : policyKey);
}
