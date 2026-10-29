// GLSL for the drawing. Every pass is a full-screen quad; positions are
// screen uv (0..1, y up), the same as the camera picture and the person mask,
// and distances are in screen heights (x scaled by the aspect ratio).
//
//   person  the person mask, held steady (half the screen's size)
//   lum     the camera's brightness, small, with mipmaps (for the local average)
//   tone    tone (0 dark .. 1 light) that follows the camera with a little
//           lag, and motion (frame-to-frame change), at the simulation's size
//   field   per texel: alive (person and grown), pattern scale, motion, sowing
//   rd      the reaction-diffusion step, run several times a frame
//   paper   the lines on paper, on screen

const NOISE = /* glsl */ `
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
`;

/**
 * The growing blob: everything within `uRadius` of the seed (the face), its
 * edge wobbling so it reads as an organic blob rather than a circle.
 */
const GROWTH = /* glsl */ `
  uniform vec2 uSeed;
  uniform float uRadius;
  uniform float uWobble;
  uniform float uAspect;
  float reachAt(vec2 uv) {
    vec2 d = (uv - uSeed) * vec2(uAspect, 1.0);
    vec2 p = uv * vec2(uAspect, 1.0);
    float w = noise(p * 3.0 + 7.3) * 0.65 + noise(p * 7.0 + 1.7) * 0.35 - 0.5;
    return uRadius * (1.0 + 2.0 * uWobble * w) - length(d);
  }
`;

/** Plain full-screen quad. */
export const flatVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

/** Copies a texture (used when the simulation changes size). */
export const copyFrag = /* glsl */ `
  uniform sampler2D uSrc;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(uSrc, vUv); }
`;

/**
 * The person, held steady: the portrait mask, trusted only around the
 * tracked face and the body below it (so bits of the room never show up as
 * islands), then held with a little hysteresis and blended over a few frames
 * so the outline never flickers.
 */
export const personFrag = /* glsl */ `
  uniform sampler2D uRaw;
  uniform float uHasRaw;
  uniform vec2 uRawTexel;
  uniform sampler2D uPrev;
  uniform float uFresh;
  uniform float uBlend;
  uniform float uAspect;
  uniform vec4 uFace;           // centre x, y (uv), width, height (uv); width 0 = none
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * vec2(uAspect, 1.0);
    float gate = 0.0;
    if (uFace.z > 0.0) {
      vec2 c = uFace.xy * vec2(uAspect, 1.0);
      float w = uFace.z * uAspect;
      float h = uFace.w;
      // The head (with room for hair) ...
      vec2 hd = (p - (c + vec2(0.0, 0.18 * h))) / vec2(1.15 * w, 1.25 * h);
      gate = max(gate, 1.0 - smoothstep(0.85, 1.15, length(hd)));
      // ... and the body, widening below the chin.
      float chin = c.y - 0.45 * h;
      float down = clamp((chin - p.y) / (1.4 * h), 0.0, 1.0);
      float hw = w * (0.8 + 3.2 * down);
      float body = (1.0 - smoothstep(hw * 0.9, hw * 1.2, abs(p.x - c.x)))
        * (1.0 - smoothstep(chin - 0.1 * h, chin + 0.3 * h, p.y));
      gate = max(gate, body);
    }
    float m = 0.0;
    if (uHasRaw > 0.5) {
      m = texture2D(uRaw, vUv).g * 0.4;
      for (int k = 0; k < 6; k++) {
        float a = float(k) * 1.0472;
        m += texture2D(uRaw, vUv + vec2(cos(a), sin(a)) * uRawTexel * 2.0).g * 0.1;
      }
    }
    float target = m * gate;
    float prev = texture2D(uPrev, vUv).r;
    float thr = prev > 0.5 ? 0.35 : 0.6;
    float bin = smoothstep(thr - 0.15, thr + 0.15, target);
    float k = uFresh > 0.5 ? 1.0 : uBlend;
    float v = mix(prev, bin, k);
    gl_FragColor = vec4(v, v, v, 1.0);
  }
`;

