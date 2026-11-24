import type {
  BackdropEffectId,
  ClickEffectId,
  RainCharsetName,
  RainLookName,
  StudioVibe,
  SurfaceFinishId,
  ThemeEffectsConfig,
} from '../../core/theme-effects';
import {
  BACKDROP_OPTIONS,
  CLICK_EFFECT_OPTIONS,
  DEFAULT_THEME_EFFECTS,
  RAIN_CHARSET_NAMES,
  RAIN_LOOK_NAMES,
  STUDIO_VIBES,
  SURFACE_FINISH_OPTIONS,
} from '../../core/theme-effects';
import { Badge, SegmentedControl, SettingCard, SettingRow, Switch } from '../primitives';

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

export interface StudioVibesCardProps {
  readonly isVibeActive: (vibe: StudioVibe) => boolean;
  readonly onApplyVibe: (vibe: StudioVibe) => void;
}

export function StudioVibesCard({ isVibeActive, onApplyVibe }: StudioVibesCardProps) {
  return (
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
              onClick={() => onApplyVibe(vibe)}
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
  );
}

export interface CreativeStudioCardProps {
  readonly effects: ThemeEffectsConfig;
  readonly effectsActive: boolean;
  readonly onUpdateEffects: (patch: Partial<ThemeEffectsConfig>, toastLabel?: string) => void;
}

export function CreativeStudioCard({
  effects,
  effectsActive,
  onUpdateEffects,
}: CreativeStudioCardProps) {
  return (
    <SettingCard
      title="Creative Studio"
      action={
        effectsActive ? (
          <button
            type="button"
            className="theme-inline-reset"
            onClick={() => onUpdateEffects({ ...DEFAULT_THEME_EFFECTS }, 'Cleared studio effects')}
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
                onUpdateEffects(
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
                    onUpdateEffects({ rainLook: event.currentTarget.value as RainLookName })
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
                    onUpdateEffects({ rainCharset: event.currentTarget.value as RainCharsetName })
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
                  onUpdateEffects({ rainDensity: Number.parseFloat(event.currentTarget.value) })
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
                    onUpdateEffects({ intensity: Number.parseFloat(event.currentTarget.value) })
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
                    onUpdateEffects({ speed: Number.parseFloat(event.currentTarget.value) })
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
                    onUpdateEffects({ glassStrength: Number.parseFloat(event.currentTarget.value) })
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
                  onChange={(next) => onUpdateEffects({ interactive: next })}
                />
              </span>
              <span className="theme-inline-toggle">
                <span>Pause motion</span>
                <Switch
                  checked={effects.paused}
                  ariaLabel="Pause background motion"
                  onChange={(next) => onUpdateEffects({ paused: next })}
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
            onUpdateEffects(
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
            onUpdateEffects(
              { click: next as ClickEffectId },
              next === 'none'
                ? 'Click effects off'
                : `Click effect: ${CLICK_EFFECT_OPTIONS.find((o) => o.value === next)?.label ?? next}`,
            )
          }
        />
      </SettingRow>
    </SettingCard>
  );
}
