// Tier 3 Opt-In Custom GLSL ES 1.00 Fragment Shader Runner.
//
// Defensively re-validates every shader before compiling on WebGL 1, injects
// standardized theme/input uniforms (`STANDARD_SHADER_UNIFORMS`) plus declared
// custom `u_<paramKey>` uniforms, and guards the host tab with a slow-frame
// watchdog and automatic static CSS fallback on compile error or context loss.

import type { EffectParamValue } from '../model';
import type {
  CustomShaderParamSpec,
  CustomShaderSpec,
  StandardShaderUniformName,
} from '../scene-schema';
import type { Rgb, ScenePalette } from './palette';
import type { SceneFactory } from './scene-host';
import type { BackdropContext, BackdropInstance } from './types';
import { createLogger } from '../../log';
import { dayPhaseAt, moonPhaseAt } from '../celestial';
import { resolveEffectParams } from '../model';
import {
  MAX_SHADER_CLICKS,
  STANDARD_SHADER_UNIFORMS,
  validateCustomShaderSource,
} from '../scene-schema';
import { hexRgb, rgbCss, rgbUnit } from './palette';
import { mountScene } from './scene-host';
import {
  createFullscreenWebglScene,
  GLSL_NOISE,
  GLSL_PRECISION,
  GLSL_SHADER_HELPERS,
} from './webgl';

const log = createLogger('custom-shader');

function formatUniformDecl(name: string, type: string): string {
  const arrayStart = type.indexOf('[');
  if (arrayStart !== -1) {
    return `uniform ${type.slice(0, arrayStart)} u_${name}${type.slice(arrayStart)};`;
  }
  return `uniform ${type} u_${name};`;
}

/**
 * Wraps a validated `CustomShaderSpec` into a complete WebGL 1 GLSL ES 1.00
 * fragment source with standard uniforms, noise & math helpers, custom
 * `u_<key>` param uniforms, and a Shadertoy `mainImage(...)` adapter when used.
 */
export function buildCustomFragmentSource(spec: CustomShaderSpec): string | null {
  const checked = validateCustomShaderSource(spec.fragment);
  if (!checked.ok || !checked.entrypoint) {
    return null;
  }
  const stdDecls = STANDARD_SHADER_UNIFORMS.map(([name, type]) => formatUniformDecl(name, type));
  const paramDecls = (spec.params ?? []).map((param) =>
    param.kind === 'color' ? `uniform vec3 u_${param.key};` : `uniform float u_${param.key};`,
  );
  const preamble = [
    GLSL_PRECISION,
    ...stdDecls,
    ...paramDecls,
    GLSL_NOISE,
    GLSL_SHADER_HELPERS,
  ].join('\n');
  const epilogue =
    checked.entrypoint === 'mainImage'
      ? '\nvoid main() {\n  vec4 fragColor = vec4(0.0);\n  mainImage(fragColor, gl_FragCoord.xy);\n  gl_FragColor = fragColor;\n}\n'
      : '';

  return `${preamble}\n${checked.source}${epilogue}`;
}

/**
 * Encodes one resolved param value as the float components uploaded to its
 * `u_<key>` uniform: an enum as its option index, a boolean as `0` or `1`, a
 * color as unit RGB. Returns `null` when the value does not fit the param kind.
 */
export function encodeShaderParam(
  param: CustomShaderParamSpec,
  value: EffectParamValue | undefined,
): readonly [number] | readonly [number, number, number] | null {
  switch (param.kind) {
    case 'color':
      return typeof value === 'string' ? rgbUnit(hexRgb(value)) : null;
    case 'boolean':
      return [value === true ? 1 : 0];
    case 'enum':
      return typeof value === 'string' ? [Math.max(param.options.indexOf(value), 0)] : null;
    case 'number':
      return typeof value === 'number' ? [value] : null;
  }
}

function uploadRgb(gl: WebGLRenderingContext, loc: WebGLUniformLocation | null, rgb: Rgb): void {
  if (!loc) {
    return;
  }
  const [r, g, b] = rgbUnit(rgb);
  gl.uniform3f(loc, r, g, b);
}

