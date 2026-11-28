// Site-agnostic description of what the filter editor offers on one site: the
// parts of an item a condition can test, the actions, starter recipes and
// sample values for the tester. Each site declares one `FilterSchema`.

import type {
  ActionKind,
  AgeUnit,
  Condition,
  Filter,
  FilterJoin,
  TextTest,
} from '../../core/filter-types';
import type { FilterIconName } from './icons';

/** Colour family of an action's badge and Simple-mode tile. */
export type ActionTone = 'hide' | 'keep' | 'style' | 'replace' | 'read';

export interface SimpleActionMeta {
  /** Short goal-first tile heading (`'Hide'`, `'Highlight'`, `'Keep visible'`). */
  readonly title: string;
  /** Two to four words under the tile heading. */
  readonly description: string;
  readonly icon: FilterIconName;
}

/** What kind of condition a target builds. */
export type TargetKind = 'text' | 'weekday' | 'age';

export interface FilterTargetOption {
  /** The part name for text targets; `'weekday'` or `'age'` for those targets. */
  readonly value: string;
  readonly label: string;
  /** Optional `<optgroup>` heading in the part dropdown. */
  readonly group?: string;
  /** Placeholder for the condition's value input. */
  readonly placeholder?: string;
  /** Condition kind this target builds (default `'text'`). */
  readonly kind?: TargetKind;
  /** The part's value is a list (hashtags, links, labels): the tester splits sample text. */
  readonly list?: boolean;
  /** Offers "contains an element matching selector". Only the whole-item part should. */
  readonly elementTest?: boolean;
  /** Offer as a Simple-mode target pill (3-5 per site). */
  readonly primary?: boolean;
  /** Short pill label in Simple mode (defaults to `label`). */
  readonly simpleLabel?: string;
}

export interface FilterActionOption {
  readonly value: ActionKind;
  readonly label: string;
  /** Optional `<optgroup>` heading in the action dropdown. */
  readonly group?: string;
  /** Short badge on list cards (`'Hide'`, `'Style'`, `'Keep'`). */
  readonly badge: string;
  readonly tone?: ActionTone;
  /** What the action does, shown on its card when it has no fields of its own. */
  readonly hint?: string;
  /** When present, the action is a goal tile in Simple mode. */
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
  /** Site name (`'Facebook'`, `'Instagram'`, `'X'`, `'Gmail'`). */
  readonly siteName: string;
  /** Singular noun for filtered items (`'post'`, `'thread'`). */
  readonly itemSingular: string;
  /** Plural noun for filtered items (`'posts'`, `'threads'`). */
  readonly itemPlural: string;
  /** Accessible label of the part `<select>` (`'Part of the post'`). */
  readonly targetLabel: string;
  /** Selectable condition targets, in dropdown order. The first text target is the default. */
  readonly targets: readonly FilterTargetOption[];
  /** Selectable actions, in dropdown order. */
  readonly actions: readonly FilterActionOption[];
  /** Placeholder for CSS selector inputs. */
  readonly selectorPlaceholder?: string;
  /** Starter recipes for the empty state and the Recipes drawer. */
  readonly recipes: readonly FilterRecipe[];
  /** Example part values (by part name) for the tester and the Simple preview. */
  readonly sampleItem?: Readonly<Record<string, string>>;
  /** Layout of Simple mode's preview card (default `'post'`). */
  readonly previewLayout?: 'post' | 'thread';
  /** Optional site-specific selector check. Returns an error message, or null. */
  readonly validateSelector?: (selector: string) => string | null;
}