const LUMA = /* glsl */ `
  uniform sampler2D uCam;
  uniform float uCamLinear;
  float lumAt(vec2 uv) {
    vec3 c = texture2D(uCam, uv).rgb;
    if (uCamLinear > 0.5) c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
    return dot(c, vec3(0.299, 0.587, 0.114));
  }
`;

/** The camera's brightness, small; its mipmaps give the local average. */
export const lumFrag = /* glsl */ `
  ${LUMA}
  varying vec2 vUv;
  void main() {
    float l = lumAt(vUv);
    gl_FragColor = vec4(l, l, l, 1.0);
  }
`;

/**
 * Tone and motion. Tone is the brightness against the area around it (so the
 * hair stays dark and the skin light in any light), following the camera with
 * a little lag. Motion is how much the picture changed since last frame,
 * held and fading slowly.
 *   r: tone (smoothed)   g: this frame's brightness   b: motion
 */
export const toneFrag = /* glsl */ `
  ${LUMA}
  uniform sampler2D uLum;
  uniform sampler2D uPrev;
  uniform float uFresh;
  uniform vec2 uTexel;
  uniform float uDetail;
  uniform float uArea;
  uniform float uFollow;
  uniform float uFloor;
  uniform float uGain;
  uniform float uDecay;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel * 1.5;
    float l = (lumAt(vUv) * 2.0 + lumAt(vUv + vec2(o.x, 0.0)) + lumAt(vUv - vec2(o.x, 0.0))
      + lumAt(vUv + vec2(0.0, o.y)) + lumAt(vUv - vec2(0.0, o.y))) / 6.0;
    float area = texture2D(uLum, vUv, 4.0).r;
    float t = clamp(0.5 + (l - area) * uDetail + (area - 0.5) * uArea, 0.0, 1.0);
    vec4 prev = texture2D(uPrev, vUv);
    if (uFresh > 0.5) { gl_FragColor = vec4(t, l, 0.0, 1.0); return; }
    float change = clamp((abs(l - prev.g) - uFloor) * uGain, 0.0, 1.0);
    float motion = max(prev.b * uDecay, change);
    gl_FragColor = vec4(mix(prev.r, t, uFollow), l, motion, 1.0);
  }
`;

/**
 * How much of the picture is the person (one texel): r now, g a reference
 * that rises quickly and sinks slowly. Now far below the reference means the
 * person just vanished.
 */
export const presenceFrag = /* glsl */ `
  uniform sampler2D uMask;
  uniform sampler2D uPrev;
  uniform float uFresh;
  uniform float uDown;
  varying vec2 vUv;
  void main() {
    float now = texture2D(uMask, vec2(0.5), 12.0).r;
    float ref = texture2D(uPrev, vec2(0.5)).g;
    ref = uFresh > 0.5 ? now : (now > ref ? mix(ref, now, 0.5) : mix(ref, now, uDown));
    gl_FragColor = vec4(now, ref, 0.0, 1.0);
  }
`;

/**
 * What each texel of the simulation does this frame:
 *   r: alive (the person, where the growth has reached)
 *   g: the pattern's scale (neighbour distance / 4)
 *   b: motion (0 still .. 1 moving fast)
 *   a: sowing (the band just inside the growing edge)
 */
export const fieldFrag = /* glsl */ `
  ${NOISE}
  ${GROWTH}
  uniform sampler2D uTone;
  uniform sampler2D uMask;
  uniform vec3 uRing;           // darkest, lightest, while moving
  uniform float uSpacing;
  uniform float uFake;          // pretend motion everywhere (development)
  uniform float uBand;
  varying vec2 vUv;
  void main() {
    vec3 tone = texture2D(uTone, vUv).rgb;
    float person = smoothstep(0.25, 0.75, texture2D(uMask, vUv).r);
    float reach = reachAt(vUv);
    float grown = smoothstep(-0.002, 0.002, reach);
    float alive = person * grown;
    float motion = max(smoothstep(0.1, 0.6, tone.b), uFake) * person;
    float t = pow(smoothstep(0.3, 0.78, tone.r), 1.3);
    float ring = mix(uRing.x, uRing.y, t);
    ring = mix(ring, uRing.z, motion) * uSpacing;
    float sow = grown * (1.0 - smoothstep(0.0, uBand, reach));
    gl_FragColor = vec4(alive, ring / 4.0, motion, sow);
  }
`;

