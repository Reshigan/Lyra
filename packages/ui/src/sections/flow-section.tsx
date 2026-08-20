import * as React from "react";
import { SectionShell } from "./shared.js";
import type { FlowSectionData, ScreenModule } from "./types.js";

export function FlowSection({ section, mod }: { section: FlowSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod}>
      {section.sub ? <p className="-mt-1 text-12 text-subtle">{section.sub}</p> : null}
      <div className="flex flex-col gap-1 rounded-md bg-surface-2 p-4 shadow-elev">
        {section.items.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-3.5 rounded-sm px-1.5 py-2 transition-colors duration-150 ease-out hover:bg-surface-3"
          >
            <div className="w-44 shrink-0 truncate text-end text-12 text-muted">{item.from}</div>
            <div className="h-1 flex-1 rounded-sm opacity-50" style={{ height: item.weight, background: item.hue }} />
            <div className="w-38 shrink-0 text-end font-mono text-12 tabular-nums" style={{ color: item.hue }}>
              {item.value}
            </div>
            <div className="w-44 shrink-0 truncate text-12 text-muted">{item.to}</div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
