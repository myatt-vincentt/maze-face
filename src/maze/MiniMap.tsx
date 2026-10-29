// A small live camera picture in the top-right corner, folded away by
// default: only a tiny wordless glass pill with a camera glyph shows. Tap it
// and the picture unfolds from the corner (a short ease-out scale and fade);
// tap the picture or the pill to fold it back. The picture is mirrored like
// the drawing, with the person's outline traced faintly on it, thin rounded
// corners, a hairline grey edge and the faintest shadow, so it sits quietly
// on the paper. It only reads the camera and the mask: the drawing never
// sees it. Folded or not is remembered while the page is open.
//
// The pill and the tap area are DOM (they lay out the corner, safe areas
// included); the picture is drawn on the canvas into the tap area's box.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector4,
  type Texture,
} from "three";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useXRCameraTexture } from "@vincentt-xr/sdk/low-level";

import { mazeState } from "./state";

const MINI = {
  /** Width as a share of the screen's width, and its limits (CSS px). */
  share: 0.22,
  min: 72,
  max: 300,
  /** Corner radius (CSS px). */
  radius: 10,
  /** Unfold and fold times (s). */
  open: 0.24,
  close: 0.18,
  renderOrder: 1400,
};

/** Folded or not, for as long as the page is open. */
let remembered = false;

const vert = /* glsl */ `
  uniform vec4 uBox;            // the drawn area (screen uv, y up): x0, y0, x1, y1
  varying vec2 vUv;
  void main() {
    vec2 p = mix(uBox.xy, uBox.zw, uv);
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform vec4 uRect;           // the picture, device pixels (y up)
  uniform vec2 uRes;
  uniform float uRadius;
  uniform float uDpr;
  uniform float uShow;
  uniform sampler2D uCam;
  uniform float uCamLinear;
  uniform sampler2D uMask;
  uniform float uHasMask;
  varying vec2 vUv;

  float box(vec2 p, vec2 c, vec2 h, float r) {
    vec2 q = abs(p - c) - h + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 px = vUv * uRes;
    vec2 c = (uRect.xy + uRect.zw) * 0.5;
    vec2 h = (uRect.zw - uRect.xy) * 0.5;
    float d = box(px, c, h, uRadius);
    vec2 t = clamp((px - uRect.xy) / max(uRect.zw - uRect.xy, vec2(1.0)), 0.0, 1.0);
    vec3 cam = texture2D(uCam, t).rgb;
    if (uCamLinear > 0.5) cam = pow(max(cam, vec3(0.0)), vec3(1.0 / 2.2));
    if (uHasMask > 0.5) {
      float m = texture2D(uMask, t).r;
      float line = 1.0 - smoothstep(0.5 * uDpr, 0.5 * uDpr + 1.0, abs(m - 0.5) / max(fwidth(m), 1e-4));
      cam = mix(cam, vec3(1.0), line * 0.7);
    }
    float inside = 1.0 - smoothstep(-0.5, 0.5, d);
    // The hairline edge, one device pixel just inside.
    float edge = (1.0 - smoothstep(0.4 * uDpr, 0.4 * uDpr + 1.0, abs(d + 0.5 * uDpr))) * inside;
    vec3 col = mix(cam, vec3(0.45), edge * 0.45);
    // The faintest shadow, a little below.
    float sd = box(px + vec2(0.0, 3.0 * uDpr), c, h, uRadius);
    float shadow = (1.0 - smoothstep(-2.0 * uDpr, 14.0 * uDpr, sd)) * 0.1 * (1.0 - inside);
    float a = max(inside, shadow) * uShow;
    gl_FragColor = vec4(col * inside * uShow, a);
  }
`;

const CSS = `
.mf-mini { position: absolute; inset: 0; pointer-events: none;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
.mf-pill { position: absolute; pointer-events: auto; border: 0; padding: 0; margin: 0;
  top: calc(env(safe-area-inset-top) + 14px); right: calc(env(safe-area-inset-right) + 14px);
  width: 32px; height: 32px; border-radius: 999px; display: grid; place-items: center;
  color: rgb(255 255 255 / .92); cursor: pointer; outline: none; touch-action: manipulation;
  background: rgb(35 37 40 / .64);
  backdrop-filter: blur(20px) saturate(1.5); -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgb(235 246 253 / .18);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / .22), 0 4px 12px rgb(0 0 0 / .14);
  transition: transform 160ms ease-out, opacity 160ms ease-out; }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .mf-pill { background: rgb(35 37 40 / .82); } }
.mf-pill:active { transform: scale(0.94); }
.mf-pill.on { opacity: .78; }
.mf-hit { position: absolute; pointer-events: none; border: 0; padding: 0; margin: 0;
  background: transparent; cursor: pointer; outline: none; touch-action: manipulation;
  top: calc(env(safe-area-inset-top) + 54px); right: calc(env(safe-area-inset-right) + 14px); }
.mf-hit.on { pointer-events: auto; }
@media (prefers-reduced-motion: reduce) { .mf-pill:active { transform: none; } }
`;

