import { useEffect, useRef, useState } from 'react';
import {
  bindQuad,
  createElementTexture,
  createGL,
  createPingPong,
  createProgram,
  deleteRenderTarget,
  resizePingPong,
  swapPingPong,
  type PingPong,
} from './webgl';
import { mockEnabled } from './support';
import { DEMO_MOCK_SCENE, type MockScene } from './mockContent';

/** A live DOM element's box, measured for element-aware effects (see Fire). */
export interface TargetRect {
  /** UV rect [x0, y0, x1, y1], origin top-left — matches v_uv. */
  uv: [number, number, number, number];
  /**
   * Corner radius in units of canvas HEIGHT. Shaders work in aspect-corrected
   * UV where both axes have unit = canvas height, so one scalar is correct for
   * both axes there.
   */
  radiusUV: number;
  /** The measured element. Absent in `?mock`, where rects are synthetic. */
  el?: HTMLElement;
}

/**
 * Per-frame state handed to an effect's `setUniforms` callback so it can push
 * its own uniforms on top of the standard set.
 */
export interface EffectFrame {
  gl: WebGLRenderingContext;
  /** The program being drawn — the sim program during a simulation pass. */
  program: WebGLProgram;
  /** Seconds since the effect mounted. */
  time: number;
  /** Seconds since the previous frame, clamped (safe to integrate against). */
  dt: number;
  /** Pointer position in [0,1] UV space, origin top-left (matches v_uv). */
  mouse: [number, number];
  /** Whether a pointer button is currently held. */
  pointerDown: boolean;
  /** Whether the pointer is currently over the canvas (false after leave). */
  pointerInside: boolean;
  /** Canvas size in device pixels — the SIM target size during a sim pass. */
  resolution: [number, number];
  /** Measured element boxes, when `targetSelector` was given. */
  targets: TargetRect[];
}

/**
 * An extra render pass run before the composite, writing into a ping-pong pair
 * of framebuffers. Lets an effect keep state between frames (a heat field, a
 * fluid, a trail) instead of being a pure function of the current frame.
 */
export interface SimulationPass {
  /** Sim fragment shader. Gets `u_prev` (the previous state) plus the standard set. */
  fragmentShader: string;
  /** Sim target size as a fraction of the canvas. Default 0.5. */
  scale?: number;
  /** Per-frame uniform setter for the sim program. */
  setUniforms?: (frame: EffectFrame) => void;
}

export interface UseElementTextureArgs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  /**
   * Effect fragment shader. Receives u_tex, u_resolution, u_mouse, u_time,
   * u_pointerDown, u_pointerInside, u_dt — plus u_heat when `simulation` is set.
   */
  fragmentShader: string;
  /** Whether the HTML-in-Canvas API is available; when false the hook is inert. */
  supported: boolean;
  /** Optional feedback pass run before the composite (see SimulationPass). */
  simulation?: SimulationPass;
  /** CSS selector, resolved inside the content, whose boxes are measured each frame. */
  targetSelector?: string;
  /** Which synthetic scene `?mock` should paint. Defaults to the demo card. */
  mockScene?: MockScene;
  /** Optional hook to set effect-specific uniforms each frame. */
  setUniforms?: (frame: EffectFrame) => void;
  /** Called on pointer down with the UV position (for event-driven effects like Ripple). */
  onPointerDownUV?: (uv: [number, number], time: number) => void;
}

/** Cached standard-uniform locations, one set per program. */
interface StandardUniforms {
  tex: WebGLUniformLocation | null;
  res: WebGLUniformLocation | null;
  mouse: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  down: WebGLUniformLocation | null;
  inside: WebGLUniformLocation | null;
  dt: WebGLUniformLocation | null;
}

function standardUniforms(gl: WebGLRenderingContext, program: WebGLProgram): StandardUniforms {
  return {
    tex: gl.getUniformLocation(program, 'u_tex'),
    res: gl.getUniformLocation(program, 'u_resolution'),
    mouse: gl.getUniformLocation(program, 'u_mouse'),
    time: gl.getUniformLocation(program, 'u_time'),
    down: gl.getUniformLocation(program, 'u_pointerDown'),
    inside: gl.getUniformLocation(program, 'u_pointerInside'),
    dt: gl.getUniformLocation(program, 'u_dt'),
  };
}

