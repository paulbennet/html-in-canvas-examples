import type { ReactNode } from 'react';
import EffectCanvas from './EffectCanvas';
import { DITHER_FRAG } from './shaders';

/**
 * Dither — 1-bit ordered (Bayer) dithering post-process. No interaction: the
 * live content is reduced to luminance and thresholded against a 4x4 Bayer
 * matrix, giving a crisp retro monochrome look while text stays readable.
 */
export default function Dither({ children }: { children: ReactNode }) {
  return <EffectCanvas fragmentShader={DITHER_FRAG}>{children}</EffectCanvas>;
}
