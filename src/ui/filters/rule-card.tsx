// The Advanced editor's card for one condition: which part to test, how, and
// the values, plus the options that fit the chosen test (negate, match case,
// whole words, regex flags), or the day and age controls.

import type {
  AgeCondition,
  Condition,
  ElementCondition,
  TextCondition,
  TextTest,
  WeekdayCondition,
} from '../../core/filter-types';
import type { ConditionTest, FilterSchema, FilterTargetOption, TestOption } from './schema';
import { AGE_UNITS, conditionOfKind } from '../../core/filter-types';
import { GroupedSelect, RemoveButton, ToggleChip, UnsupportedCard } from './grouped-select';
import { FilterIcon } from './icons';
import { replaced, withField, without } from './list-edit';
import {
  AGE_DIRECTION_OPTIONS,
  AGE_UNIT_LABELS,
  DAY_LABELS,
  DAY_NAMES,
  ELEMENT_TEST_OPTION,
  findTargetOption,
  findTestOption,
  TEXT_TEST_OPTIONS,
  targetValueOf,
} from './schema';
import { useStableKeys } from './use-stable-keys';

export interface ConditionCardProps {
  readonly condition: Condition;
  readonly schema: FilterSchema;
  /** Position in the filter, for accessible names (`Condition 2`). */
  readonly index: number;
  /** Validation error to show under the card. */
  readonly error?: string | null;
  readonly onChange: (next: Condition) => void;
  readonly onRemove?: (() => void) | undefined;
}

/** Rebuilds a text condition for a new test, dropping options the new test does not use. */
function withTextTest(condition: TextCondition, test: TextTest): TextCondition {
  const { wholeWords, regexFlags, ...rest } = condition;
  let next: TextCondition = { ...rest, test };
  if (test === 'contains' && wholeWords) {
    next = { ...next, wholeWords };
  }
  if (test === 'regex' && regexFlags) {
    next = { ...next, regexFlags };
  }
  return next;
}

/** The condition after the user picks another part. */
export function conditionForTarget(
  condition: Condition,
  target: FilterTargetOption | undefined,
  value: string,
): Condition {
  const kind = target?.kind ?? 'text';
  if (kind !== 'text') {
    return condition.kind === kind ? condition : conditionOfKind(kind);
  }
  if (condition.kind === 'text') {
    return { ...condition, part: value };
  }
  if (condition.kind === 'element' && target?.elementTest) {
    return condition;
  }
  return conditionOfKind('text', value);
}

/** The condition after the user picks another test. */
export function conditionForTest(
  condition: TextCondition | ElementCondition,
  test: ConditionTest,
  part: string,
): Condition {
  if (test === 'element') {
    if (condition.kind === 'element') {
      return condition;
    }
    const element: ElementCondition = { kind: 'element', selector: condition.values[0] ?? '' };
    return condition.negate ? { ...element, negate: true } : element;
  }
  if (condition.kind === 'text') {
    return withTextTest(condition, test);
  }
  const text: TextCondition = { kind: 'text', part, test, values: [condition.selector] };
  return condition.negate ? { ...text, negate: true } : text;
}

interface ValueListProps {
  readonly values: readonly string[];
  readonly regex: boolean;
  readonly placeholder: string | undefined;
  readonly label: string;
  readonly onChange: (values: readonly string[]) => void;
}

/** One input per value; the condition holds when any value matches. */
function ValueList({ values, regex, placeholder, label, onChange }: ValueListProps) {
  const shown = values.length > 0 ? values : [''];
  const keys = useStableKeys(shown.length);
  return (
    <div className="fr-action-fields">
      {shown.map((value, at) => (
        <div key={keys.keys[at] ?? at} className="fr-action-top">
          <input
            className={regex ? 'field fr-value-full fr-mono' : 'field fr-value-full'}
            type="text"
            aria-label={shown.length > 1 ? `${label} ${at + 1}` : label}
            placeholder={at === 0 ? placeholder : 'Another value'}
            value={value}
            onChange={(event) => onChange(replaced(shown, at, event.target.value))}
          />
          {shown.length > 1 && (
            <button
              className="fr-icon-btn"
              type="button"
              aria-label={`Remove ${label.toLowerCase()} ${at + 1}`}
              onClick={() => {
                keys.removeAt(at);
                onChange(without(shown, at));
              }}
            >
              <FilterIcon name="close" size={14} />
            </button>
          )}
        </div>
      ))}
      <button
        className="fr-link-btn"
        type="button"
        onClick={() => {
          keys.push();
          onChange([...shown, '']);
        }}
      >
        + Or another value
      </button>
    </div>
  );
}

function TextFields({
  condition,
  schema,
  onChange,
}: {
  readonly condition: TextCondition;
  readonly schema: FilterSchema;
  readonly onChange: (next: Condition) => void;
}) {
  const test = findTestOption(condition.test);
  const regex = condition.test === 'regex';
  return (
    <>
      <ValueList
        values={condition.values}
        regex={regex}
        label={regex ? 'Pattern' : 'Value'}
        placeholder={
          regex ? 'e.g. giveaway|free \\w+' : findTargetOption(schema, condition.part)?.placeholder
        }
        onChange={(values) => onChange({ ...condition, values })}
      />
      <div className="fr-chip-row">
        <ToggleChip
          label={test.negatedLabel}
          glyph="¬"
          checked={condition.negate === true}
          title="Holds when no value matches"
          onChange={(on) => onChange(withField(condition, 'negate', on))}
        />
        <ToggleChip
          label="Match case"
          glyph="Aa"
          checked={condition.matchCase === true}
          onChange={(on) => onChange(withField(condition, 'matchCase', on))}
        />
        {condition.test === 'contains' && (
          <ToggleChip
            label="Whole words only"
            glyph="ab"
            checked={condition.wholeWords === true}
            onChange={(on) => onChange(withField(condition, 'wholeWords', on))}
          />
        )}
        {regex && (
          <label className="fr-inline-field-label">
            <span className="fr-section-label">Flags</span>
            <input
              className="field fr-inline-field fr-mono fr-age-num"
              type="text"
              aria-label="Regex flags"
              placeholder="e.g. s, m, u"
              value={condition.regexFlags ?? ''}
              onChange={(event) =>
                onChange(withField(condition, 'regexFlags', event.target.value.trim()))
              }
            />
          </label>
        )}
      </div>
    </>
  );
}

