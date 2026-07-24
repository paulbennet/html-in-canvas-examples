import type { TargetRect } from './useElementTexture';

/**
 * A synthetic stand-in for one demo scene, used by `?mock` preview mode.
 *
 * The real HTML-in-Canvas API only exists in Chrome Canary, so on every other
 * browser the effects fall back to plain DOM and you can't SEE them. `?mock`
 * instead forces the WebGL path and feeds the shaders a synthetic, content-like
 * image (drawn with the Canvas 2D API) so each effect's visual behavior can be
 * previewed and screenshotted anywhere.
 *
 * Element-aware effects also need element boxes, which can't be measured in
 * mock mode (the nested DOM is inert canvas fallback content). A scene therefore
 * also reports synthetic `targets` derived from the very constants its `draw`
 * uses, keeping mock geometry and mock effects provably in sync.
 */
export interface MockScene {
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number): void;
  /** Synthetic stand-ins for `targetSelector` matches, in UV space. */
  targets?(cssW: number, cssH: number): TargetRect[];
}

/** Helper: CSS-px box → the UV rect shape shaders expect. */
export function mockTarget(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  cssW: number,
  cssH: number,
): TargetRect {
  return {
    uv: [x / cssW, y / cssH, (x + w) / cssW, (y + h) / cssH],
    radiusUV: r / cssH,
  };
}

/**
 * The demo card (see components/DemoContent.tsx) — the default mock scene. It
 * is NOT the live DOM: a stand-in that mirrors the card so distortions read
 * clearly.
 */
export function drawMockContent(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scale: number,
): void {
  ctx.save();
  ctx.scale(scale, scale);
  const W = w / scale;
  const H = h / scale;

  // Card background — mirrors .effect-content.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#171a2b');
  bg.addColorStop(1, '#0e0f1a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.8, -H * 0.2, 0, W * 0.8, -H * 0.2, W * 0.7);
  glow.addColorStop(0, 'rgba(124,156,255,0.25)');
  glow.addColorStop(1, 'rgba(124,156,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const padX = 44;
  let y = 96;

  // Eyebrow.
  ctx.fillStyle = '#7c9cff';
  ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('H T M L   ·   I N   ·   C A N V A S', padX, y);
  y += 56;

  // Title (two lines).
  ctx.fillStyle = '#eef0f8';
  ctx.font = '700 40px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Live DOM,', padX, y);
  y += 48;
  ctx.fillText('painted through a shader.', padX, y);
  y += 56;

  // Body lines.
  ctx.fillStyle = '#9aa0b5';
  ctx.font = '400 16px ui-sans-serif, system-ui, sans-serif';
  const lines = [
    'This card is a synthetic preview of the demo content, drawn',
    'to a canvas so you can see each effect without Chrome Canary.',
    'In a supported browser this would be the live, interactive DOM.',
  ];
  for (const line of lines) {
    ctx.fillText(line, padX, y);
    y += 26;
  }
  y += 24;

  // Button (gradient pill).
  const btnGrad = ctx.createLinearGradient(padX, 0, padX + 150, 0);
  btnGrad.addColorStop(0, '#7c9cff');
  btnGrad.addColorStop(1, '#b98bff');
  ctx.fillStyle = btnGrad;
  roundRect(ctx, padX, y, 150, 42, 10);
  ctx.fill();
  ctx.fillStyle = '#0a0b12';
  ctx.font = '700 14px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Clicked 3 times', padX + 22, y + 26);

  // Input field.
  const inX = padX + 168;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(ctx, inX, y, W - inX - padX, 42, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '400 14px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Type your name…', inX + 16, y + 26);
  y += 74;

  // Tag pills.
  ctx.font = '400 12px ui-sans-serif, system-ui, sans-serif';
  let tx = padX;
  for (const tag of ['selectable', 'focusable', 'accessible', 'find-in-page']) {
    const tw = ctx.measureText(tag).width + 22;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, tx, y, tw, 26, 13);
    ctx.stroke();
    ctx.fillStyle = '#9aa0b5';
    ctx.fillText(tag, tx + 11, y + 17);
    tx += tw + 8;
  }

  ctx.restore();
}

export const DEMO_MOCK_SCENE: MockScene = { draw: drawMockContent };

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
