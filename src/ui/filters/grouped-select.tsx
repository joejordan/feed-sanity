import { useMemo } from 'react';
import type { ActionTone } from './schema';

export function pillClassFor(option: { readonly tone?: ActionTone } | undefined): string {
  return option?.tone ? `fr-pill fr-pill--${option.tone}` : 'fr-pill';
}

export interface GroupedOption {
  readonly value: string;
  readonly label: string;
  readonly group?: string;
}

export interface GroupedSelectProps {
  label: string;
  value: string;
  options: readonly GroupedOption[];
  onChange: (value: string) => void;
}

/** Drop-down with optional `<optgroup>`s that preserves unknown legacy saved values. */
export function GroupedSelect({ label, value, options, onChange }: GroupedSelectProps) {
  const known = options.some((opt) => opt.value === value);
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, GroupedOption[]>();
    for (const option of options) {
      const key = option.group ?? '';
      let bucket = map.get(key);
      if (!bucket) {
        bucket = [];
        map.set(key, bucket);
        order.push(key);
      }
      bucket.push(option);
    }
    return order.map((name) => ({ name, items: map.get(name) ?? [] }));
  }, [options]);

  return (
    <select
      className="field"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {!known && <option value={value}>{value ? `${value} (not supported yet)` : ''}</option>}
      {groups.map(({ name, items }) =>
        name ? (
          <optgroup key={name} label={name}>
            {items.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        ) : (
          items.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

export interface ToggleChipProps {
  label: string;
  glyph?: string;
  checked: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}

export function ToggleChip({ label, glyph, checked, title, onChange }: ToggleChipProps) {
  return (
    <label className="fr-chip" title={title}>
      <input
        className="fr-chip-input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {glyph && (
        <span className="fr-chip-glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span>{label}</span>
    </label>
  );
}