/**
 * Core of every effect. When supported, it:
 *   - marks the canvas with `layoutsubtree` so the browser lays out (but does
 *     not paint) the child content, keeping it interactive & accessible;
 *   - keeps the canvas sized to the device pixel box (DPR-correct);
 *   - runs a render loop that re-uploads the live content element into a GL
 *     texture via `texElementImage2D` and draws it through the effect shader.
 *
 * Optionally it also runs a `simulation` pass into ping-pong framebuffers, and
 * measures `targetSelector` elements so shaders can address individual DOM
 * boxes. Effects that use neither take the identical single-pass code path.
 *
 * Interactivity is preserved for free: because the content is laid out at its
 * natural position and we draw it in-place across a fullscreen quad, pointer
 * events hit the real DOM underneath. (Displacement effects visually offset the
 * content from its hit target — an inherent, acceptable trade-off for demos.)
 */
export function useElementTexture({
  canvasRef,
  contentRef,
  fragmentShader,
  supported,
  simulation,
  targetSelector,
  mockScene,
  setUniforms,
  onPointerDownUV,
}: UseElementTextureArgs): { error: string | null } {
  const [error, setError] = useState<string | null>(null);

  // Live interaction state kept in refs so the RAF loop reads current values
  // without re-subscribing.
  const mouse = useRef<[number, number]>([0.5, 0.5]);
  const pointerDown = useRef(false);
  const pointerInside = useRef(false);

  // The loop closes over the first render's callbacks; latch the latest ones so
  // an effect passing a fresh closure each render doesn't go stale (and doesn't
  // need to be in the dep array, which would rebuild the whole GL context).
  const latest = useRef({ setUniforms, onPointerDownUV, simulation, mockScene });
  latest.current = { setUniforms, onPointerDownUV, simulation, mockScene };

  const simFragment = simulation?.fragmentShader;

  useEffect(() => {
    if (!supported) return;
    const canvas = canvasRef.current;
    const content = contentRef.current;
    if (!canvas || !content) return;

    // Opt the canvas into laying out its subtree without painting it.
    canvas.setAttribute('layoutsubtree', '');

    const sim = latest.current.simulation ?? null;
    const scene = latest.current.mockScene ?? DEMO_MOCK_SCENE;

    let gl: WebGLRenderingContext;
    let program: WebGLProgram;
    let texture: WebGLTexture;
    let quad: WebGLBuffer;
    let simProgram: WebGLProgram | null = null;
    let pp: PingPong | null = null;
    let std: StandardUniforms;
    let simStd: StandardUniforms | null = null;
    let uPrev: WebGLUniformLocation | null = null;
    let uHeat: WebGLUniformLocation | null = null;
    try {
      gl = createGL(canvas);
      program = createProgram(gl, fragmentShader);
      texture = createElementTexture(gl);
      quad = bindQuad(gl, program);
      std = standardUniforms(gl, program);
      if (sim) {
        simProgram = createProgram(gl, sim.fragmentShader);
        // Share the one quad: createProgram pins `a_pos` to slot 0 for both.
        bindQuad(gl, simProgram, quad);
        simStd = standardUniforms(gl, simProgram);
        uPrev = gl.getUniformLocation(simProgram, 'u_prev');
        uHeat = gl.getUniformLocation(program, 'u_heat');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    // Mock preview: when the real draw method is missing but `?mock` is on, we
    // upload a synthetic content canvas instead of the live element.
    const useMock = typeof gl.texElementImage2D !== 'function' && mockEnabled();
    const mockCanvas = useMock ? document.createElement('canvas') : null;
    const mockCtx = mockCanvas?.getContext('2d') ?? null;
    const paintMock = () => {
      if (!mockCanvas || !mockCtx) return;
      if (mockCanvas.width !== canvas.width || mockCanvas.height !== canvas.height) {
        mockCanvas.width = canvas.width;
        mockCanvas.height = canvas.height;
        const scale = window.devicePixelRatio || 1;
        scene.draw(mockCtx, canvas.width, canvas.height, scale);
      }
    };

    // --- element targets ----------------------------------------------------
    // getBoundingClientRect() forces a layout flush, so we never measure every
    // frame — only when something that could have moved the boxes happened.
    let targets: TargetRect[] = [];
    let targetsDirty = true;

    const measureTargets = () => {
      targetsDirty = false;
      if (!targetSelector) return;
      if (useMock) {
        const dpr = window.devicePixelRatio || 1;
        targets = scene.targets?.(canvas.width / dpr, canvas.height / dpr) ?? [];
        return;
      }
      const cr = canvas.getBoundingClientRect();
      if (cr.width < 1 || cr.height < 1) return;
      const out: TargetRect[] = [];
      content.querySelectorAll<HTMLElement>(targetSelector).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const raw = getComputedStyle(el).borderTopLeftRadius;
        const px = raw.endsWith('%')
          ? (parseFloat(raw) / 100) * Math.min(r.width, r.height)
          : parseFloat(raw) || 0;
        out.push({
          el,
          uv: [
            (r.left - cr.left) / cr.width,
            (r.top - cr.top) / cr.height,
            (r.right - cr.left) / cr.width,
            (r.bottom - cr.top) / cr.height,
          ],
          radiusUV: px / cr.height,
        });
      });
      targets = out;
    };

    gl.useProgram(program);

    // DPR-correct sizing via the device pixel content box (per the blog).
    const resize = (entry?: ResizeObserverEntry) => {
      const dpr = window.devicePixelRatio || 1;
      let w: number, h: number;
      const dpc = entry?.devicePixelContentBoxSize;
      if (dpc && dpc[0]) {
        w = dpc[0].inlineSize;
        h = dpc[0].blockSize;
      } else {
        const rect = canvas.getBoundingClientRect();
        w = Math.round(rect.width * dpr);
        h = Math.round(rect.height * dpr);
      }
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      targetsDirty = true;

      // Simulation targets track the canvas at a fraction of its resolution:
      // cheaper, and the bilinear upsample softens the field for free.
      if (sim) {
        const s = sim.scale ?? 0.5;
        const sw = Math.max(1, Math.round(canvas.width * s));
        const sh = Math.max(1, Math.round(canvas.height * s));
        try {
          if (!pp) pp = createPingPong(gl, sw, sh);
          else resizePingPong(gl, pp, sw, sh);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    resize();
    const ro = new ResizeObserver(([entry]) => resize(entry));
    ro.observe(canvas);

    // Pointer tracking (UV space, origin top-left to match v_uv).
    const toUV = (ev: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [(ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height];
    };
    const onMove = (ev: PointerEvent) => {
      mouse.current = toUV(ev);
      pointerInside.current = true;
    };
    const onDown = (ev: PointerEvent) => {
      pointerDown.current = true;
      pointerInside.current = true;
      const uv = toUV(ev);
      mouse.current = uv;
      latest.current.onPointerDownUV?.(uv, (performance.now() - start) / 1000);
    };
    const onUp = () => {
      pointerDown.current = false;
    };
    // u_mouse deliberately keeps its last value on leave (moving it would make
    // Glass's lens jump); effects that care read `pointerInside` instead.
    const onLeave = () => {
      pointerInside.current = false;
      pointerDown.current = false;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointercancel', onLeave);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('blur', onLeave);

    const start = performance.now();
    let raf = 0;
    let disposed = false;
    let prevTime = -1;

    // The real API can only sample an element that the browser has already
    // painted ("cached paint record"). So we upload on the `paint` event, not
    // every frame; the shader still redraws every frame using the cached
    // texture (needed for time/mouse-driven effects on static content).
    let needsUpload = true; // try an initial upload; retry until a record exists
    let uploaded = false; // have we ever successfully uploaded a texture?
    if (!useMock) {
      canvas.onpaint = () => {
        needsUpload = true;
        // The subtree was re-laid out, so measured boxes may have moved (e.g. a
        // button's label grew from "1 time" to "10 times").
        targetsDirty = true;
      };
    }
    // Safety net for reflows that fire no paint event we can see (web fonts).
    const remeasure = targetSelector
      ? window.setInterval(() => {
          targetsDirty = true;
        }, 500)
      : 0;

    const setStandard = (u: StandardUniforms, res: [number, number], time: number, dt: number) => {
      gl.uniform1i(u.tex, 0);
      gl.uniform2f(u.res, res[0], res[1]);
      gl.uniform2f(u.mouse, mouse.current[0], mouse.current[1]);
      gl.uniform1f(u.time, time);
      gl.uniform1f(u.dt, dt);
      gl.uniform1f(u.down, pointerDown.current ? 1 : 0);
      gl.uniform1f(u.inside, pointerInside.current ? 1 : 0);
    };

    const render = () => {
      if (disposed) return;
      const time = (performance.now() - start) / 1000;
      const dt = prevTime < 0 ? 1 / 60 : Math.min(Math.max(time - prevTime, 0), 0.05);
      prevTime = time;

      if (targetsDirty) measureTargets();

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      if (useMock && mockCanvas) {
        paintMock();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mockCanvas);
        uploaded = true;
      } else if (needsUpload) {
        // Real origin-trial API: texElementImage2D(target, internalformat, element)
        // with a WebGL2 sized internalformat (RGBA8).
        const internalformat = (gl as WebGL2RenderingContext).RGBA8 ?? gl.RGBA;
        try {
          gl.texElementImage2D!(gl.TEXTURE_2D, internalformat, content);
          needsUpload = false;
          uploaded = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Before the browser has painted the subtree there is no paint record
          // yet — that's expected; keep retrying without surfacing an error.
          if (!/cached paint record/i.test(msg)) {
            setError(msg);
            disposed = true;
            return;
          }
        }
      }

      // Nothing to draw until we've uploaded at least once.
      if (!uploaded) {
        raf = requestAnimationFrame(render);
        return;
      }

      const frameBase = {
        gl,
        time,
        dt,
        mouse: mouse.current,
        pointerDown: pointerDown.current,
        pointerInside: pointerInside.current,
        targets,
      };

      // Pass 1 — simulation: read the previous state, write the next one.
      // Ping-pong guarantees the sampled texture is never the bound attachment.
      if (sim && pp && simProgram && simStd) {
        const simRes: [number, number] = [pp.write.width, pp.write.height];
        gl.bindFramebuffer(gl.FRAMEBUFFER, pp.write.fbo);
        gl.viewport(0, 0, simRes[0], simRes[1]);
        gl.useProgram(simProgram);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, pp.read.texture);
        gl.uniform1i(uPrev, 1);
        // u_resolution is the SIM size here — the sim needs it for texel steps.
        setStandard(simStd, simRes, time, dt);
        sim.setUniforms?.({ ...frameBase, program: simProgram, resolution: simRes });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        swapPingPong(pp);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);
      }

      // Pass 2 — composite.
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);

      if (sim && pp) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, pp.read.texture); // post-swap: just written
        gl.uniform1i(uHeat, 1);
        gl.activeTexture(gl.TEXTURE0);
      }

      setStandard(std, [canvas.width, canvas.height], time, dt);

      // Effect-specific uniforms.
      latest.current.setUniforms?.({
        ...frameBase,
        program,
        resolution: [canvas.width, canvas.height],
      });

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.onpaint = null;
      if (remeasure) clearInterval(remeasure);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onLeave);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onLeave);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteBuffer(quad);
      if (simProgram) gl.deleteProgram(simProgram);
      if (pp) {
        deleteRenderTarget(gl, pp.read);
        deleteRenderTarget(gl, pp.write);
      }
    };
    // Shader identity changes only when the effect changes → full rebuild.
    // `simulation` itself is intentionally excluded (it's latched above); an
    // effect recreating that object each render must not thrash the GL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, fragmentShader, simFragment, targetSelector]);

  return { error };
}
