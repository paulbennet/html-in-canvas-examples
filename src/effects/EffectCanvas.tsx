import { useRef, type ReactNode } from 'react';
import { detectHtmlInCanvas } from '../lib/support';
import {
  useElementTexture,
  type EffectFrame,
  type SimulationPass,
} from '../lib/useElementTexture';
import type { MockScene } from '../lib/mockContent';

export interface EffectCanvasProps {
  /** The effect's fragment shader (samples u_tex, the live content). */
  fragmentShader: string;
  /** Optional feedback pass rendered into ping-pong framebuffers before the composite. */
  simulation?: SimulationPass;
  /** CSS selector for elements whose boxes the shader needs (see Fire). */
  targetSelector?: string;
  /** Which synthetic scene `?mock` should paint in place of this content. */
  mockScene?: MockScene;
  /** Optional per-frame effect-specific uniform setter. */
  setUniforms?: (frame: EffectFrame) => void;
  /** Fired on pointer down with UV position + time (event-driven effects). */
  onPointerDownUV?: (uv: [number, number], time: number) => void;
  /** The live, interactive HTML the effect is applied to. */
  children: ReactNode;
}

/**
 * Base wrapper shared by every effect. Two render paths:
 *
 *  - Supported: a `<canvas layoutsubtree>` wraps the content. The browser lays
 *    the content out but suppresses its paint; `useElementTexture` samples it
 *    into a GL texture each frame and renders it through the effect shader.
 *
 *  - Fallback: the content is rendered as ordinary DOM (NOT inside the canvas —
 *    canvas fallback content is hidden whenever the browser supports canvas,
 *    which is everywhere). It stays fully interactive; App shows a banner.
 */
export default function EffectCanvas({
  fragmentShader,
  simulation,
  targetSelector,
  mockScene,
  setUniforms,
  onPointerDownUV,
  children,
}: EffectCanvasProps) {
  const supported = detectHtmlInCanvas();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);

  const { error } = useElementTexture({
    canvasRef,
    contentRef,
    fragmentShader,
    supported,
    simulation,
    targetSelector,
    mockScene,
    setUniforms,
    onPointerDownUV,
  });

  if (!supported) {
    return (
      <div className="effect-stage">
        <div className="effect-content" ref={contentRef as React.RefObject<HTMLDivElement>}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="effect-stage">
      {/* layoutsubtree is applied imperatively in useElementTexture. */}
      <canvas className="effect-canvas" ref={canvasRef}>
        <div className="effect-content" ref={contentRef as React.RefObject<HTMLDivElement>}>
          {children}
        </div>
      </canvas>
      {error && <pre className="effect-error">{`Shader error:\n${error}`}</pre>}
    </div>
  );
}
