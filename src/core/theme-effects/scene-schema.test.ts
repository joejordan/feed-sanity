import { describe, expect, it } from 'vitest';
import {
  analyzeThemeDocument,
  applyThemeDocument,
  parseThemeDocument,
  THEME_FILE_FORMAT,
} from '../theming';
import {
  MAX_CUSTOM_SHADER_BYTES,
  MAX_SCENE_LAYERS,
  parseCustomScene,
  parseCustomShader,
  validateCustomShaderSource,
} from './scene-schema';

const VALID_MAIN_IMAGE_SHADER = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / u_resolution;
  float wave = 0.5 + 0.5 * sin(uv.x * 6.0 + u_time * u_warp);
  vec3 col = mix(u_bg, u_accent, wave * 0.4);
  fragColor = premultiply(col, 0.85);
}
`;

describe('Tier 2 Declarative Scene Layers & Tier 3 Opt-In GLSL Shaders schema', () => {
  it('validates and clamps all 6 composable Tier 2 scene layer kinds and keeps trust data-only', () => {
    const warnings: string[] = [];
    const scene = parseCustomScene(
      {
        fps: 99,
        layers: [
          {
            kind: 'gradient',
            style: 'linear',
            colors: ['background', '#1e293b', 'accent'],
            angle: 145,
            drift: 0.4,
            opacity: 0.95,
          },
          {
            kind: 'rays',
            count: 20,
            originX: 0.5,
            originY: -0.1,
            spread: 0.35,
            rotationSpeed: 0.3,
            color: 'accent',
            secondaryColor: 'alt',
            blendMode: 'screen',
          },
          {
            kind: 'silhouette',
            style: 'mountains',
            x: 0.4,
            y: 0.78,
            scale: 1.1,
            color: 'surface',
            parallax: 0.4,
          },
          {
            kind: 'waves',
            count: 3,
            amplitude: 0.08,
            frequency: 2,
            thickness: 10,
            y: 0.65,
            color: 'accent',
            blendMode: 'lighter',
          },
          {
            kind: 'grid',
            horizon: 0.6,
            spacing: 40,
            glow: 0.6,
            color: '#22d3ee',
            secondaryColor: '#f472b6',
          },
          {
            kind: 'particles',
            shape: 'petal',
            count: 999,
            sizeMin: 4,
            sizeMax: 12,
            speed: 0.8,
            angle: 110,
            spread: 30,
            swirl: 1.2,
            twinkle: true,
            clickBurst: true,
            color: '#fbcfe8',
            secondaryColor: '#f9a8d4',
            parallax: 0.6,
          },
          // 7th layer exceeds MAX_SCENE_LAYERS and should be truncated with a warning
          { kind: 'waves', color: 'accent' },
        ],
      },
      warnings,
    );

    expect(scene).toBeDefined();
    expect(scene?.fps).toBe(30);
    expect(scene?.layers).toHaveLength(MAX_SCENE_LAYERS);
    expect(scene?.layers[1]?.kind === 'rays' && scene.layers[1].count).toBe(12);
    expect(scene?.layers[5]?.kind === 'particles' && scene.layers[5].count).toBe(160);
    expect(warnings.some((w) => w.includes('maximum 6 layers'))).toBe(true);

    // Full ThemeDocumentV1 with Tier 2 Custom Scene stays Verified data-only.
    const parsed = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Sakura Twilight' },
      palette: {
        colorScheme: 'dark',
        background: '#120d1d',
        surface: '#1d1530',
        text: '#f5ecff',
        accent: '#f472b6',
      },
      effects: {
        backdrop: {
          id: 'custom-scene',
          intensity: 0.85,
          scene,
        },
        surface: { finish: 'glass', glassStrength: 0.28 },
      },
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.hadCustomShader).toBe(false);
    expect(parsed.capabilities?.trust).toBe('data-only');
    expect(parsed.capabilities?.hasCustomScene).toBe(true);
    expect(parsed.capabilities?.sceneLayerCount).toBe(6);
    expect(parsed.capabilities?.hasCustomShader).toBe(false);
  });

  it('rejects empty/invalid custom-scene payloads cleanly', () => {
    const parsed = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Broken Scene' },
      palette: null,
      effects: {
        backdrop: {
          id: 'custom-scene',
          scene: { layers: [{ kind: 'gradient', colors: ['#111111'] }] },
        },
      },
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.join(' ')).toMatch(/at least one valid scene layer/i);
  });

  it('validates Tier 3 GLSL shader safety rules and rejects unsafe constructs', () => {
    const goodMainImage = validateCustomShaderSource(VALID_MAIN_IMAGE_SHADER);
    expect(goodMainImage.ok).toBe(true);
    expect(goodMainImage.entrypoint).toBe('mainImage');

    const goodMain = validateCustomShaderSource(
      'void main() { gl_FragColor = vec4(u_accent, 1.0); }',
    );
    expect(goodMain.ok).toBe(true);
    expect(goodMain.entrypoint).toBe('main');

    // Comments mentioning blocked words must NOT trigger false positives.
    const commentSafe = validateCustomShaderSource(
      '// do not use while(true) or #extension here\nvoid main() { gl_FragColor = vec4(1.0); }',
    );
    expect(commentSafe.ok).toBe(true);

    // Bounded literal integer for-loops and coexisting mainImage helper + main() pass cleanly.
    const validLoop = validateCustomShaderSource(
      'void mainImage(out vec4 c, in vec2 p) { float acc = 0.0; for (int i = 0; i < 16; i++) { acc += 0.05; } c = vec4(acc); }\nvoid main() { vec4 outC; mainImage(outC, gl_FragCoord.xy); gl_FragColor = outC; }',
    );
    expect(validLoop.ok).toBe(true);
    expect(validLoop.entrypoint).toBe('main');

    // Unsafe directives (#version, #extension, #define) & unbounded/non-literal loops must be rejected.
    expect(
      validateCustomShaderSource('#version 300 es\nvoid main() { gl_FragColor = vec4(1.0); }').ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource(
        '#extension GL_OES_standard_derivatives : enable\nvoid main() { gl_FragColor = vec4(1.0); }',
      ).ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource('#define LOOP for\nvoid main() { gl_FragColor = vec4(1.0); }').ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource('void main() { while (true) {} gl_FragColor = vec4(1.0); }').ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource('void main() { do {} while (false); gl_FragColor = vec4(1.0); }')
        .ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource('void main() { gl_FragDepth = 0.5; gl_FragColor = vec4(1.0); }')
        .ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource(
        'void main() { for (int i = 0; i < 9999; i++) {} gl_FragColor = vec4(1.0); }',
      ).ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource(
        'void main() { for (int i = 9999; i > 0; i--) {} gl_FragColor = vec4(1.0); }',
      ).ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource(
        'void main() { for (int i = 0; i != 10; i++) {} gl_FragColor = vec4(1.0); }',
      ).ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource('void main() { for (;;) { break; } gl_FragColor = vec4(1.0); }')
        .ok,
    ).toBe(false);
    expect(
      validateCustomShaderSource(
        'void main() { for (float x = 0.0; x < 10.0; x += 0.001) {} gl_FragColor = vec4(1.0); }',
      ).ok,
    ).toBe(false);
    expect(validateCustomShaderSource('float helper() { return 1.0; }').ok).toBe(false);
    expect(
      validateCustomShaderSource(
        `void main() { /* ${'x'.repeat(MAX_CUSTOM_SHADER_BYTES + 64)} */ gl_FragColor = vec4(1.0); }`,
      ).ok,
    ).toBe(false);
  });

  it('clamps extreme shader param bounds safely and preserves 4-decimal precision for fine steps', () => {
    const warnings: string[] = [];
    const parsed = parseCustomShader(
      {
        fragment: VALID_MAIN_IMAGE_SHADER,
        params: [
          {
            key: 'huge',
            kind: 'number',
            label: 'Huge',
            min: -1e308,
            max: 1e308,
            defaultValue: 1e307,
          },
          {
            key: 'fine',
            kind: 'number',
            label: 'Fine',
            min: 0.001,
            max: 0.02,
            step: 0.001,
            defaultValue: 0.005,
          },
          {
            key: 'tinyRange',
            kind: 'number',
            label: 'Too narrow',
            min: 0,
            max: 0.0001,
            defaultValue: 0,
          },
        ],
      },
      warnings,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.shader?.params).toHaveLength(2);
    const huge = parsed.shader?.params?.[0];
    expect(huge?.kind === 'number' && Number.isFinite(huge.step)).toBe(true);
    expect(huge?.kind === 'number' && Number.isFinite(huge.defaultValue)).toBe(true);

    const doc = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Fine Uniforms' },
      palette: null,
      effects: {
        backdrop: {
          id: 'custom-shader',
          shader: parsed.shader,
          params: { fine: 0.004 },
        },
      },
    });
    expect(doc.ok).toBe(true);
    expect(doc.document?.effects?.backdrop?.params?.fine).toBe(0.004);
  });

  it('parses Tier 3 shader params, flags trust tiers, and strips shader on opt-out import', () => {
    const warnings: string[] = [];
    const shaderResult = parseCustomShader(
      {
        fragment: VALID_MAIN_IMAGE_SHADER,
        renderScale: 0.6,
        fps: 24,
        fallbackColors: ['#0b0f17', '#3b82f6'],
        params: [
          { key: 'warp', kind: 'number', label: 'Warp Speed', min: 0.2, max: 3, defaultValue: 1 },
          { key: 'glowTint', kind: 'color', label: 'Glow Tint', defaultValue: '#22d3ee' },
          { key: 'pulse', kind: 'boolean', label: 'Pulse', defaultValue: true },
          // Reserved uniform name must be skipped cleanly
          { key: 'time', kind: 'number', label: 'Shadowed', min: 0, max: 1, defaultValue: 0.5 },
        ],
      },
      warnings,
    );

    expect(shaderResult.errors).toEqual([]);
    expect(shaderResult.shader?.params).toHaveLength(3);
    expect(warnings.some((w) => w.includes('time'))).toBe(true);

    const parsed = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      meta: { name: 'Liquid Plasma' },
      palette: {
        colorScheme: 'dark',
        background: '#080c16',
        surface: '#111829',
        text: '#e6edf7',
        accent: '#38bdf8',
      },
      effects: {
        backdrop: {
          id: 'custom-shader',
          intensity: 0.8,
          shader: shaderResult.shader,
          params: { warp: 1.5, glowTint: '#a855f7', pulse: false },
        },
        surface: { finish: 'glass', glassStrength: 0.25 },
      },
      customCss: '.card { border-radius: 14px; }',
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.hadCustomShader).toBe(true);
    expect(parsed.hadCustomCss).toBe(true);
    expect(parsed.capabilities?.trust).toBe('custom-css-and-shader');
    expect(parsed.capabilities?.hasCustomShader).toBe(true);

    // Stripping shader (unchecked opt-in) preserves palette & glass surface finish while removing GPU code.
    const withoutShader = applyThemeDocument(parsed.document!, {
      includeCustomCss: false,
      includeCustomShader: false,
    });
    expect(withoutShader.customCss).toBeUndefined();
    expect(withoutShader.effects?.backdrop).toBeUndefined();
    expect(withoutShader.effects?.surface?.finish).toBe('glass');
    expect(analyzeThemeDocument(withoutShader).trust).toBe('data-only');
  });
});
