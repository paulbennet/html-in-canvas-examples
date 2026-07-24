import { useState } from 'react';

/**
 * The live, interactive HTML that every effect is applied to. It deliberately
 * mixes selectable text, a focusable input, and a stateful button so that —
 * under a supported effect — you can verify the DOM beneath stays interactive
 * and accessible (the whole point of the HTML-in-Canvas API).
 */
export default function DemoContent() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('');

  return (
    <div className="demo">
      <p className="demo__eyebrow">HTML · in · Canvas</p>
      <h1 className="demo__title">
        Live DOM,
        <br />
        painted through a shader.
      </h1>
      <p className="demo__body">
        This entire card is real, interactive HTML laid out by the browser and
        sampled into a WebGL texture every frame. Select this text, tab to the
        field, click the button — it all still works beneath the effect.
      </p>

      <div className="demo__row">
        <button className="demo__btn" onClick={() => setCount((c) => c + 1)}>
          Clicked {count} {count === 1 ? 'time' : 'times'}
        </button>
        <input
          className="demo__input"
          placeholder="Type your name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Your name"
        />
      </div>

      {name && <p className="demo__greeting">Hi, {name}. 👋 The input is fully live.</p>}

      <ul className="demo__tags">
        <li>selectable</li>
        <li>focusable</li>
        <li>accessible</li>
        <li>find-in-page</li>
      </ul>
    </div>
  );
}
