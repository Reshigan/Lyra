import { Link } from "react-router";
import { Badge, Button, hueVar } from "@lyra/ui";

// The flagship demo journey (AXIS -> NORTH -> SCOUT -> SIGNAL) is four real,
// API-backed routes (routes/journey-*.tsx), not fixture screens. This is the
// one piece of chrome all four share: which step you're on, and the link
// forward carrying the context each step refined. Not a 22nd section kind —
// Hero and ScreenState already live outside that contract in surface.tsx,
// this is the same kind of build-only chrome.

const STEPS = [
  { id: "axis", label: "AXIS", detail: "Transactions" },
  { id: "north", label: "NORTH", detail: "Insight" },
  { id: "scout", label: "SCOUT", detail: "Whitespace" },
  { id: "signal", label: "SIGNAL", detail: "Campaign" }
] as const;

export function JourneyNav({ current }: { current: (typeof STEPS)[number]["id"] }) {
  return (
    <nav aria-label="Demo journey" className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, i) => (
        <span key={step.id} className="flex items-center gap-2">
          {i > 0 ? (
            <span aria-hidden="true" className="text-subtle">
              &rarr;
            </span>
          ) : null}
          <Badge
            tone={step.id === current ? "accent" : "neutral"}
            style={step.id === current ? { borderColor: hueVar(step.id), color: hueVar(step.id) } : undefined}
          >
            {step.label} <span className="text-subtle">&middot; {step.detail}</span>
          </Badge>
        </span>
      ))}
    </nav>
  );
}

export function JourneyContinue({ to, label }: { to: string; label: string }) {
  return (
    <div className="flex justify-end">
      <Button asChild variant="primary">
        <Link to={to}>{label} &rarr;</Link>
      </Button>
    </div>
  );
}
