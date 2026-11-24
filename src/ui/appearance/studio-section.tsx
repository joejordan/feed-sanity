import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BackdropEffectId,
  ClickEffectId,
  RainCharsetName,
  RainIntro,
  RainLookName,
  StudioVibe,
  SurfaceFinishId,
  ThemeEffectsConfig,
} from '../../core/theme-effects';
import {
  BACKDROP_OPTIONS,
  CLICK_EFFECT_OPTIONS,
  RAIN_CHARSET_NAMES,
  RAIN_INTRO_NAMES,
  RAIN_LOOK_NAMES,
  STUDIO_VIBES,
  SURFACE_FINISH_OPTIONS,
  THEME_EFFECT_BOUNDS,
} from '../../core/theme-effects';
import { Badge, SegmentedControl, SettingCard, SettingRow, Switch } from '../primitives';

const SLIDER_COMMIT_DEBOUNCE_MS = 250;

const RAIN_INTRO_LABELS: Record<RainIntro, string> = {
  filled: 'Already falling',
  'rain-in': 'Rain in from top',
};

const BACKDROP_NAMES = new Map(BACKDROP_OPTIONS.map((opt) => [opt.id, opt.name]));

function RainSelect<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  labels,
  onChange,
}: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: T;
  readonly options: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly onChange: (next: T) => void;
}) {
  return (
    <label className="theme-color-row">
      <span>{label}</span>
      <select
        className="field"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as T)}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {labels[name]}
          </option>
        ))}
      </select>
    </label>
  );
}

type SliderField = keyof typeof THEME_EFFECT_BOUNDS;

function EffectSlider({
  field,
  label,
  ariaLabel,
  value,
  valueText,
  onInput,
  onDragStart,
  onCommit,
}: {
  readonly field: SliderField;
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly valueText: string;
  readonly onInput: (next: number) => void;
  readonly onDragStart: () => void;
  readonly onCommit: () => void;
}) {
  const { min, max } = THEME_EFFECT_BOUNDS[field];
  return (
    <label className="theme-slider-row">
      <span className="theme-slider-meta">
        <span>{label}</span>
        <strong>{valueText}</strong>
      </span>
      <input
        type="range"
        className="theme-range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={0.05}
        value={value}
        onPointerDown={onDragStart}
        onInput={(event) => onInput(Number.parseFloat(event.currentTarget.value))}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </label>
  );
}

/**
 * Buffers continuous range-slider drags into live `onPreview` calls without
 * flooding storage writes, committing once on pointer release / blur / keyup
 * (with a short fallback debounce for non-pointer input).
 */
function useEffectSliderDraft(
  effects: ThemeEffectsConfig,
  onPreviewEffects: ((patch: Partial<ThemeEffectsConfig>) => void) | undefined,
  onUpdateEffects: (patch: Partial<ThemeEffectsConfig>, toastLabel?: string) => void,
) {
  const [sliderDraft, setSliderDraft] = useState<Partial<ThemeEffectsConfig> | null>(null);
  const draftRef = useRef<Partial<ThemeEffectsConfig> | null>(null);
  const lastCommittedRef = useRef<Partial<ThemeEffectsConfig> | null>(null);
  const isDraggingRef = useRef(false);
  const stopWindowDragRef = useRef<(() => void) | undefined>(undefined);
  const prevEffectsRef = useRef(effects);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onUpdateRef = useRef(onUpdateEffects);
  onUpdateRef.current = onUpdateEffects;

  const clearCommitTimer = useCallback((): void => {
    if (commitTimerRef.current !== undefined) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = undefined;
    }
  }, []);

  const detachWindowDrag = useCallback((): void => {
    stopWindowDragRef.current?.();
    stopWindowDragRef.current = undefined;
  }, []);

  const resetDraft = useCallback((): void => {
    clearCommitTimer();
    detachWindowDrag();
    draftRef.current = null;
    lastCommittedRef.current = null;
    isDraggingRef.current = false;
    setSliderDraft(null);
  }, [clearCommitTimer, detachWindowDrag]);

  useEffect(
    () => () => {
      clearCommitTimer();
      detachWindowDrag();
    },
    [clearCommitTimer, detachWindowDrag],
  );

  useEffect(() => {
    if (prevEffectsRef.current === effects) {
      return;
    }
    prevEffectsRef.current = effects;
    const committed = lastCommittedRef.current;
    const matchesOwnCommit =
      committed !== null &&
      (Object.keys(committed) as Array<keyof ThemeEffectsConfig>).every(
        (key) => effects[key] === committed[key],
      );
    if (draftRef.current && matchesOwnCommit) {
      lastCommittedRef.current = null;
      return;
    }
    resetDraft();
  }, [effects, resetDraft]);

  const commitDraft = useCallback((): void => {
    clearCommitTimer();
    detachWindowDrag();
    isDraggingRef.current = false;
    const pending = draftRef.current;
    if (!pending) {
      return;
    }
    draftRef.current = null;
    lastCommittedRef.current = pending;
    // Keep `sliderDraft` visible until async `saved.set` updates `effects` so the thumb never snaps back.
    onUpdateRef.current(pending);
  }, [clearCommitTimer, detachWindowDrag]);

  const onDragStart = (): void => {
    isDraggingRef.current = true;
    clearCommitTimer();
    detachWindowDrag();
    const onRelease = (): void => commitDraft();
    globalThis.addEventListener('pointerup', onRelease, { capture: true });
    globalThis.addEventListener('pointercancel', onRelease, { capture: true });
    stopWindowDragRef.current = () => {
      globalThis.removeEventListener('pointerup', onRelease, { capture: true });
      globalThis.removeEventListener('pointercancel', onRelease, { capture: true });
    };
  };

  const handleInput = (patch: Partial<ThemeEffectsConfig>): void => {
    if (!onPreviewEffects) {
      onUpdateEffects(patch);
      return;
    }
    const merged = { ...(draftRef.current ?? {}), ...patch };
    draftRef.current = merged;
    setSliderDraft(merged);
    onPreviewEffects(merged);
    clearCommitTimer();
    if (!isDraggingRef.current) {
      commitTimerRef.current = setTimeout(commitDraft, SLIDER_COMMIT_DEBOUNCE_MS);
    }
  };

  const displayEffects: ThemeEffectsConfig = sliderDraft ? { ...effects, ...sliderDraft } : effects;
  return { displayEffects, handleInput, onDragStart, commitDraft };
}

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
  readonly activeVibe: StudioVibe | undefined;
  readonly onApplyVibe: (vibe: StudioVibe) => void;
}

