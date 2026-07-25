/**
 * All effect fragment shaders live here, separated from their React wrappers.
 * Centralizing them keeps the components thin and lets the in-browser shader
 * self-test (src/lib/selfTest.ts) compile every shader without importing React.
 *
 * Every shader receives the standard uniforms set by useElementTexture:
 *   sampler2D u_tex; vec2 u_resolution; vec2 u_mouse; float u_time; float u_pointerDown;
 * plus any effect-specific uniforms noted below.
 */

// Ripple configuration shared between the shader and the component logic.
export const MAX_RIPPLES = 8;
export const RIPPLE_LIFETIME = 2.4; // seconds
export const RIPPLE_DEAD = -1000.0; // sentinel start-time for empty slots

/** Dither — 1-bit ordered (Bayer) dithering, no interaction. */
export const DITHER_FRAG = /* glsl */ `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_resolution;

// 4x4 Bayer threshold in [0,1). Looped lookup avoids dynamic array indexing,
// which GLSL ES 1.00 (WebGL1) restricts.
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int idx = y * 4 + x;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  float t = 0.0;
  for (int k = 0; k < 16; k++) { if (k == idx) t = m[k]; }
  return (t + 0.5) / 16.0;
}

void main() {
  vec4 src = texture2D(u_tex, v_uv);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  vec2 px = v_uv * u_resolution;
  float bw = step(bayer(px), lum);
  vec3 col = mix(vec3(0.02, 0.05, 0.02), vec3(0.75, 1.0, 0.80), bw);
  gl_FragColor = vec4(col, src.a);
}
`;

/** Glitch — periodic RGB-split + slice tearing + grain, time-driven. */
export const GLITCH_FRAG = /* glsl */ `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_time;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  float t = u_time;
  float burst = smoothstep(0.6, 1.0, sin(t * 3.7) * 0.5 + 0.5)
              * smoothstep(0.5, 1.0, hash(floor(t * 6.0)));

  float row = floor(v_uv.y * 24.0);
  float jump = (hash(row + floor(t * 20.0)) - 0.5) * 0.15 * burst;

  vec2 uv = v_uv;
  uv.x += jump;

  float shift = (0.006 + 0.02 * burst);
  float r = texture2D(u_tex, uv + vec2(shift, 0.0)).r;
  float g = texture2D(u_tex, uv).g;
  float b = texture2D(u_tex, uv - vec2(shift, 0.0)).b;
  float a = texture2D(u_tex, uv).a;

  vec3 col = vec3(r, g, b);
  col *= 0.9 + 0.1 * sin(v_uv.y * 800.0);
  col += (hash(v_uv.x * 91.7 + v_uv.y * 13.3 + t) - 0.5) * 0.08 * burst;

  gl_FragColor = vec4(col, a);
}
`;

/** Glass — cursor-tracking lens: magnify + refract + rim/specular highlight. */
export const GLASS_FRAG = /* glsl */ `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

const float RADIUS = 0.16;
const float MAG = 0.55;

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;
  vec2 d = (uv - u_mouse) * vec2(aspect, 1.0);
  float dist = length(d);

  vec3 col;
  if (dist < RADIUS) {
    float n = dist / RADIUS;
    float bulge = 1.0 - pow(1.0 - n, 2.0);
    vec2 refr = u_mouse + (uv - u_mouse) * mix(MAG, 1.0, bulge * bulge);
    col = texture2D(u_tex, refr).rgb;

    float rim = smoothstep(0.82, 1.0, n);
    col += rim * 0.35;
    vec2 hl = (uv - (u_mouse - vec2(0.05, 0.05))) * vec2(aspect, 1.0);
    float spec = smoothstep(0.06, 0.0, length(hl));
    col += spec * 0.5;
    col *= mix(1.0, 0.92, smoothstep(0.7, 1.0, n));
  } else {
    col = texture2D(u_tex, uv).rgb;
  }

  gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
}
`;

