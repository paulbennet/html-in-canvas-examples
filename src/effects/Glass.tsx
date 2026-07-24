import type { ReactNode } from 'react';
import EffectCanvas from './EffectCanvas';
import { GLASS_FRAG } from './shaders';

/**
 * Glass — a cursor-tracking lens that magnifies and refracts the content
 * beneath it. Pointer-driven via u_mouse (UV space). Outside the lens radius
 * the content renders untouched, so the rest of the page stays crisp and
 * interactive; the lens adds a bright rim + specular highlight.
 */
export default function Glass({ children }: { children: ReactNode }) {
  return <EffectCanvas fragmentShader={GLASS_FRAG}>{children}</EffectCanvas>;
}
