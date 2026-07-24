import { QUAD_VERT, createGL, createProgram } from './webgl';
import { ALL_SHADERS } from '../effects/shaders';

/**
 * Compiles every effect shader against a real WebGL context and reports the
 * result to the console. Runs when the URL contains `?selftest`. This lets us
 * validate the GLSL (the riskiest part) in any browser via playwright, without
 * needing the HTML-in-Canvas API — which only exists in Chrome Canary.
 */
export function runShaderSelfTest(): void {
  const canvas = document.createElement('canvas');
  let gl: WebGLRenderingContext;
  try {
    gl = createGL(canvas);
  } catch (e) {
    console.error('[selftest] no WebGL context:', e);
    return;
  }

  let failures = 0;
  for (const { name, frag } of ALL_SHADERS) {
    try {
      const program = createProgram(gl, frag, QUAD_VERT);
      gl.deleteProgram(program);
      console.log(`[selftest] PASS ${name}`);
    } catch (e) {
      failures++;
      console.error(`[selftest] FAIL ${name}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    failures === 0
      ? `[selftest] ALL SHADERS COMPILED (${ALL_SHADERS.length}/${ALL_SHADERS.length})`
      : `[selftest] ${failures} SHADER(S) FAILED`,
  );
}
