/**
 * Minimal WebGL helpers — no external library. Every effect renders the live
 * HTML as a full-screen textured quad through a custom fragment shader; these
 * helpers cover the tiny surface that requires (compile, quad, texture).
 */

/** Vertex shader shared by every effect: a fullscreen clip-space quad. */
export const QUAD_VERT = /* glsl */ `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  // a_pos is in [-1,1] clip space; derive [0,1] UV. Flip Y so texture origin
  // (top-left of the DOM) maps to the top of the canvas.
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export function createGL(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl =
    (canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true }) as
      | WebGLRenderingContext
      | null) ??
    (canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true }) as
      | WebGLRenderingContext
      | null);
  if (!gl) throw new Error('WebGL is not available in this browser.');
  return gl;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}\n---\n${source}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGLRenderingContext,
  fragmentSource: string,
  vertexSource: string = QUAD_VERT,
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

/** Binds a static two-triangle fullscreen quad to the `a_pos` attribute. */
export function bindQuad(gl: WebGLRenderingContext, program: WebGLProgram): void {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // Two triangles covering clip space.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

/** Creates a texture configured for uploading live element images each frame. */
export function createElementTexture(gl: WebGLRenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // CLAMP + LINEAR: the content isn't power-of-two and we sample with offsets.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}
