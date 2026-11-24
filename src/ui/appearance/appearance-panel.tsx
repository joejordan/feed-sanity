import { useEffect, useId, useMemo, useState } from 'react';
import type { SavedValue } from '../../core/saved';
import type { StudioVibe, ThemeEffectsConfig } from '../../core/theme-effects';
import type { THEME_FONT_STACKS, ThemeConfig, ThemeController } from '../../core/theming';
import type { OptionsPanel, PanelProps, PanelSearchItem } from '../options-dialog/panel';
import type { AuditState } from './health-disclosure';
import {
  DEFAULT_THEME_EFFECTS,
  hasActiveEffects,
  readThemeEffectsConfig,
  STUDIO_VIBES,
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
  TextInput,
} from '../primitives';
import css from './appearance-panel.css?inline';
import { CustomCssDisclosure } from './custom-css-disclosure';
import { ThemeHealthDisclosure } from './health-disclosure';
import { CreativeStudioCard, StudioVibesCard } from './studio-section';

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
      <StudioVibesCard isVibeActive={isVibeActive} onApplyVibe={applyVibe} />

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

      <CreativeStudioCard
        effects={effects}
        effectsActive={effectsActive}
        onUpdateEffects={updateEffects}
      />

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
                      <TextInput
                        className="field theme-hex"
                        ariaLabel={label}
                        placeholder={fallbackHex}
                        value={value[key]}
                        onValueChange={(nextHex) => update({ [key]: nextHex })}
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
          <ThemeHealthDisclosure
            open={healthOpen}
            onToggle={() => setHealthOpen((open) => !open)}
            auditState={auditState}
            hasHeal={Boolean(controller.healNow)}
            onRunAudit={runAudit}
            onRunHeal={runHealAndAudit}
          />
        )}

        <CustomCssDisclosure
          open={cssOpen}
          onToggle={() => setCssOpen((open) => !open)}
          customCss={value.customCss}
          onCustomCssChange={(nextCss) => update({ customCss: nextCss })}
          hasExternalCssOption={hasExternalCssOption}
          savedExternalCssUrl={savedExternalCssUrl}
          externalCssDraft={externalCssDraft}
          onExternalCssDraftChange={setExternalCssDraft}
          onCommitExternalCssUrl={commitExternalCssUrl}
        />
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
