import { describe, expect, it } from 'vitest';
import { STUDIO_VIBES } from '../theme-effects';
import {
  applyStudioVibe,
  applyThemeDocument,
  applyThemePreset,
  autoFixDocumentContrast,
  BUILTIN_THEMES,
  clearThemeEffects,
  compileChromeHostCss,
  compileChromeUiCss,
  compileHostThemeCss,
  DEFAULT_THEME_DOCUMENT,
  hydratePalette,
  isCustomImportedDocument,
  MAX_CUSTOM_CSS_BYTES,
  MAX_THEME_FILE_BYTES,
  parseThemeDocument,
  presetToThemeDocument,
  readThemeDocument,
  resolveTheme,
  sanitizeCustomCss,
  sanitizeFontStack,
  serializeThemeDocument,
  THEME_FILE_FORMAT,
  THEME_SCHEMA_VERSION,
  updateThemeCustomCss,
  updateThemeEffects,
  updateThemePalette,
  updateThemeTypography,
  vibeToThemeDocument,
} from '../theming';

describe('ThemeDocumentV1 (.fstheme.json) codec & standardization', () => {
  it('materializes every built-in Color Theme and Studio Vibe as canonical ThemeDocumentV1 and round-trips cleanly', () => {
    for (const preset of BUILTIN_THEMES) {
      const doc = presetToThemeDocument(preset);
      expect(applyThemePreset(DEFAULT_THEME_DOCUMENT, preset.id)).toEqual(doc);
      const json = serializeThemeDocument(doc);
      const parsed = parseThemeDocument(json);

      expect(parsed.ok, `${preset.id} should parse cleanly`).toBe(true);
      expect(parsed.document).toBeDefined();
      expect(parsed.document?.format).toBe(THEME_FILE_FORMAT);
      expect(parsed.document?.schemaVersion).toBe(THEME_SCHEMA_VERSION);
      expect(parsed.document?.id).toBe(preset.id);
      expect(parsed.document?.palette).toEqual(preset.palette);
      expect(parsed.document?.chrome).toEqual(preset.chrome);
      expect(isCustomImportedDocument(parsed.document!)).toBe(false);

      const applied = applyThemeDocument(parsed.document!);
      const resolved = resolveTheme(applied);
      expect(resolved?.palette).toEqual(preset.palette);
      expect(resolved?.chrome).toEqual(preset.chrome);
    }

    for (const vibe of STUDIO_VIBES) {
      const doc = vibeToThemeDocument(vibe);
      expect(applyStudioVibe(DEFAULT_THEME_DOCUMENT, vibe)).toEqual(doc);
      const json = serializeThemeDocument(doc);
      const parsed = parseThemeDocument(json);

      expect(parsed.ok, `${vibe.id} should parse cleanly`).toBe(true);
      expect(parsed.document?.id).toBe(vibe.id);
      expect(parsed.document?.effects?.backdrop?.id).toBe(vibe.effects.backdrop);
      expect(isCustomImportedDocument(parsed.document!)).toBe(false);

      const applied = applyThemeDocument(parsed.document!);
      const originalResolved = resolveTheme(doc);
      const importedResolved = resolveTheme(applied);

      expect(importedResolved?.palette).toEqual(originalResolved?.palette);
      expect(importedResolved?.effects).toEqual(originalResolved?.effects);
      expect(importedResolved?.fontFamily).toBe(originalResolved?.fontFamily);
      expect(importedResolved?.chrome).toEqual(originalResolved?.chrome);
    }
  });

  it('hydrates a minimal 4-color theme document deterministically', () => {
    const minimal = JSON.stringify({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Minimal Ocean' },
      palette: {
        colorScheme: 'dark',
        background: '#08121e',
        surface: '#0f1f33',
        text: '#e8f1fa',
        accent: '#38bdf8',
      },
    });

    const parsed = parseThemeDocument(minimal);
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.id).toBe('minimal-ocean');
    expect(parsed.document?.palette).toMatchObject({
      colorScheme: 'dark',
      background: '#08121e',
      surface: '#0f1f33',
      text: '#e8f1fa',
      accent: '#38bdf8',
      accentText: '#111111',
    });
    expect(parsed.document?.palette?.surfaceAlt).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed.document?.palette?.textMuted).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed.document?.palette?.border).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed.document?.palette?.danger).toBe('#f87171');
  });

  it('rejects oversized files, invalid JSON, wrong format, future schemaVersion, and malformed hex colors', () => {
    expect(parseThemeDocument('x'.repeat(MAX_THEME_FILE_BYTES + 1)).ok).toBe(false);
    expect(parseThemeDocument('{not valid json').ok).toBe(false);
    expect(parseThemeDocument('[]').ok).toBe(false);

    const wrongFormat = parseThemeDocument({
      format: 'some-other-theme',
      schemaVersion: 1,
      meta: { name: 'Bad' },
      palette: null,
    });
    expect(wrongFormat.ok).toBe(false);
    expect(wrongFormat.errors[0]).toMatch(/format/);

    const futureVersion = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 99,
      meta: { name: 'Future' },
      palette: null,
    });
    expect(futureVersion.ok).toBe(false);
    expect(futureVersion.errors[0]).toMatch(/schemaVersion 99/);

    const badHex = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Bad Hex' },
      palette: {
        colorScheme: 'dark',
        background: 'rgb(0,0,0)',
        surface: '#111111',
        text: '#ffffff',
        accent: '#3b82f6',
      },
    });
    expect(badHex.ok).toBe(false);
    expect(badHex.errors.join(' ')).toMatch(/palette\.background/);
  });

  it('warns on low WCAG AA contrast and repairs it with autoFixDocumentContrast', () => {
    const lowContrast = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Faint Ink' },
      palette: {
        colorScheme: 'light',
        background: '#ffffff',
        surface: '#f8fafc',
        text: '#cccccc',
        accent: '#facc15',
        accentText: '#ffffff',
      },
    });

    expect(lowContrast.ok).toBe(true);
    expect(lowContrast.warnings.some((w) => w.includes('Low text contrast'))).toBe(true);
    expect(lowContrast.warnings.some((w) => w.includes('Low accent button contrast'))).toBe(true);

    const fixed = autoFixDocumentContrast(lowContrast.document!);
    const rechecked = parseThemeDocument(fixed);
    expect(rechecked.ok).toBe(true);
    expect(rechecked.warnings).toEqual([]);
    expect(fixed.palette?.text).toBe('#111111');
    expect(fixed.palette?.accentText).toBe('#111111');
  });

  it('sanitizes external/unsafe directives and enforces the 16 KB ceiling on customCss', () => {
    const dirty = [
      '@import url("https://evil.example/track.css");',
      '@charset "utf-8";',
      '.card { background: url(https://evil.example/pixel.png); width: expression(alert(1)); behavior: url(x.htc); -moz-binding: url(x.xml); color: red; }',
    ].join('\n');

    const sanitized = sanitizeCustomCss(dirty);
    expect(sanitized.strippedCount).toBeGreaterThanOrEqual(5);
    expect(sanitized.css).not.toMatch(/@import/i);
    expect(sanitized.css).not.toMatch(/https:\/\/evil/i);
    expect(sanitized.css).not.toMatch(/expression\s*\(/i);
    expect(sanitized.css).not.toMatch(/behavior\s*:/i);
    expect(sanitized.css).not.toMatch(/-moz-binding/i);
    expect(sanitized.css).toContain('color: red;');

    const oversized = sanitizeCustomCss(`.a { color: red; }\n`.repeat(1500));
    expect(oversized.truncated).toBe(true);
    expect(oversized.css.length).toBeLessThanOrEqual(MAX_CUSTOM_CSS_BYTES);

    // applyThemeDocument respects includeCustomCss: false (opt-in safety)
    const parsed = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Styled' },
      palette: null,
      customCss: '.x { color: green; }',
    });
    expect(parsed.hadCustomCss).toBe(true);
    const withoutCss = applyThemeDocument(parsed.document!, {
      includeCustomCss: false,
    });
    expect(withoutCss.customCss).toBeUndefined();
  });

  it('compiles declarative chrome specs cleanly and suppresses ambientGlow when a live backdrop runs', () => {
    const chrome = {
      ribbon: { enabled: true, stops: ['#22d3ee', '#c084fc'], height: 3, angle: 90 },
      ambientGlow: {
        enabled: true,
        spots: [{ color: '#22d3ee', alpha: 0.14, x: 18, y: 0, radiusX: 60, radiusY: 42 }],
      },
    } as const;

    const withoutBackdrop = compileChromeHostCss(chrome, false);
    expect(withoutBackdrop).toContain('body::before');
    expect(withoutBackdrop).toContain('body::after');
    expect(withoutBackdrop).toContain('linear-gradient(90deg, #22d3ee, #c084fc)');

    const withBackdrop = compileChromeHostCss(chrome, true);
    expect(withBackdrop).toContain('body::before');
    expect(withBackdrop).not.toContain('body::after');

    const uiCss = compileChromeUiCss(chrome);
    expect(uiCss).toContain('.dialog::before, .qp-root::before');
    expect(uiCss).toContain('linear-gradient(90deg, #22d3ee, #c084fc)');
  });

  it('keeps mixed !important and normal custom CSS rules in their proper cascade layers', () => {
    const resolved = resolveTheme(
      updateThemeCustomCss(
        applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight'),
        '.normal { border-radius: 12px; }\n.forced { color: #ff00ff !important; }\n@media (min-width: 800px) { .wide { padding: 8px; } }',
      ),
    )!;

    const css = compileHostThemeCss(resolved, {
      rootSelectors: [':root'],
    });

    expect(css).toContain('@layer fs-user {\n.forced { color: #ff00ff !important; }\n}');
    expect(css).toContain('.normal { border-radius: 12px; }');
    expect(css).toContain('@media (min-width: 800px) { .wide { padding: 8px; } }');
  });

  it('re-hydrates secondary tokens on polarity flips, rejects non-v1 records cleanly, and reverts tweaked Studio Vibes on effect clear', () => {
    // Flip a dark preset to a light background override
    const flipped = resolveTheme(
      updateThemePalette(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight'), {
        background: '#f8fafc',
        surface: '#ffffff',
        text: '#111111',
      }),
    )!;
    expect(flipped.palette).not.toBeNull();
    expect(flipped.palette?.colorScheme).toBe('light');
    // Secondary tokens should match light polarity, not dark midnight (#1c2536 / #243044)
    expect(flipped.palette?.surfaceAlt).not.toBe('#1c2536');
    expect(flipped.palette?.border).not.toBe('#243044');

    // readThemeDocument preserves valid stored ThemeDocumentV1 and defaults non-v1 / corrupt records cleanly
    const validDoc = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Saved Doc', author: 'Joe' },
      palette: hydratePalette({
        colorScheme: 'dark',
        background: '#10141c',
        surface: '#19202d',
        text: '#f1f5f9',
        accent: '#38bdf8',
      }),
    }).document!;

    const readValid = readThemeDocument(validDoc);
    expect(readValid.meta.name).toBe('Saved Doc');
    expect(readValid.meta.author).toBe('Joe');

    const readCorruptV1 = readThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 99,
      meta: { name: 'Broken' },
    });
    expect(readCorruptV1).toEqual(DEFAULT_THEME_DOCUMENT);

    expect(readThemeDocument({ preset: 'nord', font: 'serif' })).toEqual(DEFAULT_THEME_DOCUMENT);

    // Tweaking a Studio Vibe and then clearing effects (or manually turning all effects off)
    // still reverts vibe identity & vibe-owned font cleanly while preserving custom palette swatches.
    const matrix = STUDIO_VIBES.find((v) => v.id === 'enter-the-matrix')!;
    const tweakedVibe = updateThemeEffects(
      updateThemePalette(applyStudioVibe(DEFAULT_THEME_DOCUMENT, matrix), { accent: '#ff0066' }),
      { backdrop: 'aurora' },
    );
    const clearedTweaked = clearThemeEffects(tweakedVibe);
    expect(clearedTweaked.id).toBe('terminal-phosphor');
    expect(clearedTweaked.typography).toBeUndefined();
    expect(clearedTweaked.meta.swatches).toContain('#ff0066');

    const manuallyOff = updateThemeEffects(tweakedVibe, {
      backdrop: 'none',
      surface: 'default',
      click: 'none',
    });
    expect(manuallyOff.id).toBe('terminal-phosphor');
    expect(manuallyOff.effects).toBeUndefined();
    expect(manuallyOff.typography).toBeUndefined();

    const switchedAfterTweak = applyThemePreset(tweakedVibe, 'warm-paper');
    expect(switchedAfterTweak.id).toBe('warm-paper');
    expect(switchedAfterTweak.typography).toBeUndefined();
  });

  it('blocks CSS escape bypasses, image-set/src/image functions, comment breakout, and EOF payloads', () => {
    const hostile = [
      '@\\69 mport "https://evil.example/hex.css";',
      '@\\6e amespace x "https://evil.example/ns";',
      '/* url(https://ignored-comment.example/x) */',
      '.a { background: \\75 rl("https://evil.example/a"); }',
      '.b { background: \\u\\r\\l("https://evil.example/b"); }',
      '.c { background: image-set("https://evil.example/c.png" 1x); }',
      '.d { background: -webkit-image-set("https://evil.example/d.png" 1x); }',
      '.e { background: image("https://evil.example/e.png"); content: "safe url(text)"; }',
      '.f { color: red; background: url(https://evil.example/unclosed',
    ].join('\n');

    const sanitized = sanitizeCustomCss(hostile);
    expect(sanitized.strippedCount).toBe(8);
    expect(sanitized.css).not.toContain('evil.example');
    expect(sanitized.css).toContain('/* url(https://ignored-comment.example/x) */');
    expect(sanitized.css).toContain('content: "safe url(text)";');
    expect(sanitized.css).toContain('color: red;');

    const eofImport = sanitizeCustomCss('@import "https://evil.example/eof"');
    expect(eofImport.strippedCount).toBe(1);
    expect(eofImport.css).toBe('');
  });

  it('validates sanitizeFontStack, meta.homepage https-only, chrome stops, and mid-luminance accents', () => {
    expect(sanitizeFontStack('"IBM Plex Sans", sans-serif')).toBe('"IBM Plex Sans", sans-serif');
    expect(sanitizeFontStack('"Inter')).toBeUndefined();
    expect(sanitizeFontStack('Inter\nbody { color: red; }')).toBeUndefined();
    expect(sanitizeFontStack('Arial; } body { background: red }')).toBeUndefined();

    const parsed = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Emerald Safe', homepage: 'javascript:alert(1)' },
      palette: {
        colorScheme: 'dark',
        background: '#0b0f17',
        surface: '#131926',
        text: '#f8fafc',
        accent: '#22c55e',
      },
      typography: { customStack: '"Unclosed' },
      chrome: {
        ribbon: {
          enabled: true,
          stops: ['#22c55e', 'red; } body { display:none }', 'transparent'],
        },
      },
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.document?.meta.homepage).toBeUndefined();
    expect(parsed.document?.palette?.accentText).toBe('#111111');
    expect(parsed.document?.chrome?.ribbon?.stops).toEqual(['#22c55e', 'transparent']);
    expect(parsed.warnings).toEqual([
      'Ignored typography.customStack containing unsupported characters.',
    ]);

    const httpsDoc = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'HTTPS', homepage: 'https://example.com/theme' },
      palette: null,
    });
    expect(httpsDoc.document?.meta.homepage).toBe('https://example.com/theme');
  });

  it('resolves palette: null documents with orthogonal overrides and honors includeCustomCss', () => {
    const parsed = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Font & CSS Only' },
      palette: null,
      typography: { customStack: '"IBM Plex Sans", sans-serif' },
      customCss: '.feed { letter-spacing: 0.01em; }',
    });
    expect(parsed.ok).toBe(true);

    const withCss = applyThemeDocument(parsed.document!, {
      includeCustomCss: true,
    });
    const resolvedWithCss = resolveTheme(withCss);
    expect(resolvedWithCss?.palette).toBeNull();
    expect(resolvedWithCss?.fontFamily).toBe('"IBM Plex Sans", sans-serif');
    expect(resolvedWithCss?.customCss).toBe('.feed { letter-spacing: 0.01em; }');

    // Dropping customCss on a customCss-only palette:null doc resolves to null.
    const cssOnly = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'CSS Only' },
      palette: null,
      customCss: '.x { color: green; }',
    }).document!;
    const stripped = applyThemeDocument(cssOnly, {
      includeCustomCss: false,
    });
    expect(resolveTheme(stripped)).toBeNull();
  });

  it('clears imported font/customCss on applyThemePreset and refreshes swatches/customStack on edit', () => {
    const importedDoc = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: {
        name: 'Custom Stack Theme',
        swatches: ['#000000', '#111111', '#ffffff', '#3b82f6'],
      },
      palette: {
        colorScheme: 'dark',
        background: '#000000',
        surface: '#111111',
        text: '#ffffff',
        accent: '#3b82f6',
      },
      typography: { preset: 'mono', customStack: '"IBM Plex Mono", monospace' },
      customCss: '.imported { opacity: 0.9; }',
    }).document!;

    const applied = applyThemeDocument(importedDoc, {
      includeCustomCss: true,
    });
    expect(isCustomImportedDocument(applied)).toBe(true);

    // Switching to a built-in preset clears imported identity, font, and imported customCss.
    const switched = applyThemePreset(applied, 'warm-paper');
    expect(isCustomImportedDocument(switched)).toBe(false);
    expect(switched.id).toBe('warm-paper');
    expect(switched.typography).toBeUndefined();
    expect(switched.customCss).toBeUndefined();

    // Editing accent and font on top of an imported theme updates swatches & drops stale customStack.
    const edited = updateThemeTypography(
      updateThemePalette(applied, { accent: '#ff0066' }),
      'serif',
    );
    expect(edited.meta.swatches).toContain('#ff0066');
    expect(edited.typography).toEqual({ preset: 'serif' });
  });

  it('routes comments, strings, ! important whitespace, statement at-rules, and unclosed blocks safely in formatUserCustomCss', () => {
    const resolved = resolveTheme(
      updateThemeCustomCss(
        applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight'),
        [
          '@layer external;',
          '/* avoid !important here */ .commented { color: green; }',
          '.quoted::after { content: "!important"; color: yellow; }',
          '.spaced { color: #ff00ff ! important; }',
          '.unclosed { color: red !important;',
        ].join('\n'),
      ),
    )!;

    const css = compileHostThemeCss(resolved, { rootSelectors: [':root'] });
    const layerStart = css.indexOf('@layer fs-user {');
    expect(layerStart).toBeGreaterThan(-1);
    const beforeUserLayer = css.slice(0, layerStart);
    const userLayer = css.slice(layerStart);

    // Commented/quoted rules and statement at-rule stay unlayered (NOT inside @layer fs-user).
    expect(beforeUserLayer).toContain('@layer external;');
    expect(beforeUserLayer).toContain('.commented { color: green; }');
    expect(beforeUserLayer).toContain('.quoted::after { content: "!important"; color: yellow; }');
    // Real `! important` and unclosed `!important` enter `@layer fs-user` with balanced braces.
    expect(userLayer).toContain('.spaced { color: #ff00ff ! important; }');
    expect(userLayer).toContain('.unclosed { color: red !important;}');
  });
});
