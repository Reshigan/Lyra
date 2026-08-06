import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CommandBar } from "@lyra/ui";
import type { Translate } from "../i18n";
import type { SearchItem } from "../routes/search";

// The one client-side fetch in the shell. It goes to /search (this app), not the
// API — the session cookie is deliberately unreadable by script, so the loader
// there is what holds it.

/** A place the nav can already reach, named the way the nav names it. */
export interface Destination {
  href: string;
  label: string;
}

/**
 * The destinations that match what has been typed — the design's "Where"
 * overlay, folded into the palette instead of living as a second overlay
 * (ADR-0031). CommandBar's own filter is off here (onQueryChange is set,
 * because the record rows beside these are matched by the server on fields no
 * label shows), so the workspace rows are filtered here.
 */
export function matchingDestinations(
  destinations: readonly Destination[],
  query: string
): Destination[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...destinations];
  return destinations.filter((d) => d.label.toLowerCase().includes(q));
}

export function SearchPalette({ t, destinations }: { t: Translate; destinations: readonly Destination[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    const abort = new AbortController();
    // ponytail: one timer is the whole debounce. Reach for a library when the
    // palette needs more than "wait, then ask once".
    const timer = setTimeout(() => {
      void fetch(`/search?q=${encodeURIComponent(term)}`, {
        signal: abort.signal,
        headers: { accept: "application/json" }
      })
        .then((response) => (response.ok ? (response.json() as Promise<{ items: SearchItem[] }>) : { items: [] }))
        .then((body) => setItems(body.items))
        // Aborted, offline, or signed out mid-keystroke: the last results stand
        // rather than the palette flashing empty on every dropped request.
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  return (
    <>
      {/* Horizon's ask bar: the widest thing in the top bar, because asking is
          the first move on every screen. It is a button, not an input — the
          typing happens in the palette, and a second focusable field in the
          header would only be somewhere to lose a query. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-border bg-surface-2/50 px-2.5 text-start font-ui text-12 text-subtle transition-colors duration-150 hover:border-border-strong hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex"
      >
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-orbit bg-accent"
          style={{ animation: "var(--animate-twinkle)" }}
        />
        <span className="truncate">{t("search.open")}</span>
        {/* A key cap, not a word: the same two glyphs in every locale. */}
        <kbd className="ms-auto shrink-0 font-mono text-11 text-subtle">⌘K</kbd>
      </button>
      <CommandBar
        open={open}
        onOpenChange={setOpen}
        onQueryChange={setQuery}
        items={[
          ...matchingDestinations(destinations, query).map((destination) => ({
            id: `where:${destination.href}`,
            label: destination.label,
            group: t("search.goTo"),
            onSelect: () => navigate(destination.href)
          })),
          ...items.map((item) => ({
            id: item.id,
            label: item.label,
            hint: item.hint,
            group: t("search.results"),
            onSelect: () => navigate(item.href)
          })),
          // The door to the full results page. /search answers this palette with
          // ten rows per resource; when that is not enough, the same query goes
          // to a screen that can group and page it. Labelled with the palette's
          // own name because that is exactly what it does, in full.
          ...(query.trim().length < 2
            ? []
            : [
                {
                  id: "search-all",
                  label: t("search.label"),
                  group: t("search.results"),
                  onSelect: () => navigate(`/search/results?q=${encodeURIComponent(query.trim())}`)
                }
              ])
        ]}
        label={t("search.label")}
        placeholder={t("search.placeholder")}
        emptyLabel={query.trim().length < 2 ? t("search.prompt") : t("search.none")}
      />
    </>
  );
}
