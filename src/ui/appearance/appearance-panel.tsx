import type { SavedValue } from '../../core/saved';
import type { THEME_FONT_STACKS, ThemeConfig, ThemeController } from '../../core/theming';
import type { OptionsPanel, PanelProps } from '../options-dialog/panel';
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_CONFIG,
  normalizeHex,
  resolveTheme,
} from '../../core/theming';
import { definePanel } from '../options-dialog/panel';
import css from './appearance-panel.css?inline';

export const THEME_DATA_KEY = 'theme';

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

export function readThemeConfig(raw: unknown): ThemeConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_THEME_CONFIG };
  }
  const obj = raw as Record<string, unknown>;
  const str = (key: string, fallback = ''): string =>
    typeof obj[key] === 'string' ? obj[key] : fallback;
  return {
    preset: str('preset', 'default'),
    accent: str('accent'),
    background: str('background'),
    surface: str('surface'),
    text: str('text'),
    font: str('font', 'default'),
    customCss: str('customCss'),
  };
}

function AppearancePanelView({
  value,
  onChange,
  controller,
}: PanelProps<ThemeConfig> & { controller: ThemeController }) {
  const effective = resolveTheme(value)?.palette ?? null;
  const applyEdit = (next: ThemeConfig): void => {
    controller.preview(resolveTheme(next));
    onChange(next);
  };
  const update = (patch: Partial<ThemeConfig>): void => applyEdit({ ...value, ...patch });

  return (
    <section className="theme-panel">
      <div className="theme-actions">
        <h3 className="theme-heading">Site theme</h3>
        <button
          className="button"
          type="button"
          onClick={() => applyEdit({ ...DEFAULT_THEME_CONFIG })}
        >
          Reset to site default
        </button>
      </div>
      <p className="description">
        Pick a preset or customize colors and typography for this site. Changes preview live and
        apply across the page and Feed Sanity controls.
      </p>

      <div className="theme-grid" role="group" aria-label="Theme presets">
        <button
          type="button"
          className="theme-card"
          aria-pressed={value.preset === 'default'}
          onClick={() =>
            update({ preset: 'default', accent: '', background: '', surface: '', text: '' })
          }
        >
          <span className="theme-card-name">Site Default</span>
          <p className="theme-card-desc">Use the host site's built-in light or dark theme.</p>
        </button>
        {BUILTIN_THEMES.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="theme-card"
            aria-pressed={value.preset === preset.id}
            onClick={() =>
              update({ preset: preset.id, accent: '', background: '', surface: '', text: '' })
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
                  onChange={(event) => update({ [key]: event.target.value })}
                />
                <input
                  type="text"
                  className="field theme-hex"
                  aria-label={label}
                  placeholder={fallbackHex}
                  value={value[key]}
                  onChange={(event) => update({ [key]: event.target.value })}
                />
              </span>
            </label>
          );
        })}
      </div>

      <label className="theme-color-row">
        <span>Typography</span>
        <select
          className="field"
          aria-label="Typography"
          value={value.font}
          onChange={(event) => update({ font: event.target.value })}
        >
          {(Object.keys(FONT_LABELS) as Array<keyof typeof FONT_LABELS>).map((id) => (
            <option key={id} value={id}>
              {FONT_LABELS[id]}
            </option>
          ))}
        </select>
      </label>

      <label className="theme-color-row">
        <span>Custom CSS</span>
        <textarea
          className="field"
          rows={4}
          aria-label="Custom CSS"
          placeholder="Optional CSS layered on top of this site's theme"
          spellCheck={false}
          value={value.customCss}
          onChange={(event) => update({ customCss: event.target.value })}
        />
      </label>
    </section>
  );
}

/**
 * First-class Appearance panel automatically attached to every `SiteAdapter`
 * that declares a `themeMapping`. Previews edits live across Options tab
 * switches and restores cleanly via `onClose` when the dialog closes.
 */
export function appearancePanel(
  saved: SavedValue<ThemeConfig>,
  controller: ThemeController,
  onApply: (config: ThemeConfig) => void = (next) => controller.apply(resolveTheme(next)),
): OptionsPanel {
  return definePanel<ThemeConfig>({
    section: 'Appearance',
    css,
    ready: saved.ready,
    read: () => saved.get(),
    save: async (next) => {
      await saved.set(next);
      onApply(next);
      controller.clearPreview();
    },
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
