import * as React from "react";
import { SectionShell, useMountAnimate } from "./shared.js";
import type { BandsSectionData, ScreenModule } from "./types.js";

export function BandsSection({ section, mod }: { section: BandsSectionData; mod: ScreenModule }) {
  const mounted = useMountAnimate();
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min}>
      {section.sub ? <p className="-mt-1 text-12 text-subtle">{section.sub}</p> : null}
      <div className="flex flex-col gap-4.5 rounded-md bg-surface-2 p-4 shadow-elev">
        {section.items.map((item, i) => (
          <div key={i}>
            <div className="mb-2 flex items-baseline justify-between gap-2.5">
              <span className="text-13 text-muted">{item.label}</span>
              <span className="font-mono text-14 tabular-nums" style={{ color: item.hue }}>
                {item.value}
              </span>
            </div>
            <div className="relative h-1.5 rounded-orbit bg-surface-3">
              <div
                className="absolute inset-y-0 rounded-orbit opacity-[0.32] transition-[width,inset-inline-start] duration-700 ease-out motion-reduce:transition-none"
                style={{
                  insetInlineStart: mounted ? item.bandL : "50%",
                  width: mounted ? item.bandW : "0%",
                  background: item.hue
                }}
              />
              <div
                className="absolute -top-0.75 -bottom-0.75 w-0.5 rounded-sm transition-[inset-inline-start] duration-700 ease-out motion-reduce:transition-none"
                style={{ insetInlineStart: mounted ? item.midL : "50%", background: item.hue }}
              />
            </div>
            {item.note ? <p className="mt-1.5 text-12 leading-relaxed text-subtle">{item.note}</p> : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