export interface HighlightPreset {
  readonly id: string;
  readonly label: string;
  readonly swatch: string;
  readonly css: string;
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Day-of-week target, usable on any site (the core engine tests it). */
export const WEEKDAY_TARGET_OPTION: FilterTargetOption = {
  value: 'weekday',
  label: 'Day of the week',
  group: 'Schedule',
  kind: 'weekday',
};

/** Item-age target, for sites whose filters can read an item's time. */
export const AGE_TARGET_OPTION: FilterTargetOption = {
  value: 'age',
  label: 'Age',
  group: 'Schedule',
  kind: 'age',
};

export const HIGHLIGHT_CSS = {
  accent: 'outline: 2px solid #3b82f6; outline-offset: -2px; border-radius: 8px;',
  gold: 'background-color: rgba(245, 158, 11, 0.14); border-left: 3px solid #d97706;',
  green: 'background-color: rgba(22, 163, 74, 0.14); border-left: 3px solid #16a34a;',
  dim: 'opacity: 0.35;',
} as const;

/** Simple-mode goal tiles shared by every site. */
export const SIMPLE_ACTION_META = {
  hide: { title: 'Hide', description: 'Collapse or remove', icon: 'eyeOff' },
  style: { title: 'Highlight', description: 'Add color accent', icon: 'sparkle' },
  keep: { title: 'Keep visible', description: 'Always allowlist', icon: 'shield' },
} as const satisfies Record<string, SimpleActionMeta>;

/** The actions every site offers, worded for `itemSingular` (`'post'`, `'thread'`). */
export function standardFilterActions(itemSingular: string): readonly FilterActionOption[] {
  return [
    {
      value: 'hide',
      label: `Hide the ${itemSingular}`,
      group: 'Visibility',
      badge: 'Hide',
      tone: 'hide',
      simple: SIMPLE_ACTION_META.hide,
    },
    {
      value: 'style',
      label: 'Highlight or restyle',
      group: 'Appearance',
      badge: 'Style',
      tone: 'style',
      simple: SIMPLE_ACTION_META.style,
    },
    {
      value: 'keep',
      label: `Keep the ${itemSingular} visible`,
      group: 'Visibility',
      badge: 'Keep',
      tone: 'keep',
      hint: `Undoes hiding by earlier filters and the quick switches. Turn on "Stop later filters" so later filters cannot hide the ${itemSingular} again.`,
      simple: SIMPLE_ACTION_META.keep,
    },
    {
      value: 'add_class',
      label: 'Add a CSS class',
      group: 'Appearance',
      badge: 'Class',
      tone: 'style',
    },
    {
      value: 'replace',
      label: 'Replace text',
      group: 'Appearance',
      badge: 'Replace',
      tone: 'replace',
    },
  ];
}

/** One-click highlight styles offered for `style` actions on every site. */
export const HIGHLIGHT_PRESETS: readonly HighlightPreset[] = [
  { id: 'accent', label: 'Accent border', swatch: '#3b82f6', css: HIGHLIGHT_CSS.accent },
  { id: 'gold', label: 'Warm highlight', swatch: '#d97706', css: HIGHLIGHT_CSS.gold },
  { id: 'green', label: 'Green tint', swatch: '#16a34a', css: HIGHLIGHT_CSS.green },
  { id: 'dim', label: 'Dim quietly', swatch: '#6b7280', css: HIGHLIGHT_CSS.dim },
];

// ---------------------------------------------------------------------------
// Test (operator) lists
// ---------------------------------------------------------------------------

/** The test select's value: a text test, or the element test. */
export type ConditionTest = TextTest | 'element';

export interface TestOption {
  readonly value: ConditionTest;
  /** Wording in the select and in summaries (`'contains'`). */
  readonly label: string;
  /** Wording when negated (`'does not contain'`). */
  readonly negatedLabel: string;
}

/** Tests for text conditions, in select order. */
export const TEXT_TEST_OPTIONS: readonly TestOption[] = [
  { value: 'contains', label: 'contains', negatedLabel: 'does not contain' },
  { value: 'is', label: 'is exactly', negatedLabel: 'is not exactly' },
  { value: 'starts', label: 'starts with', negatedLabel: 'does not start with' },
  { value: 'ends', label: 'ends with', negatedLabel: 'does not end with' },
  { value: 'regex', label: 'matches regex', negatedLabel: 'does not match regex' },
];

/** The element test, offered only on targets with `elementTest`. */
export const ELEMENT_TEST_OPTION: TestOption = {
  value: 'element',
  label: 'contains an element matching',
  negatedLabel: 'has no element matching',
};

export interface AgeDirectionOption {
  readonly value: 'older' | 'newer';
  readonly label: string;
}

/** Directions for age conditions (`olderThan` true / false). */
export const AGE_DIRECTION_OPTIONS: readonly AgeDirectionOption[] = [
  { value: 'older', label: 'older than' },
  { value: 'newer', label: 'newer than' },
];

/** Labels of the age units. */
export const AGE_UNIT_LABELS: Readonly<Record<AgeUnit, string>> = {
  hours: 'hours',
  days: 'days',
};

/** Wording of the two joins, for the combine toggle and summaries. */
export const JOIN_LABELS: Readonly<Record<FilterJoin, string>> = {
  all: 'all conditions',
  any: 'any condition',
};

export function findTestOption(test: ConditionTest): TestOption {
  return test === 'element'
    ? ELEMENT_TEST_OPTION
    : (TEXT_TEST_OPTIONS.find((option) => option.value === test) ??
        (TEXT_TEST_OPTIONS[0] as TestOption));
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

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

function isTextTarget(target: FilterTargetOption): boolean {
  return (target.kind ?? 'text') === 'text';
}

/** The target that offers the element test (the whole-item part), if any. */
export function elementTarget(schema: FilterSchema): FilterTargetOption | undefined {
  return schema.targets.find((target) => target.elementTest === true);
}

/** The first text target: where new conditions start. */
export function defaultTextPart(schema: FilterSchema): string {
  return schema.targets.find(isTextTarget)?.value ?? 'text';
}

/**
 * The part select's value for `condition`: its part for text conditions, the
 * element-test target for element conditions, and the kind otherwise.
 */
export function targetValueOf(condition: Condition, schema: FilterSchema): string {
  switch (condition.kind) {
    case 'text':
      return condition.part;
    case 'element':
      return elementTarget(schema)?.value ?? 'text';
    case 'weekday':
    case 'age':
      return (
        schema.targets.find((target) => target.kind === condition.kind)?.value ?? condition.kind
      );
    default:
      return '';
  }
}

/** Simple-mode target pills: the `primary` text targets, else the first four text targets. */
export function getSimpleTargets(schema: FilterSchema): readonly FilterTargetOption[] {
  const textTargets = schema.targets.filter(isTextTarget);
  const primary = textTargets.filter((target) => target.primary === true);
  return primary.length > 0 ? primary : textTargets.slice(0, 4);
}

/** Simple-mode goal tiles declared by `schema.actions`. */
export function getSimpleActions(
  schema: FilterSchema,
): readonly (FilterActionOption & { readonly simple: SimpleActionMeta })[] {
  return schema.actions.filter(
    (a): a is FilterActionOption & { readonly simple: SimpleActionMeta } => a.simple !== undefined,
  );
}
