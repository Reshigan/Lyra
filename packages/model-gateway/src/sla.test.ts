import { describe, expect, it } from "vitest";
import { parseSla, slaMessages, slaSchema } from "./sla.js";

const driver = { feature: "queueDepth", detail: "queue is 3x the owner's throughput", evidenceRef: "queueDepth" };

describe("parseSla", () => {
  it("strips a ```json fence", () => {
    const body = JSON.stringify({ breachProbability: 82, driver });
    expect(parseSla("```json\n" + body + "\n```")).toEqual({ breachProbability: 82, driver, confidence: 100 });
  });

  // Regression: see fraud.test.ts — valid JSON that is not an object used to throw.
  it.each(["null", "42", '"a string"'])("returns the zero result for valid non-object JSON: %s", (reply) => {
    expect(() => parseSla(reply)).not.toThrow();
    expect(parseSla(reply)).toEqual({ breachProbability: 0, driver: null, confidence: 0 });
  });
});

const SLA_CTX = {
  kind: "claim",
  status: "awaiting_docs",
  priority: "high",
  ageMs: 518_400_000,
  hoursUntilDue: 4,
  history: [{ step: "awaiting_docs", outcome: null, durationMs: 518_400_000, ts: "1970-01-07T00:00:00.000Z" }],
  queueDepth: 12,
  ownerLoad: 9
};

describe("slaSchema", () => {
  it("requires the probability and a single evidence-bearing driver", () => {
    expect(slaSchema()).toEqual({
      name: "axis_case_sla_breach_estimate",
      schema: {
        type: "object",
        properties: {
          breachProbability: { type: "integer" },
          driver: {
            type: "object",
            properties: {
              feature: { type: "string" },
              detail: { type: "string" },
              evidenceRef: { type: "string" }
            },
            required: ["feature", "detail", "evidenceRef"]
          }
        },
        required: ["breachProbability", "driver"]
      }
    });
  });
});

describe("slaMessages", () => {
  const system = (): string => slaMessages(SLA_CTX)[0]!.content;

  it("sends the rules as system and the case as JSON, and nothing else", () => {
    const messages = slaMessages(SLA_CTX);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toBe(JSON.stringify(SLA_CTX));
  });

  it("names every input the estimate may read", () => {
    for (const input of [
      /kind, status, priority/,
      /hours remaining until the SLA is due/,
      /process step history/,
      /queue depth/,
      /owner load/
    ]) {
      expect(system()).toMatch(input);
    }
  });

  it("fixes the probability scale and the shape of the driver", () => {
    expect(system()).toMatch(/breachProbability \(0-100/);
    expect(system()).toMatch(/a single object naming the one observed feature/);
    expect(system()).toMatch(/detail, a human-readable comparison/);
    expect(system()).toMatch(/evidenceRef, the specific fact from the input/);
  });

  // parseSla drops an unevidenced driver and zeroes the probability with none;
  // the prompt has to ask for what the parser will keep, or every reply is halved.
  it("refuses an unevidenced driver and an undriven prediction", () => {
    expect(system()).toMatch(/never invent one you cannot point to evidence for/);
    expect(system()).toMatch(/an unexplained prediction is not a prediction/);
  });
});
