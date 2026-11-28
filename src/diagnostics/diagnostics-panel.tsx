import { useEffect, useId, useState } from 'react';
import type { FeatureState } from '../core/app';
import type { LocatorOverrides, LocatorStats } from '../core/locator';
import type { SavedValue } from '../core/saved';
import type { OptionsPanel, PanelProps } from '../ui/options-dialog/panel';
import type { Diagnostics } from './collect';
import type { CheckedOverrides } from './overrides';
import { NAME } from '../../project';
import { definePanel } from '../ui/options-dialog/panel';
import { Badge, Disclosure, SettingCard, UiIcon } from '../ui/primitives';
import css from './diagnostics-panel.css?inline';
import { checkOverrides, OVERRIDES_EXAMPLE, overridesText } from './overrides';
import {
  ago,
  badgeSummary,
  bridgeSummary,
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

const FEATURE_WORD_OVERRIDES: Readonly<Record<string, string>> = {
  css: 'CSS',
  id: 'ID',
  ig: 'Instagram',
  x: 'X',
};

function formatFeatureLabel(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => FEATURE_WORD_OVERRIDES[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function featureBadgeTone(state: FeatureState): 'success' | 'warning' | 'neutral' {
  if (state === 'running') {
    return 'success';
  }
  if (state === 'failed') {
    return 'warning';
  }
  return 'neutral';
}

function bridgeShortLabel(state: Diagnostics['bridge']['state']): {
  readonly label: string;
  readonly tone: 'success' | 'warning' | 'neutral';
} {
  switch (state) {
    case 'connected':
      return { label: 'Connected', tone: 'success' };
    case 'connecting':
      return { label: 'Connecting…', tone: 'neutral' };
    case 'not started':
      return { label: 'Standby', tone: 'neutral' };
    default:
      return { label: 'Unavailable', tone: 'warning' };
  }
}

function HealthOverview({
  diagnostics,
  itemNoun,
  livePaused,
  onToggleLive,
  onRefresh,
  onCopy,
}: {
  diagnostics: Diagnostics;
  itemNoun: string;
  livePaused: boolean;
  onToggleLive: () => void;
  onRefresh: () => void;
  onCopy: () => void;
}) {
  const failed = diagnostics.features.filter((f) => f.state === 'failed');
  const running = diagnostics.features.filter((f) => f.state === 'running');
  const brokenLocators = diagnostics.locators.filter(neverFound);
  const bridgeDown = diagnostics.bridge.state === 'unavailable';
  const issues: string[] = [];
  if (failed.length > 0) {
    issues.push(
      `${plural(failed.length, 'feature', 'features')} stopped with errors: ${failed.map((f) => f.id).join(', ')}`,
    );
  }
  if (bridgeDown) {
    issues.push(
      `Page bridge unavailable (${diagnostics.bridge.problem ?? 'page script did not answer'})`,
    );
  }
  if (brokenLocators.length > 0) {
    issues.push(
      `${plural(brokenLocators.length, 'locator', 'locators')} stopped matching: ${names(brokenLocators)}`,
    );
  }

  let healthState: 'healthy' | 'warning' | 'error' = 'healthy';
  let headline = 'All systems healthy';
  if (failed.length > 0 || bridgeDown) {
    healthState = 'error';
    headline =
      issues.length === 1 ? '1 issue needs attention' : `${issues.length} issues need attention`;
  } else if (brokenLocators.length > 0) {
    healthState = 'warning';
    headline = `${plural(brokenLocators.length, 'selector', 'selectors')} stopped matching`;
  }

  const bridgePill = bridgeShortLabel(diagnostics.bridge.state);
  const trackedValue = diagnostics.posts.started ? String(diagnostics.posts.tracked) : 'Standby';
  const trackedSub = diagnostics.posts.started
    ? `${diagnostics.posts.withId} with ID`
    : 'Idle until filtering runs';

  return (
    <div className="diag-overview">
      <div className="diag-hero" data-health={healthState}>
        <div className="diag-hero-main">
          <div className="diag-hero-title-row">
            <span className="diag-status-dot" data-health={healthState} aria-hidden="true" />
            <h3 className="diag-heading">{headline}</h3>
            <Badge tone={healthState === 'healthy' ? 'success' : 'warning'}>
              {healthState === 'healthy' ? 'Healthy' : 'Attention'}
            </Badge>
          </div>
          <p className="diag-hero-meta">
            {livePaused
              ? `Snapshot paused · last checked ${formatClock(diagnostics.at)}`
              : `Live snapshot · updates every ${REFRESH_MS / 1000}s · last checked ${formatClock(diagnostics.at)}`}
          </p>
          {issues.length > 0 && (
            <div className="diag-issue-list">
              {issues.map((issue) => (
                <p key={issue} className="diag-issue-item">
                  • {issue}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="diag-hero-actions">
          <button className="button" type="button" aria-pressed={livePaused} onClick={onToggleLive}>
            {livePaused ? 'Resume live' : 'Pause'}
          </button>
          <button className="button" type="button" onClick={onRefresh}>
            <UiIcon name="refresh" size={13} />
            Refresh
          </button>
          <button className="button primary" type="button" onClick={onCopy}>
            Copy report
          </button>
        </div>
      </div>

      <div className="diag-kpis">
        <div className="diag-kpi">
          <span className="diag-kpi-label">Features</span>
          <strong className="diag-kpi-value">
            {running.length} / {diagnostics.features.length}
          </strong>
          <span className="diag-kpi-sub">
            {failed.length > 0 ? `${failed.length} failed` : 'Running on this page'}
          </span>
        </div>
        <div className="diag-kpi">
          <span className="diag-kpi-label">Hidden on tab</span>
          <strong className="diag-kpi-value">
            {diagnostics.badge.failed ? '!' : diagnostics.badge.count}
          </strong>
          <span className="diag-kpi-sub">Toolbar badge count</span>
        </div>
        <div className="diag-kpi">
          <span className="diag-kpi-label">Page bridge</span>
          <div className="diag-kpi-badge">
            <Badge tone={bridgePill.tone}>{bridgePill.label}</Badge>
          </div>
          <span className="diag-kpi-sub">Site data &amp; API hook</span>
        </div>
        <div className="diag-kpi">
          <span className="diag-kpi-label">Tracked {itemNoun.toLowerCase()}</span>
          <strong className="diag-kpi-value">{trackedValue}</strong>
          <span className="diag-kpi-sub">{trackedSub}</span>
        </div>
      </div>
    </div>
  );
}

function Facts({ diagnostics }: { diagnostics: Diagnostics }) {
  const { version, build, pageType, badge, classNames, bridge } = diagnostics;
  const showClassNames = classNames.started || classNames.total > 0;
  return (
    <SettingCard title="Environment & Page Bridge">
      <dl className="diag-facts">
        <div className="diag-fact-row">
          <dt>Version</dt>
          <dd>{version}</dd>
        </div>
        <div className="diag-fact-row">
          <dt>Build</dt>
          <dd>{build}</dd>
        </div>
        <div className="diag-fact-row">
          <dt>Page type</dt>
          <dd>
            <code>{pageType}</code>
          </dd>
        </div>
        <div className="diag-fact-row">
          <dt>Toolbar badge</dt>
          <dd>{badgeSummary(badge)}</dd>
        </div>
        <div className="diag-fact-row">
          <dt>Page bridge</dt>
          <dd className={bridge.state === 'unavailable' ? 'diag-warn' : undefined}>
            {bridgeSummary(bridge)}
            <span className="diag-small">
              Reads React fiber data, timeline APIs, and page controls without breaking site code.
            </span>
          </dd>
        </div>
        {showClassNames && (
          <div className="diag-fact-row">
            <dt>Class names</dt>
            <dd>
              {classNamesSummary(classNames)}
              {classNames.started && classNames.missing.length > 0 && (
                <span className="diag-small">Missing: {classNames.missing.join(', ')}</span>
              )}
            </dd>
          </div>
        )}
      </dl>
    </SettingCard>
  );
}

function Features({ diagnostics }: { diagnostics: Diagnostics }) {
  return (
    <SettingCard title="Features">
      <div className="diag-card-pad">
        <p className="diag-help">
          Each module running on this page. <strong>off</strong> means disabled in your settings;{' '}
          <strong>failed</strong> means a module stopped itself after repeated runtime errors.
        </p>
        <div className="diag-scroll">
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
                  <td>
                    <span className="diag-feature-label">{formatFeatureLabel(id)}</span>
                    <span className="diag-feature-id">{id}</span>
                  </td>
                  <td>
                    <Badge tone={featureBadgeTone(state)}>{state}</Badge>
                  </td>
                  <td className="diag-num">{errors}</td>
                  <td className="diag-err-cell">{lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SettingCard>
  );
}

function Posts({ diagnostics, itemNoun }: { diagnostics: Diagnostics; itemNoun: string }) {
  const { posts } = diagnostics;
  return (
    <SettingCard title={`${itemNoun} detection`}>
      <div className="diag-card-pad">
        {posts.started ? (
          <div className="diag-posts-copy">
            <p>{postSummary(posts)}</p>
            <p className={posts.unrecognised > 0 ? 'diag-warn' : undefined}>{slotSummary(posts)}</p>
            <p className="diag-help">
              Items without an ID are typically promoted ads or special cards without a standard
              permalink.
            </p>
          </div>
        ) : (
          <p className="diag-notice">{NOT_STARTED}</p>
        )}
      </div>
    </SettingCard>
  );
}

function ExtraSections({ diagnostics }: { diagnostics: Diagnostics }) {
  if (!diagnostics.extraSections || diagnostics.extraSections.length === 0) {
    return null;
  }
  return (
    <>
      {diagnostics.extraSections.map((section) => (
        <SettingCard key={section.title} title={section.title}>
          <dl className="diag-facts">
            {section.lines.map((line) => {
              const colon = line.indexOf(':');
              if (colon > 0 && colon < line.length - 1) {
                const label = line.slice(0, colon).trim();
                const value = line.slice(colon + 1).trim();
                return (
                  <div key={line} className="diag-fact-row">
                    <dt>{label}</dt>
                    <dd className="diag-num">{value}</dd>
                  </div>
                );
              }
              return (
                <div key={line} className="diag-fact-row">
                  <dd>{line}</dd>
                </div>
              );
            })}
          </dl>
        </SettingCard>
      ))}
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
          <td className="diag-num">{strategy.lookups}</td>
          <td className="diag-num">{strategy.found}</td>
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
      <p className="diag-help">
        Locators are the CSS selectors {NAME} uses to find posts, menus, and videos on this site. If
        a site redesign breaks a feature, check which locator stopped matching and override it
        below.
      </p>
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
      <button
        className="button"
        type="button"
        disabled={value.trim() === '' || value.trim() === '{}'}
        onClick={() => onChange(overridesText({}))}
      >
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
  itemNoun?: string;
  scrubMessage?: (message: string) => string;
  scrubPageType?: (pageType: string) => string;
  consumePendingInspector?: () => boolean;
  registerInspectorOpener?: (fn: (() => void) | undefined) => void;
}

/**
 * The Diagnostics section: live health overview, active features, page bridge
 * & environment telemetry, bug report export, and collapsible DOM locator
 * inspector with selector overrides.
 */
export function DiagnosticsPanel({
  value,
  onChange,
  notify,
  collect,
  check,
  itemNoun = 'Posts',
  scrubMessage,
  scrubPageType,
  consumePendingInspector,
  registerInspectorOpener,
}: DiagnosticsPanelProps) {
  const [diagnostics, setDiagnostics] = useState(collect);
  const [copy, setCopy] = useState<Copied>();
  const [livePaused, setLivePaused] = useState(false);
  const trimmed = value.trim();
  const [inspectorOpen, setInspectorOpen] = useState(
    () => Boolean(consumePendingInspector?.()) || (trimmed !== '' && trimmed !== '{}'),
  );

  useEffect(() => {
    if (!registerInspectorOpener) {
      return;
    }
    registerInspectorOpener(() => setInspectorOpen(true));
    return () => registerInspectorOpener(undefined);
  }, [registerInspectorOpener]);

  useEffect(() => {
    if (livePaused) {
      return;
    }
    const timer = setInterval(() => setDiagnostics(collect()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [collect, livePaused]);

  const copyReport = async () => {
    const report = diagnosticsReport(diagnostics, scrubMessage, scrubPageType);
    try {
      await navigator.clipboard.writeText(report);
      if (notify) {
        setCopy(undefined);
        notify('The report is copied. No names, post text, or page addresses are included.');
      } else {
        setCopy({ copied: true });
      }
    } catch {
      setCopy({ failed: report });
    }
  };

  const brokenCount = diagnostics.locators.filter(neverFound).length;
  const overriddenCount = diagnostics.locators.filter((l) => l.overridden).length;
  let locatorBadge: ReturnType<typeof Badge> | undefined;
  if (brokenCount > 0) {
    locatorBadge = <Badge tone="warning">{brokenCount} never found</Badge>;
  } else if (overriddenCount > 0) {
    locatorBadge = <Badge tone="accent">{overriddenCount} custom</Badge>;
  } else if (diagnostics.locators.length > 0) {
    locatorBadge = <Badge>{diagnostics.locators.length}</Badge>;
  }

  return (
    <section className="diag">
      <div data-fs-jump-id="copy-report">
        <HealthOverview
          diagnostics={diagnostics}
          itemNoun={itemNoun}
          livePaused={livePaused}
          onToggleLive={() => setLivePaused((paused) => !paused)}
          onRefresh={() => setDiagnostics(collect())}
          onCopy={() => void copyReport()}
        />
      </div>

      {copy && 'copied' in copy && (
        <p role="status" className="diag-copy-status">
          The report is copied. No names, post text, or page addresses are included.
        </p>
      )}
      {copy && 'failed' in copy && (
        <SettingCard title="Report">
          <div className="diag-card-pad">
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
          </div>
        </SettingCard>
      )}

      <Features diagnostics={diagnostics} />
      <Posts diagnostics={diagnostics} itemNoun={itemNoun} />
      <ExtraSections diagnostics={diagnostics} />
      <Facts diagnostics={diagnostics} />

      <SettingCard jumpId="locator-overrides">
        <Disclosure
          label="Locator inspector & custom selectors"
          badge={locatorBadge}
          open={inspectorOpen}
          onToggle={() => setInspectorOpen((open) => !open)}
        >
          <div className="diag-drawer-pad">
            <h4 className="diag-subheading">Locators</h4>
            <Locators diagnostics={diagnostics} />
            <h4 className="diag-subheading">Your selectors</h4>
            <OverridesEditor value={value} onChange={onChange} check={check} />
          </div>
        </Disclosure>
      </SettingCard>
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
  /** Optional plural item noun for this site (e.g. `'Threads'` on Gmail, default `'Posts'`). */
  itemNoun?: string;
  /** Optional site-specific PII scrubber for the text report. */
  scrubMessage?: (message: string) => string;
  /** Optional scrubber for `pageType` in copied reports (e.g. masking Facebook profile slugs). */
  scrubPageType?: (pageType: string) => string;
}

/** The Diagnostics part of the options dialog. Its value is the overrides as the user typed them. */
export function diagnosticsPanel({
  collect,
  overrides,
  locatorNames,
  itemNoun = 'Posts',
  scrubMessage,
  scrubPageType,
}: DiagnosticsPanelSource): OptionsPanel {
  // The dialog asks on every render, and the editor asks again, mostly about the same text.
  let last: { text: string; checked: CheckedOverrides } | undefined;
  const check: Check = (text) => {
    if (last?.text !== text) {
      last = { text, checked: checkOverrides(text, locatorNames()) };
    }
    return last.checked;
  };
  let inspectorPending = false;
  let inspectorOpener: (() => void) | undefined;
  const requestInspector = (): void => {
    if (inspectorOpener) {
      inspectorOpener();
    } else {
      inspectorPending = true;
    }
  };
  const consumePendingInspector = (): boolean => {
    const pending = inspectorPending;
    inspectorPending = false;
    return pending;
  };
  const registerInspectorOpener = (fn: (() => void) | undefined): void => {
    inspectorOpener = fn;
    if (fn && inspectorPending) {
      inspectorPending = false;
      fn();
    }
  };
  return definePanel<string>({
    section: 'Diagnostics',
    css,
    ready: overrides.ready,
    read: () => overridesText(overrides.get()),
    searchItems: () => [
      {
        id: 'copy-report',
        title: 'Copy diagnostics bug report',
        description: 'Copy PII-scrubbed feature, bridge, and locator health report.',
        keywords: ['diagnostics', 'bug', 'report', 'debug', 'bridge'],
      },
      {
        id: 'locator-overrides',
        title: 'Custom DOM locator overrides (Your selectors)',
        description: 'Override CSS selectors when a host site updates its markup.',
        keywords: ['selectors', 'locators', 'overrides', 'debug'],
        onSelect: requestInspector,
      },
    ],
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
    Panel: (props) => (
      <DiagnosticsPanel
        {...props}
        collect={collect}
        check={check}
        itemNoun={itemNoun}
        consumePendingInspector={consumePendingInspector}
        registerInspectorOpener={registerInspectorOpener}
        {...(scrubMessage ? { scrubMessage } : {})}
        {...(scrubPageType ? { scrubPageType } : {})}
      />
    ),
  });
}
