import { useMemo } from 'react';
import type { ActionTone } from './schema';
import { FilterIcon } from './icons';

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

/** Drop-down with optional `<optgroup>`s. A saved value it does not list stays selectable. */
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
  title?: string | undefined;
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

/** Trash button that removes a condition or action. Renders nothing without `onRemove`. */
export function RemoveButton({
  noun,
  index,
  onRemove,
}: {
  readonly noun: 'condition' | 'action';
  readonly index: number;
  readonly onRemove?: (() => void) | undefined;
}) {
  if (!onRemove) {
    return null;
  }
  return (
    <button
      className="fr-icon-btn fr-icon-btn--danger"
      type="button"
      aria-label={`Remove ${noun} ${index + 1}`}
      title={`Remove ${noun}`}
      onClick={onRemove}
    >
      <FilterIcon name="trash" />
    </button>
  );
}

/** Card for a saved condition or action this version does not understand. */
export function UnsupportedCard({
  noun,
  index,
  onRemove,
}: {
  readonly noun: 'condition' | 'action';
  readonly index: number;
  readonly onRemove?: (() => void) | undefined;
}) {
  const effect = noun === 'condition' ? 'is not used' : 'does nothing';
  return (
    <div className="fr-block-card" data-kind="unknown">
      <div className="fr-action-top">
        <span className="fr-adv-banner">
          This {noun} was saved by another version and {effect}. Remove it or edit the filter code.
        </span>
        <RemoveButton noun={noun} index={index} onRemove={onRemove} />
      </div>
    </div>
  );
}
