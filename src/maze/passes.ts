// Off-screen passes: one full-screen quad drawn into a render target. A
// feedback pass keeps two targets and swaps them each step (it reads last
// step's picture as `uPrev`).
import {
  type TextureDataType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Texture,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

import { copyFrag, flatVert } from "./shaders";

type Uniforms = Record<string, { value: unknown }>;

export type Pass = {
  targets: WebGLRenderTarget[];
  read: number;
  frame: number;
  material: ShaderMaterial;
  scene: Scene;
  camera: OrthographicCamera;
  quad: Mesh;
  type: TextureDataType;
  mips: boolean;
};

const makeTarget = (type: TextureDataType, mips: boolean, w = 4, h = 4) =>
  new WebGLRenderTarget(w, h, {
    type,
    generateMipmaps: mips,
    minFilter: mips ? LinearMipmapLinearFilter : LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });

const quadScene = (material: ShaderMaterial) => {
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(1, 1), material);
  quad.frustumCulled = false;
  scene.add(quad);
  return { scene, quad, camera: new OrthographicCamera() };
};

export const makePass = (
  fragmentShader: string,
  uniforms: Uniforms,
  {
    type,
    feedback = true,
    mips = false,
  }: { type: TextureDataType; feedback?: boolean; mips?: boolean },
): Pass => {
  const material = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uPrev: { value: null as Texture | null },
      uFresh: { value: 1 },
    },
    vertexShader: flatVert,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  return {
    targets: feedback
      ? [makeTarget(type, mips), makeTarget(type, mips)]
      : [makeTarget(type, mips)],
    read: 0,
    frame: 0,
    material,
    ...quadScene(material),
    type,
    mips,
  };
};

const copier = (() => {
  let made: ReturnType<typeof quadScene> | null = null;
  return () => {
    if (!made) {
      made = quadScene(
        new ShaderMaterial({
          uniforms: { uSrc: { value: null as Texture | null } },
          vertexShader: flatVert,
          fragmentShader: copyFrag,
          depthTest: false,
          depthWrite: false,
        }),
      );
    }
    return made;
  };
})();

/**
 * Size a pass. A feedback pass that already holds a picture keeps it,
 * stretched to the new size (so a quality change doesn't wipe the drawing).
 * Returns true when the pass starts fresh.
 */
export const sizePass = (
  pass: Pass,
  gl: WebGLRenderer,
  w: number,
  h: number,
): boolean => {
  const p = pass;
  const old = p.targets[p.read];
  if (old.width === w && old.height === h) return false;
  const keep = p.frame > 0 && p.targets.length > 1;
  const next = p.targets.map(() => makeTarget(p.type, p.mips, w, h));
  if (keep) {
    const c = copier();
    (c.quad.material as ShaderMaterial).uniforms.uSrc.value = old.texture;
    const before = gl.getRenderTarget();
    gl.setRenderTarget(next[p.read]);
    gl.render(c.scene, c.camera);
    gl.setRenderTarget(before);
  }
  p.targets.forEach((t) => t.dispose());
  p.targets = next;
  if (!keep) p.frame = 0;
  return !keep;
};

/** Render one step into the pass (swapping for feedback); returns the new texture. */
export const runPass = (
  pass: Pass,
  gl: WebGLRenderer,
  fresh = false,
): Texture => {
  const p = pass;
  const feedback = p.targets.length > 1;
  const read = p.targets[p.read];
  const write = feedback ? p.targets[1 - p.read] : read;
  p.material.uniforms.uPrev.value = feedback ? read.texture : null;
  p.material.uniforms.uFresh.value = fresh || p.frame === 0 ? 1 : 0;
  const before = gl.getRenderTarget();
  gl.setRenderTarget(write);
  gl.render(p.scene, p.camera);
  gl.setRenderTarget(before);
  if (feedback) p.read = 1 - p.read;
  p.frame += 1;
  return write.texture;
};

/** The pass's latest picture. */
export const latest = (pass: Pass) => pass.targets[pass.read];

export const disposePass = (pass: Pass) => {
  pass.targets.forEach((t) => t.dispose());
  pass.material.dispose();
  pass.quad.geometry.dispose();
};
