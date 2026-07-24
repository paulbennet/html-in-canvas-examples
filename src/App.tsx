import { useState } from 'react';
import { detectHtmlInCanvas, mockEnabled } from './lib/support';
import DemoContent from './components/DemoContent';
import SupportBanner from './components/SupportBanner';
import Dither from './effects/Dither';
import Glitch from './effects/Glitch';
import Ripple from './effects/Ripple';
import Glass from './effects/Glass';

type EffectKey = 'dither' | 'glitch' | 'ripple' | 'glass';

const EFFECTS: {
  key: EffectKey;
  label: string;
  hint: string;
  Component: (props: { children: React.ReactNode }) => React.ReactElement;
}[] = [
  { key: 'glass', label: 'Glass', hint: 'Move the cursor — a lens magnifies & refracts the content.', Component: Glass },
  { key: 'ripple', label: 'Ripple', hint: 'Click anywhere to send water ripples across the surface.', Component: Ripple },
  { key: 'dither', label: 'Dither', hint: '1-bit Bayer dithering — a crisp retro monochrome pass.', Component: Dither },
  { key: 'glitch', label: 'Glitch', hint: 'Intermittent RGB-split and slice-tearing bursts.', Component: Glitch },
];

export default function App() {
  const supported = detectHtmlInCanvas();
  const mock = mockEnabled();
  const [active, setActive] = useState<EffectKey>('glass');
  const current = EFFECTS.find((e) => e.key === active)!;
  const Effect = current.Component;

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__logo">
          html-in-canvas <span>· creative effects</span>
        </h1>
        <p className="app__sub">
          CanvasUI-style WebGL effects applied to live, interactive DOM — built on Chrome&rsquo;s{' '}
          HTML-in-Canvas origin trial.
        </p>
        <nav className="app__tabs" aria-label="Effects">
          {EFFECTS.map((e) => (
            <button
              key={e.key}
              className={`tab${e.key === active ? ' tab--active' : ''}`}
              aria-pressed={e.key === active}
              onClick={() => setActive(e.key)}
            >
              {e.label}
            </button>
          ))}
        </nav>
        <p className="app__hint" aria-live="polite">
          {supported ? current.hint : 'Preview shown as plain DOM — enable the flag for the live effect.'}
        </p>
      </header>

      {!supported && !mock && <SupportBanner />}

      <main className="app__stage">
        {/* key forces a clean remount (and GL rebuild) when switching effects. */}
        <Effect key={active}>
          <DemoContent />
        </Effect>
      </main>

      <footer className="app__footer">
        <span
          className={`chip${mock ? ' chip--mock' : supported ? ' chip--live' : ' chip--fallback'}`}
        >
          {mock
            ? 'Mock preview · synthetic texture (not live DOM)'
            : supported
              ? 'API detected · live rendering'
              : 'API absent · fallback DOM'}
        </span>
      </footer>
    </div>
  );
}
