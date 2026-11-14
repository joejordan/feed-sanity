import { useEffect, useId, useState } from 'react';
import type { LocatorOverrides, LocatorStats } from '../core/locator';
import type { SavedValue } from '../core/saved';
import type { OptionsPanel, PanelProps } from '../ui/options-dialog/panel';
import type { Diagnostics } from './collect';
import type { CheckedOverrides } from './overrides';
import { NAME } from '../../project';
import { definePanel } from '../ui/options-dialog/panel';
import css from './diagnostics-panel.css?inline';
import { checkOverrides, OVERRIDES_EXAMPLE, overridesText } from './overrides';
import {
  ago,
  badgeSummary,
  classNamesSummary,
  diagnosticsReport,
  NEVER_FOUND_AFTER,
  NOT_STARTED,
  neverFound,
  plural,
  postSummary,
  STRATEGY_STATES,
  slotSummary,
} from './report';

/** How often the numbers are read again while the section is shown. */
export const REFRESH_MS = 2000;

/** True for a locator the user should look at. */
const needsLook = (locator: LocatorStats): boolean =>
  neverFound(locator) ||
  locator.overridden ||
  locator.strategies.some((strategy) => strategy.state !== 'ready');

const names = (locators: readonly LocatorStats[]): string =>
  locators.map((locator) => locator.name).join(', ');

function Facts({ diagnostics }: { diagnostics: Diagnostics }) {
  const { version, build, pageType, badge, classNames } = diagnostics;
  return (
    <dl className="diag-facts">
      <dt>Version</dt>
      <dd>{version}</dd>
      <dt>Build</dt>
      <dd>{build}</dd>
      <dt>Page type</dt>
      <dd>{pageType}</dd>
      <dt>Toolbar badge</dt>
      <dd>{badgeSummary(badge)}</dd>
      <dt>Class names</dt>
      <dd>
        {classNamesSummary(classNames)}
        {classNames.started && classNames.missing.length > 0 && (
          <span className="diag-small">Missing: {classNames.missing.join(', ')}</span>
        )}
      </dd>
    </dl>
  );
}

