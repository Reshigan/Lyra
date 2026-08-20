import * as React from "react";
import { SectionShell } from "./shared.js";
import type { KvSectionData, ScreenModule } from "./types.js";

export function KvSection({ section, mod }: { section: KvSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min}>
      <dl className="rounded-md bg-surface-2 px-4 shadow-elev">
        {section.items.map((item, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-4.5 border-b border-line px-1.5 py-3.5 transition-colors duration-150 ease-out last:border-b-0 hover:bg-surface-3"
          >
            <dt className="text-13 text-subtle">{item.label}</dt>
            <dd className="text-end text-13 tabular-nums" style={{ color: item.hue, fontFamily: item.font }}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </SectionShell>
  );
}