/** Ripple — click-triggered expanding wavefronts, event-driven. */
export const RIPPLE_FRAG = /* glsl */ `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_ripples[${MAX_RIPPLES}]; // xy = origin (UV), z = start time
uniform float u_lifetime;

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 disp = vec2(0.0);
  float highlight = 0.0;

  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec3 rp = u_ripples[i];
    float age = u_time - rp.z;
    if (age < 0.0 || age > u_lifetime) continue;

    vec2 dir = (v_uv - rp.xy) * vec2(aspect, 1.0);
    float dist = length(dir);
    float radius = age * 0.45;                 // wavefront expansion speed
    float band = dist - radius;
    float ring = exp(-band * band * 120.0);    // wider, softer ring
    float fade = 1.0 - age / u_lifetime;
    float wave = sin(band * 45.0) * ring * fade;

    disp += normalize(dir + 1e-6) * wave * 0.06;
    highlight += ring * fade * 0.5;
  }

  vec2 suv = v_uv + disp;
  vec4 tex = texture2D(u_tex, suv);
  gl_FragColor = vec4(tex.rgb + highlight, tex.a);
}
`;

/* ---------------------------------------------------------------------------
 * Fire — the first multi-pass, element-aware effect.
 *
 * The look is a power-up AURA, not a campfire: fuel is injected in an envelope
 * that hugs the whole silhouette of each button — sides and underneath included
 * — so the element sits *inside* the flame rather than beneath it. Clicking
 * charges the button through discrete tiers, each with its own colour and
 * features (gold, then white-gold with crackling arcs, then a blue-white core).
 *
 * Pass 1 (FIRE_SIM_FRAG) simulates the heat field into a ping-pong framebuffer;
 * pass 2 (FIRE_FRAG) composites it over the live element texture. Both address
 * individual DOM buttons through rounded-rect uniforms measured from real
 * getBoundingClientRect() boxes.
 * ------------------------------------------------------------------------- */

/** Maximum simultaneously burning elements (uniform array size). */
export const MAX_BURN = 4;

/** GLSL shared by both fire passes: hashing, value noise, fbm, rounded-box SDF. */
const FIRE_COMMON = /* glsl */ `
uniform vec4 u_burnRect[${MAX_BURN}];   // xy = min UV, zw = max UV (top-left origin)
// x = charge 0..1 (continuous: drives aura size / heat)
// y = tier 0..1 (quantised: drives colour + features, so transformations snap)
// z = click pop 0..1 (transient impulse)
uniform vec3 u_burnState[${MAX_BURN}];
uniform float u_burnRadius;             // corner radius, in units of canvas height

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 3 octaves: enough structure for licking flames, cheap enough to run several
// times per pixel at half resolution.
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 19.7; a *= 0.5; }
  return v;
}

// Signed distance to a rounded box centred at the origin. p and b are in
// aspect-corrected UV (x scaled by aspect), where both axes share the same
// unit — so a single scalar radius is correct.
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

// The shared quad vertex shader flips Y when deriving v_uv, so a pass rendered
// through it stores the value for v_uv at texture row (1 - v_uv.y). Every read
// of the heat field must undo that, or the field comes back mirrored (and the
// advection runs the wrong way).
vec2 fieldUV(vec2 uv) { return vec2(uv.x, 1.0 - uv.y); }
`;

/**
 * Fire pass 1 — the heat field simulation.
 * Channels: R = heat, G = fuel, B = soot, A = 1.
 */
