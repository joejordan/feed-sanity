// Zero-DOM model & validation helpers for X (Twitter) custom video playback speed.
// Kept free of DOM/UI/feature imports so the toolbar popup can read and adjust
// saved speed without pulling X's page runtime into the popup bundle.

import { isRecord } from '../../../core/storage';

export const X_VIDEO_SPEED_KEY = 'x_video_speed';

export const MIN_VIDEO_SPEED = 0.1;
export const MAX_VIDEO_SPEED = 16;
export const SPEED_EPSILON = 0.005;

/** Native playback speed presets offered by X's built-in video player menu. */
export const NATIVE_X_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** True when `rate` matches one of X's native playback speed radio presets. */
export function isNativeXSpeed(rate: number): boolean {
  const clamped = clampVideoSpeed(rate);
  return NATIVE_X_SPEEDS.some((preset) => Math.abs(preset - clamped) < SPEED_EPSILON);
}

export interface SavedVideoSpeed {
  readonly rate: number;
  readonly custom: boolean;
}

export const DEFAULT_VIDEO_SPEED: SavedVideoSpeed = {
  rate: 1,
  custom: false,
};

/** Rounds a playback speed to 2 decimals and clamps it within `[0.1, 16]`. */
export function clampVideoSpeed(rate: number): number {
  const clamped = Math.max(MIN_VIDEO_SPEED, Math.min(MAX_VIDEO_SPEED, rate));
  return Math.round(clamped * 100) / 100;
}

/** Formats a numeric speed cleanly without trailing zeros (e.g. `1.17` -> `'1.17'`). */
export function formatSpeedNumber(rate: number): string {
  return String(clampVideoSpeed(rate));
}

/** Formats a numeric speed with an `x` suffix for menu display (e.g. `1.37` -> `'1.37x'`). */
export function formatSpeedLabel(rate: number): string {
  return `${formatSpeedNumber(rate)}x`;
}

function parseBoundedSpeed(numeric: string): number | null {
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value) || value < MIN_VIDEO_SPEED || value > MAX_VIDEO_SPEED) {
    return null;
  }
  return clampVideoSpeed(value);
}

/** Parses user-typed speed input (e.g. `'1.17'`, `'2.23x'`, `'0.78×'`). */
export function parseSpeedInput(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/[x×]\s*$/i, '')
    .trim();
  if (!/^\d*(?:\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    return null;
  }
  return parseBoundedSpeed(cleaned);
}

/** Parses an X native speed option label (`'Normal'`, `'0.25x'`, `'1x (Normal)'`, `'1.5x'`, `'2x'`, etc.). */
export function parseNativeSpeedLabel(text: string): number | null {
  const trimmed = text.replaceAll(/[✓✔•]/g, '').trim();
  if (/^normal(?:\s*\(\s*1(?:\.0+)?\s*[x×]\s*\))?$/i.test(trimmed)) {
    return 1;
  }
  const match = /^(\d+(?:\.\d+)?)\s*[x×](?:\s*\(\s*normal\s*\))?$/i.exec(trimmed);
  return match?.[1] ? parseBoundedSpeed(match[1]) : null;
}

/** Safely validates persisted `SavedVideoSpeed` data from storage. */
export function readSavedVideoSpeed(raw: unknown): SavedVideoSpeed {
  if (!isRecord(raw)) {
    return { ...DEFAULT_VIDEO_SPEED };
  }
  const rate =
    typeof raw.rate === 'number' && Number.isFinite(raw.rate)
      ? clampVideoSpeed(raw.rate)
      : DEFAULT_VIDEO_SPEED.rate;
  const custom = typeof raw.custom === 'boolean' ? raw.custom : rate !== 1;
  return { rate, custom };
}
