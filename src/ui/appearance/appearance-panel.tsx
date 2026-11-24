import { useEffect, useId, useMemo, useState } from 'react';
import type { SavedValue } from '../../core/saved';
import type { ThemeAuditReport } from '../../core/theme';
import type {
  BackdropEffectId,
  ClickEffectId,
  RainCharsetName,
  RainLookName,
  StudioVibe,
  SurfaceFinishId,
  ThemeEffectsConfig,
} from '../../core/theme-effects';
import type { THEME_FONT_STACKS, ThemeConfig, ThemeController } from '../../core/theming';
import type { OptionsPanel, PanelProps, PanelSearchItem } from '../options-dialog/panel';
import {
  BACKDROP_OPTIONS,
  CLICK_EFFECT_OPTIONS,
  DEFAULT_THEME_EFFECTS,
  hasActiveEffects,
  RAIN_CHARSET_NAMES,
  RAIN_LOOK_NAMES,
  readThemeEffectsConfig,
  STUDIO_VIBES,
  SURFACE_FINISH_OPTIONS,
} from '../../core/theme-effects';
import {
  applyStudioVibe,
  applyThemePreset,
  BUILTIN_THEMES,
  contrastingText,
  contrastRatio,
  DEFAULT_THEME_CONFIG,
  normalizeHex,
  resolveTheme,
} from '../../core/theming';
import { definePanel } from '../options-dialog/panel';
import {
  Badge,
  Disclosure,
  SegmentedControl,
  SettingCard,
  SettingRow,
  Switch,
} from '../primitives';
import css from './appearance-panel.css?inline';

export { readThemeConfig, THEME_DATA_KEY } from '../../core/theming';

const RAIN_LOOK_LABELS: Record<RainLookName, string> = {
  theme: 'Match active theme',
  phosphor: 'Matrix Phosphor',
  ultraviolet: 'Ultraviolet',
  ember: 'Solar Ember',
  glacier: 'Arctic Glacier',
  newsprint: 'Newsprint Ink (Light)',
  blueprint: 'Blueprint Ink (Light)',
};