/**
 * One Gray-Scott step (u, v). Each texel diffuses toward its neighbours
 * `ring` texels away (the far ring sets the pattern's scale), plus a little
 * toward its next-door neighbours (so the finest ripples always settle).
 * Outside the person the page is forced blank (u 1, v 0), so the lines end
 * cleanly at the silhouette. New lines are sown just inside the growing
 * edge; where the person moves fast, random sparks loosen the pattern.
 *   r: u   g: v   b: alive (the person, where the growth has reached)
 */
export const rdFrag = /* glsl */ `
  ${NOISE}
  uniform sampler2D uPrev;
  uniform sampler2D uField;
  uniform sampler2D uPresence;
  uniform vec2 uTexel;
  uniform float uFresh;
  uniform float uStep;
  uniform float uFeed;
  uniform float uKill;
  uniform float uDu;
  uniform float uDv;
  uniform float uNear;
  varying vec2 vUv;

  void main() {
    if (uFresh > 0.5) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
    // The person is suddenly gone (they walked out, or the camera was
    // covered): hold the drawing as it is, so it can fade rather than vanish.
    vec2 presence = texture2D(uPresence, vec2(0.5)).rg;
    if (presence.g > 0.02 && presence.r < 0.55 * presence.g) {
      gl_FragColor = texture2D(uPrev, vUv);
      return;
    }
    vec4 f = texture2D(uField, vUv);
    if (f.r < 0.5) { gl_FragColor = vec4(1.0, 0.0, f.r, 1.0); return; }
    vec2 s = texture2D(uPrev, vUv).rg;
    vec2 o = uTexel * f.g * 4.0;
    vec2 far =
      0.2 * (texture2D(uPrev, vUv + vec2(o.x, 0.0)).rg + texture2D(uPrev, vUv - vec2(o.x, 0.0)).rg
           + texture2D(uPrev, vUv + vec2(0.0, o.y)).rg + texture2D(uPrev, vUv - vec2(0.0, o.y)).rg)
      + 0.05 * (texture2D(uPrev, vUv + o).rg + texture2D(uPrev, vUv - o).rg
           + texture2D(uPrev, vUv + vec2(o.x, -o.y)).rg + texture2D(uPrev, vUv + vec2(-o.x, o.y)).rg)
      - s;
    vec2 near = 0.25 * (texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).rg
      + texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).rg
      + texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).rg
      + texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).rg) - s;
    vec2 lap = far + uNear * near;
    float u = s.r, v = s.g;
    float uvv = u * v * v;
    u += uDu * lap.x - uvv + uFeed * (1.0 - u);
    v += uDv * lap.y + uvv - (uFeed + uKill) * v;
    // Sow new lines just inside the growing edge: small round drops in some
    // cells of a grid as fine as the pattern is there, wherever the page is
    // still empty, so the lines start out at the right spacing.
    vec2 texel = vUv / uTexel;
    float size = floor((6.0 + 7.0 * f.g * 4.0) * 0.5 + 0.5) * 2.0;
    vec2 cell = floor(texel / size);
    vec2 inCell = fract(texel / size) * size - size * 0.5;
    float drop = 1.0 - step(max(1.6, size * 0.2), length(inCell));
    if (v < 0.1 && f.a > 0.3 && hash(cell + size * 3.1) > 0.45 && drop > 0.5) { u = 0.25; v = 0.5; }
    // Moving fast: drops land now and then, dissolving the lines into
    // loose loops.
    if (f.b > 0.05 && mod(uStep, 24.0) < 0.5
      && hash(cell + floor(uStep / 24.0) * 0.137) > 1.0 - 0.12 * f.b && drop > 0.5) {
      u = 0.25; v = 0.5;
    }
    gl_FragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), f.r, 1.0);
  }
`;

