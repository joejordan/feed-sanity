import { useEffect, useMemo, useState } from 'react';
import type { PaletteMood } from '../../core/theming/color';
import type { ThemeDocumentV1 } from '../../core/theming/document';
import type { ThemePreset } from '../../core/theming/types';
import {
  minTextContrast,
  normalizeHex,
  PALETTE_MOODS,
  pickAccessibleText,
  WCAG_AA_TEXT_CONTRAST,
} from '../../core/theming/color';
import {
  applyGeneratedPalette,
  flipThemeColorScheme,
  hasPaletteOverrides,
  updateThemeChrome,
  updateThemePalette,
} from '../../core/theming/config';
import { Badge, Disclosure, Switch, TextInput } from '../primitives';

type ColorFieldKey = 'accent' | 'accentSecondary' | 'background' | 'surface' | 'text';

const COLOR_FIELDS: ReadonlyArray<{
  readonly key: ColorFieldKey;
  readonly label: string;
}> = [
  { key: 'accent', label: 'Accent' },
  { key: 'accentSecondary', label: 'Secondary accent' },
  { key: 'background', label: 'Canvas background' },
  { key: 'surface', label: 'Card surface' },
  { key: 'text', label: 'Primary text' },
];

const MOOD_LABELS: Record<PaletteMood, string> = {
  midnight: 'Midnight',
  'soft-dark': 'Soft Dark',
  neon: 'Neon',
  'warm-paper': 'Warm Paper',
  'crisp-light': 'Crisp Light',
  pastel: 'Pastel',
};

export interface PaletteCustomizationDisclosureProps {
  readonly value: ThemeDocumentV1;
  readonly activePreset: ThemePreset | undefined;
  /** Monotonic counter incremented when external edits (presets, vibes, undo) should clear local color drafts. */
  readonly draftResetKey: number;
  readonly onApplyEdit: (next: ThemeDocumentV1, toastLabel?: string) => void;
}

/**
 * Self-contained "Customize colors" disclosure: seed-color Palette Generator,
 * Flip Light/Dark polarity toggle, 5 hex/picker token inputs, Chrome accent
 * switches, and WCAG AA contrast warning with one-click auto-fix.
 */
