import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import * as THREE from "three";
import { MOUSE } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

function disposeObject3d(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry && "dispose" in mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}

export default function Model3dViewport(props: {
  modelUrl: string;
  format: "glb" | "obj";
  interactiveAnimations?: boolean;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);
  const playingRef = useRef(true);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const actions = actionsRef.current;
    if (!props.interactiveAnimations || actions.length === 0) {
      return;
    }

    actions.forEach((action, index) => {
      const isActive = index === activeClipIndex;
      action.enabled = isActive;
      action.clampWhenFinished = !loopEnabled;
      action.setLoop(loopEnabled ? THREE.LoopRepeat : THREE.LoopOnce, loopEnabled ? Infinity : 1);
      if (!isActive) {
        action.stop();
      }
    });

    const current = actions[activeClipIndex];
    if (!current) {
      return;
    }

    current.reset().play();
    current.paused = !playing;
  }, [activeClipIndex, loopEnabled, playing, props.interactiveAnimations]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    let loadedModel: THREE.Object3D | null = null;
    const clock = new THREE.Clock();

    setClipNames([]);
    setActiveClipIndex(0);
    setPlaying(Boolean(props.interactiveAnimations));
    setLoopEnabled(true);
    actionsRef.current = [];
    mixerRef.current = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c1419");

    const camera = new THREE.PerspectiveCamera(46, 1, 0.01, 2000);
    camera.position.set(0, 1, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.mouseButtons.LEFT = MOUSE.PAN;
    controls.mouseButtons.RIGHT = MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = MOUSE.DOLLY;

    const hemi = new THREE.HemisphereLight("#ffe9cc", "#305070", 1.1);
    const key = new THREE.DirectionalLight("#ffffff", 1.25);
    key.position.set(4, 7, 4);
    const fill = new THREE.DirectionalLight("#99ccff", 0.65);
    fill.position.set(-4, 3, -3);
    scene.add(hemi, key, fill);

    const grid = new THREE.GridHelper(14, 20, "#3f6a7a", "#25414c");
    grid.position.y = -0.001;
    scene.add(grid);

    const frameScene = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.65;
      const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;

      controls.target.copy(center);
      camera.position.set(center.x + safeRadius * 1.6, center.y + safeRadius * 0.9, center.z + safeRadius * 1.9);
      camera.near = Math.max(0.01, safeRadius / 400);
      camera.far = Math.max(120, safeRadius * 80);
      camera.updateProjectionMatrix();
      controls.update();
    };

    const applySize = () => {
      const width = Math.max(200, Math.floor(container.clientWidth));
      const height = Math.max(220, Math.floor(container.clientHeight));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    applySize();
    const observer = new ResizeObserver(() => applySize());
    observer.observe(container);

    const animate = () => {
      if (disposed) {
        return;
      }
      const mixer = mixerRef.current;
      if (mixer) {
        mixer.update(clock.getDelta() * (playingRef.current ? 1 : 0));
      } else {
        clock.getDelta();
      }
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const loadModel = async () => {
      setLoadError(null);
      try {
        let rootObject: THREE.Object3D;
        if (props.format === "glb") {
          const loader = new GLTFLoader();
          const gltf = await loader.loadAsync(props.modelUrl);
          rootObject = gltf.scene;
          if (props.interactiveAnimations && gltf.animations.length > 0) {
            const names = gltf.animations.map((clip, index) => clip.name?.trim() || `Clip ${index + 1}`);
            setClipNames(names);
            setActiveClipIndex(0);
            setPlaying(true);
            setLoopEnabled(true);
            const mixer = new THREE.AnimationMixer(rootObject);
            mixerRef.current = mixer;
            actionsRef.current = gltf.animations.map((clip) => {
              const action = mixer.clipAction(clip);
              action.enabled = false;
              action.setLoop(THREE.LoopRepeat, Infinity);
              return action;
            });
          }
        } else {
          const loader = new OBJLoader();
          rootObject = await loader.loadAsync(props.modelUrl);
        }

        if (disposed) {
          disposeObject3d(rootObject);
          return;
        }

        loadedModel = rootObject;
        scene.add(rootObject);
        frameScene(rootObject);
      } catch (error) {
        if (!disposed) {
          setLoadError(String(error));
        }
      }
    };

    void loadModel();
    animate();

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
      }
      mixerRef.current = null;
      actionsRef.current = [];
      if (loadedModel) {
        scene.remove(loadedModel);
        disposeObject3d(loadedModel);
      }
      renderer.dispose();
      container.innerHTML = "";
    };
  }, [props.format, props.interactiveAnimations, props.modelUrl]);

  return (
    <div className="model3d-viewport-shell">
      <div className="model3d-viewport-canvas" ref={containerRef} />
      <small>Controls: left drag = pan camera, right drag = orbit model, wheel = zoom.</small>
      {props.interactiveAnimations && clipNames.length > 0 ? (
        <div className="model3d-animation-controls">
          <button type="button" className="ghost" onClick={() => setPlaying((current) => !current)}>
            {playing ? "Pause" : "Play"}
          </button>
          <label>
            <span>Clip</span>
            <select value={activeClipIndex} onChange={(event) => setActiveClipIndex(Number(event.target.value || 0))}>
              {clipNames.map((name, index) => (
                <option key={`${name}-${index}`} value={index}>{name}</option>
              ))}
            </select>
          </label>
          <label className="model3d-loop-toggle">
            <input type="checkbox" checked={loopEnabled} onChange={(event) => setLoopEnabled(event.target.checked)} />
            <span>Loop</span>
          </label>
        </div>
      ) : null}
      {loadError ? <small className="model3d-viewport-error">Preview load failed: {loadError}</small> : null}
    </div>
  );
}
