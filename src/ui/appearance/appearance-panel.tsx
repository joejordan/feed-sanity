import { useEffect, useId, useMemo, useState } from 'react';
import type { SavedValue } from '../../core/saved';
import type { ThemeAuditReport } from '../../core/theme';
import type { THEME_FONT_STACKS, ThemeConfig, ThemeController } from '../../core/theming';
import type { OptionsPanel, PanelProps, PanelSearchItem } from '../options-dialog/panel';
import {
  applyThemePreset,
  BUILTIN_THEMES,
  contrastingText,
  contrastRatio,
  DEFAULT_THEME_CONFIG,
  normalizeHex,
  resolveTheme,
} from '../../core/theming';
import { definePanel } from '../options-dialog/panel';
import { Badge, Disclosure, SegmentedControl, SettingCard, SettingRow } from '../primitives';
import css from './appearance-panel.css?inline';

export { readThemeConfig, THEME_DATA_KEY } from '../../core/theming';

const FONT_LABELS: Record<keyof typeof THEME_FONT_STACKS, string> = {
  default: 'Site default',
  system: 'System Sans',
  rounded: 'Rounded Sans',
  serif: 'Editorial Serif',
  mono: 'Monospace',
};

const COLOR_FIELDS: ReadonlyArray<{
  readonly key: 'accent' | 'background' | 'surface' | 'text';
  readonly label: string;
}> = [
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Canvas background' },
  { key: 'surface', label: 'Card surface' },
  { key: 'text', label: 'Primary text' },
];

type SchemeFilter = 'all' | 'dark' | 'light';

const SCHEME_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const;

const WCAG_AA_CONTRAST = 4.5;

function pickAccessibleText(background: string, surface: string): string {
  const whiteMin = Math.min(
    contrastRatio('#ffffff', background),
    contrastRatio('#ffffff', surface),
  );
  const darkMin = Math.min(contrastRatio('#111111', background), contrastRatio('#111111', surface));
  if (whiteMin === darkMin) {
    return contrastingText(background);
  }
  return whiteMin > darkMin ? '#ffffff' : '#111111';
}

interface AuditState {
  readonly report: ThemeAuditReport;
  readonly runCount: number;
  readonly ranAt: string;
  readonly lastAction: 'audit' | 'heal';
  readonly healedCount?: number;
  readonly beforeScore?: number;
}

function formatScanTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function AppearancePanelView({
  value,
  onChange,
  notify,
  controller,
}: PanelProps<ThemeConfig> & { controller: ThemeController }) {
  const fontId = useId();
  const [auditState, setAuditState] = useState<AuditState | null>(null);
  const [schemeFilter, setSchemeFilter] = useState<SchemeFilter>('all');
  const hasCustomColors = Boolean(value.accent || value.background || value.surface || value.text);
  const [colorsOpen, setColorsOpen] = useState(hasCustomColors);
  const [cssOpen, setCssOpen] = useState(Boolean(value.customCss.trim()));
  const [healthOpen, setHealthOpen] = useState(false);

  const effective = useMemo(() => resolveTheme(value)?.palette ?? null, [value]);
  const minContrast = useMemo(
    () =>
      effective
        ? Math.min(
            contrastRatio(effective.text, effective.background),
            contrastRatio(effective.text, effective.surface),
          )
        : null,
    [effective],
  );
  const lowContrast = minContrast !== null && minContrast < WCAG_AA_CONTRAST;

  useEffect(() => {
    if (lowContrast) {
      setColorsOpen(true);
    }
  }, [lowContrast]);
  const applyEdit = (next: ThemeConfig, toastLabel?: string): void => {
    const previous = value;
    controller.preview(resolveTheme(next));
    onChange(next);
    setAuditState(null);
    if (toastLabel && notify) {
      notify(toastLabel, () => {
        controller.preview(resolveTheme(previous));
        onChange(previous);
        setAuditState(null);
      });
    }
  };
  const update = (patch: Partial<ThemeConfig>, toastLabel?: string): void =>
    applyEdit({ ...value, ...patch }, toastLabel);

  const runAudit = (): void => {
    setHealthOpen(true);
    const report = controller.audit?.() ?? null;
    if (!report) {
      setAuditState(null);
      return;
    }
    setAuditState((prev) => ({
      report,
      runCount: (prev?.runCount ?? 0) + 1,
      ranAt: formatScanTime(new Date()),
      lastAction: 'audit',
    }));
  };

  const runHealAndAudit = (): void => {
    setHealthOpen(true);
    const beforeScore = auditState?.report.score;
    const healedCount = controller.healNow?.() ?? 0;
    const report = controller.audit?.() ?? null;
    if (!report) {
      setAuditState(null);
      return;
    }
    setAuditState((prev) => ({
      report,
      runCount: (prev?.runCount ?? 0) + 1,
      ranAt: formatScanTime(new Date()),
      lastAction: 'heal',
      healedCount,
      ...(beforeScore === undefined ? {} : { beforeScore }),
    }));
  };

  const auditReport = auditState?.report ?? null;
  const healableCount = auditReport
    ? auditReport.summary.contrast + auditReport.summary.polarityLeak
    : null;
  const geometryIssues = auditReport
    ? auditReport.summary.layoutShift + auditReport.summary.headerOcclusion
    : 0;
  const healDisabled = healableCount === 0;
  const healNeedsAttention = healableCount !== null && healableCount > 0;

  const filteredPresets = BUILTIN_THEMES.filter(
    (preset) => schemeFilter === 'all' || preset.palette.colorScheme === schemeFilter,
  );

  let colorsBadge;
  if (lowContrast) {
    colorsBadge = <Badge tone="warning">Low contrast</Badge>;
  } else if (hasCustomColors) {
    colorsBadge = <Badge tone="accent">Customized</Badge>;
  }

  return (
    <section className="theme-panel">
      <div className="theme-actions">
        <SegmentedControl
          options={SCHEME_FILTERS}
          value={schemeFilter}
          ariaLabel="Filter theme presets"
          onChange={setSchemeFilter}
        />
        <button
          className="button"
          type="button"
          onClick={() => applyEdit({ ...DEFAULT_THEME_CONFIG }, 'Reset theme to site default')}
        >
          Reset to site default
        </button>
      </div>

      <div className="theme-grid" role="group" aria-label="Theme presets">
        <button
          type="button"
          className="theme-card"
          aria-pressed={value.preset === 'default'}
          onClick={() => applyEdit(applyThemePreset(value, 'default'), 'Theme set to Site Default')}
        >
          <span className="theme-card-name">Site Default</span>
          <p className="theme-card-desc">Use the host site's built-in light or dark theme.</p>
        </button>
        {filteredPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="theme-card"
            aria-pressed={value.preset === preset.id}
            onClick={() =>
              applyEdit(applyThemePreset(value, preset.id), `Theme set to ${preset.name}`)
            }
          >
            <span className="theme-swatches" aria-hidden="true">
              <span className="theme-dot" style={{ background: preset.palette.background }} />
              <span className="theme-dot" style={{ background: preset.palette.surface }} />
              <span className="theme-dot" style={{ background: preset.palette.text }} />
              <span className="theme-dot" style={{ background: preset.palette.accent }} />
            </span>
            <span className="theme-card-name">{preset.name}</span>
            <p className="theme-card-desc">{preset.description}</p>
          </button>
        ))}
      </div>

      <SettingCard>
        <SettingRow
          title="Typography"
          description="Applies across site text and Feed Sanity controls."
          htmlFor={fontId}
        >
          <select
            id={fontId}
            className="field"
            aria-label="Typography"
            value={value.font}
            onChange={(event) => {
              const nextFont = event.currentTarget.value;
              const fontLabel = FONT_LABELS[nextFont as keyof typeof FONT_LABELS] ?? nextFont;
              update({ font: nextFont }, `Typography set to ${fontLabel}`);
            }}
          >
            {(Object.keys(FONT_LABELS) as Array<keyof typeof FONT_LABELS>).map((id) => (
              <option key={id} value={id}>
                {FONT_LABELS[id]}
              </option>
            ))}
          </select>
        </SettingRow>

        <Disclosure
          label="Customize colors"
          badge={colorsBadge}
          open={colorsOpen}
          onToggle={() => setColorsOpen((open) => !open)}
        >
          <div className="theme-drawer-pad">
            <div className="theme-controls">
              {COLOR_FIELDS.map(({ key, label }) => {
                const fallbackHex = effective ? effective[key] : '#3b82f6';
                const pickerValue = normalizeHex(value[key]) ?? fallbackHex;
                return (
                  <label key={key} className="theme-color-row">
                    <span>{label}</span>
                    <span className="theme-color-inputs">
                      <input
                        type="color"
                        className="theme-picker"
                        aria-label={`${label} picker`}
                        value={pickerValue}
                        onChange={(event) => update({ [key]: event.currentTarget.value })}
                      />
                      <input
                        type="text"
                        className="field theme-hex"
                        aria-label={label}
                        placeholder={fallbackHex}
                        value={value[key]}
                        onChange={(event) => update({ [key]: event.currentTarget.value })}
                      />
                    </span>
                  </label>
                );
              })}
            </div>
            {lowContrast && effective && (
              <div className="theme-contrast-warn" role="status">
                <span>
                  Low text contrast ({minContrast.toFixed(1)}:1 — WCAG AA recommends 4.5:1+).
                </span>
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    update(
                      { text: pickAccessibleText(effective.background, effective.surface) },
                      'Fixed text contrast',
                    )
                  }
                >
                  Fix contrast
                </button>
              </div>
            )}
          </div>
        </Disclosure>

        <Disclosure
          label="Custom CSS"
          badge={value.customCss.trim() ? <Badge tone="accent">Active</Badge> : undefined}
          open={cssOpen}
          onToggle={() => setCssOpen((open) => !open)}
        >
          <div className="theme-drawer-pad">
            <label className="theme-color-row">
              <span>Custom CSS</span>
              <textarea
                className="field"
                rows={4}
                aria-label="Custom CSS"
                placeholder="Optional CSS layered on top of this site's theme"
                spellCheck={false}
                value={value.customCss}
                onChange={(event) => update({ customCss: event.currentTarget.value })}
              />
            </label>
          </div>
        </Disclosure>

        {effective && controller.audit && (
          <Disclosure
            label="Theme health & layout check"
            badge={
              auditReport ? (
                <Badge tone={auditReport.violations.length === 0 ? 'success' : 'warning'}>
                  {auditReport.score}%
                </Badge>
              ) : undefined
            }
            open={healthOpen}
            onToggle={() => setHealthOpen((open) => !open)}
          >
            <div className="theme-drawer-pad">
              <div className="theme-actions">
                <span className="theme-audit-subtitle">
                  Adaptive theming automatically heals new elements and contrast on every visit.
                </span>
                <div className="theme-audit-buttons">
                  <button className="button" type="button" onClick={runAudit}>
                    Audit page
                  </button>
                  {controller.healNow && (
                    <button
                      className={healNeedsAttention ? 'button theme-heal-ready' : 'button'}
                      type="button"
                      disabled={healDisabled}
                      title={
                        healDisabled
                          ? 'No contrast or unthemed surface issues to heal'
                          : 'Re-compile adaptive styles and fix contrast or unthemed surfaces now'
                      }
                      onClick={runHealAndAudit}
                    >
                      Auto-heal now
                    </button>
                  )}
                </div>
              </div>
              {auditState && auditReport && (
                <div
                  key={auditState.runCount}
                  className="theme-audit-result"
                  data-healthy={auditReport.violations.length === 0 ? 'true' : 'false'}
                  role="status"
                >
                  <div className="theme-audit-bar-row">
                    <span className="theme-audit-score">
                      <strong>{auditReport.score}% coverage</strong> ({auditReport.totalChecked}{' '}
                      elements checked)
                    </span>
                    <span className="theme-audit-time">Checked {auditState.ranAt}</span>
                  </div>
                  <div className="theme-audit-meter" aria-hidden="true">
                    <div
                      className="theme-audit-meter-fill"
                      style={{ width: `${Math.max(0, Math.min(100, auditReport.score))}%` }}
                    />
                  </div>
                  {auditState.lastAction === 'heal' && (
                    <p className="theme-audit-feedback">
                      {(() => {
                        if (auditState.healedCount && auditState.healedCount > 0) {
                          const delta =
                            auditState.beforeScore !== undefined &&
                            auditState.beforeScore !== auditReport.score
                              ? ` (${auditState.beforeScore}% → ${auditReport.score}%)`
                              : '';
                          const noun = auditState.healedCount === 1 ? 'element' : 'elements';
                          return `Fixed ${auditState.healedCount} ${noun} on this page${delta}. Adaptive healing stays active automatically on future visits.`;
                        }
                        if (healableCount === 0) {
                          return 'Re-compiled styles and scanned the page — no unhealed contrast or surface issues found.';
                        }
                        const remaining = healableCount ?? 0;
                        const phrase = remaining === 1 ? 'issue needs' : 'issues need';
                        return `Re-compiled styles — ${remaining} remaining contrast/surface ${phrase} a higher-contrast palette or custom CSS.`;
                      })()}
                    </p>
                  )}
                  <p className="theme-audit-summary">
                    <span data-has-issue={auditReport.summary.contrast > 0 ? 'true' : undefined}>
                      {auditReport.summary.contrast} contrast
                    </span>
                    ,{' '}
                    <span
                      data-has-issue={auditReport.summary.polarityLeak > 0 ? 'true' : undefined}
                    >
                      {auditReport.summary.polarityLeak} unthemed surfaces
                    </span>
                    ,{' '}
                    <span data-has-issue={auditReport.summary.layoutShift > 0 ? 'true' : undefined}>
                      {auditReport.summary.layoutShift} layout shifts
                    </span>
                    ,{' '}
                    <span
                      data-has-issue={auditReport.summary.headerOcclusion > 0 ? 'true' : undefined}
                    >
                      {auditReport.summary.headerOcclusion} header overlaps
                    </span>
                    .
                  </p>
                  {geometryIssues > 0 && auditState.lastAction === 'heal' && (
                    <p className="theme-audit-note">
                      Layout shifts and header overlaps are reported for inspection and are not
                      auto-modified.
                    </p>
                  )}
                  {auditReport.violations.length > 0 && (
                    <ul className="theme-audit-list">
                      {(() => {
                        const seen = new Map<string, number>();
                        return auditReport.violations.slice(0, 6).map((v) => {
                          const base = `${v.kind}:${v.selector}:${v.detail}`;
                          const count = (seen.get(base) ?? 0) + 1;
                          seen.set(base, count);
                          return (
                            <li key={`${base}#${count}`}>
                              <code>{v.selector}</code> ({v.kind}): {v.detail}
                            </li>
                          );
                        });
                      })()}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Disclosure>
        )}
      </SettingCard>
    </section>
  );
}

/**
 * First-class Appearance panel automatically attached to every `SiteAdapter`
 * that declares a `themeMapping`. Instant-applies valid theme edits with Undo
 * support and contributes all presets & styling controls to unified search.
 */
export function appearancePanel(
  saved: SavedValue<ThemeConfig>,
  controller: ThemeController,
  onApply: (config: ThemeConfig) => void = (next) => controller.apply(resolveTheme(next)),
): OptionsPanel {
  return definePanel<ThemeConfig>({
    section: 'Appearance',
    css,
    instant: true,
    ready: saved.ready,
    read: () => saved.get(),
    save: async (next) => {
      await saved.set(next);
      onApply(next);
      controller.clearPreview();
    },
    swatch: () => {
      const palette = resolveTheme(saved.get())?.palette;
      return palette ? { bg: palette.background, accent: palette.accent } : null;
    },
    searchItems: (): PanelSearchItem[] => [
      {
        id: 'typography',
        title: 'Typography / Site font',
        description: 'Change the font family across this site and Feed Sanity controls.',
        keywords: ['font', 'serif', 'mono', 'rounded', 'sans'],
      },
      {
        id: 'custom-css',
        title: 'Custom CSS',
        description: 'Layer custom stylesheet rules on top of this site.',
        keywords: ['style', 'stylesheet', 'css'],
      },
      {
        id: 'theme-health',
        title: 'Theme health & layout audit',
        description: 'Scan contrast, unthemed surfaces, layout shifts, and header overlaps.',
        keywords: ['audit', 'auto-heal', 'contrast', 'wcag'],
      },
      ...BUILTIN_THEMES.map((preset) => ({
        id: `preset:${preset.id}`,
        title: `Theme: ${preset.name}`,
        description: preset.description,
        keywords: ['theme', 'preset', preset.palette.colorScheme, preset.id],
        onSelect: () => {
          const next = applyThemePreset(saved.get(), preset.id);
          controller.preview(resolveTheme(next));
          void saved.set(next).then(() => {
            onApply(next);
            controller.clearPreview();
          });
        },
      })),
    ],
    onClose: () => controller.clearPreview(),
    problem: (next) => {
      for (const { key, label } of COLOR_FIELDS) {
        const raw = next[key].trim();
        if (raw && !normalizeHex(raw)) {
          return `${label} must be a hex color like #3b82f6.`;
        }
      }
      return null;
    },
    Panel: (props) => <AppearancePanelView {...props} controller={controller} />,
  });
}