export function PaletteCustomizationDisclosure({
  value,
  activePreset,
  draftResetKey,
  onApplyEdit,
}: PaletteCustomizationDisclosureProps) {
  const effective = value.palette;
  const hasCustomColors = useMemo(() => hasPaletteOverrides(value), [value]);
  const minContrast = useMemo(
    () =>
      effective ? minTextContrast(effective.text, effective.background, effective.surface) : null,
    [effective],
  );
  const lowContrast = minContrast !== null && minContrast < WCAG_AA_TEXT_CONTRAST;

  const [open, setOpen] = useState(hasCustomColors);
  const [seedColor, setSeedColor] = useState(() => effective?.accent ?? '#3b82f6');
  const [seedMood, setSeedMood] = useState<PaletteMood>('midnight');
  const [colorDrafts, setColorDrafts] = useState<Partial<Record<ColorFieldKey, string>>>({});

  useEffect(() => {
    if (draftResetKey > 0) {
      setColorDrafts((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    }
  }, [draftResetKey]);

  useEffect(() => {
    if (lowContrast) {
      setOpen(true);
    }
  }, [lowContrast]);

  const colorError = useMemo(() => {
    for (const { key, label } of COLOR_FIELDS) {
      const draft = colorDrafts[key];
      if (draft !== undefined) {
        const trimmed = draft.trim();
        if (trimmed && !normalizeHex(trimmed)) {
          return `${label} must be a hex color like #3b82f6.`;
        }
      }
    }
    return null;
  }, [colorDrafts]);

  const clearDraftKey = (key: ColorFieldKey): void => {
    setColorDrafts((prev) => {
      if (!(key in prev)) {
        return prev;
      }
      const { [key]: _removed, ...next } = prev;
      return next;
    });
  };

  const handleColorHexInput = (key: ColorFieldKey, raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (key === 'accentSecondary') {
        clearDraftKey(key);
        const presetSecondary = activePreset?.palette.accentSecondary;
        onApplyEdit(updateThemePalette(value, { accentSecondary: presetSecondary ?? '' }));
        return;
      }
      if (activePreset) {
        clearDraftKey(key);
        onApplyEdit(updateThemePalette(value, { [key]: activePreset.palette[key] }));
      } else {
        setColorDrafts((prev) => ({ ...prev, [key]: '' }));
      }
      return;
    }
    const normalized = normalizeHex(trimmed);
    if (!normalized) {
      setColorDrafts((prev) => ({ ...prev, [key]: raw }));
      return;
    }
    if (trimmed.toLowerCase() === normalized) {
      clearDraftKey(key);
    } else {
      setColorDrafts((prev) => ({ ...prev, [key]: raw }));
    }
    onApplyEdit(updateThemePalette(value, { [key]: normalized }));
  };

  let colorsBadge;
  if (lowContrast) {
    colorsBadge = <Badge tone="warning">Low contrast</Badge>;
  } else if (hasCustomColors) {
    colorsBadge = <Badge tone="accent">Customized</Badge>;
  }

  return (
    <Disclosure
      label="Customize colors"
      badge={colorsBadge}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
    >
      <div className="theme-drawer-pad">
        <div className="theme-palette-gen" role="group" aria-label="Palette generator">
          <span className="theme-palette-gen-label">Generate palette</span>
          <input
            type="color"
            className="theme-picker"
            aria-label="Palette seed color"
            value={seedColor}
            onChange={(event) => setSeedColor(event.currentTarget.value)}
          />
          <select
            className="field"
            aria-label="Palette mood"
            value={seedMood}
            onChange={(event) => setSeedMood(event.currentTarget.value as PaletteMood)}
          >
            {PALETTE_MOODS.map((mood) => (
              <option key={mood} value={mood}>
                {MOOD_LABELS[mood]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setColorDrafts({});
              onApplyEdit(
                applyGeneratedPalette(value, seedColor, seedMood),
                `Generated ${MOOD_LABELS[seedMood]} palette`,
              );
            }}
          >
            Generate
          </button>
          {effective && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setColorDrafts({});
                const nextScheme = effective.colorScheme === 'dark' ? 'light' : 'dark';
                onApplyEdit(flipThemeColorScheme(value), `Flipped to ${nextScheme} mode`);
              }}
            >
              Flip {effective.colorScheme === 'dark' ? 'Light' : 'Dark'}
            </button>
          )}
        </div>

        <div className="theme-controls">
          {COLOR_FIELDS.map(({ key, label }) => {
            const defaultFallback =
              key === 'accentSecondary' ? (effective?.danger ?? '#a855f7') : '#3b82f6';
            const fallbackHex = effective?.[key] ?? defaultFallback;
            const currentToken = effective?.[key] ?? '';
            const presetToken = activePreset?.palette[key] ?? '';
            const savedOverride =
              effective && (!activePreset || currentToken !== presetToken) ? currentToken : '';
            const inputVal = colorDrafts[key] ?? savedOverride;
            const pickerValue = normalizeHex(inputVal) ?? fallbackHex;
            return (
              <label key={key} className="theme-color-row">
                <span>{label}</span>
                <span className="theme-color-inputs">
                  <input
                    type="color"
                    className="theme-picker"
                    aria-label={`${label} picker`}
                    value={pickerValue}
                    onChange={(event) => handleColorHexInput(key, event.currentTarget.value)}
                  />
                  <TextInput
                    className="field theme-hex"
                    ariaLabel={label}
                    placeholder={fallbackHex}
                    value={inputVal}
                    onValueChange={(nextHex) => handleColorHexInput(key, nextHex)}
                  />
                </span>
              </label>
            );
          })}
        </div>

        <div className="theme-chrome-row" role="group" aria-label="Chrome accents">
          <span className="theme-inline-toggle">
            <span>Top accent ribbon</span>
            <Switch
              checked={Boolean(value.chrome?.ribbon?.enabled)}
              ariaLabel="Top accent ribbon"
              onChange={(enabled) =>
                onApplyEdit(
                  updateThemeChrome(value, { ribbon: enabled }),
                  enabled ? 'Top accent ribbon on' : 'Top accent ribbon off',
                )
              }
            />
          </span>
          <span className="theme-inline-toggle">
            <span>Ambient corner glow</span>
            <Switch
              checked={Boolean(value.chrome?.ambientGlow?.enabled)}
              ariaLabel="Ambient corner glow"
              onChange={(enabled) =>
                onApplyEdit(
                  updateThemeChrome(value, { ambientGlow: enabled }),
                  enabled ? 'Ambient corner glow on' : 'Ambient corner glow off',
                )
              }
            />
          </span>
        </div>

        {colorError && (
          <div className="theme-contrast-warn" role="alert">
            <span>{colorError}</span>
          </div>
        )}
        {lowContrast && effective && (
          <div className="theme-contrast-warn" role="status">
            <span>Low text contrast ({minContrast.toFixed(1)}:1 — WCAG AA recommends 4.5:1+).</span>
            <button
              className="button"
              type="button"
              onClick={() => {
                clearDraftKey('text');
                onApplyEdit(
                  updateThemePalette(value, {
                    text: pickAccessibleText(effective.background, effective.surface),
                  }),
                  'Fixed text contrast',
                );
              }}
            >
              Fix contrast
            </button>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
