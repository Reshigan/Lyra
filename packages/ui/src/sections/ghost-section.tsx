import * as React from "react";
import { cn } from "../cn.js";
import { AGENT_MARK } from "../ai.js";
import { SectionShell } from "./shared.js";
import type { GhostSectionData, ScreenModule } from "./types.js";

/**
 * The AI-draft kind (docs/07 §4 ghost text / docs/15 §4): a single ✦ chip
 * naming the agent, an inline "why", a confidence bar and the literal draft
 * text a person accepts, edits or discards via the `items` action chips.
 */
export function GhostSection({ section, mod }: { section: GhostSectionData; mod: ScreenModule }) {
  const [chosen, setChosen] = React.useState<number | null>(null);
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min} className="border-dashed">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-orbit border border-accent px-2.5 py-0.5 text-12 text-accent">
          <span aria-hidden="true">{AGENT_MARK}</span>
          <span>{section.agent}</span>
        </span>
        <span className="text-12 text-subtle">{section.why}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 text-12 text-subtle">How sure it is</span>
        <div
          role="meter"
          aria-label="Confidence"
          aria-valuetext={section.confLabel}
          className="h-1.5 w-35 overflow-hidden rounded-orbit bg-surface-3"
        >
          <div className="h-1.5" style={{ width: section.conf, background: section.confHue }} />
        </div>
        <span className="font-mono text-12" style={{ color: section.confHue }}>
          {section.confLabel}
        </span>
      </div>
      <p className="max-w-[68ch] border-s-2 border-line3 ps-4 text-16 leading-relaxed text-muted">{section.draft}</p>
      <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Actions">
        {section.items.map((chip, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={chosen === i}
            onClick={() => setChosen((current) => (current === i ? null : i))}
            className={cn(
              "rounded-md px-4 py-2 text-13 transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              chosen === i && "shadow-elev ring-2 ring-accent"
            )}
            style={{ background: chip.bg, color: chip.tx, borderColor: chip.line, borderWidth: 1, borderStyle: "solid" }}
          >
            {chip.label}
          </button>
        ))}
        {section.foot ? <span className="text-12 text-subtle">{section.foot}</span> : null}
      </div>
    </SectionShell>
  );
}
