// Reusable Babylon.js canvas. Handles engine/scene/camera/light lifecycle and
// hands the scene to a setup callback. Used by avatar, editor, and player.
import { useEffect, useRef } from "react";
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color4,
} from "@babylonjs/core";

export interface SceneSetup {
  (scene: Scene, camera: ArcRotateCamera): void | (() => void);
}

export function BabylonCanvas({
  setup,
  className,
  cameraRadius = 12,
}: {
  setup: SceneSetup;
  className?: string;
  cameraRadius?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.055, 0.078, 0.125, 1);

    const camera = new ArcRotateCamera(
      "cam",
      -Math.PI / 2,
      Math.PI / 2.4,
      cameraRadius,
      new Vector3(0, 2, 0),
      scene
    );
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 20;
    camera.lowerRadiusLimit = 4;
    camera.upperRadiusLimit = 80;

    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.8;
    const dir = new DirectionalLight("dir", new Vector3(-1, -2, -1), scene);
    dir.intensity = 0.6;

    const cleanup = setup(scene, camera);

    // Debug beacon: lets tooling confirm the render loop is alive and inspect
    // the scene without shipping a devtools dependency.
    (window as any).__bjs = { scene, engine, frames: 0 };
    engine.runRenderLoop(() => {
      scene.render();
      (window as any).__bjs.frames += 1;
    });
    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (typeof cleanup === "function") cleanup();
      scene.dispose();
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block", outline: "none" }} />;
}
