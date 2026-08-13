import { describe, expect, it } from "vitest";
import { PERSONAS, labelsIn, outcomeOf, personaOf, type MessageRow } from "./orbit-dev";

// docs/modules/orbit.md §4 screen 7. The simulator's one piece of real logic
// is reading the transcript back: whether the drafting sweep actually produced
// a reply, or whether the run ended with the customer talking to nobody.

const row = (role: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id: `m_${role}_${Math.round(Math.random() * 1e9)}`,
  role,
  content: "hi",
  ...extra
});

describe("outcomeOf", () => {
  it("counts each side and sees a trailing unsent agent_ai as a pending draft", () => {
    const out = outcomeOf([row("customer"), row("customer"), row("agent_ai")]);
    expect(out).toEqual({ customer: 2, agent: 1, drafted: true });
  });

  it("does not call an already-delivered reply a draft", () => {
    // Same rule routes/conversation.tsx renders approve/discard on: once the
    // reply has a delivery status it has left the building, so there is
    // nothing left waiting for a human.
    expect(outcomeOf([row("customer"), row("agent_ai", { deliveryStatus: "sent" })]).drafted).toBe(false);
  });

  it("reports no draft when the sweep wrote nothing", () => {
    expect(outcomeOf([row("customer"), row("customer")])).toEqual({ customer: 2, agent: 0, drafted: false });
  });

  it("counts a human agent's turn as the agent's, and never as a draft", () => {
    const out = outcomeOf([row("customer"), row("agent_human")]);
    expect(out.agent).toBe(1);
    expect(out.drafted).toBe(false);
  });

  it("survives an empty transcript", () => {
    expect(outcomeOf([])).toEqual({ customer: 0, agent: 0, drafted: false });
  });
});

describe("personas", () => {
  it("ships at least one Arabic script, as the spec's screen 7 requires", () => {
    const arabic = PERSONAS.filter((persona) => persona.lang === "ar");
    expect(arabic.length).toBeGreaterThan(0);
    // Not a locale label: the lines must actually be in Arabic script, since
    // the point is exercising the agent's own language handling.
    expect(arabic.every((persona) => persona.lines.every((line) => /[؀-ۿ]/.test(line)))).toBe(true);
  });

  it("gives every persona a name in both locales, and a script to say", () => {
    for (const persona of PERSONAS) {
      expect(persona.lines.length).toBeGreaterThan(0);
      for (const locale of ["en", "ar"]) {
        const label = labelsIn(locale)(`persona.${persona.key}`);
        expect(label).not.toBe(`persona.${persona.key}`);
      }
    }
  });

  it("resolves a persona by key and refuses an unknown one", () => {
    expect(personaOf(PERSONAS[0]!.key)?.key).toBe(PERSONAS[0]!.key);
    expect(personaOf("does-not-exist")).toBeUndefined();
  });
});
