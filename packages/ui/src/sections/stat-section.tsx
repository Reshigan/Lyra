import * as React from "react";
import { AutoGrid } from "../horizon.js";
import { Badge } from "../primitives.js";
import { SectionShell, chipStyle, hueStyle, toneFromWord } from "./shared.js";
import type { StatSectionData, ScreenModule } from "./types.js";

export function StatSection({ section, mod }: { section: StatSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod}>
      <AutoGrid min="13rem">
        {section.items.map((item, i) => (
          <div
            key={`${item.label}-${i}`}
            className="flex flex-col gap-2 rounded-md border border-border p-3 transition-colors duration-150 ease-out hover:border-accent-line"
            style={chipStyle(item.bg, undefined, item.line)}
          >
            <p className="font-ui text-12 text-subtle" style={hueStyle(item.hue)}>
              {item.label}
            </p>
            <p className="font-mono text-22 font-medium tabular-nums" style={hueStyle(item.vhue)}>
              {item.value}
            </p>
            <div className="flex items-center gap-2">
              <Badge tone={toneFromWord(item.state)} size="sm">
                {item.state}
              </Badge>
              {item.note ? <span className="font-ui text-12 text-subtle">{item.note}</span> : null}
            </div>
          </div>
        ))}
      </AutoGrid>
    </SectionShell>
  );
}
