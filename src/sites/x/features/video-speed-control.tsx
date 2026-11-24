import { useState, useSyncExternalStore } from 'react';
import type { SavedVideoSpeed } from './video-speed-model';
import {
  clampVideoSpeed,
  formatSpeedNumber,
  isNativeXSpeed,
  parseSpeedInput,
} from './video-speed-model';

const SLIDER_MIN = 0.25;
const SLIDER_MAX = 4;
const SLIDER_STEP = 0.01;
const BUTTON_STEP = 0.05;

export interface SpeedStore {
  get: () => SavedVideoSpeed;
  set: (next: SavedVideoSpeed, immediate?: boolean) => void;
  flush: () => void;
  subscribe: (listener: () => void) => () => void;
}

export interface CustomSpeedControlProps {
  readonly store: SpeedStore;
  /** Called when the user confirms their chosen speed via Enter or the Set button. */
  readonly onConfirm?: () => void;
}

export function CustomSpeedControl({ store, onConfirm }: CustomSpeedControlProps) {
  const speed = useSyncExternalStore(store.subscribe, store.get);
  const [draft, setDraft] = useState<string | null>(null);

  const displayText = draft ?? formatSpeedNumber(speed.rate);
  const parsedDraft = draft === null ? speed.rate : parseSpeedInput(draft);
  const inputInvalid = draft !== null && draft.trim() !== '' && parsedDraft === null;
  const activeRate = parsedDraft ?? speed.rate;

  const sliderValue = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, speed.rate));
  const sliderPct = ((sliderValue - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
  const sliderTrack = `linear-gradient(to right, var(--fs-accent) 0%, var(--fs-accent) ${sliderPct}%, var(--fs-divider) ${sliderPct}%, var(--fs-divider) 100%)`;

  const applyRate = (rate: number, immediate: boolean): void => {
    const clamped = clampVideoSpeed(rate);
    store.set({ rate: clamped, custom: !isNativeXSpeed(clamped) }, immediate);
  };

  const handleSlider = (raw: string, immediate: boolean): void => {
    const val = Number.parseFloat(raw);
    if (!Number.isFinite(val)) {
      return;
    }
    setDraft(null);
    applyRate(val, immediate);
  };

  const commitDraft = (): number | null => {
    if (draft === null) {
      return speed.rate;
    }
    const parsed = parseSpeedInput(draft);
    setDraft(null);
    if (parsed !== null) {
      applyRate(parsed, true);
      return parsed;
    }
    return null;
  };

  const confirmAndClose = (): void => {
    const finalRate = draft === null ? speed.rate : parseSpeedInput(draft);
    if (finalRate === null) {
      return;
    }
    setDraft(null);
    applyRate(finalRate, true);
    onConfirm?.();
  };

  const stepBy = (dir: -1 | 1, fine: boolean): void => {
    setDraft(null);
    const delta = dir * (fine ? SLIDER_STEP : BUTTON_STEP);
    applyRate(speed.rate + delta, true);
  };

  return (
    <>
      <hr className="fs-speed-divider" />
      <div className="fs-speed-section" role="group" aria-label="Custom playback speed">
        <div className="fs-speed-header">
          <span className="fs-speed-title">Custom speed</span>
          <span className="fs-speed-badge">{formatSpeedNumber(activeRate)}×</span>
        </div>

        <div className="fs-speed-slider-wrap">
          <input
            type="range"
            className="fs-speed-slider"
            aria-label="Playback speed slider"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={SLIDER_STEP}
            value={sliderValue}
            style={{ background: sliderTrack }}
            onInput={(event) => handleSlider(event.currentTarget.value, false)}
            onPointerUp={() => store.flush()}
            onKeyUp={() => store.flush()}
            onBlur={() => store.flush()}
          />
          <div className="fs-speed-ticks" aria-hidden="true">
            <span>0.25×</span>
            <span>1×</span>
            <span>2×</span>
            <span>4×</span>
          </div>
        </div>

        <div className="fs-speed-input-row">
          <button
            type="button"
            className="fs-speed-step"
            aria-label="Decrease playback speed"
            title="Decrease speed (hold Shift for 0.01)"
            onClick={(event) => stepBy(-1, event.shiftKey)}
          >
            −
          </button>
          <input
            type="text"
            inputMode="decimal"
            className="fs-speed-input"
            aria-label="Custom playback speed"
            aria-invalid={inputInvalid || undefined}
            placeholder="Type speed"
            title="Type any speed from 0.1 to 16 and press Enter"
            value={displayText}
            onFocus={(event) => {
              setDraft(formatSpeedNumber(speed.rate));
              event.currentTarget.select();
            }}
            onInput={(event) => {
              const raw = event.currentTarget.value;
              setDraft(raw);
              const parsed = parseSpeedInput(raw);
              if (parsed !== null) {
                applyRate(parsed, false);
              }
            }}
            onBlur={() => {
              commitDraft();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                confirmAndClose();
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                stepBy(1, event.shiftKey);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                stepBy(-1, event.shiftKey);
              }
            }}
          />
          <button
            type="button"
            className="fs-speed-step"
            aria-label="Increase playback speed"
            title="Increase speed (hold Shift for 0.01)"
            onClick={(event) => stepBy(1, event.shiftKey)}
          >
            +
          </button>
        </div>

        {inputInvalid && (
          <span className="fs-speed-hint" role="alert">
            Enter a number between 0.1 and 16
          </span>
        )}

        <button
          type="button"
          className="fs-speed-apply"
          disabled={inputInvalid}
          onMouseDown={(event) => event.preventDefault()}
          onClick={confirmAndClose}
        >
          Set {formatSpeedNumber(activeRate)}×
        </button>
      </div>
    </>
  );
}
