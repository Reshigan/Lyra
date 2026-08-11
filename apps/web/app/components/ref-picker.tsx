import { useId, useState } from "react";
import { Input } from "@lyra/ui";

/**
 * Screens that hang work off a record — a screening's customer, a quote's
 * customer, a settlement's channel — asked for it as a plain text box, so the
 * only way to fill one in was to leave, copy a `cu_01KE…` out of another list
 * and paste it back. A person knows the name, not the id.
 *
 * The picker types over names and submits the id. It degrades on purpose: an
 * actor whose role cannot read the list gets no options and can still paste a
 * ref, which is exactly what the box did before.
 */
export interface RefOption {
  id: string;
  label: string;
}

/** What a person typed → what the form posts. */
export function refFor(typed: string, options: readonly RefOption[]): string {
  const text = typed.trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const named = options.find((option) => option.label.trim().toLowerCase() === lower);
  if (named) return named.id;
  // A pasted id stays an id, and so does anything the list has never heard of:
  // the server is the one that decides whether a ref exists.
  return text;
}

export interface RefPickerProps {
  name: string;
  options: readonly RefOption[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  /** Guards the visible box — the hidden field a form posts is never validated. */
  required?: boolean;
}

export function RefPicker({ name, options, defaultValue, placeholder, className, required }: RefPickerProps) {
  const listId = useId();
  const [typed, setTyped] = useState(
    () => options.find((option) => option.id === defaultValue)?.label ?? defaultValue ?? ""
  );
  return (
    <>
      <Input
        list={options.length ? listId : undefined}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={placeholder}
        maxLength={200}
        required={required}
        className={className}
        autoComplete="off"
      />
      {options.length ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.id} value={option.label} />
          ))}
        </datalist>
      ) : null}
      <input type="hidden" name={name} value={refFor(typed, options)} />
    </>
  );
}
