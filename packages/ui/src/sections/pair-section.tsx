import * as React from "react";
import { AutoGrid, Lede } from "../horizon.js";
import { SectionShell, chipStyle, hueStyle } from "./shared.js";
import type { PairSectionData, ScreenModule } from "./types.js";

export function PairSection({ section, mod }: { section: PairSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min}>
      <AutoGrid min="16rem">
        {section.items.map((item, i) => (
          <div
            key={`${item.label}-${i}`}
            className="flex flex-col gap-2 rounded-md border border-border p-3 transition-colors duration-150 ease-out hover:border-accent-line"
            style={chipStyle(item.bg, undefined, item.line)}
          >
            <p className="font-ui text-12 font-medium" style={hueStyle(item.hue)}>
              {item.star ? "✦ " : ""}
              {item.label}
            </p>
            <Lede className="text-16">{item.lede}</Lede>
            <ul className="flex flex-col gap-1.5">
              {item.points.map((point, j) => (
                <li key={j} className="font-ui text-13 leading-relaxed text-muted">
                  {point.body}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </AutoGrid>
    </SectionShell>
  );
}
