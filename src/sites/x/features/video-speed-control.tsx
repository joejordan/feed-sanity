import { useState, useSyncExternalStore } from 'react';
import type { SavedVideoSpeed } from './video-speed-model';
import { clampVideoSpeed, formatSpeedNumber, parseSpeedInput } from './video-speed-model';

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

export function CustomSpeedControl({ store }: { readonly store: SpeedStore }) {
  const speed = useSyncExternalStore(store.subscribe, store.get);
  const [draft, setDraft] = useState<string | null>(null);

  const displayText = draft ?? formatSpeedNumber(speed.rate);
  const inputInvalid = draft !== null && draft.trim() !== '' && parseSpeedInput(draft) === null;

  const sliderValue = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, speed.rate));
  const sliderPct = ((sliderValue - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
  const sliderTrack = `linear-gradient(to right, var(--fs-accent) 0%, var(--fs-accent) ${sliderPct}%, var(--fs-divider) ${sliderPct}%, var(--fs-divider) 100%)`;

  const handleSlider = (raw: string, immediate: boolean): void => {
    const val = Number.parseFloat(raw);
    if (!Number.isFinite(val)) {
      return;
    }
    setDraft(null);
    store.set({ rate: clampVideoSpeed(val), custom: true }, immediate);
  };

  const commitDraft = (): void => {
    if (draft !== null) {
      const parsed = parseSpeedInput(draft);
      if (parsed !== null) {
        store.set({ rate: parsed, custom: true }, true);
      }
      setDraft(null);
    }
  };

  const stepBy = (dir: -1 | 1, fine: boolean): void => {
    setDraft(null);
    const delta = dir * (fine ? SLIDER_STEP : BUTTON_STEP);
    store.set({ rate: clampVideoSpeed(speed.rate + delta), custom: true }, true);
  };

  const resetNormal = (): void => {
    setDraft(null);
    store.set({ rate: 1, custom: false }, true);
  };

  return (
    <>
      <hr className="fs-speed-divider" />
      <div className="fs-speed-section" role="group" aria-label="Custom playback speed">
        <div className="fs-speed-header">
          <span className="fs-speed-title-group">
            <span className="fs-speed-title">Custom</span>
            <span className="fs-speed-badge">{formatSpeedNumber(speed.rate)}×</span>
          </span>
          <span className="fs-speed-header-right">
            {speed.rate !== 1 && (
              <button
                type="button"
                className="fs-speed-reset"
                aria-label="Reset playback speed to 1x"
                onClick={resetNormal}
              >
                1×
              </button>
            )}
            {speed.custom && (
              <svg
                className="fs-speed-check"
                viewBox="0 0 24 24"
                aria-label="Custom speed active"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
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
            onClick={(event) => stepBy(-1, event.shiftKey)}
          >
            −
          </button>
          <label className="fs-speed-field" data-invalid={inputInvalid ? 'true' : undefined}>
            <input
              type="text"
              inputMode="decimal"
              className="fs-speed-input"
              aria-label="Custom playback speed"
              placeholder="1.00"
              value={displayText}
              onFocus={() => setDraft(formatSpeedNumber(speed.rate))}
              onInput={(event) => {
                const raw = event.currentTarget.value;
                setDraft(raw);
                const parsed = parseSpeedInput(raw);
                if (parsed !== null) {
                  store.set({ rate: parsed, custom: true }, false);
                }
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  stepBy(1, event.shiftKey);
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  stepBy(-1, event.shiftKey);
                }
              }}
            />
            <span className="fs-speed-suffix" aria-hidden="true">
              ×
            </span>
          </label>
          <button
            type="button"
            className="fs-speed-step"
            aria-label="Increase playback speed"
            onClick={(event) => stepBy(1, event.shiftKey)}
          >
            +
          </button>
        </div>
      </div>
    </>
  );
}