/**
 * The page: warm paper with a faint grain, and the lines drawn where the
 * simulation crosses one level, always the same width on screen (the
 * distance to that level is measured in screen pixels), anti-aliased. The
 * simulation is read through a smooth cubic filter so the lines stay round.
 * A thin outline traces the person where the drawing has reached.
 */
export const paperFrag = /* glsl */ `
  ${NOISE}
  ${GROWTH}
  uniform sampler2D uState;
  uniform vec2 uStateSize;
  uniform float uInk;
  uniform float uHalf;
  uniform float uLevel;
  uniform vec3 uPaper;
  uniform vec3 uInkColor;
  uniform sampler2D uCam;
  uniform float uShowCam;
  uniform sampler2D uField;
  varying vec2 vUv;

  vec4 cubic(float x) {
    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - x;
    vec4 s = n * n * n;
    float a = s.x;
    float b = s.y - 4.0 * s.x;
    float c = s.z - 4.0 * s.y + 6.0 * s.x;
    float d = 6.0 - a - b - c;
    return vec4(a, b, c, d) * (1.0 / 6.0);
  }
  // A smooth (cubic B-spline) read of a texture, from four linear reads.
  vec4 smoothRead(sampler2D t, vec2 uv, vec2 size) {
    vec2 st = uv * size - 0.5;
    vec2 fxy = fract(st);
    st -= fxy;
    vec4 xc = cubic(fxy.x);
    vec4 yc = cubic(fxy.y);
    vec4 c = st.xxyy + vec2(-0.5, 1.5).xyxy;
    vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
    vec4 off = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
    vec4 s0 = texture2D(t, off.xz);
    vec4 s1 = texture2D(t, off.yz);
    vec4 s2 = texture2D(t, off.xw);
    vec4 s3 = texture2D(t, off.yw);
    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);
    return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
  }
  uniform float uPxPerTexel;
  // Coverage of a line where f crosses level, half-width uHalf screen pixels.
  // The slope is capped at what a smooth line can have, so a sudden step
  // (the page's edge) still draws one line of the same width, not a smear.
  float lineAt(float f, float level) {
    float g = min(length(vec2(dFdx(f), dFdy(f))), 0.12 / uPxPerTexel);
    float d = abs(f - level) / max(g, 1e-6);
    return 1.0 - smoothstep(uHalf - 0.75, uHalf + 0.75, d);
  }

  void main() {
    vec4 st = smoothRead(uState, vUv, uStateSize);
    float ink = lineAt(st.g, uLevel);
    // The outline: the edge of the drawn person, but not the growing edge.
    float edge = lineAt(st.b, 0.5) * smoothstep(0.006, 0.016, reachAt(vUv));
    ink = max(ink, edge) * uInk;

    vec2 px = gl_FragCoord.xy;
    vec2 p = vUv * vec2(uAspect, 1.0);
    float grain = (hash(px) - 0.5) * 0.018 + (noise(p * 90.0) - 0.5) * 0.02
      + (noise(p * 6.0) - 0.5) * 0.015;
    vec3 paper = uPaper + grain;
    if (uShowCam > 1.5) {
      // Development: the pattern's scale (dark = tight) and motion (red).
      vec4 f = texture2D(uField, vUv);
      float scale = clamp((f.g * 4.0 - 0.5) / 2.5, 0.0, 1.0);
      gl_FragColor = vec4(mix(vec3(scale), vec3(1.0, 0.1, 0.1), f.b * 0.7) * mix(0.35, 1.0, f.r), 1.0);
      return;
    }
    if (uShowCam > 0.5) paper *= mix(vec3(1.0), texture2D(uCam, vUv).rgb, 0.55);
    gl_FragColor = vec4(mix(paper, uInkColor, ink), 1.0);
  }
`;
