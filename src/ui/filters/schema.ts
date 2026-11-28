// Declarative site-agnostic schema describing the targets, actions, and starter
// recipes available in the Filter Rules UI for any host site (Facebook,
// Instagram, X.com, Gmail, and future adapters).

import type { Filter, Rule } from '../../core/filter-types';
import type { FilterIconName } from './icons';

export type ActionTone = 'hide' | 'unhide' | 'style' | 'replace' | 'tab' | 'read';

export interface SimpleActionMeta {
  /** Concise goal-first tile heading (e.g. `'Hide'`, `'Highlight'`, `'Keep visible'`). */
  readonly title: string;
  /** Short 2–4 word micro-caption below the tile title. */
  readonly description: string;
  readonly icon: FilterIconName;
}

export interface FilterTargetOption {
  readonly value: string;
  readonly label: string;
  /** Optional `<optgroup>` heading in the target dropdown. */
  readonly group?: string;
  /** Contextual placeholder shown in the condition's value input. */
  readonly placeholder?: string;
  /** Special input mode for schedule/age rules (defaults to `'text'`). */
  readonly kind?: 'text' | 'day' | 'age';
  /** Promote as a Simple-mode target pill (3–5 per site). */
  readonly primary?: boolean;
  /** Concise pill label in Simple mode (defaults to `label`). */
  readonly simpleLabel?: string;
}

export interface FilterActionOption {
  readonly value: string;
  readonly label: string;
  /** Optional `<optgroup>` heading in the action dropdown. */
  readonly group?: string;
  /** Short badge label shown on list cards (e.g. `'Hide'`, `'Style'`, `'Tab'`). */
  readonly badge: string;
  readonly tone?: ActionTone;
  /** When present, renders this action as a Goal-first tile in Simple mode. */
  readonly simple?: SimpleActionMeta;
}

export interface FilterRecipe {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly badge: string;
  readonly tone?: ActionTone;
  readonly create: () => Filter;
}

export interface FilterSchema {
  /** Human-readable site name (e.g. `'Facebook'`, `'Instagram'`, `'X'`, `'Gmail'`). */
  readonly siteName: string;
  /** Singular noun for filtered items (e.g. `'post'`, `'thread'`). */
  readonly itemSingular: string;
  /** Plural noun for filtered items (e.g. `'posts'`, `'threads'`). */
  readonly itemPlural: string;
  /** Accessible label for the condition target `<select>` (e.g. `'Part of the post'`). */
  readonly targetLabel: string;
  /** Ordered list of selectable condition targets. */
  readonly targets: readonly FilterTargetOption[];
  /** Ordered list of selectable actions. */
  readonly actions: readonly FilterActionOption[];
  /** Targets that offer the element-selector comparison. */
  readonly selectorTargets?: readonly string[];
  /** Placeholder text for CSS selector rules. */
  readonly selectorPlaceholder?: string;
  /** 1-click starter recipes shown in empty state and the Recipes drawer. */
  readonly recipes: readonly FilterRecipe[];
  /** Default sample field values pre-populated in the live `Test rule` sandbox and preview. */
  readonly sampleItem?: Readonly<Record<string, string>>;
  /** Visual style for Simple mode's live mini-card preview (defaults to `'post'`). */
  readonly previewLayout?: 'post' | 'thread';
  /** Optional site-specific selector validator. */
  readonly validateSelector?: (selector: string) => string | null;
}

