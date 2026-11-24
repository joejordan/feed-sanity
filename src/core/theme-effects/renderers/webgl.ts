// Minimal zero-dependency WebGL 1 full-screen shader runner for backdrops.
// Returns `null` (so the scene host falls back to Canvas 2D) whenever WebGL is
// missing, software-rendered, fails to compile, or throws.

import type { ScenePalette } from './palette';
import type { Scene, SceneFactory } from './scene-host';

/** Uniforms every shader scene receives from the runner. */
const BUILTIN_UNIFORMS = ['uResolution', 'uTime', 'uPointer'] as const;
type BuiltinUniform = (typeof BUILTIN_UNIFORMS)[number];

export type UniformMap<U extends string> = Readonly<Record<U, WebGLUniformLocation | null>>;

export interface ShaderSceneSpec<U extends string> {
  /** Fragment source; may use `uResolution`, `uTime`, and `uPointer` (x, y, presence). */
  readonly fragment: string;
  /** Scene-specific uniform names (built-ins are added automatically). */
  readonly uniforms: readonly U[];
  /**
   * Uploads palette-derived uniforms. Uniforms persist in the program, so this
   * runs only when the theme palette changes, not every frame.
   */
  readonly bindPalette: (
    gl: WebGLRenderingContext,
    uniforms: UniformMap<U>,
    palette: ScenePalette,
  ) => void;
  /** Fraction of the device pixel ratio to render at (soft shaders look identical at half). */
  readonly renderScale?: number;
  readonly maxPixels?: number;
}

const VERTEX_SOURCE = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

/** Prefer high precision so slow clocks stay smooth; fall back gracefully on mobile GPUs. */
export const GLSL_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif`;

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: 'low-power',
  // Software rasterizers burn CPU and battery; Canvas 2D is the better fallback there.
  failIfMajorPerformanceCaveat: true,
};

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  const program = vs && fs ? gl.createProgram() : null;
  if (!program || !vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders are no longer needed once linked; releasing them early keeps GPU memory lean.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function releaseContext(gl: WebGLRenderingContext): void {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

export function createShaderScene<const U extends string>(spec: ShaderSceneSpec<U>): SceneFactory {
  return (canvas, hooks) => {
    // The scene host treats a throw here like `null` and moves to the next fallback.
    const gl = canvas.getContext('webgl', CONTEXT_ATTRIBUTES);
    if (!gl) {
      return null;
    }
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    try {
      program = linkProgram(gl, spec.fragment);
      buffer = program ? gl.createBuffer() : null;
      if (!program || !buffer) {
        throw new Error('WebGL program setup failed');
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // One oversized triangle covers the viewport with no diagonal seam.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API method, not a React hook
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
    } catch {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      releaseContext(gl);
      return null;
    }

    const linked = program;
    const vertexBuffer = buffer;
    const names: ReadonlyArray<U | BuiltinUniform> = [...BUILTIN_UNIFORMS, ...spec.uniforms];
    const uniforms = Object.fromEntries(
      names.map((name) => [name, gl.getUniformLocation(linked, name)]),
    ) as UniformMap<U | BuiltinUniform>;
    let boundPalette: ScenePalette | null = null;
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
        gl.uniform2f(uniforms.uResolution, width, height);
      }
    };

    const scene: Scene = {
      kind: 'webgl',
      renderScale: spec.renderScale ?? 0.45,
      maxPixels: spec.maxPixels ?? 640_000,
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
          spec.bindPalette(gl, uniforms, frame.palette);
        }
        syncResolution(frame.view.width, frame.view.height);
        gl.uniform1f(uniforms.uTime, frame.time);
        gl.uniform3f(
          uniforms.uPointer,
          frame.pointer.nx,
          1 - frame.pointer.ny,
          frame.pointer.presence,
        );
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
        releaseContext(gl);
        lost = true;
      },
    };
    return scene;
  };
}

/** Shared GLSL helpers: Ashima/Gustavson 2D simplex noise (MIT) and a sine-free hash. */
export const GLSL_NOISE = `
vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 premultiply(vec3 color, float alpha) {
  vec3 c = clamp(color, 0.0, 1.0);
  float a = clamp(max(alpha, max(c.r, max(c.g, c.b))), 0.0, 1.0);
  return vec4(c, a);
}`;
