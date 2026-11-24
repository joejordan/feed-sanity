import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EffectParamSpec,
  EffectParamUnit,
  EffectParamValue,
  EffectParamValues,
  StudioVibe,
  ThemeEffectsConfig,
} from '../../core/theme-effects';
import {
  BACKDROP_OPTIONS,
  CLICK_EFFECT_OPTIONS,
  getBackdropParamSpecs,
  mergeEffectsPatch,
  resolveEffectParams,
  STUDIO_VIBES,
  SURFACE_FINISH_OPTIONS,
  THEME_EFFECT_BOUNDS,
  validateEffectParams,
} from '../../core/theme-effects';
import {
  Badge,
  previewLeaveProps,
  SegmentedControl,
  SettingCard,
  SettingRow,
  Switch,
  TextInput,
} from '../primitives';

const SLIDER_COMMIT_DEBOUNCE_MS = 250;

const BACKDROP_NAMES = new Map(BACKDROP_OPTIONS.map((opt) => [opt.id, opt.name]));

function EffectSlider({
  min,
  max,
  step = 0.05,
  label,
  ariaLabel,
  value,
  valueText,
  onInput,
  onDragStart,
  onCommit,
}: {
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly valueText: string;
  readonly onInput: (next: number) => void;
  readonly onDragStart: () => void;
  readonly onCommit: () => void;
}) {
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
        step={step}
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

function formatParamNumber(value: number, unit: EffectParamUnit | undefined): string {
  if (unit === '%') {
    return `${Math.round(value * 100)}%`;
  }
  if (unit === '×') {
    return `${value.toFixed(2).replace(/\.00$/, '')}×`;
  }
  if (unit === 'px' || unit === '°') {
    return `${Math.round(value)}${unit}`;
  }
  return String(value);
}

function PluginParamsBox({
  backdropName,
  specs,
  values,
  rawValues,
  onUpdateParam,
  onInputParam,
  onDragStart,
  onCommit,
}: {
  readonly backdropName: string;
  readonly specs: readonly EffectParamSpec[];
  readonly values: Readonly<Record<string, EffectParamValue>>;
  readonly rawValues: EffectParamValues | undefined;
  readonly onUpdateParam: (key: string, value: EffectParamValue) => void;
  readonly onInputParam: (key: string, value: EffectParamValue) => void;
  readonly onDragStart: () => void;
  readonly onCommit: () => void;
}) {
  const grouped = useMemo(() => {
    const enums: Extract<EffectParamSpec, { kind: 'enum' }>[] = [];
    const numbers: Extract<EffectParamSpec, { kind: 'number' }>[] = [];
    const strings: Extract<EffectParamSpec, { kind: 'string' }>[] = [];
    const colors: Extract<EffectParamSpec, { kind: 'color' }>[] = [];
    const booleans: Extract<EffectParamSpec, { kind: 'boolean' }>[] = [];
    for (const spec of specs) {
      switch (spec.kind) {
        case 'enum':
          enums.push(spec);
          break;
        case 'number':
          numbers.push(spec);
          break;
        case 'string':
          strings.push(spec);
          break;
        case 'color':
          colors.push(spec);
          break;
        case 'boolean':
          booleans.push(spec);
          break;
      }
    }
    return { enums, numbers, strings, colors, booleans };
  }, [specs]);

  return (
    <div className="theme-tuner-box" role="group" aria-label={`${backdropName} settings`}>
      {grouped.enums.length > 0 && (
        <div className="theme-tuner-grid">
          {grouped.enums.map((spec) => (
            <label key={spec.key} className="theme-color-row">
              <span>{spec.label}</span>
              <select
                className="field"
                aria-label={spec.ariaLabel ?? spec.label}
                value={String(values[spec.key] ?? spec.defaultValue)}
                onChange={(event) => onUpdateParam(spec.key, event.currentTarget.value)}
              >
                {spec.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {spec.optionLabels?.[opt] ?? opt}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {grouped.numbers.map((spec) => {
        const raw = values[spec.key];
        const num = typeof raw === 'number' ? raw : spec.defaultValue;
        return (
          <EffectSlider
            key={spec.key}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            label={spec.label}
            ariaLabel={spec.ariaLabel ?? spec.label}
            value={num}
            valueText={formatParamNumber(num, spec.unit)}
            onInput={(next) => onInputParam(spec.key, next)}
            onDragStart={onDragStart}
            onCommit={onCommit}
          />
        );
      })}

      {grouped.strings.map((spec) => {
        const raw = rawValues?.[spec.key];
        const current =
          typeof raw === 'string' ? raw : String(values[spec.key] ?? spec.defaultValue);
        return (
          <label key={spec.key} className="theme-color-row">
            <span>{spec.label}</span>
            <TextInput
              className="field"
              ariaLabel={spec.ariaLabel ?? spec.label}
              {...(spec.placeholder === undefined ? {} : { placeholder: spec.placeholder })}
              value={current}
              onValueChange={(next) => {
                if (next !== current) {
                  onInputParam(spec.key, next);
                }
              }}
              onBlur={onCommit}
            />
          </label>
        );
      })}

      {grouped.colors.map((spec) => (
        <label key={spec.key} className="theme-color-row">
          <span>{spec.label}</span>
          <input
            type="color"
            className="theme-picker"
            aria-label={spec.ariaLabel ?? spec.label}
            value={String(values[spec.key] ?? spec.defaultValue)}
            onChange={(event) => onUpdateParam(spec.key, event.currentTarget.value)}
          />
        </label>
      ))}

      {grouped.booleans.length > 0 && (
        <div className="theme-tuner-switches">
          {grouped.booleans.map((spec) => (
            <span key={spec.key} className="theme-inline-toggle">
              <span>{spec.label}</span>
              <Switch
                checked={Boolean(values[spec.key] ?? spec.defaultValue)}
                ariaLabel={spec.ariaLabel ?? spec.label}
                onChange={(next) => onUpdateParam(spec.key, next)}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function matchesCommittedBackdropParams(
  actual: EffectParamValues | undefined,
  committed: EffectParamValues | undefined,
  specs: readonly EffectParamSpec[],
): boolean {
  if (!committed) {
    return true;
  }
  const normalized = validateEffectParams(committed, specs);
  return Object.keys(committed).every((key) => actual?.[key] === normalized?.[key]);
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
    const specs = getBackdropParamSpecs(effects.backdrop);
    const matchesOwnCommit =
      committed !== null &&
      (Object.keys(committed) as Array<keyof ThemeEffectsConfig>).every((key) =>
        key === 'backdropParams'
          ? matchesCommittedBackdropParams(effects.backdropParams, committed.backdropParams, specs)
          : effects[key] === committed[key],
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
    const merged = mergeEffectsPatch(draftRef.current ?? {}, patch);
    draftRef.current = merged;
    setSliderDraft(merged);
    onPreviewEffects(merged);
    clearCommitTimer();
    if (!isDraggingRef.current) {
      commitTimerRef.current = setTimeout(commitDraft, SLIDER_COMMIT_DEBOUNCE_MS);
    }
  };

  const displayEffects: ThemeEffectsConfig = sliderDraft
    ? mergeEffectsPatch(effects, sliderDraft)
    : effects;
  return { displayEffects, handleInput, onDragStart, commitDraft };
}

export interface StudioVibesCardProps {
  readonly activeVibe: StudioVibe | undefined;
  readonly onApplyVibe: (vibe: StudioVibe) => void;
  readonly onPreviewVibe?: (vibe: StudioVibe | null) => void;
}

export function StudioVibesCard({ activeVibe, onApplyVibe, onPreviewVibe }: StudioVibesCardProps) {
  return (
    <SettingCard
      title="Studio Vibes"
      action={activeVibe ? <Badge tone="accent">{activeVibe.name}</Badge> : undefined}
    >
      <div className="theme-studio-pad">
        <p className="theme-studio-intro">
          Full-scene looks pairing curated palettes with live backgrounds, surface finishes, and
          click effects. Hover any card to preview live.
        </p>
        <div
          className="theme-vibe-grid"
          role="group"
          aria-label="Studio vibes"
          {...previewLeaveProps(() => onPreviewVibe?.(null))}
        >
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
                onMouseEnter={() => onPreviewVibe?.(vibe)}
                onFocus={() => onPreviewVibe?.(vibe)}
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
  const backdropSpecs = getBackdropParamSpecs(effects.backdrop);
  const resolvedPluginParams = useMemo(
    () => resolveEffectParams(backdropSpecs, displayEffects.backdropParams),
    [backdropSpecs, displayEffects.backdropParams],
  );
  const activeBackdropName = BACKDROP_NAMES.get(effects.backdrop) ?? effects.backdrop;

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
                  { backdrop: opt.id },
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

        {backdropSpecs.length > 0 && (
          <PluginParamsBox
            backdropName={activeBackdropName}
            specs={backdropSpecs}
            values={resolvedPluginParams}
            rawValues={displayEffects.backdropParams}
            onUpdateParam={(key, val) => onUpdateEffects({ backdropParams: { [key]: val } })}
            onInputParam={(key, val) => handleInput({ backdropParams: { [key]: val } })}
            onDragStart={onDragStart}
            onCommit={commitDraft}
          />
        )}

        {effects.backdrop !== 'none' && (
          <div className="theme-tuner-box" role="group" aria-label="Background tuning">
            <div className="theme-slider-grid">
              <EffectSlider
                min={THEME_EFFECT_BOUNDS.intensity.min}
                max={THEME_EFFECT_BOUNDS.intensity.max}
                label="Visibility"
                ariaLabel="Background visibility"
                value={displayEffects.intensity}
                valueText={formatParamNumber(displayEffects.intensity, '%')}
                onInput={(intensity) => handleInput({ intensity })}
                onDragStart={onDragStart}
                onCommit={commitDraft}
              />
              <EffectSlider
                min={THEME_EFFECT_BOUNDS.speed.min}
                max={THEME_EFFECT_BOUNDS.speed.max}
                label="Motion speed"
                ariaLabel="Motion speed"
                value={displayEffects.speed}
                valueText={formatParamNumber(displayEffects.speed, '×')}
                onInput={(speed) => handleInput({ speed })}
                onDragStart={onDragStart}
                onCommit={commitDraft}
              />
              <EffectSlider
                min={THEME_EFFECT_BOUNDS.glassStrength.min}
                max={THEME_EFFECT_BOUNDS.glassStrength.max}
                label="Card glass"
                ariaLabel="Card glass translucency"
                value={displayEffects.glassStrength}
                valueText={formatParamNumber(
                  displayEffects.glassStrength / THEME_EFFECT_BOUNDS.glassStrength.max,
                  '%',
                )}
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
          options={SURFACE_FINISH_OPTIONS}
          onChange={(next) =>
            onUpdateEffects(
              { surface: next },
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
              { click: next },
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