export interface HighlightPreset {
  readonly id: string;
  readonly label: string;
  readonly swatch: string;
  readonly css: string;
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Shared schedule condition target usable on any site (evaluated natively by `filter-engine.ts`). */
export const DAY_TARGET_OPTION: FilterTargetOption = {
  value: 'day',
  label: 'Day of week',
  group: 'Schedule',
  kind: 'day',
};

export const HIGHLIGHT_CSS = {
  accent: 'outline: 2px solid #3b82f6; outline-offset: -2px; border-radius: 8px;',
  gold: 'background-color: rgba(245, 158, 11, 0.14); border-left: 3px solid #d97706;',
  green: 'background-color: rgba(22, 163, 74, 0.14); border-left: 3px solid #16a34a;',
  dim: 'opacity: 0.35;',
} as const;

/** Shared Simple-mode goal-tile metadata for cross-site visibility & highlight actions. */
export const SIMPLE_ACTION_META = {
  hide: { title: 'Hide', description: 'Collapse or remove', icon: 'eyeOff' },
  css: { title: 'Highlight', description: 'Add color accent', icon: 'sparkle' },
  unhide: { title: 'Keep visible', description: 'Always allowlist', icon: 'shield' },
} as const satisfies Record<string, SimpleActionMeta>;

/** Standard 4 cross-site visibility/appearance actions parameterized by item noun (`'post'`, `'thread'`). */
export function standardFilterActions(itemSingular: string): readonly FilterActionOption[] {
  return [
    {
      value: 'hide',
      label: `Hide ${itemSingular}`,
      group: 'Visibility',
      badge: 'Hide',
      tone: 'hide',
      simple: SIMPLE_ACTION_META.hide,
    },
    {
      value: 'css',
      label: 'Highlight / CSS',
      group: 'Appearance',
      badge: 'Style',
      tone: 'style',
      simple: SIMPLE_ACTION_META.css,
    },
    {
      value: 'unhide',
      label: `Keep ${itemSingular} visible`,
      group: 'Visibility',
      badge: 'Keep',
      tone: 'unhide',
      simple: SIMPLE_ACTION_META.unhide,
    },
    { value: 'class', label: 'Add CSS class', group: 'Appearance', badge: 'Class', tone: 'style' },
    {
      value: 'replace',
      label: 'Replace text',
      group: 'Appearance',
      badge: 'Replace',
      tone: 'replace',
    },
  ];
}

/** 1-click visual highlight presets offered for `css` actions across every site. */
export const HIGHLIGHT_PRESETS: readonly HighlightPreset[] = [
  { id: 'accent', label: 'Accent border', swatch: '#3b82f6', css: HIGHLIGHT_CSS.accent },
  { id: 'gold', label: 'Warm highlight', swatch: '#d97706', css: HIGHLIGHT_CSS.gold },
  { id: 'green', label: 'Green tint', swatch: '#16a34a', css: HIGHLIGHT_CSS.green },
  { id: 'dim', label: 'Dim quietly', swatch: '#6b7280', css: HIGHLIGHT_CSS.dim },
];

// TODO(clean): operator lists for text, element and age conditions (filter-editor unit).

export function findTargetOption(
  schema: FilterSchema,
  value: string | undefined,
): FilterTargetOption | undefined {
  return schema.targets.find((item) => item.value === value);
}

export function findActionOption(
  schema: FilterSchema,
  value: string | undefined,
): FilterActionOption | undefined {
  return schema.actions.find((item) => item.value === value);
}

export function supportsSelectorOperator(schema: FilterSchema, rule: Rule): boolean {
  const allowed = schema.selectorTargets ?? ['any'];
  return allowed.includes(rule.target ?? '');
}

/** Curated Simple-mode target pills (falls back to the first 4 text targets when none are marked `primary`). */
export function getSimpleTargets(schema: FilterSchema): readonly FilterTargetOption[] {
  const primary = schema.targets.filter(
    (t) => t.primary === true && (!t.kind || t.kind === 'text'),
  );
  if (primary.length > 0) {
    return primary;
  }
  return schema.targets.filter((t) => !t.kind || t.kind === 'text').slice(0, 4);
}

/** Goal-first Simple-mode action tiles declared by `schema.actions`. */
export function getSimpleActions(
  schema: FilterSchema,
): readonly (FilterActionOption & { readonly simple: SimpleActionMeta })[] {
  return schema.actions.filter(
    (a): a is FilterActionOption & { readonly simple: SimpleActionMeta } => a.simple !== undefined,
  );
}