function createCustomShaderFactory(spec: CustomShaderSpec): SceneFactory {
  const fragmentSource = buildCustomFragmentSource(spec);
  if (!fragmentSource) {
    return () => null;
  }
  const paramSpecs: readonly CustomShaderParamSpec[] = spec.params ?? [];
  return createFullscreenWebglScene({
    fragment: fragmentSource,
    renderScale: spec.renderScale ?? 0.5,
    maxPixels: 480_000,
    onError(stage, info) {
      log.error(`custom shader ${stage} failed: ${info.slice(0, 240)}`);
    },
    init(gl, program) {
      const std = Object.fromEntries(
        STANDARD_SHADER_UNIFORMS.map(([name, type]) => [
          name,
          gl.getUniformLocation(program, type.includes('[') ? `u_${name}[0]` : `u_${name}`),
        ]),
      ) as Readonly<Record<StandardShaderUniformName, WebGLUniformLocation | null>>;
      const paramLocations = new Map<string, WebGLUniformLocation | null>(
        paramSpecs.map((param) => [param.key, gl.getUniformLocation(program, `u_${param.key}`)]),
      );
      return {
        std,
        paramLocations,
        clicksBuf: new Float32Array(MAX_SHADER_CLICKS * 4),
        clicksSettled: false,
        lastClickCount: -1,
        lastSkyClockAt: 0,
      };
    },
    onResize(gl, { std }, width, height) {
      gl.uniform2f(std.resolution, width, height);
    },
    onPalette(gl, { std }, palette) {
      uploadRgb(gl, std.bg, palette.background);
      uploadRgb(gl, std.surface, palette.surface);
      uploadRgb(gl, std.text, palette.text);
      uploadRgb(gl, std.border, palette.border);
      uploadRgb(gl, std.accent, palette.accent);
      uploadRgb(gl, std.accent2, palette.alt);
      uploadRgb(gl, std.danger, palette.danger);
      gl.uniform1f(std.isDark, palette.scheme === 'dark' ? 1 : 0);
    },
    onParams(gl, { paramLocations }, raw) {
      if (paramSpecs.length === 0) {
        return;
      }
      const resolved = resolveEffectParams(paramSpecs, raw);
      for (const param of paramSpecs) {
        const loc = paramLocations.get(param.key) ?? null;
        const encoded = loc ? encodeShaderParam(param, resolved[param.key]) : null;
        if (!loc || !encoded) {
          continue;
        }
        if (encoded.length === 3) {
          gl.uniform3f(loc, encoded[0], encoded[1], encoded[2]);
        } else {
          gl.uniform1f(loc, encoded[0]);
        }
      }
    },
    onRender(gl, state, frame) {
      const { std } = state;
      if (std.time) {
        gl.uniform1f(std.time, frame.time);
      }
      if (std.delta) {
        gl.uniform1f(std.delta, frame.dt);
      }
      if (std.frame) {
        gl.uniform1f(std.frame, frame.frameIndex);
      }
      if (std.pointer) {
        gl.uniform4f(
          std.pointer,
          frame.pointer.nx,
          1 - frame.pointer.ny,
          frame.pointer.presence,
          frame.ctx.effects.interactive ? 1 : 0,
        );
      }
      if (std.pointerVel) {
        gl.uniform2f(
          std.pointerVel,
          frame.ctx.effects.interactive ? frame.pointer.vx : 0,
          frame.ctx.effects.interactive ? -frame.pointer.vy : 0,
        );
      }
      if (std.click) {
        gl.uniform4f(
          std.click,
          frame.click.x,
          1 - frame.click.y,
          frame.click.age,
          frame.click.count,
        );
      }
      if (std.clicks && (frame.click.count !== state.lastClickCount || !state.clicksSettled)) {
        let allSettled = true;
        for (let i = 0; i < MAX_SHADER_CLICKS; i++) {
          const slot = frame.clicks[i];
          const offset = i * 4;
          state.clicksBuf[offset] = slot ? slot.x : 0.5;
          state.clicksBuf[offset + 1] = slot ? 1 - slot.y : 0.5;
          state.clicksBuf[offset + 2] = slot ? slot.age : 999;
          state.clicksBuf[offset + 3] = slot ? slot.active : 0;
          if (frame.click.count !== 0 && slot && slot.active !== 0 && slot.age < 30) {
            allSettled = false;
          }
        }
        gl.uniform4fv(std.clicks, state.clicksBuf);
        state.lastClickCount = frame.click.count;
        state.clicksSettled = allSettled;
      }
      if (std.scroll) {
        gl.uniform2f(std.scroll, frame.scroll.y, frame.scroll.velocity);
      }
      // Refresh slow local-clock uniforms (`u_dayPhase`, `u_moonPhase`) every 30 seconds.
      if (std.dayPhase || std.moonPhase) {
        const nowMs = Date.now();
        if (state.lastSkyClockAt === 0 || nowMs - state.lastSkyClockAt > 30_000) {
          state.lastSkyClockAt = nowMs;
          if (std.dayPhase) {
            gl.uniform1f(std.dayPhase, dayPhaseAt(new Date(nowMs)));
          }
          if (std.moonPhase) {
            gl.uniform1f(std.moonPhase, moonPhaseAt(nowMs));
          }
        }
      }
    },
  });
}

function buildShaderCssFallback(spec: CustomShaderSpec | undefined, palette: ScenePalette): string {
  if (spec?.fallbackColors) {
    return `linear-gradient(135deg, ${spec.fallbackColors[0]} 0%, ${spec.fallbackColors[1]} 100%)`;
  }
  return `radial-gradient(ellipse 80% 65% at 50% 35%, ${rgbCss(palette.accent, 0.3)} 0%, ${rgbCss(palette.background, 0.94)} 100%)`;
}

function mountInnerShader(
  ctx: BackdropContext,
  spec: CustomShaderSpec | undefined,
): BackdropInstance {
  return mountScene(ctx, {
    factories: spec ? [createCustomShaderFactory(spec)] : [],
    cssFallback: (palette) => buildShaderCssFallback(spec, palette),
    fps: spec?.fps ?? 24,
    startTime: 2,
    trackScroll: true,
    acceptsBursts: true,
    watchdog: { slowFrameMs: 28, consecutiveLimit: 12 },
  });
}

function sameShaderSpec(a: CustomShaderSpec | undefined, b: CustomShaderSpec | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.fragment !== b.fragment || a.renderScale !== b.renderScale || a.fps !== b.fps) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Mounts a Tier 3 opt-in WebGL 1 custom fragment shader backdrop with watchdog fallback. */
export function mountCustomShaderBackdrop(initial: BackdropContext): BackdropInstance {
  let activeSpec = initial.effects.customShader;
  let inner = mountInnerShader(initial, activeSpec);

  return {
    update(next) {
      const nextSpec = next.effects.customShader;
      if (!sameShaderSpec(activeSpec, nextSpec)) {
        inner.destroy();
        activeSpec = nextSpec;
        inner = mountInnerShader(next, activeSpec);
        return;
      }
      inner.update(next);
    },
    burst(normX, normY) {
      inner.burst?.(normX, normY);
    },
    destroy() {
      inner.destroy();
    },
  };
}