export const FIRE_SIM_FRAG = /* glsl */ `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_prev;    // previous state (texture unit 1)
uniform vec2 u_resolution;   // SIM target size, in px
uniform float u_time;
uniform float u_dt;
${FIRE_COMMON}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float dt = clamp(u_dt, 0.0, 0.05);
  vec2 ap = vec2(v_uv.x * aspect, v_uv.y);   // isotropic UV, unit = canvas height

  // --- 1. advect upward with turbulence ----------------------------------
  // v_uv.y grows DOWNWARD, so the parcel now here came from LARGER y.
  vec2 turb = vec2(
    fbm(ap * 5.5 + vec2(0.0, -u_time * 1.6)) - 0.5,
    fbm(ap * 5.0 + vec2(4.7, -u_time * 1.05)) - 0.5);
  // Strong lateral turbulence: without it the aura advects straight up and
  // reads as a rectangular beam rather than a flame that tapers and licks.
  vec2 vel = vec2(turb.x * 0.78, 0.62 + turb.y * 0.26);
  vec4 prev = texture2D(u_prev, fieldUV(v_uv + vel * dt));

  float heat = prev.r;
  float fuel = prev.g;
  float soot = prev.b;

  // --- 2. inject fuel in an aura envelope around each element -------------
  float inject = 0.0;
  float injTier = 0.0;
  for (int i = 0; i < ${MAX_BURN}; i++) {
    vec3 st = u_burnState[i];
    float charge = st.x;
    float amt = charge + st.z * 0.55;           // sustained charge + click pop
    if (amt <= 0.004) continue;

    vec4 r = u_burnRect[i];
    vec2 c = (r.xy + r.zw) * 0.5;
    vec2 h = (r.zw - r.xy) * 0.5;
    vec2 p = vec2((v_uv.x - c.x) * aspect, v_uv.y - c.y);
    vec2 b = vec2(h.x * aspect, h.y);
    float rad = min(u_burnRadius, min(b.x, b.y));
    float d = sdRoundBox(p, b, rad);

    // The envelope: a band that hugs the silhouette on BOTH sides (d is
    // signed, d*d is not) so the element ends up inside the flame rather than
    // under it. It widens with charge — that is most of the "powering up" read.
    float w = mix(0.008, 0.030, charge);
    float band = exp(-(d * d) / (w * w));

    // Interior fill only really arrives at high tiers, so low tiers stay
    // readable and max tier genuinely engulfs the label.
    float core = smoothstep(0.005, -0.012, d) * charge * charge * 0.18;

    // Feed mainly from below: fuel introduced under the box streams up through
    // and around it, which is what makes an aura wrap instead of just outline.
    float tyRaw = (v_uv.y - r.y) / max(r.w - r.y, 1e-4);   // 0 top, 1 bottom
    float below = smoothstep(-0.25, 1.15, tyRaw);
    float feed = 0.5 + 0.95 * below;

    // Track which element wins this pixel so its tier can be tagged onto the
    // gas below — a compare rather than max(), since we need the paired tier.
    float contrib = amt * (band * feed * 0.85 + core);
    if (contrib > inject) { inject = contrib; injTier = st.y; }
  }
  // Break the emitter up — but less aggressively than a campfire, since an aura
  // reads as a coherent sheet with licks rather than separate tongues.
  float flick = fbm(ap * 19.0 + vec2(0.0, -u_time * 4.0));
  fuel = max(fuel, inject * (0.55 + 0.85 * smoothstep(0.15, 0.8, flick)));

  // --- 3. combustion: fuel -> heat + soot ---------------------------------
  float burned = fuel * clamp(6.5 * dt, 0.0, 1.0);
  fuel -= burned;
  heat += burned * 3.0;
  soot += burned * 0.4;

  // --- 4. cooling ---------------------------------------------------------
  // Cool hard: bilinear advection is diffusive, so long-lived heat smears into
  // blobs. A short lifetime plus a fast rise keeps the visible flame made of
  // freshly injected — and therefore still structured — gas.
  // The additive floor matters too: a purely multiplicative decay quantises to
  // a stall point near 1/255 in an 8-bit target and leaves ghost trails.
  heat *= exp(-4.2 * dt);
  heat -= 0.70 * dt;
  soot *= exp(-2.6 * dt);
  soot -= 0.25 * dt;
  fuel *= exp(-4.5 * dt);

  // --- 5. tier tag, carried by the gas ------------------------------------
  // Alpha stores the tier of whichever element emitted this parcel, and it
  // advects with everything else. Picking the tier per-pixel from the *nearest*
  // element instead would put a hard seam down the midpoint between two
  // buttons, because tier would jump discontinuously across that boundary.
  // Tagging the gas means the colour simply travels with the flame.
  float tag = mix(prev.a, injTier, clamp(inject * 5.0, 0.0, 1.0));

  // --- 6. dither: turn 8-bit quantisation into flicker, not banding -------
  float dith = (hash21(v_uv * u_resolution + u_time * 61.0) - 0.5) / 255.0;

  gl_FragColor = vec4(
    clamp(heat + dith, 0.0, 1.0),
    clamp(fuel + dith, 0.0, 1.0),
    clamp(soot + dith, 0.0, 1.0),
    clamp(tag, 0.0, 1.0));
}
`;