const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

export const MiniMap = () => {
  const cameraTexture = useXRCameraTexture();
  const [open, setOpen] = useState(remembered);
  const [aspect, setAspect] = useState(1);
  const hit = useRef<HTMLButtonElement>(null);
  const anim = useMemo(() => ({ k: remembered ? 1 : 0 }), []);

  useEffect(() => {
    remembered = open;
  }, [open]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uBox: { value: new Vector4() },
          uRect: { value: new Vector4() },
          uRes: { value: new Vector2(1, 1) },
          uRadius: { value: 10 },
          uDpr: { value: 1 },
          uShow: { value: 0 },
          uCam: { value: null as Texture | null },
          uCamLinear: { value: 0 },
          uMask: { value: null as Texture | null },
          uHasMask: { value: 0 },
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const { width, height } = state.size;
    const a = width / Math.max(1, height);
    if (Math.abs(a - aspect) > 0.01) setAspect(a);
    // Strict ease-out both ways: unfolding and folding.
    const target = open ? 1 : 0;
    if (anim.k !== target) {
      const step = dt / (open ? MINI.open : MINI.close);
      anim.k = open ? Math.min(1, anim.k + step) : Math.max(0, anim.k - step);
    }
    const u = material.uniforms;
    const k = open ? easeOut(anim.k) : 1 - easeOut(1 - anim.k);
    u.uShow.value = k;
    const el = hit.current;
    if (!el || !cameraTexture || k <= 0.001) {
      u.uShow.value = 0;
      return;
    }
    // The tap area's box, shrunk toward the top-right corner while folding.
    const canvas = state.gl.domElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const s = 0.6 + 0.4 * k;
    const x1 = r.right - canvas.left;
    const y0 = r.top - canvas.top;
    const x0 = x1 - r.width * s;
    const y1 = y0 + r.height * s;
    const dpr = state.gl.getPixelRatio();
    const W = width * dpr;
    const H = height * dpr;
    u.uRes.value.set(W, H);
    u.uDpr.value = dpr;
    u.uRadius.value = MINI.radius * dpr * s;
    // Device pixels, y up.
    u.uRect.value.set(x0 * dpr, H - y1 * dpr, x1 * dpr, H - y0 * dpr);
    const m = 20; // room for the shadow (CSS px)
    u.uBox.value.set(
      (x0 - m) / width,
      1 - (y1 + m) / height,
      (x1 + m) / width,
      1 - (y0 - m) / height,
    );
    u.uCam.value = cameraTexture;
    u.uCamLinear.value = cameraTexture.colorSpace === SRGBColorSpace ? 1 : 0;
    const mask = mazeState.targets.mask?.texture ?? null;
    u.uMask.value = mask;
    u.uHasMask.value = mask ? 1 : 0;
  });

  const w = `clamp(${MINI.min}px, ${MINI.share * 100}vw, ${MINI.max}px)`;
  return (
    <>
      <mesh
        name="mini-map"
        material={material}
        renderOrder={MINI.renderOrder}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1, 1, 1]} />
      </mesh>
      <Html fullscreen zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <style>{CSS}</style>
        <div className="mf-mini">
          <button
            type="button"
            className={`mf-pill${open ? " on" : ""}`}
            aria-label={open ? "Hide the camera" : "Show the camera"}
            aria-pressed={open}
            onClick={() => setOpen((o) => !o)}
          >
            <svg
              viewBox="0 0 24 24"
              width={16}
              height={16}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
              <circle cx="12" cy="13" r="3.3" />
            </svg>
          </button>
          <button
            ref={hit}
            type="button"
            tabIndex={open ? 0 : -1}
            className={`mf-hit${open ? " on" : ""}`}
            aria-label="Hide the camera"
            aria-hidden={!open}
            style={{ width: w, height: `calc(${w} / ${aspect.toFixed(4)})` }}
            onClick={() => setOpen(false)}
          />
        </div>
      </Html>
    </>
  );
};
