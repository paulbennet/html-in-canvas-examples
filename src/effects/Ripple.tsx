import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import EffectCanvas from './EffectCanvas';
import type { EffectFrame } from '../lib/useElementTexture';
import { MAX_RIPPLES, RIPPLE_DEAD, RIPPLE_FRAG, RIPPLE_LIFETIME } from './shaders';

/**
 * Ripple — click-triggered water ripples that refract the content. Each
 * pointer-down spawns an expanding wavefront (stored as x, y, startTime) in a
 * ring buffer; the shader sums every slot's active wave into a UV displacement
 * and resamples the live content. Empty/expired slots use a DEAD start time so
 * their age always exceeds the lifetime and they contribute nothing.
 */
function makeRipples(): Float32Array {
  const arr = new Float32Array(MAX_RIPPLES * 3);
  for (let i = 0; i < MAX_RIPPLES; i++) arr[i * 3 + 2] = RIPPLE_DEAD;
  return arr;
}

export default function Ripple({ children }: { children: ReactNode }) {
  const ripples = useRef<Float32Array>(makeRipples());
  const next = useRef(0);

  const onPointerDownUV = useCallback((uv: [number, number], time: number) => {
    const i = next.current;
    ripples.current[i * 3] = uv[0];
    ripples.current[i * 3 + 1] = uv[1];
    ripples.current[i * 3 + 2] = time;
    next.current = (i + 1) % MAX_RIPPLES;
  }, []);

  const setUniforms = useCallback(({ gl, program }: EffectFrame) => {
    // Array uniforms must be addressed by their first element on most drivers;
    // `getUniformLocation(program, 'u_ripples')` can return null otherwise.
    gl.uniform3fv(gl.getUniformLocation(program, 'u_ripples[0]'), ripples.current);
    gl.uniform1f(gl.getUniformLocation(program, 'u_lifetime'), RIPPLE_LIFETIME);
  }, []);

  return (
    <EffectCanvas fragmentShader={RIPPLE_FRAG} setUniforms={setUniforms} onPointerDownUV={onPointerDownUV}>
      {children}
    </EffectCanvas>
  );
}