/** Fire pass 2 — composite the heat field over the live element. */
export const FIRE_FRAG = /* glsl */ `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;    // live element (unit 0)
uniform sampler2D u_heat;   // simulated field (unit 1)
uniform vec2 u_resolution;
uniform float u_time;
${FIRE_COMMON}

// black -> deep red -> orange -> yellow -> white
vec3 fireRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.0), vec3(0.42, 0.04, 0.01), smoothstep(0.00, 0.22, t));
  c = mix(c, vec3(1.00, 0.28, 0.02), smoothstep(0.18, 0.48, t));
  c = mix(c, vec3(1.00, 0.76, 0.18), smoothstep(0.44, 0.76, t));
  c = mix(c, vec3(1.00, 0.97, 0.86), smoothstep(0.74, 1.00, t));
  return c;
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 texel = 1.0 / u_resolution;
  vec2 ap = vec2(v_uv.x * aspect, v_uv.y);

  // Jitter the field lookup to hide bilinear diamonds from the half-res upsample.
  vec2 jit = (vec2(hash21(v_uv * u_resolution), hash21(v_uv * u_resolution + 7.3)) - 0.5)
           * texel * 1.5;
  vec4 H = texture2D(u_heat, fieldUV(v_uv + jit));

  // Heat-haze: hot air bends what's behind it. Offsets are in v_uv space and
  // fieldUV maps them into the field, so hg stays a v_uv-space gradient.
  float hL = texture2D(u_heat, fieldUV(v_uv - vec2(texel.x, 0.0))).r;
  float hR = texture2D(u_heat, fieldUV(v_uv + vec2(texel.x, 0.0))).r;
  float hU = texture2D(u_heat, fieldUV(v_uv - vec2(0.0, texel.y))).r;
  float hD = texture2D(u_heat, fieldUV(v_uv + vec2(0.0, texel.y))).r;
  vec2 hg = vec2(hR - hL, hD - hU);
  vec2 uv = v_uv + hg * 0.018 * smoothstep(0.02, 0.5, H.r);

  vec4 src = texture2D(u_tex, uv);
  vec3 col = src.rgb;

  // The aura's tier travels with the gas (see the sim's alpha channel), so the
  // colour is continuous everywhere — no seam between neighbouring buttons.
  float tier = H.a;

  // Rim and arcs are element-local: both fall off within a few thousandths of
  // a UV unit, far tighter than the gap between buttons, so taking the max
  // across elements introduces no visible discontinuity.
  float rim = 0.0;
  float arc = 0.0;
  float n1 = fbm(ap * 15.0 + vec2(0.0, -u_time * 2.2));
  float n2 = fbm(ap * 33.0 + vec2(7.1, -u_time * 3.9));
  float s1 = step(0.42, hash21(vec2(floor(u_time * 23.0), 3.7)));
  float s2 = step(0.58, hash21(vec2(floor(u_time * 17.0), 9.1)));

  for (int i = 0; i < ${MAX_BURN}; i++) {
    vec3 st = u_burnState[i];
    if (st.x <= 0.002) continue;
    vec4 r = u_burnRect[i];
    vec2 c = (r.xy + r.zw) * 0.5;
    vec2 h = (r.zw - r.xy) * 0.5;
    vec2 p = vec2((v_uv.x - c.x) * aspect, v_uv.y - c.y);
    vec2 b = vec2(h.x * aspect, h.y);
    float rad = min(u_burnRadius, min(b.x, b.y));
    float d = sdRoundBox(p, b, rad);

    rim = max(rim, st.x * exp(-d * d * 11000.0));

    // Crackling arcs from tier 3: wobble the distance field with noise and draw
    // thin contours where it crosses zero, strobed on and off by a hash so they
    // read as electricity rather than as a static ring.
    float aAmt = smoothstep(0.45, 0.8, st.y);
    if (aAmt > 0.001) {
      // Offset the contours OUTSIDE the silhouette: drawn on the outline they
      // land inside the white-hot core and are invisible. Out here they cross
      // the dark fringe and read as discharges leaving the element.
      float dw = d - 0.032 + (n1 - 0.5) * 0.095 + (n2 - 0.5) * 0.035;
      arc = max(arc, aAmt * (exp(-dw * dw * 7000.0) * s1
                           + exp(-(dw - 0.038) * (dw - 0.038) * 9000.0) * s2 * 0.7));
    }
  }

  col *= mix(1.0, 0.72, clamp(H.b * 1.4, 0.0, 1.0));   // soot absorbs

  // Everything emissive accumulates here and is tone-mapped once at the end.
  // Adding these straight to the colour clips them to flat white, which
  // destroys what distinguishes the tiers: hue and internal structure.
  vec3 emis = vec3(0.0);

  // --- the aura, coloured by tier -----------------------------------------
  // Higher tiers push the ramp hotter, then tint it: gold at mid tiers, a
  // blue-white core at the peak. Tinting multiplicatively (rather than mixing
  // toward a flat colour) keeps the ramp's structure legible.
  vec3 flame = fireRamp(H.r * (1.0 + tier * 0.45)) * (0.85 + 0.5 * H.r);
  flame *= mix(vec3(1.0), vec3(1.0, 0.88, 0.40), smoothstep(0.2, 0.55, tier));
  // Peak tier runs blue-white at the core. Mix toward the colour rather than
  // multiplying by it: multiplying a warm flame by a cyan tint zeroes red
  // before it can raise blue, which reads as olive green.
  flame = mix(flame, vec3(0.55, 0.80, 1.0) * (0.9 + 0.6 * H.r),
              smoothstep(0.55, 1.0, H.r) * smoothstep(0.68, 1.0, tier) * 0.85);
  emis += flame;

  // Rim: the element's own outline running hot, whitening with tier.
  emis += mix(vec3(1.0, 0.42, 0.10), vec3(1.0, 0.93, 0.72), tier) * rim * (0.42 + 0.7 * tier);
  emis += vec3(0.72, 0.90, 1.0) * arc * 2.6;

  // Embers: sparse cells drifting up, gated by local heat.
  vec2 gp = ap * 95.0 + vec2(0.0, -u_time * 5.0);
  float rnd = hash21(floor(gp));
  float spark = step(0.986, rnd)
              * smoothstep(0.34, 0.0, length(fract(gp) - 0.5))
              * (0.45 + 0.55 * sin(u_time * 26.0 + rnd * 51.0))
              * smoothstep(0.04, 0.28, H.r);
  emis += mix(vec3(1.0, 0.62, 0.22), vec3(0.85, 0.95, 1.0), tier) * spark * 1.8;

  // Filmic-ish exposure: compresses the highlights so the core keeps its hue
  // instead of saturating, while leaving low values essentially linear.
  col += 1.0 - exp(-emis * 1.3);

  // Keep the card opaque, but let flames and embers extend past its box.
  float fireA = smoothstep(0.015, 0.22, H.r) + spark;
  gl_FragColor = vec4(col, clamp(max(src.a, fireA), 0.0, 1.0));
}
`;

/** Registry used by the shader self-test. */
export const ALL_SHADERS: { name: string; frag: string }[] = [
  { name: 'Dither', frag: DITHER_FRAG },
  { name: 'Glitch', frag: GLITCH_FRAG },
  { name: 'Glass', frag: GLASS_FRAG },
  { name: 'Ripple', frag: RIPPLE_FRAG },
  { name: 'Fire', frag: FIRE_FRAG },
  { name: 'Fire Sim', frag: FIRE_SIM_FRAG },
];
