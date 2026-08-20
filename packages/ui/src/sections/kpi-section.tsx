import * as React from "react";
import { Sparkline } from "../data.js";
import { Figure, AutoGrid } from "../horizon.js";
import { SectionShell, chipStyle } from "./shared.js";
import type { KpiSectionData, ScreenModule } from "./types.js";

export function KpiSection({ section, mod }: { section: KpiSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod}>
      <AutoGrid min="14rem">
        {section.items.map((item, i) => (
          <div
            key={`${item.label}-${i}`}
            className="flex flex-col gap-2 rounded-md border border-border p-3 transition-colors duration-150 ease-out hover:border-accent-line"
            style={chipStyle(item.bg)}
          >
            <p className="font-ui text-12 text-subtle">{item.label}</p>
            <Figure
              value={item.value}
              {...(item.hasDelta ? { delta: item.delta } : {})}
              tone={item.hasDelta && item.dhue.includes("bad") ? "bad" : item.hasDelta ? "ok" : "neutral"}
            />
            {item.note ? <p className="font-ui text-12 text-subtle">{item.note}</p> : null}
            {item.hasSpark && item.spark.length ? (
              <Sparkline values={item.spark} label={item.label} />
            ) : null}
          </div>
        ))}
      </AutoGrid>
    </SectionShell>
  );
}
