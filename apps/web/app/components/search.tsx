import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CommandBar } from "@lyra/ui";
import type { Translate } from "../i18n";
import type { SearchItem } from "../routes/search";

// The one client-side fetch in the shell. It goes to /search (this app), not the
// API — the session cookie is deliberately unreadable by script, so the loader
// there is what holds it.

export function SearchPalette({ t }: { t: Translate }) {
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden rounded-md px-2.5 py-1.5 font-ui text-12 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text sm:inline-flex"
      >
        {t("search.open")}
        {/* A key cap, not a word: the same two glyphs in every locale. */}
        <kbd className="ms-2 font-mono text-11 text-subtle">⌘K</kbd>
      </button>
      <CommandBar
        open={open}
        onOpenChange={setOpen}
        onQueryChange={setQuery}
        items={[
          ...items.map((item) => ({
            id: item.id,
            label: item.label,
            hint: item.hint,
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
