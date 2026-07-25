import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import EffectCanvas from './EffectCanvas';
import type { EffectFrame, TargetRect } from '../lib/useElementTexture';
import { BURN_MOCK_SCENE } from '../lib/mockBurnContent';
import { FIRE_FRAG, FIRE_SIM_FRAG, MAX_BURN } from './shaders';

/**
 * Charge model. Hovering raises a floor the charge cannot fall below; clicking
 * adds on top of it and bleeds off, so *holding* a high tier means keeping up
 * the clicking rather than just parking the pointer.
 */
const IDLE_FLOOR = 0.1; // at rest: a faint shimmer, kept under the tier-1 threshold
const HOVER_FLOOR = 0.3; // hover alone engulfs at tier 1
const CLICK_STEP = 0.2; // every click charges this much further
const DECAY = 0.26; // charge bled per second
const FLOOR_RATE = 1 / 0.28; // how fast the floor follows hover on/off
const POP_DECAY = 1 / 0.45; // per-click impulse
const TIER_SNAP = 1 / 0.12; // tier transitions snap rather than crossfade

/** Charge thresholds entering tiers 1..4. Crossing one is a transformation. */
const TIERS = [0.12, 0.38, 0.58, 0.8];
const TIER_MAX = TIERS.length;

/** `?charge=0.9` pins every button's charge, for reproducible screenshots. */
function pinnedCharge(): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('charge');
    if (raw === null) return null;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  } catch {
    return null;
  }
}

function tierOf(charge: number): number {
  let t = 0;
  for (const th of TIERS) if (charge >= th) t++;
  return t;
}

/**
 * Fire — buttons that power up. Hovering (or focusing) one wraps it in an aura;
 * clicking it repeatedly charges it through discrete tiers, each with its own
 * colour and features. Charge bleeds off over a few seconds, so sustaining the
 * top tier means sustaining the mashing.
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
  // Three floats per button: [charge, tier01, pop]. Charge is continuous and
  // drives the aura's size; tier is quantised so transformations snap.
  const state = useRef(
    new Float32Array(MAX_BURN * 3).map((_, i) => (i % 3 === 0 ? IDLE_FLOOR : 0)),
  );
  const floors = useRef(new Float32Array(MAX_BURN).fill(IDLE_FLOOR));
  const radius = useRef(0.024);
  const targets = useRef<TargetRect[]>([]);
  const lastTime = useRef(-1);
  const pinned = useRef(pinnedCharge());

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
      const s = i * 3;
      if (!t) {
        rects.current.fill(0, i * 4, i * 4 + 4);
        state.current.fill(0, s, s + 3);
        continue;
      }
      rects.current.set(t.uv, i * 4);

      // Pin only the first button: you can only ever charge one at a time, so
      // pinning all four would make screenshots misrepresent the real look.
      if (pinned.current !== null && i === 0) {
        state.current[s] = pinned.current;
        state.current[s + 1] = tierOf(pinned.current) / TIER_MAX;
        state.current[s + 2] = 0;
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

      // The floor rises on hover; charge decays toward it but never below it.
      const floorTarget = lit ? HOVER_FLOOR : IDLE_FLOOR;
      floors.current[i] += (floorTarget - floors.current[i]) * Math.min(1, FLOOR_RATE * f.dt);

      const charge = Math.max(floors.current[i], state.current[s] - DECAY * f.dt);
      state.current[s] = charge;

      const tierTarget = tierOf(charge) / TIER_MAX;
      state.current[s + 1] += (tierTarget - state.current[s + 1]) * Math.min(1, TIER_SNAP * f.dt);
      state.current[s + 2] = Math.max(0, state.current[s + 2] - POP_DECAY * f.dt);
    }
  }, []);

  /** Push the current state at whichever program is being drawn. */
  const upload = useCallback(({ gl, program }: EffectFrame) => {
    // Array uniforms must be addressed by their first element on most drivers.
    gl.uniform4fv(gl.getUniformLocation(program, 'u_burnRect[0]'), rects.current);
    gl.uniform3fv(gl.getUniformLocation(program, 'u_burnState[0]'), state.current);
    gl.uniform1f(gl.getUniformLocation(program, 'u_burnRadius'), radius.current);
  }, []);

  const setUniforms = useCallback(
    (f: EffectFrame) => {
      advance(f);
      upload(f);
    },
    [advance, upload],
  );

  /** Every click charges the button further — keep hammering to climb tiers. */
  const onPointerDownUV = useCallback(([x, y]: [number, number]) => {
    targets.current.forEach((t, i) => {
      if (i < MAX_BURN && x >= t.uv[0] && x <= t.uv[2] && y >= t.uv[1] && y <= t.uv[3]) {
        state.current[i * 3] = Math.min(1, state.current[i * 3] + CLICK_STEP);
        state.current[i * 3 + 2] = 1;
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
