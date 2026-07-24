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
  // Every program here has exactly one attribute. Pinning it to slot 0 lets a
  // single quad buffer serve several programs: WebGL1 has no VAOs, so attribute
  // state is global and keyed by index — two programs are only safe sharing a
  // buffer if both resolved `a_pos` to the same slot.
  gl.bindAttribLocation(program, 0, 'a_pos');
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

/**
 * Binds a static two-triangle fullscreen quad to the `a_pos` attribute. Pass an
 * existing `buffer` to share one quad across several programs (multi-pass
 * effects); returns the buffer so the caller can reuse and later delete it.
 */
export function bindQuad(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  buffer?: WebGLBuffer,
): WebGLBuffer {
  const buf = buffer ?? gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  if (!buffer) {
    // Two triangles covering clip space.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
  }
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return buf;
}

/* ---------------------------------------------------------------------------
 * Render targets — used by multi-pass effects that need to feed a pass's output
 * back into itself (e.g. Fire's heat field). See lib/useElementTexture.ts.
 * ------------------------------------------------------------------------- */

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** A pair of identical targets; `read` holds last frame, `write` takes this one. */
export interface PingPong {
  read: RenderTarget;
  write: RenderTarget;
}

/**
 * An RGBA8 color target with LINEAR filtering.
 *
 * RGBA8/UNSIGNED_BYTE — not float — is deliberate: it is the only combination
 * guaranteed to be *color-renderable* AND to filter LINEAR without extensions
 * (float textures are NEAREST-only unless OES_texture_float_linear is present,
 * and advection needs bilinear sampling or it stair-steps). `createGL` may hand
 * back a WebGL1 context, which also rejects sized internalformats — hence the
 * RGBA8 ?? RGBA fallback. 8-bit precision loss is handled shader-side with an
 * additive cooling floor plus dithering.
 */
export function createRenderTarget(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
): RenderTarget {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const internal = (gl as WebGL2RenderingContext).RGBA8 ?? gl.RGBA;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    throw new Error(
      `Framebuffer incomplete (0x${status.toString(16)}) at ${width}x${height}.`,
    );
  }
  // Start from a known state (A=1) rather than relying on zero-fill.
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { fbo, texture, width, height };
}

export function resizeRenderTarget(
  gl: WebGLRenderingContext,
  rt: RenderTarget,
  width: number,
  height: number,
): void {
  if (rt.width === width && rt.height === height) return;
  gl.bindTexture(gl.TEXTURE_2D, rt.texture);
  const internal = (gl as WebGL2RenderingContext).RGBA8 ?? gl.RGBA;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  rt.width = width;
  rt.height = height;
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function deleteRenderTarget(gl: WebGLRenderingContext, rt: RenderTarget): void {
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.texture);
}

export function createPingPong(gl: WebGLRenderingContext, w: number, h: number): PingPong {
  return { read: createRenderTarget(gl, w, h), write: createRenderTarget(gl, w, h) };
}

export function resizePingPong(gl: WebGLRenderingContext, pp: PingPong, w: number, h: number): void {
  resizeRenderTarget(gl, pp.read, w, h);
  resizeRenderTarget(gl, pp.write, w, h);
}

/** After a sim pass, makes the freshly written target the one to sample next. */
export function swapPingPong(pp: PingPong): void {
  const t = pp.read;
  pp.read = pp.write;
  pp.write = t;
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
