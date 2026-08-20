import * as React from "react";
import { SectionShell, useMountAnimate } from "./shared.js";
import type { BarsSectionData, ScreenModule } from "./types.js";

export function BarsSection({ section, mod }: { section: BarsSectionData; mod: ScreenModule }) {
  const mounted = useMountAnimate();
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min}>
      <div className="flex flex-col gap-4 rounded-md bg-surface-2 p-4 shadow-elev">
        {section.items.map((item, i) => (
          <div key={i}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2.5">
              <span className="text-13 text-muted">{item.label}</span>
              <span className="font-mono text-13 tabular-nums" style={{ color: item.hue }}>
                {item.value}
              </span>
            </div>
            <div
              role="meter"
              aria-label={item.label}
              aria-valuetext={item.value}
              className="h-1.5 overflow-hidden rounded-orbit bg-surface-3"
            >
              <div
                className="h-1.5 rounded-orbit transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{ width: mounted ? item.w : "0%", background: item.hue }}
              />
            </div>
            {item.note ? <p className="mt-1.5 text-12 leading-relaxed text-subtle">{item.note}</p> : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
