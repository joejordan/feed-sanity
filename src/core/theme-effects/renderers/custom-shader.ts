// Tier 3 Opt-In Custom GLSL ES 1.00 Fragment Shader Runner.
//
// Defensively re-validates every shader before compiling on WebGL 1, injects
// standardized theme/input uniforms (`STANDARD_SHADER_UNIFORMS`) plus declared
// custom `u_<paramKey>` uniforms, and guards the host tab with a slow-frame
// watchdog and automatic static CSS fallback on compile error or context loss.

import type { EffectParamValues } from '../model';
import type {
  CustomShaderParamSpec,
  CustomShaderSpec,
  StandardShaderUniformName,
} from '../scene-schema';
import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory } from './scene-host';
import type { BackdropContext, BackdropInstance } from './types';
import { createLogger } from '../../log';
import { resolveEffectParams, sameEffectParams } from '../model';
import {
  MAX_SHADER_CLICKS,
  STANDARD_SHADER_UNIFORMS,
  validateCustomShaderSource,
} from '../scene-schema';
import { hexRgb, rgbCss, rgbUnit } from './palette';
import { mountScene } from './scene-host';
import {
  GLSL_NOISE,
  GLSL_PRECISION,
  GLSL_SHADER_HELPERS,
  linkFullscreenProgram,
  releaseWebglContext,
  setupFullscreenTriangle,
  WEBGL_CONTEXT_ATTRIBUTES,
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

function createCustomShaderFactory(spec: CustomShaderSpec): SceneFactory {
  return (canvas, hooks) => {
    const fragmentSource = buildCustomFragmentSource(spec);
    if (!fragmentSource) {
      return null;
    }
    const gl = canvas.getContext('webgl', WEBGL_CONTEXT_ATTRIBUTES);
    if (!gl) {
      return null;
    }

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    try {
      program = linkFullscreenProgram(gl, fragmentSource, (stage, info) => {
        log.error(`custom shader ${stage} failed: ${info.slice(0, 240)}`);
      });
      buffer = program ? setupFullscreenTriangle(gl, program) : null;
      if (!program || !buffer) {
        throw new Error('Custom WebGL program setup failed');
      }
    } catch {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      releaseWebglContext(gl);
      return null;
    }

    const linked = program;
    const vertexBuffer = buffer;
    const std = Object.fromEntries(
      STANDARD_SHADER_UNIFORMS.map(([name, type]) => [
        name,
        gl.getUniformLocation(linked, type.includes('[') ? `u_${name}[0]` : `u_${name}`),
      ]),
    ) as Readonly<Record<StandardShaderUniformName, WebGLUniformLocation | null>>;
    const clicksBuf = new Float32Array(MAX_SHADER_CLICKS * 4);
    let clicksUploaded = false;
    let clicksSettled = false;
    let lastClickCount = -1;
    let lastDayPhaseAt = 0;

    const syncDayPhase = (): void => {
      if (!std.dayPhase) {
        return;
      }
      const nowMs = Date.now();
      if (lastDayPhaseAt !== 0 && nowMs - lastDayPhaseAt <= 30_000) {
        return;
      }
      lastDayPhaseAt = nowMs;
      const d = new Date(nowMs);
      const dayPhase = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86_400;
      gl.uniform1f(std.dayPhase, dayPhase);
    };

    const uploadRgb = (loc: WebGLUniformLocation | null, rgb: Rgb): void => {
      if (!loc) {
        return;
      }
      const [r, g, b] = rgbUnit(rgb);
      gl.uniform3f(loc, r, g, b);
    };

    const paramSpecs: readonly CustomShaderParamSpec[] = spec.params ?? [];
    const paramLocations = new Map<string, WebGLUniformLocation | null>(
      paramSpecs.map((param) => [param.key, gl.getUniformLocation(linked, `u_${param.key}`)]),
    );

    let boundPalette: ScenePalette | null = null;
    let boundParams: EffectParamValues | undefined | null = null;
    let boundWidth = 0;
    let boundHeight = 0;
    let lost = false;

    const onContextLost = (): void => {
      lost = true;
      hooks.fallback();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const syncResolution = (width: number, height: number): void => {
      if (width !== boundWidth || height !== boundHeight) {
        boundWidth = width;
        boundHeight = height;
        gl.uniform2f(std.resolution, width, height);
      }
    };

    const uploadPalette = (palette: ScenePalette): void => {
      uploadRgb(std.bg, palette.background);
      uploadRgb(std.surface, palette.surface);
      uploadRgb(std.text, palette.text);
      uploadRgb(std.border, palette.border);
      uploadRgb(std.accent, palette.accent);
      uploadRgb(std.accent2, palette.alt);
      uploadRgb(std.danger, palette.danger);
      gl.uniform1f(std.isDark, palette.scheme === 'dark' ? 1 : 0);
    };

    const uploadParams = (raw: EffectParamValues | undefined): void => {
      if (paramSpecs.length === 0) {
        return;
      }
      const resolved = resolveEffectParams(paramSpecs, raw);
      for (const param of paramSpecs) {
        const loc = paramLocations.get(param.key) ?? null;
        if (!loc) {
          continue;
        }
        const value = resolved[param.key];
        if (param.kind === 'color' && typeof value === 'string') {
          uploadRgb(loc, hexRgb(value));
        } else if (param.kind === 'boolean') {
          gl.uniform1f(loc, value === true ? 1 : 0);
        } else if (param.kind === 'enum' && typeof value === 'string') {
          const idx = param.options.indexOf(value);
          gl.uniform1f(loc, Math.max(idx, 0));
        } else if (typeof value === 'number') {
          gl.uniform1f(loc, value);
        }
      }
    };

    const scene: Scene = {
      kind: 'webgl',
      renderScale: spec.renderScale ?? 0.5,
      maxPixels: 640_000,
      resize(view) {
        if (!lost) {
          gl.viewport(0, 0, view.width, view.height);
          syncResolution(view.width, view.height);
        }
      },
      render(frame) {
        if (lost || gl.isContextLost()) {
          return;
        }
        if (frame.palette !== boundPalette) {
          boundPalette = frame.palette;
          uploadPalette(frame.palette);
        }
        if (
          boundParams === null ||
          !sameEffectParams(boundParams, frame.ctx.effects.backdropParams)
        ) {
          boundParams = frame.ctx.effects.backdropParams;
          uploadParams(boundParams);
        }
        syncResolution(frame.view.width, frame.view.height);
        gl.uniform1f(std.time, frame.time);
        gl.uniform1f(std.delta, frame.dt);
        gl.uniform1f(std.frame, frame.frameIndex);
        gl.uniform4f(
          std.pointer,
          frame.pointer.nx,
          1 - frame.pointer.ny,
          frame.pointer.presence,
          frame.ctx.effects.interactive ? 1 : 0,
        );
        gl.uniform4f(
          std.click,
          frame.click.x,
          1 - frame.click.y,
          frame.click.age,
          frame.click.count,
        );
        if (std.clicks) {
          const clickChanged = frame.click.count !== lastClickCount;
          const isIdle = frame.click.count === 0 || frame.click.age >= 999;
          if (!clicksUploaded || clickChanged || !clicksSettled) {
            for (let i = 0; i < MAX_SHADER_CLICKS; i++) {
              const slot = frame.clicks[i];
              const offset = i * 4;
              clicksBuf[offset] = slot ? slot.x : 0.5;
              clicksBuf[offset + 1] = slot ? 1 - slot.y : 0.5;
              clicksBuf[offset + 2] = slot ? slot.age : 999;
              clicksBuf[offset + 3] = slot ? slot.active : 0;
            }
            gl.uniform4fv(std.clicks, clicksBuf);
            clicksUploaded = true;
            lastClickCount = frame.click.count;
            clicksSettled = isIdle;
          }
        }
        gl.uniform2f(std.scroll, frame.scroll.y, frame.scroll.velocity);
        syncDayPhase();
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose() {
        canvas.removeEventListener('webglcontextlost', onContextLost);
        if (!lost && !gl.isContextLost()) {
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API method, not a React hook
          gl.useProgram(null);
          gl.deleteBuffer(vertexBuffer);
          gl.deleteProgram(linked);
        }
        releaseWebglContext(gl);
        lost = true;
      },
    };
    return scene;
  };
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
    watchdog: { slowFrameMs: 42, consecutiveLimit: 12 },
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
