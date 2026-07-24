import type { ReactNode } from 'react';
import EffectCanvas from './EffectCanvas';
import { GLITCH_FRAG } from './shaders';

/**
 * Glitch — periodic RGB-split + horizontal slice tearing + scanline noise.
 * Time-driven (u_time), no pointer interaction. Bursts come and go so the
 * content is legible most of the time and tears intermittently.
 */
export default function Glitch({ children }: { children: ReactNode }) {
  return <EffectCanvas fragmentShader={GLITCH_FRAG}>{children}</EffectCanvas>;
}
