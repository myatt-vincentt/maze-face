// Maze Face: you, drawn live as one winding maze line on white paper. The
// page starts blank; when a face shows, the line seeds at the face and grows
// out through the person until the whole portrait is drawn. Tone comes only
// from the spacing of the lines: tight in the dark (hair, shadows), wide open
// loops in the light (skin, light clothes). It re-forms with a little lag as
// you move; move fast and it dissolves into loose loops, hold still and it
// sharpens again. Leave, and it fades back to a blank page.
//
// The lines are a reaction-diffusion simulation (Gray-Scott, in its labyrinth
// regime) run on the GPU several steps a frame, its scale set by the camera's
// tone and kept to the person by the steadied person mask (shaders.ts). The
// camera picture itself is never shown.
//
//   renderOrder -998  paper  — the page and the lines, covering the camera
//   renderOrder 1400  mini   — the folded-away camera picture (MiniMap.tsx)
//   renderOrder 1500  hint   — the ghost face (Hint.tsx)
import { Suspense, useEffect, useMemo } from "react";
import {
  FloatType,
  HalfFloatType,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { usePersonMaskTexture } from "@vincentt-xr/sdk";
import { useXRCameraTexture } from "@vincentt-xr/sdk/low-level";
import { useFaceInfo } from "@vincentt-xr/sdk/tracking";

import {
  FACE_FPS,
  GROW,
  LEAVE,
  PAPER,
  PATTERN,
  PERSON,
  QUALITY,
  TONE,
} from "./config";
import { Hint } from "./Hint";
import { MiniMap } from "./MiniMap";
import { disposePass, latest, makePass, runPass, sizePass } from "./passes";
import {
  fieldFrag,
  flatVert,
  lumFrag,
  paperFrag,
  personFrag,
  presenceFrag,
  rdFrag,
  toneFrag,
} from "./shaders";
import { stepGrowth } from "./sim/growth";
import { simSize, stepQuality } from "./sim/quality";
import { mazeState } from "./state";

/** The small brightness picture's height (texels). */
const LUM_HEIGHT = 128;

/** The face's place and size (a light face tracker). */
const FaceWatch = () => {
  const face = useFaceInfo({ targetFps: FACE_FPS });
  useEffect(() => {
    const b = face?.bounds;
    mazeState.face = b
      ? { x: b.centerX, y: 1 - b.centerY, w: b.width, h: b.height }
      : null;
  }, [face]);
  return null;
};

export const MazeScene = () => {
  const gl = useThree((s) => s.gl);
  const cameraTexture = useXRCameraTexture();
  const { texture: maskTexture } = usePersonMaskTexture();

  // Shared by the passes that need to know where the growth has reached.
  const growth = useMemo(
    () => ({
      uSeed: { value: new Vector2(0.5, 0.6) },
      uRadius: { value: 0 },
      uWobble: { value: GROW.wobble },
      uAspect: { value: 1 },
    }),
    [],
  );
  const cam = useMemo(
    () => ({
      uCam: { value: null as Texture | null },
      uCamLinear: { value: 0 },
    }),
    [],
  );

  const passes = useMemo(() => {
    // Full float where it can be filtered, else half float (phones).
    const float =
      gl.capabilities.isWebGL2 &&
      gl.extensions.has("EXT_color_buffer_float") &&
      gl.extensions.has("OES_texture_float_linear");
    return {
      person: makePass(
        personFrag,
        {
          uAspect: growth.uAspect,
          uRaw: { value: null as Texture | null },
          uHasRaw: { value: 0 },
          uRawTexel: { value: new Vector2(1 / 256, 1 / 256) },
          uBlend: { value: 0.3 },
          uFace: { value: new Vector4() },
        },
        { type: UnsignedByteType, mips: true },
      ),
      lum: makePass(lumFrag, cam, {
        type: UnsignedByteType,
        feedback: false,
        mips: true,
      }),
      tone: makePass(
        toneFrag,
        {
          ...cam,
          uLum: { value: null as Texture | null },
          uTexel: { value: new Vector2() },
          uDetail: { value: TONE.detail },
          uArea: { value: TONE.area },
          uFollow: { value: 0.1 },
          uFloor: { value: TONE.floor },
          uGain: { value: TONE.gain },
          uDecay: { value: 0.96 },
        },
        { type: UnsignedByteType },
      ),
      field: makePass(
        fieldFrag,
        {
          ...growth,
          uTone: { value: null as Texture | null },
          uMask: { value: null as Texture | null },
          uRing: {
            value: new Vector3(
              PATTERN.ringDark,
              PATTERN.ringLight,
              PATTERN.ringLoose,
            ),
          },
          uSpacing: { value: 1 },
          uFake: { value: 0 },
          uBand: { value: GROW.band },
        },
        { type: UnsignedByteType, feedback: false },
      ),
      presence: makePass(
        presenceFrag,
        { uMask: { value: null as Texture | null }, uDown: { value: 0.02 } },
        { type: UnsignedByteType },
      ),
      rd: makePass(
        rdFrag,
        {
          uField: { value: null as Texture | null },
          uPresence: { value: null as Texture | null },
          uTexel: { value: new Vector2() },
          uStep: { value: 0 },
          uFeed: { value: PATTERN.feed },
          uKill: { value: PATTERN.kill },
          uDu: { value: PATTERN.du },
          uDv: { value: PATTERN.dv },
          uNear: { value: PATTERN.near },
        },
        { type: float ? FloatType : HalfFloatType },
      ),
    };
  }, [gl, growth, cam]);

  const paper = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          ...growth,
          ...cam,
          uState: { value: null as Texture | null },
          uStateSize: { value: new Vector2(1, 1) },
          uInk: { value: 0 },
          uHalf: { value: 1 },
          uLevel: { value: PAPER.level },
          uPaper: { value: new Vector3(...PAPER.paper) },
          uInkColor: { value: new Vector3(...PAPER.ink) },
          uShowCam: { value: 0 },
          uPxPerTexel: { value: 1 },
          uField: { value: null as Texture | null },
        },
        vertexShader: flatVert,
        fragmentShader: paperFrag,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [growth, cam],
  );

  useEffect(
    () => () => {
      Object.values(passes).forEach(disposePass);
      paper.dispose();
    },
    [passes, paper],
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = mazeState;
    const { width, height } = state.size;
    const aspect = width / Math.max(1, height);
    growth.uAspect.value = aspect;

    // The portrait's life: blank, growing, drawn, fading.
    const g = stepGrowth(s.growth, !!s.face, dt, s.restart);
    s.restart = false;
    // Quality adapts only while there is a drawing to keep smooth.
    if (g.phase !== "blank") stepQuality(s.quality, rawDt);

    // The face, eased: it gates the person mask and is where the growth starts.
    const face = passes.person.material.uniforms.uFace.value as Vector4;
    const seed = growth.uSeed.value;
    if (s.face) {
      const fresh = face.z <= 0 || g.clear;
      const k = fresh ? 1 : 1 - Math.exp(-10 * dt);
      face.x += (s.face.x - face.x) * k;
      face.y += (s.face.y - face.y) * k;
      face.z += (s.face.w - face.z) * k;
      face.w += (s.face.h - face.w) * k;
      // The nose sits a little below the face box's centre.
      seed.set(face.x, face.y - 0.08 * face.w);
    } else if (g.lostFor > LEAVE.grace + LEAVE.fade) {
      face.set(0, 0, 0, 0);
    }

    // How far the growth reaches (screen heights from the seed).
    const sx = seed.x * aspect;
    const far = Math.max(
      Math.hypot(sx, seed.y),
      Math.hypot(aspect - sx, seed.y),
      Math.hypot(sx, 1 - seed.y),
      Math.hypot(aspect - sx, 1 - seed.y),
    );
    if (g.phase === "growing")
      growth.uRadius.value =
        GROW.start + (far * 1.05 - GROW.start) * g.progress;
    else if (g.phase === "blank") growth.uRadius.value = 0;
    else growth.uRadius.value = 10;

    paper.uniforms.uInk.value = g.ink;
    const dpr = state.gl.getPixelRatio();
    paper.uniforms.uHalf.value =
      Math.max(PAPER.lineMin, PAPER.line * height * dpr) / 2;
    paper.uniforms.uShowCam.value = s.view;

    if (!cameraTexture) return; // tracker / media startup and source swaps
    cam.uCam.value = cameraTexture;
    cam.uCamLinear.value = cameraTexture.colorSpace === SRGBColorSpace ? 1 : 0;
    // As it fades the drawing holds still.
    if (g.frozen) return;

    // You, steadied.
    const pu = passes.person.material.uniforms;
    pu.uRaw.value = maskTexture ?? null;
    pu.uHasRaw.value = maskTexture ? 1 : 0;
    const img = (
      maskTexture as { image?: { width?: number; height?: number } } | null
    )?.image;
    if (img?.width && img.height)
      pu.uRawTexel.value.set(1 / img.width, 1 / img.height);
    pu.uBlend.value = 1 - Math.exp(-PERSON.rate * dt);
    const pk = Math.min(PERSON.scale, PERSON.max / Math.max(width, height, 1));
    const pw = Math.max(16, Math.round(width * pk));
    const ph = Math.max(16, Math.round(height * pk));
    sizePass(passes.person, state.gl, pw, ph);
    const mask = runPass(passes.person, state.gl);
    s.targets.mask = latest(passes.person);
    sizePass(passes.presence, state.gl, 1, 1);
    passes.presence.material.uniforms.uMask.value = mask;
    passes.presence.material.uniforms.uDown.value = 1 - Math.exp(-0.7 * dt);
    const presence = runPass(passes.presence, state.gl);

    // Brightness, small, for the local average.
    sizePass(
      passes.lum,
      state.gl,
      Math.max(8, Math.round(LUM_HEIGHT * aspect)),
      LUM_HEIGHT,
    );
    const lum = runPass(passes.lum, state.gl);

    // Tone and motion, at the simulation's size.
    const { level } = s.quality;
    const size = simSize(level, aspect);
    s.sim = size;
    sizePass(passes.tone, state.gl, size.width, size.height);
    const tu = passes.tone.material.uniforms;
    tu.uLum.value = lum;
    tu.uTexel.value.set(1 / size.width, 1 / size.height);
    tu.uFollow.value = 1 - Math.exp(-TONE.follow * dt);
    tu.uDecay.value = Math.exp(-TONE.decay * dt);
    const tone = runPass(passes.tone, state.gl);

    // What each texel does this frame.
    sizePass(passes.field, state.gl, size.width, size.height);
    const fu = passes.field.material.uniforms;
    fu.uTone.value = tone;
    fu.uMask.value = mask;
    fu.uSpacing.value = s.spacing;
    fu.uFake.value = s.fakeMotion ? 1 : 0;
    const field = runPass(passes.field, state.gl);

    // The lines: several simulation steps.
    const clear = sizePass(passes.rd, state.gl, size.width, size.height);
    const ru = passes.rd.material.uniforms;
    ru.uField.value = field;
    ru.uPresence.value = presence;
    ru.uTexel.value.set(1 / size.width, 1 / size.height);
    const { steps } = QUALITY.levels[level];
    let out: Texture | null = null;
    for (let i = 0; i < steps; i += 1) {
      ru.uStep.value = ((ru.uStep.value as number) + 1) % 4096;
      out = runPass(passes.rd, state.gl, i === 0 && (clear || g.clear));
    }
    paper.uniforms.uState.value = out;
    paper.uniforms.uStateSize.value.set(size.width, size.height);
    paper.uniforms.uPxPerTexel.value = (height * dpr) / size.height;
    s.targets.state = latest(passes.rd);
    s.targets.field = latest(passes.field);
    paper.uniforms.uField.value = field;
  }, -1);

  return (
    <>
      <FaceWatch />
      <mesh
        name="paper"
        material={paper}
        renderOrder={-998}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <Suspense fallback={null}>
        <Hint />
      </Suspense>
      <MiniMap />
    </>
  );
};
