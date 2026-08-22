import type { ToolDef } from "@lyra/model-gateway";
import { ORBIT_TOOL_DEFS } from "./orbit-tools.js";

// ADR-0073. One registry behind which every module's hands live. ORBIT's tools
// are reused verbatim (same defs, same handlers, same gates — one execution
// path per action); every other module contributes read tools whose handlers
// live in command-reads.ts, each checking the same permission the module's own
// list route requires.

/** A command-registry tool: a gateway ToolDef plus the module it belongs to,
 *  so the surface can group and the loop can attribute. */
export interface CommandToolDef extends ToolDef {
  module: string;
}

function readTool(
  module: string,
  name: string,
  description: string,
  properties: Record<string, { type: string; description?: string }>,
  required: string[]
): CommandToolDef {
  return {
    name,
    description,
    parameters: { type: "object", properties, required },
    consequential: false,
    module
  };
}

/** ORBIT's tools keep their module tag; their handlers stay in orbit-tools.ts. */
const ORBIT_TAGGED: CommandToolDef[] = ORBIT_TOOL_DEFS.map((t) => ({ ...t, module: "orbit" }));

export const COMMAND_TOOL_DEFS: CommandToolDef[] = [
  ...ORBIT_TAGGED,

  // AXIS reads
  readTool("axis", "list_open_cases", "List open AXIS cases (intake, quoted, issued).", {}, []),
  readTool("axis", "fetch_policy_summary", "Summarise an AXIS policy's state, premium and cover.", {
    policyId: { type: "string" }
  }, ["policyId"]),

  // SIGNAL reads
  readTool("signal", "list_campaigns", "List SIGNAL campaigns with status and budget.", {
    status: { type: "string", description: "Optional status filter: draft|review|live|paused|done" }
  }, []),

  // SCOUT reads
  readTool("scout", "list_whitespaces", "List SCOUT whitespace opportunities by category.", {}, []),

  // NORTH reads
  readTool("north", "latest_snapshot", "Fetch the latest NORTH metric snapshot for a period.", {
    period: { type: "string", description: "Optional YYYY-MM period; defaults to latest." }
  }, []),

  // LEDGER reads
  readTool("ledger", "account_balance", "Read a ledger account's current balance by code.", {
    code: { type: "string", description: "Account code, e.g. 1100." }
  }, ["code"])
];

/**
 * Filter to an agent row's allowlist — same contract as `orbitToolsFor`:
 * null/empty allowlist means everything.
 */
export function toolsFor(agent: { toolsJson: string | null }): CommandToolDef[] {
  let allow: string[] | null = null;
  if (agent.toolsJson) {
    try {
      const parsed: unknown = JSON.parse(agent.toolsJson);
      if (Array.isArray(parsed) && parsed.length) {
        allow = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // A malformed allowlist offers nothing rather than everything.
      allow = [];
    }
  }
  return allow ? COMMAND_TOOL_DEFS.filter((t) => allow!.includes(t.name)) : COMMAND_TOOL_DEFS;
}

export function isCommandTool(name: string): boolean {
  return COMMAND_TOOL_DEFS.some((t) => t.name === name);
}

export function toolModule(name: string): string | undefined {
  return COMMAND_TOOL_DEFS.find((t) => t.name === name)?.module;
}
