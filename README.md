# html-in-canvas · creative effects

CanvasUI-style WebGL effects applied to **live, interactive DOM** — built from
scratch on Chrome's experimental **[HTML-in-Canvas API](https://developer.chrome.com/blog/html-in-canvas-origin-trial)**
(origin trial, Chrome 148–150).

Each effect renders the real DOM as a full-screen WebGL texture through a custom
fragment shader. Because the content is opted into `layoutsubtree`, it stays laid
out, **interactive, selectable, and accessible** underneath the effect — you can
still click the button, focus the input, and select the text while a shader warps
the pixels.

| Effect     | Technique                                                        | Interaction        |
| ---------- | ---------------------------------------------------------------- | ------------------ |
| **Glass**  | Cursor-tracking lens: magnification + refraction + rim/specular  | Move the pointer   |
| **Ripple** | Expanding wavefronts summed into a UV displacement               | Click to send      |
| **Fire**   | Two-pass ping-pong heat simulation; a power-up aura around real `<button>` boxes | Hover / focus, then mash |
| **Dither** | Luminance + 4×4 Bayer ordered dithering (1-bit phosphor look)    | —                  |
| **Glitch** | Periodic RGB-split + horizontal slice tearing + grain            | — (time-driven)    |

## How it works

The whole thing is a thin, shared core plus one small file per effect:

- [`src/lib/support.ts`](src/lib/support.ts) — `detectHtmlInCanvas()` feature detection (single source of truth).
- [`src/lib/webgl.ts`](src/lib/webgl.ts) — minimal shader / fullscreen-quad / texture helpers.
- [`src/lib/useElementTexture.ts`](src/lib/useElementTexture.ts) — the core hook: sets `layoutsubtree`,
  keeps the canvas at the device-pixel box, and runs a render loop that re-uploads the live element via
  `gl.texElementImage2D(...)` and draws it through the effect shader.
- [`src/effects/EffectCanvas.tsx`](src/effects/EffectCanvas.tsx) — base wrapper; picks the canvas path or the fallback path.
- [`src/effects/shaders.ts`](src/effects/shaders.ts) — every fragment shader in one place.
- [`src/effects/*.tsx`](src/effects/) — `Glass`, `Ripple`, `Fire`, `Dither`, `Glitch` (≈ a shader + a few uniforms each).

Every shader receives the standard uniforms: `sampler2D u_tex`, `vec2 u_resolution`,
`vec2 u_mouse` (UV space), `float u_time`, `float u_pointerDown`, `float u_pointerInside`,
`float u_dt`.

### Multi-pass simulation & element-aware effects

Most effects are a pure function of the current frame. **Fire** is not — it needs heat to persist,
rise and cool — so `useElementTexture` takes two optional extras. Effects that pass neither run the
exact single-pass path they always did.

- **`simulation`** — a second fragment shader rendered into a ping-pong pair of framebuffers before
  the composite, receiving the previous state as `u_prev` and exposing the result to the composite as
  `u_heat`. Targets are `RGBA8` at `scale` × the canvas resolution (see
  `createPingPong` / `swapPingPong` in [`src/lib/webgl.ts`](src/lib/webgl.ts)). RGBA8 rather than
  float is deliberate: it is the only format guaranteed both color-renderable *and* `LINEAR`-filterable
  without extensions, and advection needs bilinear sampling. All four channels are state — Fire packs
  `R=heat, G=fuel, B=soot, A=tier tag` — so render targets are cleared fully transparent and nothing
  may assume alpha is opaque.
- **`targetSelector`** — a CSS selector resolved inside the live content. Matching elements are
  measured with `getBoundingClientRect()` and handed to the effect as UV rects + corner radii on
  `frame.targets`, so a shader can address individual DOM boxes (Fire builds a rounded-rect SDF per
  button). Measurement is dirty-flagged on resize, on `paint`, and on a slow interval — never every
  frame, since it forces layout.

> **Gotcha worth knowing:** the shared quad vertex shader flips Y when deriving `v_uv`, so a pass
> rendered through it stores the value for `v_uv` at texture row `1 - v_uv.y`. Every read of a
> render target must undo that (`fieldUV()` in the fire shaders) or the field comes back mirrored
> *and* the advection runs backwards.

> **Second gotcha:** anything varying *per element* that colours the flame must travel **in the
> field**, not be looked up per-pixel from the nearest element. Fire's tier rides in the sim's alpha
> channel and advects with the gas. Picking the tier from the nearest rect instead puts a hard seam
> down the midpoint between two buttons, where the nearest-element choice flips.

### API signature note (the blog is stale)

