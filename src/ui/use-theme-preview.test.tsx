import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeDocumentV1 } from '../core/theming/document';
import type { ThemePreviewControls } from './use-theme-preview';
import { applyThemePreset, DEFAULT_THEME_DOCUMENT } from '../core/theming/config';
import { useThemePreview } from './use-theme-preview';

function Harness({
  current,
  onPreview,
  enabled = true,
  onControls,
}: {
  readonly current: ThemeDocumentV1;
  readonly onPreview?: (doc: ThemeDocumentV1 | null) => void;
  readonly enabled?: boolean;
  readonly onControls: (controls: ThemePreviewControls) => void;
}) {
  const controls = useThemePreview(current, onPreview, enabled);
  onControls(controls);
  return <div />;
}

describe('useThemePreview', () => {
  afterEach(() => cleanup());

  it('deduplicates consecutive identical preview keys without re-invoking buildCandidate or onPreview', () => {
    const onPreview = vi.fn();
    const midnight = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight');
    const buildCandidate = vi.fn(() => midnight);
    let controls!: ThemePreviewControls;

    render(
      <Harness
        current={DEFAULT_THEME_DOCUMENT}
        onPreview={onPreview}
        onControls={(c) => {
          controls = c;
        }}
      />,
    );

    controls.preview('preset:midnight', buildCandidate);
    controls.preview('preset:midnight', buildCandidate);

    expect(buildCandidate).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(midnight);
    expect(controls.isActive()).toBe(true);
  });

  it('clears an active preview when moving back onto the active theme via matchesCurrent or JSON equality', () => {
    const onPreview = vi.fn();
    const current = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'nord');
    const midnight = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight');
    let controls!: ThemePreviewControls;

    render(
      <Harness
        current={current}
        onPreview={onPreview}
        onControls={(c) => {
          controls = c;
        }}
      />,
    );

    controls.previewDocument('preset:midnight', midnight);
    expect(onPreview).toHaveBeenLastCalledWith(midnight);

    // Explicit matchesCurrent short-circuit clears the prior preview.
    controls.previewDocument('saved:active', midnight, true);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controls.isActive()).toBe(false);

    // Re-enter midnight, then hover an equivalent clone of `current` (JSON equality fallback).
    controls.previewDocument('preset:midnight', midnight);
    controls.previewDocument('preset:nord', { ...current });
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controls.isActive()).toBe(false);
  });

  it('clears active preview when disabled, ignores calls while disabled, suppresses clear after commit, and cleans up on unmount', () => {
    const onPreview = vi.fn();
    const midnight = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight');
    let controls!: ThemePreviewControls;

    const { rerender, unmount } = render(
      <Harness
        current={DEFAULT_THEME_DOCUMENT}
        onPreview={onPreview}
        enabled={true}
        onControls={(c) => {
          controls = c;
        }}
      />,
    );

    controls.previewDocument('preset:midnight', midnight);
    expect(controls.isActive()).toBe(true);

    // Disabling clears the active preview.
    rerender(
      <Harness
        current={DEFAULT_THEME_DOCUMENT}
        onPreview={onPreview}
        enabled={false}
        onControls={(c) => {
          controls = c;
        }}
      />,
    );
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controls.isActive()).toBe(false);

    // Previews while disabled are ignored.
    onPreview.mockClear();
    controls.previewDocument('preset:midnight', midnight);
    expect(onPreview).not.toHaveBeenCalled();

    // Re-enable, preview, commit -> trailing clear() is a no-op.
    rerender(
      <Harness
        current={DEFAULT_THEME_DOCUMENT}
        onPreview={onPreview}
        enabled={true}
        onControls={(c) => {
          controls = c;
        }}
      />,
    );
    controls.previewDocument('preset:midnight', midnight);
    expect(controls.markCommitted()).toBe(true);
    onPreview.mockClear();
    controls.clear();
    expect(onPreview).not.toHaveBeenCalled();

    // Active preview clears automatically on unmount.
    controls.previewDocument('preset:midnight', midnight);
    act(() => {
      unmount();
    });
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});
