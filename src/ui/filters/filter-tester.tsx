import { useMemo, useState } from 'react';
import type { Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { FilterIcon } from './icons';
import { findTargetOption } from './schema';
import { testFilterAgainstSample } from './tester';

export interface FilterTesterProps {
  filter: Filter;
  schema: FilterSchema;
}

/** The parts the tester asks samples for: every part a text condition tests. */
function testedParts(filter: Filter, sampleKeys: readonly string[]): string[] {
  const names = new Set<string>();
  for (const condition of filter.conditions) {
    if (condition.kind !== 'text') {
      continue;
    }
    if (condition.part === 'text') {
      // The whole item is made of every sample part.
      for (const key of sampleKeys) {
        names.add(key);
      }
    } else {
      names.add(condition.part);
    }
  }
  return [...names];
}

/** Live tester: runs the filter's conditions through the engine against editable sample parts. */
export function FilterTester({ filter, schema }: FilterTesterProps) {
  const [samples, setSamples] = useState<Record<string, string>>(() =>
    schema.sampleItem
      ? { ...schema.sampleItem }
      : { text: `Sample ${schema.itemSingular} text to test your filter.` },
  );
  const sampleKeys = useMemo(() => Object.keys(schema.sampleItem ?? { text: '' }), [schema]);
  const parts = useMemo(() => testedParts(filter, sampleKeys), [filter, sampleKeys]);
  const report = useMemo(
    () => testFilterAgainstSample(filter, samples, schema),
    [filter, samples, schema],
  );
  const actionCount = filter.actions.length;

  return (
    <details className="fr-disclosure">
      <summary>
        <FilterIcon name="play" size={14} />
        <span>Test rule</span>
        <span className={report.matched ? 'fr-pill fr-pill--match' : 'fr-pill'}>
          {report.matched ? 'Matches sample' : 'No match'}
        </span>
      </summary>
      <div className="fr-disclosure-body">
        {parts.map((part) => {
          const label = findTargetOption(schema, part)?.label ?? part;
          return (
            <label key={part} className="fr-field-label">
              Sample {label.toLowerCase()}
              <input
                className="field"
                type="text"
                aria-label={`Sample ${label}`}
                value={samples[part] ?? ''}
                onChange={(event) =>
                  setSamples((prev) => ({ ...prev, [part]: event.target.value }))
                }
              />
            </label>
          );
        })}
        <div className="fr-test-verdict" role="status">
          <span className={report.matched ? 'fr-pill fr-pill--match' : 'fr-pill'}>
            {report.matched ? 'Matches' : 'No match'}
          </span>
          <span>
            {report.matched
              ? `Would apply ${actionCount} action${actionCount === 1 ? '' : 's'} to this ${schema.itemSingular}.`
              : `This sample ${schema.itemSingular} would pass through untouched.`}
          </span>
        </div>
        {report.conditions.length > 0 && (
          <ul className="fr-test-list">
            {report.conditions.map((item) => {
              let mark = '✗';
              let statusText = 'did not match';
              if (item.skipped) {
                mark = '•';
                statusText = 'cannot be tested on a sample (checked on the page)';
              } else if (item.error) {
                mark = '!';
                statusText = item.error;
              } else if (item.matched) {
                mark = '✓';
                statusText = item.caught ? `matched "${item.caught}"` : 'matched';
              }
              return (
                <li key={item.index} className="fr-test-item">
                  <span className={item.matched ? 'fr-test-ok' : 'fr-test-no'}>{mark}</span>
                  <span>
                    Condition {item.index + 1}: {statusText}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
