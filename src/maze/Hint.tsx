// The only hint, wordless: a small see-through ghost face low in the centre,
// holding still (the SDK's FaceExpressionHint with no expression and no
// orbit): "show your face". It fades in shortly after the start and goes for
// good once the first portrait is fully drawn. Motion: strict ease-out.
import { useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Vector3, type Group } from "three";
// eslint-disable-next-line import/extensions
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// eslint-disable-next-line import/extensions
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FaceExpressionHint } from "@vincentt-xr/sdk/instructions";

import { HINT } from "./config";
import { mazeState } from "./state";

const FACE_URL = "/models/face-v1.glb";
const STILL = { targets: {} };
/** Pencil grey on the paper; no glow or halo, so it stays faint. */
const LOOK = {
  ghost: { color: "#5d5852", core: 0.22, rim: 0.5, whiten: 0 },
  halo: false as const,
  glow: false as const,
};

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export const Hint = () => {
  const face = useLoader(GLTFLoader, FACE_URL, (l) =>
    l.setMeshoptDecoder(MeshoptDecoder),
  );
  const camera = useThree((s) => s.camera);
  const root = useRef<Group>(null);
  const v = useMemo(() => new Vector3(), []);
  const t = useMemo(() => ({ start: -1, gone: -1, done: false }), []);

  useFrame(() => {
    const g = root.current;
    if (!g || t.done) return;
    const now = performance.now() / 1000;
    if (t.start < 0) t.start = now;
    if (mazeState.growth.grownOnce && t.gone < 0) t.gone = now;
    let k = easeOut((now - t.start - HINT.delay) / HINT.fadeIn);
    if (t.gone >= 0) {
      const out = (now - t.gone) / HINT.fadeOut;
      k = Math.min(k, 1 - easeOut(out));
      if (out >= 1) {
        t.done = true;
        g.visible = false;
        return;
      }
    }
    g.visible = k > 0.001;
    if (!g.visible) return;
    // Pinned to its place on screen, just in front of the camera.
    v.set(HINT.at[0], HINT.at[1], 0.5).unproject(camera).sub(camera.position);
    g.position
      .copy(camera.position)
      .addScaledVector(v.normalize(), HINT.distance);
    g.quaternion.copy(camera.quaternion);
    g.scale.setScalar(Math.max(1e-4, k));
  });

  return (
    <group ref={root} name="hint" visible={false}>
      <FaceExpressionHint
        expression={STILL}
        model={face.scene}
        height={HINT.height}
        orbit={0}
        look={LOOK}
        renderOrder={HINT.renderOrder}
      />
    </group>
  );
};
