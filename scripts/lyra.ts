import { onpremInit, onpremMigrate, onpremSeed, onpremSmoke, type SmokeReport } from "./lyra-onprem.js";

const USAGE = `Usage: lyra onprem <init|migrate|seed|smoke>

  onprem init              Write ops/.env from .env.example, generating fresh secrets.
  onprem migrate           Run drizzle migrations against LIBSQL_URL.
  onprem seed              Seed the GONXT demo tenant.
    --password <pw>          Override the seeded demo password.
  onprem smoke             Check llm / llm-vllm / embed reachability + one chat round trip.
`;

export interface DispatchResult {
  code: number;
  message: string;
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function formatSmoke(report: SmokeReport): string {
  const lines = report.tiers.map(
    (t) => `  ${t.service}: ${t.reachable ? "reachable" : "unreachable"} (${t.url})${t.detail ? ` — ${t.detail}` : ""}`
  );
  lines.push(
    report.roundTrip
      ? report.roundTrip.ok
        ? `  round trip: ok (${report.roundTrip.model}) -> ${JSON.stringify(report.roundTrip.text)}`
        : `  round trip: failed (${report.roundTrip.model}) — ${report.roundTrip.error}`
      : "  round trip: skipped — no chat tier reachable"
  );
  return lines.join("\n");
}

export async function dispatch(argv: string[]): Promise<DispatchResult> {
  const [group, sub, ...rest] = argv;
  if (group !== "onprem") return { code: 1, message: `unknown command "${group ?? ""}"\n\n${USAGE}` };

  try {
    switch (sub) {
      case "init": {
        const result = onpremInit();
        return {
          code: 0,
          message: result.created
            ? `wrote ${result.path} (generated: ${result.generated.join(", ") || "none"})`
            : `${result.path} already exists — left untouched`
        };
      }
      case "migrate":
        onpremMigrate();
        return { code: 0, message: "migrate complete" };
      case "seed": {
        const password = flagValue(rest, "--password");
        onpremSeed(password ? { password } : {});
        return { code: 0, message: "seed complete" };
      }
      case "smoke": {
        const report = await onpremSmoke();
        return { code: report.roundTrip?.ok ? 0 : 1, message: formatSmoke(report) };
      }
      default:
        return { code: 1, message: `unknown onprem subcommand "${sub ?? ""}"\n\n${USAGE}` };
    }
  } catch (err) {
    return { code: 1, message: err instanceof Error ? err.message : String(err) };
  }
}

// Only runs when executed directly — importing this module (tests) must not launch a CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await dispatch(process.argv.slice(2));
  console.log(result.message);
  process.exit(result.code);
}
