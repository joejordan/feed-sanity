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

/** Live rule tester running the exact shared filter engine against editable sample fields. */
export function FilterTester({ filter, schema }: FilterTesterProps) {
  const defaultKeys = useMemo(() => {
    const sampleKeys = schema.sampleItem ? Object.keys(schema.sampleItem) : [];
    return sampleKeys.length > 0 ? sampleKeys : ['content'];
  }, [schema]);

  const [samples, setSamples] = useState<Record<string, string>>(() =>
    schema.sampleItem
      ? { ...schema.sampleItem }
      : { content: `Sample ${schema.itemSingular} text to test your filter.` },
  );

  const relevantTargets = useMemo(() => {
    const names = new Set<string>();
    const rules = filter.rules ?? [];
    const usesAny = rules.length === 0 || rules.some((r) => !r.target || r.target === 'any');
    if (usesAny) {
      for (const key of defaultKeys) {
        names.add(key);
      }
    } else if (defaultKeys[0]) {
      names.add(defaultKeys[0]);
    }
    for (const rule of rules) {
      // TODO(clean): adapt to the new condition model (parts and condition kinds).
      const target = rule.target;
      if (target && target !== 'any' && target !== 'day' && target !== 'age') {
        names.add(target);
      }
    }
    return [...names];
  }, [defaultKeys, filter.rules]);

  const report = useMemo(() => testFilterAgainstSample(filter, samples), [filter, samples]);

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
        {relevantTargets.map((target) => {
          const opt = findTargetOption(schema, target);
          const label = opt?.label ?? target;
          return (
            <label key={target} className="fr-field-label">
              Sample {label.toLowerCase()}
              <input
                className="field"
                type="text"
                aria-label={`Sample ${label}`}
                value={samples[target] ?? ''}
                onChange={(event) =>
                  setSamples((prev) => ({ ...prev, [target]: event.target.value }))
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
              ? `Would apply ${filter.actions?.length ?? 0} action${filter.actions?.length === 1 ? '' : 's'} to this ${schema.itemSingular}.`
              : `This sample ${schema.itemSingular} would pass through untouched.`}
          </span>
        </div>
        {report.rules.length > 0 && (
          <ul className="fr-test-list">
            {report.rules.map((item) => {
              let mark = '✗';
              let statusText = 'did not match';
              if (item.skipped) {
                mark = '•';
                statusText = 'skipped in text preview (evaluated live on page)';
              } else if (item.error) {
                mark = '!';
                statusText = item.error;
              } else if (item.matched) {
                mark = '✓';
                statusText = item.captured ? `matched "${item.captured}"` : 'matched';
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