function Features({ diagnostics }: { diagnostics: Diagnostics }) {
  return (
    <table className="diag-table">
      <thead>
        <tr>
          <th scope="col">Feature</th>
          <th scope="col">State</th>
          <th scope="col">Errors</th>
          <th scope="col">Last error</th>
        </tr>
      </thead>
      <tbody>
        {diagnostics.features.map(({ id, state, errors, lastError }) => (
          <tr key={id} className={state === 'failed' ? 'diag-failed' : undefined}>
            <td>{id}</td>
            <td>{state}</td>
            <td>{errors}</td>
            <td>{lastError ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Posts({ diagnostics }: { diagnostics: Diagnostics }) {
  const { posts } = diagnostics;
  if (!posts.started) {
    return <p className="diag-notice">{NOT_STARTED}</p>;
  }
  return (
    <>
      <p>{postSummary(posts)}</p>
      <p className={posts.unrecognised > 0 ? 'diag-warn' : undefined}>{slotSummary(posts)}</p>
    </>
  );
}

function LocatorRows({ locator, now }: { locator: LocatorStats; now: number }) {
  const never = neverFound(locator);
  const rowClass = never ? 'diag-never' : undefined;
  return (
    <>
      {locator.strategies.map((strategy, index) => (
        // Strategies have no identity of their own, and the list only changes as a whole.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <tr key={index} className={rowClass}>
          {index === 0 && (
            <th scope="rowgroup" rowSpan={locator.strategies.length}>
              <span className="diag-name">{locator.name}</span>{' '}
              <span className="diag-small">
                {locator.mode}, {plural(locator.lookups, 'lookup', 'lookups')}, {locator.found}{' '}
                found
              </span>{' '}
              {locator.overridden && <span className="diag-tag diag-yours">your selectors</span>}{' '}
              {never && <span className="diag-tag diag-bad">never found</span>}
            </th>
          )}
          <td className="diag-selector" title={strategy.note}>
            {strategy.selector}
          </td>
          <td>{strategy.seen ?? 'yours'}</td>
          <td className={strategy.state === 'ready' ? undefined : 'diag-warn'}>
            {STRATEGY_STATES[strategy.state]}
          </td>
          <td>{strategy.lookups}</td>
          <td>{strategy.found}</td>
          <td>{ago(strategy.lastFound, now)}</td>
        </tr>
      ))}
    </>
  );
}

function Locators({ diagnostics }: { diagnostics: Diagnostics }) {
  const [onlyToLook, setOnlyToLook] = useState(false);
  const { locators, at } = diagnostics;
  const never = locators.filter(neverFound);
  const overridden = locators.filter((locator) => locator.overridden);
  const shown = onlyToLook ? locators.filter(needsLook) : locators;
  return (
    <>
      {never.length > 0 && (
        <p className="diag-warn">
          Looked up {NEVER_FOUND_AFTER} times or more and never found anything: {names(never)}.
        </p>
      )}
      {overridden.length > 0 && <p>Your selectors stand in for: {names(overridden)}.</p>}
      <label className="diag-check">
        <input
          type="checkbox"
          checked={onlyToLook}
          onChange={(event) => setOnlyToLook(event.target.checked)}
        />
        Only show locators that are overridden, never found anything, or have a strategy that is not
        ready
      </label>
      <div className="diag-scroll">
        <table className="diag-table diag-locators">
          <thead>
            <tr>
              <th scope="col">Locator</th>
              <th scope="col">Selector</th>
              <th scope="col">Seen</th>
              <th scope="col">State</th>
              <th scope="col">Lookups</th>
              <th scope="col">Found</th>
              <th scope="col">Last found</th>
            </tr>
          </thead>
          {shown.map((locator) => (
            <tbody key={locator.name}>
              <LocatorRows locator={locator} now={at} />
            </tbody>
          ))}
        </table>
      </div>
      {onlyToLook && shown.length === 0 && <p className="empty">No locator needs a look.</p>}
    </>
  );
}

/** Checks the overrides the user typed. */
type Check = (text: string) => CheckedOverrides;

interface OverridesEditorProps extends PanelProps<string> {
  check: Check;
}

function OverridesEditor({ value, onChange, check }: OverridesEditorProps) {
  const id = useId();
  const { problems } = check(value);
  return (
    <>
      <p className="description" id={`${id}-description`}>
        Selectors typed here stand in for a locator's own, by locator name, as in{' '}
        <code>{OVERRIDES_EXAMPLE}</code>. They take effect when you save, with no reload.
      </p>
      <textarea
        className="field diag-code"
        rows={6}
        aria-label="Your selectors"
        aria-describedby={`${id}-description`}
        aria-invalid={problems.length > 0 || undefined}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {problems.length > 0 && (
        <ul className="diag-problems">
          {problems.map((problem) => (
            <li key={problem} className="error">
              {problem}
            </li>
          ))}
        </ul>
      )}
      <button className="button" type="button" onClick={() => onChange(overridesText({}))}>
        Use the built-in selectors
      </button>
    </>
  );
}

/** Whether the report was copied, or the report to copy by hand when it could not be. */
type Copied = { copied: true } | { failed: string };

interface DiagnosticsPanelProps extends PanelProps<string> {
  collect: () => Diagnostics;
  check: Check;
}

/**
 * The Diagnostics section: what the features, the post finder and the
 * locators have done on this page, a report to copy, and the user's own
 * selectors. The numbers are read when it opens and again every few
 * seconds while it is shown.
 */
export function DiagnosticsPanel({ value, onChange, collect, check }: DiagnosticsPanelProps) {
  const [diagnostics, setDiagnostics] = useState(collect);
  const [copy, setCopy] = useState<Copied>();

  useEffect(() => {
    const timer = setInterval(() => setDiagnostics(collect()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [collect]);

  const copyReport = async () => {
    const report = diagnosticsReport(diagnostics);
    try {
      await navigator.clipboard.writeText(report);
      setCopy({ copied: true });
    } catch {
      setCopy({ failed: report });
    }
  };

  return (
    <section className="diag">
      <div className="diag-line">
        <h3 className="diag-heading">Diagnostics</h3>
        <button className="button primary" type="button" onClick={() => void copyReport()}>
          Copy report
        </button>
      </div>
      <p className="description">
        What {NAME} has found on this page, read again every {REFRESH_MS / 1000} seconds while
        shown. The report holds counts, selectors, states and error messages, and no names, post
        text or page addresses.
      </p>
      {copy && 'copied' in copy && <p role="status">The report is copied.</p>}
      {copy && 'failed' in copy && (
        <>
          <p role="status" className="error">
            The report could not be copied. Select the text below and copy it.
          </p>
          <textarea
            className="field diag-code"
            rows={8}
            readOnly
            aria-label="Report"
            value={copy.failed}
          />
        </>
      )}
      <Facts diagnostics={diagnostics} />
      <h4 className="diag-subheading">Features</h4>
      <Features diagnostics={diagnostics} />
      <h4 className="diag-subheading">Posts</h4>
      <Posts diagnostics={diagnostics} />
      <h4 className="diag-subheading">Locators</h4>
      <Locators diagnostics={diagnostics} />
      <h4 className="diag-subheading">Your selectors</h4>
      <OverridesEditor value={value} onChange={onChange} check={check} />
    </section>
  );
}

export interface DiagnosticsPanelSource {
  /** Reads the diagnostics for the page now. */
  collect: () => Diagnostics;
  /** The user's locator overrides, the saved value `createPage` reads. */
  overrides: SavedValue<LocatorOverrides>;
  /** The name of every locator. A locator can become known after startup, when it is first used. */
  locatorNames: () => readonly string[];
}

/** The Diagnostics part of the options dialog. Its value is the overrides as the user typed them. */
export function diagnosticsPanel({
  collect,
  overrides,
  locatorNames,
}: DiagnosticsPanelSource): OptionsPanel {
  // The dialog asks on every render, and the editor asks again, mostly about the same text.
  let last: { text: string; checked: CheckedOverrides } | undefined;
  const check: Check = (text) => {
    if (last?.text !== text) {
      last = { text, checked: checkOverrides(text, locatorNames()) };
    }
    return last.checked;
  };
  return definePanel<string>({
    section: 'Diagnostics',
    css,
    ready: overrides.ready,
    read: () => overridesText(overrides.get()),
    save: async (text) => {
      const checked = check(text);
      if (checked.overrides === null) {
        throw new Error(`the locator overrides have problems: ${checked.problems.join(' ')}`);
      }
      await overrides.set(checked.overrides);
    },
    problem: (text) =>
      check(text).problems.length > 0
        ? 'Your selectors in Diagnostics have a mistake, so nothing is saved until it is fixed.'
        : null,
    Panel: (props) => <DiagnosticsPanel {...props} collect={collect} check={check} />,
  });
}