export function StudioVibesCard({ activeVibe, onApplyVibe }: StudioVibesCardProps) {
  return (
    <SettingCard
      title="Studio Vibes"
      action={activeVibe ? <Badge tone="accent">{activeVibe.name}</Badge> : undefined}
    >
      <div className="theme-studio-pad">
        <p className="theme-studio-intro">
          Full-scene looks pairing curated palettes with live backgrounds, surface finishes, and
          click effects.
        </p>
        <div className="theme-vibe-grid" role="group" aria-label="Studio vibes">
          {STUDIO_VIBES.map((vibe) => {
            const backdropName = vibe.effects.backdrop
              ? BACKDROP_NAMES.get(vibe.effects.backdrop)
              : undefined;
            return (
              <button
                key={vibe.id}
                type="button"
                className="theme-vibe-card"
                aria-pressed={activeVibe?.id === vibe.id}
                onClick={() => onApplyVibe(vibe)}
              >
                <span
                  className="theme-vibe-banner"
                  aria-hidden="true"
                  style={{ background: vibe.swatch }}
                >
                  {backdropName && <span className="theme-vibe-tag">{backdropName}</span>}
                </span>
                <span className="theme-vibe-body">
                  <span className="theme-card-name">{vibe.name}</span>
                  <span className="theme-card-desc">{vibe.tagline}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SettingCard>
  );
}

export interface CreativeStudioCardProps {
  readonly effects: ThemeEffectsConfig;
  readonly effectsActive: boolean;
  readonly onPreviewEffects?: (patch: Partial<ThemeEffectsConfig>) => void;
  readonly onUpdateEffects: (patch: Partial<ThemeEffectsConfig>, toastLabel?: string) => void;
  readonly onResetEffects: () => void;
}

export function CreativeStudioCard({
  effects,
  effectsActive,
  onPreviewEffects,
  onUpdateEffects,
  onResetEffects,
}: CreativeStudioCardProps) {
  const { displayEffects, handleInput, onDragStart, commitDraft } = useEffectSliderDraft(
    effects,
    onPreviewEffects,
    onUpdateEffects,
  );

  return (
    <SettingCard
      title="Customize Effects"
      action={
        effectsActive ? (
          <button type="button" className="theme-inline-reset" onClick={onResetEffects}>
            Reset effects
          </button>
        ) : undefined
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
              <RainSelect
                label="Rain style"
                ariaLabel="Rain style"
                value={effects.rainLook}
                options={RAIN_LOOK_NAMES}
                labels={RAIN_LOOK_LABELS}
                onChange={(rainLook) => onUpdateEffects({ rainLook })}
              />
              <RainSelect
                label="Glyph charset"
                ariaLabel="Glyph charset"
                value={effects.rainCharset}
                options={RAIN_CHARSET_NAMES}
                labels={RAIN_CHARSET_LABELS}
                onChange={(rainCharset) => onUpdateEffects({ rainCharset })}
              />
              <RainSelect
                label="Intro"
                ariaLabel="Rain intro"
                value={effects.rainIntro}
                options={RAIN_INTRO_NAMES}
                labels={RAIN_INTRO_LABELS}
                onChange={(rainIntro) => onUpdateEffects({ rainIntro })}
              />
            </div>
            <EffectSlider
              field="rainDensity"
              label="Rain density"
              ariaLabel="Rain density"
              value={displayEffects.rainDensity}
              valueText={`${Math.round(displayEffects.rainDensity * 100)}%`}
              onInput={(rainDensity) => handleInput({ rainDensity })}
              onDragStart={onDragStart}
              onCommit={commitDraft}
            />
          </div>
        )}

        {effects.backdrop !== 'none' && (
          <div className="theme-tuner-box" role="group" aria-label="Background tuning">
            <div className="theme-slider-grid">
              <EffectSlider
                field="intensity"
                label="Visibility"
                ariaLabel="Background visibility"
                value={displayEffects.intensity}
                valueText={`${Math.round(displayEffects.intensity * 100)}%`}
                onInput={(intensity) => handleInput({ intensity })}
                onDragStart={onDragStart}
                onCommit={commitDraft}
              />
              <EffectSlider
                field="speed"
                label="Motion speed"
                ariaLabel="Motion speed"
                value={displayEffects.speed}
                valueText={`${displayEffects.speed.toFixed(2).replace(/\.00$/, '')}×`}
                onInput={(speed) => handleInput({ speed })}
                onDragStart={onDragStart}
                onCommit={commitDraft}
              />
              <EffectSlider
                field="glassStrength"
                label="Card glass"
                ariaLabel="Card glass translucency"
                value={displayEffects.glassStrength}
                valueText={`${Math.round((displayEffects.glassStrength / THEME_EFFECT_BOUNDS.glassStrength.max) * 100)}%`}
                onInput={(glassStrength) => handleInput({ glassStrength })}
                onDragStart={onDragStart}
                onCommit={commitDraft}
              />
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