function ElementFields({
  condition,
  schema,
  onChange,
}: {
  readonly condition: ElementCondition;
  readonly schema: FilterSchema;
  readonly onChange: (next: Condition) => void;
}) {
  return (
    <>
      <input
        className="field fr-value-full fr-mono"
        type="text"
        aria-label="CSS selector"
        placeholder={schema.selectorPlaceholder ?? 'e.g. video, a[href*="example.com"]'}
        value={condition.selector}
        onChange={(event) => onChange({ ...condition, selector: event.target.value })}
      />
      <div className="fr-chip-row">
        <ToggleChip
          label={ELEMENT_TEST_OPTION.negatedLabel}
          glyph="¬"
          checked={condition.negate === true}
          onChange={(on) => onChange(withField(condition, 'negate', on))}
        />
      </div>
    </>
  );
}

function WeekdayFields({
  condition,
  onChange,
}: {
  readonly condition: WeekdayCondition;
  readonly onChange: (next: Condition) => void;
}) {
  const toggle = (day: number, on: boolean) => {
    const days = condition.days.filter((item) => item !== day);
    onChange({ ...condition, days: on ? [...days, day].sort((a, b) => a - b) : days });
  };
  return (
    <fieldset className="fr-day-grid" aria-label="Days">
      {DAY_LABELS.map((label, day) => (
        <ToggleChip
          key={label}
          label={label}
          title={DAY_NAMES[day]}
          checked={condition.days.includes(day)}
          onChange={(on) => toggle(day, on)}
        />
      ))}
    </fieldset>
  );
}

function AgeFields({
  condition,
  onChange,
}: {
  readonly condition: AgeCondition;
  readonly onChange: (next: Condition) => void;
}) {
  return (
    <div className="fr-age-row">
      <select
        className="field"
        aria-label="Older or newer"
        value={condition.olderThan ? 'older' : 'newer'}
        onChange={(event) => onChange({ ...condition, olderThan: event.target.value === 'older' })}
      >
        {AGE_DIRECTION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        className="field fr-age-num"
        type="number"
        min={0}
        step="any"
        aria-label="Amount"
        value={String(condition.amount)}
        onChange={(event) => {
          // A cleared or half-typed amount keeps the saved one, so the filter
          // does not briefly match every item as "older than 0".
          const amount = event.target.valueAsNumber;
          if (Number.isFinite(amount)) {
            onChange({ ...condition, amount });
          }
        }}
      />
      <select
        className="field"
        aria-label="Unit"
        value={condition.unit}
        onChange={(event) =>
          onChange({
            ...condition,
            unit: AGE_UNITS.find((unit) => unit === event.target.value) ?? 'days',
          })
        }
      >
        {AGE_UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {AGE_UNIT_LABELS[unit]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Editor for one condition. */
export function ConditionCard({
  condition,
  schema,
  index,
  error,
  onChange,
  onRemove,
}: ConditionCardProps) {
  const errorNote = error ? (
    <p className="fr-field-error" role="alert">
      {error}
    </p>
  ) : null;

  if (condition.kind === 'unknown') {
    return <UnsupportedCard noun="condition" index={index} onRemove={onRemove} />;
  }

  const targetValue = targetValueOf(condition, schema);
  const target = findTargetOption(schema, targetValue);
  const partSelect = (
    <GroupedSelect
      label={schema.targetLabel}
      value={targetValue}
      options={schema.targets}
      onChange={(value) =>
        onChange(conditionForTarget(condition, findTargetOption(schema, value), value))
      }
    />
  );

  if (condition.kind === 'weekday' || condition.kind === 'age') {
    return (
      <div className="fr-block-card" data-kind={condition.kind}>
        <div className="fr-cond-top fr-cond-top--single">
          {partSelect}
          <RemoveButton noun="condition" index={index} onRemove={onRemove} />
        </div>
        {condition.kind === 'weekday' ? (
          <WeekdayFields condition={condition} onChange={onChange} />
        ) : (
          <AgeFields condition={condition} onChange={onChange} />
        )}
        {errorNote}
      </div>
    );
  }

  const tests: readonly TestOption[] =
    target?.elementTest || condition.kind === 'element'
      ? [...TEXT_TEST_OPTIONS, ELEMENT_TEST_OPTION]
      : TEXT_TEST_OPTIONS;
  const testValue: ConditionTest = condition.kind === 'element' ? 'element' : condition.test;

  return (
    <div className="fr-block-card" data-kind={condition.kind}>
      <div className="fr-cond-top">
        {partSelect}
        <select
          className="field"
          aria-label="Test"
          value={testValue}
          onChange={(event) => {
            const test = tests.find((option) => option.value === event.target.value)?.value;
            if (test) {
              onChange(conditionForTest(condition, test, targetValue));
            }
          }}
        >
          {tests.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <RemoveButton noun="condition" index={index} onRemove={onRemove} />
      </div>
      {condition.kind === 'element' ? (
        <ElementFields condition={condition} schema={schema} onChange={onChange} />
      ) : (
        <TextFields condition={condition} schema={schema} onChange={onChange} />
      )}
      {errorNote}
    </div>
  );
}
