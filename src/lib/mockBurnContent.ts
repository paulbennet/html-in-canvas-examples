import { mockTarget, roundRect, type MockScene } from './mockContent';
import type { TargetRect } from './useElementTexture';

/**
 * `?mock` stand-in for the Fire scene (components/BurnContent.tsx).
 *
 * Fire is element-aware: it burns the boxes reported by `targetSelector`. Those
 * can't be measured in mock mode — the nested DOM is inert canvas fallback
 * content — so this scene derives BOTH its drawing and its reported targets from
 * the same geometry below. Change a number and the painted button and its flame
 * move together.
 */

const PAD_X = 44;
const BTN_Y = 336; // lower third, leaving the upper half for flames to rise into
const BTN_H = 46;
const BTN_R = 12;
const GAP = 14;

interface MockBtn {
  label: string;
  w: number;
  kind: 'primary' | 'ghost' | 'danger' | 'icon';
}

const BUTTONS: MockBtn[] = [
  { label: 'Deploy', w: 106, kind: 'primary' },
  { label: 'Cancel', w: 100, kind: 'ghost' },
  { label: 'Delete everything', w: 178, kind: 'danger' },
  { label: '↻', w: 54, kind: 'icon' },
];

/** Left edge of each button, laid out in a row like the real flex container. */
function layout(): number[] {
  const xs: number[] = [];
  let x = PAD_X;
  for (const b of BUTTONS) {
    xs.push(x);
    x += b.w + GAP;
  }
  return xs;
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number): void {
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

  let y = 96;

  ctx.fillStyle = '#ff9d4d';
  ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('P O W E R   L E V E L   R I S I N G', PAD_X, y);
  y += 52;

  ctx.fillStyle = '#eef0f8';
  ctx.font = '700 40px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Buttons that burn.', PAD_X, y);
  y += 44;

  ctx.fillStyle = '#9aa0b5';
  ctx.font = '400 15px ui-sans-serif, system-ui, sans-serif';
  for (const line of [
    'Each button is a live <button> element, wrapped in a WebGL heat',
    'simulation. Hover one to engulf it — then keep clicking to charge',
    'it through the tiers. Stop mashing and it powers back down.',
  ]) {
    ctx.fillText(line, PAD_X, y);
    y += 24;
  }

  const xs = layout();
  BUTTONS.forEach((b, i) => {
    const x = xs[i];
    if (b.kind === 'primary') {
      const g = ctx.createLinearGradient(x, 0, x + b.w, 0);
      g.addColorStop(0, '#7c9cff');
      g.addColorStop(1, '#b98bff');
      ctx.fillStyle = g;
      roundRect(ctx, x, BTN_Y, b.w, BTN_H, BTN_R);
      ctx.fill();
      ctx.fillStyle = '#0a0b12';
    } else if (b.kind === 'danger') {
      ctx.fillStyle = 'rgba(255,76,60,0.12)';
      ctx.strokeStyle = 'rgba(255,106,90,0.4)';
      roundRect(ctx, x, BTN_Y, b.w, BTN_H, BTN_R);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffb4ab';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      roundRect(ctx, x, BTN_Y, b.w, BTN_H, BTN_R);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#eef0f8';
    }
    ctx.font = `700 ${b.kind === 'icon' ? 17 : 14}px ui-sans-serif, system-ui, sans-serif`;
    const tw = ctx.measureText(b.label).width;
    ctx.fillText(b.label, x + (b.w - tw) / 2, BTN_Y + 29);
  });

  ctx.fillStyle = '#9aa0b5';
  ctx.font = '400 13px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(
    'State updates inside the aura. Try the keyboard: Tab, then hold Space.',
    PAD_X,
    BTN_Y + BTN_H + 30,
  );

  ctx.restore();
}

function targets(cssW: number, cssH: number): TargetRect[] {
  const xs = layout();
  return BUTTONS.map((b, i) => mockTarget(xs[i], BTN_Y, b.w, BTN_H, BTN_R, cssW, cssH));
}

export const BURN_MOCK_SCENE: MockScene = { draw, targets };
