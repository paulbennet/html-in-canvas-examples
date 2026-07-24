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

/** Registry used by the shader self-test. */
export const ALL_SHADERS: { name: string; frag: string }[] = [
  { name: 'Dither', frag: DITHER_FRAG },
  { name: 'Glitch', frag: GLITCH_FRAG },
  { name: 'Glass', frag: GLASS_FRAG },
  { name: 'Ripple', frag: RIPPLE_FRAG },
];