const RAIN_CHARSET_LABELS: Record<RainCharsetName, string> = {
  matrix: 'Classic Matrix (Katakana + Digits)',
  katakana: 'Half-width Katakana',
  binary: 'Binary (0 / 1)',
  decimal: 'Decimal (0–9)',
  hex: 'Hexadecimal (0–F)',
  latin: 'Latin (A–Z)',
  symbols: 'Code Symbols',
  braille: 'Braille Patterns',
};

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
  options,
  controller,
}: PanelProps<ThemeConfig> & { controller: ThemeController }) {
  const fontId = useId();
  const externalCssId = useId();
  const [auditState, setAuditState] = useState<AuditState | null>(null);
  const [schemeFilter, setSchemeFilter] = useState<SchemeFilter>('all');
  const hasExternalCssOption = useMemo(
    () => Boolean(options?.list().some(([key]) => key === 'custom_stylesheet_url')),
    [options],
  );
  const [savedExternalCssUrl, setSavedExternalCssUrl] = useState(() =>
    hasExternalCssOption && options ? String(options.get('custom_stylesheet_url')) : '',
  );
  const [externalCssDraft, setExternalCssDraft] = useState(savedExternalCssUrl);

  useEffect(() => {
    if (!hasExternalCssOption || !options) {
      return;
    }
    return options.watch('custom_stylesheet_url', (next) => {
      const url = String(next);
      setSavedExternalCssUrl(url);
      setExternalCssDraft(url);
    });
  }, [hasExternalCssOption, options]);

  const hasCustomColors = Boolean(value.accent || value.background || value.surface || value.text);
  const [colorsOpen, setColorsOpen] = useState(hasCustomColors);
  const [cssOpen, setCssOpen] = useState(
    Boolean(value.customCss.trim() || savedExternalCssUrl.trim()),
  );
  const [healthOpen, setHealthOpen] = useState(false);

  const commitExternalCssUrl = (raw: string): void => {
    if (!hasExternalCssOption || !options) {
      return;
    }
    const nextUrl = raw.trim();
    if (nextUrl === savedExternalCssUrl) {
      setExternalCssDraft(nextUrl);
      return;
    }
    const previousUrl = savedExternalCssUrl;
    setExternalCssDraft(nextUrl);
    setSavedExternalCssUrl(nextUrl);
    void options.set('custom_stylesheet_url', nextUrl);
    notify?.(nextUrl ? 'External stylesheet saved' : 'External stylesheet cleared', () => {
      setExternalCssDraft(previousUrl);
      setSavedExternalCssUrl(previousUrl);
      void options.set('custom_stylesheet_url', previousUrl);
    });
  };

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

  const effects: ThemeEffectsConfig = useMemo(
    () => (value.effects ? readThemeEffectsConfig(value.effects) : DEFAULT_THEME_EFFECTS),
    [value.effects],
  );
  const effectsActive = hasActiveEffects(effects);

  const updateEffects = (patch: Partial<ThemeEffectsConfig>, toastLabel?: string): void => {
    const nextEffects: ThemeEffectsConfig = { ...effects, ...patch };
    const { effects: _prev, ...rest } = value;
    const nextConfig: ThemeConfig = hasActiveEffects(nextEffects)
      ? { ...rest, effects: nextEffects }
      : rest;
    applyEdit(nextConfig, toastLabel);
  };

  const applyVibe = (vibe: StudioVibe): void => {
    applyEdit(applyStudioVibe(value, vibe), `${vibe.name} vibe applied`);
  };

  const isVibeActive = (vibe: StudioVibe): boolean =>
    value.preset === vibe.preset &&
    effects.backdrop === (vibe.effects.backdrop ?? 'none') &&
    effects.surface === (vibe.effects.surface ?? 'default') &&
    effects.click === (vibe.effects.click ?? 'none');

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
      <SettingCard
        title="Studio Vibes"
        action={<Badge tone="accent">Live preview · Reversible</Badge>}
      >
        <div className="theme-studio-pad">
          <p className="theme-studio-intro">
            Transform this site in one click — every vibe pairs a high-contrast palette with live
            backgrounds, surface finishes, and click effects you can remix below.
          </p>
          <div className="theme-vibe-grid" role="group" aria-label="Studio vibes">
            {STUDIO_VIBES.map((vibe) => (
              <button
                key={vibe.id}
                type="button"
                className="theme-vibe-card"
                aria-pressed={isVibeActive(vibe)}
                onClick={() => applyVibe(vibe)}
              >
                <span
                  className="theme-vibe-banner"
                  aria-hidden="true"
                  style={{ background: vibe.swatch }}
                />
                <span className="theme-vibe-body">
                  <span className="theme-card-name">{vibe.name}</span>
                  <span className="theme-card-desc">{vibe.tagline}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </SettingCard>

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
              {(
                preset.swatches ?? [
                  preset.palette.background,
                  preset.palette.surface,
                  preset.palette.text,
                  preset.palette.accent,
                ]
              ).map((color, idx) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static preset swatch palette
                  key={idx}
                  className="theme-dot"
                  style={{ background: color }}
                />
              ))}
            </span>
            <span className="theme-card-name">{preset.name}</span>
            <p className="theme-card-desc">{preset.description}</p>
          </button>
        ))}
      </div>

      <SettingCard
        title="Creative Studio"
        action={
          effectsActive ? (
            <button
              type="button"
              className="theme-inline-reset"
              onClick={() => updateEffects({ ...DEFAULT_THEME_EFFECTS }, 'Cleared studio effects')}
            >
              Reset effects
            </button>
          ) : (
            <Badge>Contrast-safe</Badge>
          )
        }
      >
        <div className="theme-studio-pad">
          <div className="theme-studio-subhead">
            <span className="theme-studio-label">Live background</span>
            <span className="theme-studio-hint">
              Pauses in background tabs and follows your reduced-motion setting.
            </span>
          </div>
          <div className="theme-backdrop-grid" role="group" aria-label="Live background effect">
            {BACKDROP_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="theme-backdrop-chip"
                aria-pressed={effects.backdrop === opt.id}
                onClick={() =>
                  updateEffects(
                    { backdrop: opt.id as BackdropEffectId },
                    opt.id === 'none' ? 'Background effect off' : `Background: ${opt.name}`,
                  )
                }
              >
                <span
                  className="theme-backdrop-swatch"
                  aria-hidden="true"
                  style={{ background: opt.preview }}
                />
                <span className="theme-backdrop-text">
                  <span className="theme-backdrop-name">{opt.name}</span>
                  <span className="theme-backdrop-tag">{opt.tagline}</span>
                </span>
              </button>
            ))}
          </div>

          {effects.backdrop === 'digital-rain' && (
            <div className="theme-tuner-box" role="group" aria-label="Matrix Rain settings">
              <div className="theme-tuner-grid">
                <label className="theme-color-row">
                  <span>Rain style</span>
                  <select
                    className="field"
                    aria-label="Rain style"
                    value={effects.rainLook}
                    onChange={(event) =>
                      updateEffects({ rainLook: event.currentTarget.value as RainLookName })
                    }
                  >
                    {RAIN_LOOK_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {RAIN_LOOK_LABELS[name]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="theme-color-row">
                  <span>Glyph charset</span>
                  <select
                    className="field"
                    aria-label="Glyph charset"
                    value={effects.rainCharset}
                    onChange={(event) =>
                      updateEffects({ rainCharset: event.currentTarget.value as RainCharsetName })
                    }
                  >
                    {RAIN_CHARSET_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {RAIN_CHARSET_LABELS[name]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="theme-slider-row">
                <span className="theme-slider-meta">
                  <span>Rain density</span>
                  <strong>{Math.round(effects.rainDensity * 100)}%</strong>
                </span>
                <input
                  type="range"
                  className="theme-range"
                  aria-label="Rain density"
                  min={0.15}
                  max={0.9}
                  step={0.05}
                  value={effects.rainDensity}
                  onInput={(event) =>
                    updateEffects({ rainDensity: Number.parseFloat(event.currentTarget.value) })
                  }
                />
              </label>
            </div>
          )}

          {effects.backdrop !== 'none' && (
            <div className="theme-tuner-box" role="group" aria-label="Background tuning">
              <div className="theme-slider-grid">
                <label className="theme-slider-row">
                  <span className="theme-slider-meta">
                    <span>Visibility</span>
                    <strong>{Math.round(effects.intensity * 100)}%</strong>
                  </span>
                  <input
                    type="range"
                    className="theme-range"
                    aria-label="Background visibility"
                    min={0.15}
                    max={1}
                    step={0.05}
                    value={effects.intensity}
                    onInput={(event) =>
                      updateEffects({ intensity: Number.parseFloat(event.currentTarget.value) })
                    }
                  />
                </label>
                <label className="theme-slider-row">
                  <span className="theme-slider-meta">
                    <span>Motion speed</span>
                    <strong>{effects.speed.toFixed(2).replace(/\.00$/, '')}×</strong>
                  </span>
                  <input
                    type="range"
                    className="theme-range"
                    aria-label="Motion speed"
                    min={0.25}
                    max={2}
                    step={0.05}
                    value={effects.speed}
                    onInput={(event) =>
                      updateEffects({ speed: Number.parseFloat(event.currentTarget.value) })
                    }
                  />
                </label>
                <label className="theme-slider-row">
                  <span className="theme-slider-meta">
                    <span>Card glass</span>
                    <strong>{Math.round((effects.glassStrength / 0.65) * 100)}%</strong>
                  </span>
                  <input
                    type="range"
                    className="theme-range"
                    aria-label="Card glass translucency"
                    min={0}
                    max={0.65}
                    step={0.05}
                    value={effects.glassStrength}
                    onInput={(event) =>
                      updateEffects({ glassStrength: Number.parseFloat(event.currentTarget.value) })
                    }
                  />
                </label>
              </div>
              <div className="theme-tuner-switches">
                <span className="theme-inline-toggle">
                  <span>Pointer reactive</span>
                  <Switch
                    checked={effects.interactive}
                    ariaLabel="Pointer reactive background"
                    onChange={(next) => updateEffects({ interactive: next })}
                  />
                </span>
                <span className="theme-inline-toggle">
                  <span>Pause motion</span>
                  <Switch
                    checked={effects.paused}
                    ariaLabel="Pause background motion"
                    onChange={(next) => updateEffects({ paused: next })}
                  />
                </span>
              </div>
            </div>
          )}
        </div>

        <SettingRow
          title="Surface finish"
          description="Layer frosted glass, gradient sheen, or neon rims across cards and buttons."
        >
          <SegmentedControl
            ariaLabel="Surface finish"
            value={effects.surface}
            options={SURFACE_FINISH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(next) =>
              updateEffects(
                { surface: next as SurfaceFinishId },
                `Surface finish: ${SURFACE_FINISH_OPTIONS.find((o) => o.value === next)?.label ?? next}`,
              )
            }
          />
        </SettingRow>

        <SettingRow
          title="Click effects"
          description="A subtle accent touch on buttons, links, and tabs. Selecting text stays quiet."
        >
          <SegmentedControl
            ariaLabel="Click effects"
            value={effects.click}
            options={CLICK_EFFECT_OPTIONS}
            onChange={(next) =>
              updateEffects(
                { click: next as ClickEffectId },
                next === 'none'
                  ? 'Click effects off'
                  : `Click effect: ${CLICK_EFFECT_OPTIONS.find((o) => o.value === next)?.label ?? next}`,
              )
            }
          />
        </SettingRow>
      </SettingCard>

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

        <Disclosure
          label="Custom CSS"
          badge={
            value.customCss.trim() || savedExternalCssUrl.trim() ? (
              <Badge tone="accent">Active</Badge>
            ) : undefined
          }
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
                placeholder="Write custom CSS rules layered on top of this site's theme"
                spellCheck={false}
                value={value.customCss}
                onChange={(event) => update({ customCss: event.currentTarget.value })}
              />
            </label>
            {hasExternalCssOption && (
              <div className="theme-color-row">
                <label htmlFor={externalCssId}>External stylesheet URL</label>
                <div className="theme-external-css-row">
                  <input
                    id={externalCssId}
                    type="text"
                    inputMode="url"
                    className="field theme-hex"
                    aria-label="External CSS url"
                    placeholder="https://example.com/custom.css"
                    spellCheck={false}
                    value={externalCssDraft}
                    onInput={(event) => setExternalCssDraft(event.currentTarget.value)}
                    onChange={(event) => setExternalCssDraft(event.currentTarget.value)}
                    onBlur={(event) => commitExternalCssUrl(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitExternalCssUrl(event.currentTarget.value);
                      }
                    }}
                  />
                  {externalCssDraft.trim() !== savedExternalCssUrl && (
                    <button
                      type="button"
                      className="button primary"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commitExternalCssUrl(externalCssDraft)}
                    >
                      Apply
                    </button>
                  )}
                  {savedExternalCssUrl && externalCssDraft.trim() === savedExternalCssUrl && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => commitExternalCssUrl('')}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <span className="theme-studio-hint">
                  Optional HTTPS stylesheet URL (served as <code>text/css</code>). Use inline CSS,
                  an external URL, or both.
                </span>
              </div>
            )}
          </div>
        </Disclosure>
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
        title: 'Custom CSS & External stylesheet',
        description: 'Write inline CSS rules or link an external HTTPS stylesheet.',
        keywords: ['style', 'stylesheet', 'css', 'external', 'url', 'link'],
      },
      {
        id: 'theme-health',
        title: 'Theme health & layout audit',
        description: 'Scan contrast, unthemed surfaces, layout shifts, and header overlaps.',
        keywords: ['audit', 'auto-heal', 'contrast', 'wcag'],
      },
      {
        id: 'creative-studio',
        title: 'Creative Studio (Backgrounds, Glass, Gradients & Click FX)',
        description:
          'Add Matrix Rain, Vice City sunset, Aurora, Silk, glass cards, and click sparks.',
        keywords: [
          'matrix',
          'gta',
          'vice',
          'rain',
          'aurora',
          'silk',
          'stars',
          'grid',
          'glass',
          'gradient',
          'neon',
          'click',
        ],
      },
      ...STUDIO_VIBES.map((vibe) => ({
        id: `vibe:${vibe.id}`,
        title: `Studio Vibe: ${vibe.name}`,
        description: vibe.tagline,
        keywords: ['vibe', 'studio', 'effect', vibe.id, vibe.preset, vibe.effects.backdrop ?? ''],
        onSelect: () => {
          const next = applyStudioVibe(saved.get(), vibe);
          controller.preview(resolveTheme(next));
          void saved.set(next).then(() => {
            onApply(next);
            controller.clearPreview();
          });
        },
      })),
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
