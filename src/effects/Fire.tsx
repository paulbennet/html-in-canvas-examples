import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import EffectCanvas from './EffectCanvas';
import type { EffectFrame, TargetRect } from '../lib/useElementTexture';
import { BURN_MOCK_SCENE } from '../lib/mockBurnContent';
import { FIRE_FRAG, FIRE_SIM_FRAG, MAX_BURN } from './shaders';

/** Resting smoulder — every button is always at least a little alight. */
const IDLE = 0.115;
const ATTACK = 1 / 0.35; // hover -> full blaze
const DECAY = 1 / 0.9; // un-hover -> back to smouldering
const FLARE_DECAY = 1 / 0.6; // click burst

/** `?ign=0.7` pins intensity, so screenshots of a given state are reproducible. */
function pinnedIntensity(): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('ign');
    if (raw === null) return null;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  } catch {
    return null;
  }
}

/**
 * Fire — every button smoulders; hovering (or focusing) one fans it into a blaze.
 *
 * The first effect to use both new capabilities of `useElementTexture`: a
 * ping-pong `simulation` pass holding a heat field between frames, and
 * `targetSelector`, which measures the live buttons so the shader can burn each
 * one individually.
 *
 * The per-button state machine lives here rather than in GLSL because the shader
 * has no persistent per-target storage (that would mean a whole extra texture
 * for eight floats), and because hover is a DOM concept. Hover is hit-tested
 * from the pointer UV rather than CSS `:hover`: in `?mock` mode the nested DOM
 * is inert canvas fallback content that can never match `:hover`, and in live
 * mode the content is laid out 1:1 under the canvas, so the UV test is exact.
 */
export default function Fire({ children }: { children: ReactNode }) {
  const rects = useRef(new Float32Array(MAX_BURN * 4));
  // Two floats per button: [intensity, flare]. Start at the resting smoulder so
  // the scene is already alight on the first frame.
  const state = useRef(
    new Float32Array(MAX_BURN * 2).map((_, i) => (i % 2 === 0 ? IDLE : 0)),
  );
  const radius = useRef(0.024);
  const targets = useRef<TargetRect[]>([]);
  const lastTime = useRef(-1);
  const pinned = useRef(pinnedIntensity());

  /**
   * Integrate the per-button state. Called from both passes but guarded to run
   * once per frame — both share the same `time`.
   */
  const advance = useCallback((f: EffectFrame) => {
    if (f.time === lastTime.current) return;
    lastTime.current = f.time;
    targets.current = f.targets;
    radius.current = f.targets[0]?.radiusUV ?? 0.024;

    const [mx, my] = f.mouse;
    for (let i = 0; i < MAX_BURN; i++) {
      const t = f.targets[i];
      if (!t) {
        rects.current.fill(0, i * 4, i * 4 + 4);
        state.current[i * 2] = 0;
        state.current[i * 2 + 1] = 0;
        continue;
      }
      rects.current.set(t.uv, i * 4);

      if (pinned.current !== null) {
        state.current[i * 2] = pinned.current;
        state.current[i * 2 + 1] = 0;
        continue;
      }

      const over =
        f.pointerInside && mx >= t.uv[0] && mx <= t.uv[2] && my >= t.uv[1] && my <= t.uv[3];
      let focused = false;
      try {
        focused = !!t.el?.matches(':focus-visible');
      } catch {
        /* :focus-visible unsupported — hover alone still ignites */
      }
      const lit = over || focused;

      const intensity = state.current[i * 2];
      const target = lit ? 1 : IDLE;
      state.current[i * 2] =
        intensity + (target - intensity) * Math.min(1, (lit ? ATTACK : DECAY) * f.dt);
      state.current[i * 2 + 1] = Math.max(0, state.current[i * 2 + 1] - FLARE_DECAY * f.dt);
    }
  }, []);

  /** Push the current state at whichever program is being drawn. */
  const upload = useCallback(({ gl, program }: EffectFrame) => {
    // Array uniforms must be addressed by their first element on most drivers.
    gl.uniform4fv(gl.getUniformLocation(program, 'u_burnRect[0]'), rects.current);
    gl.uniform2fv(gl.getUniformLocation(program, 'u_burnState[0]'), state.current);
    gl.uniform1f(gl.getUniformLocation(program, 'u_burnRadius'), radius.current);
  }, []);

  const setUniforms = useCallback(
    (f: EffectFrame) => {
      advance(f);
      upload(f);
    },
    [advance, upload],
  );

  /** Clicking a button throws a burst of extra fuel at it. */
  const onPointerDownUV = useCallback(([x, y]: [number, number]) => {
    targets.current.forEach((t, i) => {
      if (i < MAX_BURN && x >= t.uv[0] && x <= t.uv[2] && y >= t.uv[1] && y <= t.uv[3]) {
        state.current[i * 2 + 1] = 1;
      }
    });
  }, []);

  const simulation = useMemo(
    () => ({ fragmentShader: FIRE_SIM_FRAG, scale: 0.65, setUniforms }),
    [setUniforms],
  );

  return (
    <EffectCanvas
      fragmentShader={FIRE_FRAG}
      simulation={simulation}
      targetSelector=".burn__btn"
      mockScene={BURN_MOCK_SCENE}
      setUniforms={setUniforms}
      onPointerDownUV={onPointerDownUV}
    >
      {children}
    </EffectCanvas>
  );
}