The [Chrome blog](https://developer.chrome.com/blog/html-in-canvas-origin-trial) documents a
6-argument `texElementImage2D`. The **actual** origin-trial API (verified against Chromium 151 /
Chrome 150) is different — this repo uses the real one:

- **`gl.texElementImage2D(target, internalformat, element)`** — 3 args; `internalformat` must be a
  **WebGL2 sized format** (`RGBA8`, `SRGB8_ALPHA8`, `RGBA16F`, or `RGBA32F`). The blog's
  `(target, level, internalformat, format, type, element)` is wrong.
- Uploads must be driven by the **`paint` event** (`canvas.onpaint`). The element needs a *cached
  paint record*; calling `texElementImage2D` before the browser has painted the subtree throws
  `No cached paint record for element`. We upload on `paint` and redraw the shader every frame using
  the cached texture. See [`src/lib/useElementTexture.ts`](src/lib/useElementTexture.ts).

## Run it

```bash
npm install
npm run dev          # → http://localhost:5173
```

Three runtime modes:

| Mode | URL | What you see |
| --- | --- | --- |
| **Live** | `/` with the flag enabled (see below) | Real API: shaders applied to the live, interactive DOM |
| **Fallback** | `/` in any browser without the flag | Plain interactive DOM + a banner explaining how to enable the API |
| **Mock preview** | `/?mock` in **any** browser | Shaders applied to a *synthetic* content texture so you can see each effect without the flag (not live DOM) |

There's also a shader self-test: open `/?selftest` and check the console for
`[selftest] ALL SHADERS COMPILED`.

### Enabling the real API (Live mode)

The feature lives in recent Chromium behind a flag (origin trial, Chrome 148–150). Any of:

1. **Chrome/Chromium ~148+** — paste `chrome://flags/#canvas-draw-element`, enable, restart; **or**
2. **Launch with the switch** — start the browser with
   `--enable-features=CanvasDrawElement` (works headless / for automation); **or**
3. Register your origin for the [origin trial](https://developer.chrome.com/origintrials/#/view_trial/3478467762190286849) for production.

> **You don't need Chrome Canary.** playwright's own bundled Chromium (151, UA `Chrome/150`) already
> ships the feature — just launch it with the flag (see the config below). In this build only the
> **WebGL** path is exposed (`gl.texElementImage2D`); the 2D `ctx.drawElementImage` is absent, which
> is why all effects use the WebGL path.

> **Limitations of the API:** no cross-origin iframe content; scrolling/animation
> is main-thread only. Displacement effects (Glass, Ripple) visually offset the
> content from its hit target — an inherent trade-off; the base content stays
> interactive.

## Visual testing with `playwright-cli`

All demos are verified visually with `playwright-cli` (screenshots + interaction).

### Live API path — enable the flag via a config file

`playwright-cli`'s `open`/`goto` don't take raw Chrome args, but they accept a **config file**
(`--config`) whose `browser.launchOptions.args` are passed straight to the browser. That's how you
turn on `chrome://flags/#canvas-draw-element` — no Canary needed, the bundled Chromium supports it.
See [pw-canvas.config.json](pw-canvas.config.json):

```json
{ "browser": { "launchOptions": {
  "headless": false,
  "args": ["--enable-features=CanvasDrawElement",
           "--enable-blink-features=CanvasDrawElement",
           "--enable-experimental-web-platform-features"] } } }
```

```bash
# One-command shortcut (dev server must be running):
npm run demo:live      # opens the flagged window on the live API
npm run demo:close     # closes it

# …or the explicit form:
npx playwright-cli close
npx playwright-cli open --config=pw-canvas.config.json http://localhost:5173/
npx playwright-cli mousemove 640 480          # Glass lens follows the cursor
npx playwright-cli screenshot

# Confirm the API is actually live (not fallback):
npx playwright-cli eval "() => { const g=document.createElement('canvas').getContext('webgl2'); return typeof g.texElementImage2D; }"   # → "function"

# Prove interactivity survives: click the real button THROUGH the canvas
npx playwright-cli mousemove 444 593 && npx playwright-cli mousedown && npx playwright-cli mouseup
```

### Fallback / mock / self-test (any browser, no flag)

```bash
# Fallback path — banner + interactive DOM
npx playwright-cli open http://localhost:5173/
npx playwright-cli screenshot
npx playwright-cli click <button-ref>          # get refs from: playwright-cli snapshot

# Mock preview — see the effects render without the flag
npx playwright-cli goto "http://localhost:5173/?mock"
npx playwright-cli mousemove 640 500           # Glass lens follows the cursor

# Shader compile self-test — check the console for PASS/FAIL
npx playwright-cli goto "http://localhost:5173/?selftest"
```

> Note: time-sensitive effects (Ripple fades in ~2.4s) are hard to catch across
> separate CLI calls (each is its own process). Drive a short `setInterval` spawn
> loop via `playwright-cli eval` so a fresh ripple is always on screen when you
> screenshot.
>
> Fire is easier: hover is *sticky* across CLI calls (`mousemove` parks the cursor and no
> `pointerleave` fires in between), so successive screenshots sample the ramp naturally. For
> reproducible frames, `?charge=0.0`–`1.0` pins the **first** button's charge (only the first,
> since you can only ever charge one at a time — pinning all four would misrepresent the look).
> To exercise the click-to-charge path, drive a mash loop via `eval`:
>
> ```js
> const b = document.querySelector('.burn__btn'), r = b.getBoundingClientRect();
> setInterval(() => b.dispatchEvent(new PointerEvent('pointerdown',
>   { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true })), 90);
> ```

## Adding an effect

1. Add a fragment shader to [`src/effects/shaders.ts`](src/effects/shaders.ts) (and to `ALL_SHADERS` so the self-test covers it).
2. Create a component like [`src/effects/Dither.tsx`](src/effects/Dither.tsx) that renders `<EffectCanvas fragmentShader={...} />`; pass `setUniforms` / `onPointerDownUV` if it needs interaction.
3. Register it in the `EFFECTS` array in [`src/App.tsx`](src/App.tsx). Give it a `Content` component if it needs its own scene rather than the shared demo card.

Effects needing frame-to-frame state or per-element awareness additionally pass `simulation` and/or
`targetSelector` (see [`src/effects/Fire.tsx`](src/effects/Fire.tsx)). If the effect brings its own
scene, also give it a `mockScene` so `?mock` previews it in any browser — derive the scene's
`targets()` from the same constants its `draw()` uses, or the mock flames will drift off the mock
buttons.
