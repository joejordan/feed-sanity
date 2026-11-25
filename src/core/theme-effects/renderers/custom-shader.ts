// Tier 3 Opt-In Custom GLSL ES 1.00 Fragment Shader Runner.
//
// Defensively re-validates every shader before compiling on WebGL 1, injects
// standardized theme/input uniforms (`STANDARD_SHADER_UNIFORMS`) plus declared
// custom `u_<paramKey>` uniforms, and guards the host tab with a slow-frame
// watchdog and automatic static CSS fallback on compile error or context loss.

import type { EffectParamValue, EffectParamValues } from '../model';
import type {
  CustomShaderParamSpec,
  CustomShaderSpec,
  StandardShaderUniformName,
} from '../scene-schema';
import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory } from './scene-host';
import type { BackdropContext, BackdropInstance } from './types';
import { createLogger } from '../../log';
import { dayPhaseAt, moonPhaseAt } from '../celestial';
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
    let clicksSettled = false;
    let lastClickCount = -1;
    let lastSkyClockAt = 0;

    /** Refreshes the slow local-clock uniforms (`u_dayPhase`, `u_moonPhase`) every 30 seconds. */
    const syncSkyClock = (): void => {
      if (!std.dayPhase && !std.moonPhase) {
        return;
      }
      const nowMs = Date.now();
      if (lastSkyClockAt !== 0 && nowMs - lastSkyClockAt <= 30_000) {
        return;
      }
      lastSkyClockAt = nowMs;
      if (std.dayPhase) {
        gl.uniform1f(std.dayPhase, dayPhaseAt(new Date(nowMs)));
      }
      if (std.moonPhase) {
        gl.uniform1f(std.moonPhase, moonPhaseAt(nowMs));
      }
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

    const onContextLost = (event: Event): void => {
      event.preventDefault();
      lost = true;
      hooks.fallback({ recoverable: true });
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
    };

    const scene: Scene = {
      kind: 'webgl',
      renderScale: spec.renderScale ?? 0.5,
      maxPixels: 480_000,
      resize(view) {
        if (!lost) {
          gl.viewport(0, 0, view.width, view.height);
          syncResolution(view.width, view.height);
        }
      },
      render(frame) {
        if (lost) {
          return;
        }
        if (gl.isContextLost()) {
          lost = true;
          hooks.fallback({ recoverable: true });
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
        if (std.clicks && (frame.click.count !== lastClickCount || !clicksSettled)) {
          let allSettled = true;
          for (let i = 0; i < MAX_SHADER_CLICKS; i++) {
            const slot = frame.clicks[i];
            const offset = i * 4;
            clicksBuf[offset] = slot ? slot.x : 0.5;
            clicksBuf[offset + 1] = slot ? 1 - slot.y : 0.5;
            clicksBuf[offset + 2] = slot ? slot.age : 999;
            clicksBuf[offset + 3] = slot ? slot.active : 0;
            if (frame.click.count !== 0 && slot && slot.active !== 0 && slot.age < 30) {
              allSettled = false;
            }
          }
          gl.uniform4fv(std.clicks, clicksBuf);
          lastClickCount = frame.click.count;
          clicksSettled = allSettled;
        }
        if (std.scroll) {
          gl.uniform2f(std.scroll, frame.scroll.y, frame.scroll.velocity);
        }
        syncSkyClock();
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
