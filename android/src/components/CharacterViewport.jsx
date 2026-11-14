import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PlaceholderCharacter } from "./PlaceholderCharacter.jsx";
import { defaultManifest, loadManifest, resolveOutfit } from "../model/characterModelConfig.js";
import { disposeModel, frameCharacterCamera, loadCharacterModel, resolveOutfitUrls } from "../model/loadCharacterModel.js";

function reportViewport(detail) {
  if (typeof window === "undefined") return;
  window.__yukinoViewport = { ...window.__yukinoViewport, ...detail, updatedAt: Date.now() };
}

export function CharacterViewport({ outfitId, motion = true, speaking = false, listening = false }) {
  const host = useRef(null);
  const speakingRef = useRef(speaking);
  const listeningRef = useRef(listening);
  const motionRef = useRef(motion);
  const [mode, setMode] = useState("loading");
  speakingRef.current = speaking;
  listeningRef.current = listening;
  motionRef.current = motion;

  useEffect(() => {
    let dead = false;
    let renderer, scene, camera, frame, root, clock, mixer, vrm;
    const actions = {};
    let current = "";
    let glanceAt = 8 + Math.random() * 8;
    reportViewport({ status: "loading", outfit: outfitId || "", error: "" });
    setMode("loading");

    const play = (name, { fade = 0.25, loop } = {}) => {
      if (!mixer || !actions[name] || current === name) return;
      const next = actions[name];
      const prev = current ? actions[current] : null;
      const shouldLoop = loop ?? next.clip?.loop ?? (name === "Idle_Breathe" || name === "Listen_Attentive");
      next.reset();
      next.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);
      next.clampWhenFinished = !shouldLoop;
      next.enabled = true;
      if (prev && prev !== next) prev.fadeOut(fade);
      next.fadeIn(fade);
      next.play();
      current = name;
    };

    (async () => {
      const manifest = await loadManifest().catch(() => ({ ...defaultManifest, missing: true }));
      const outfit = resolveOutfit(manifest, outfitId);
      const { modelUrl, actionsUrl } = resolveOutfitUrls(outfit);
      if (dead) return;
      if (!outfit || !modelUrl || !host.current) {
        setMode("placeholder");
        reportViewport({ status: "placeholder", outfit: outfitId || "", error: "missing-outfit" });
        return;
      }

      const width = host.current.clientWidth || 240;
      const height = host.current.clientHeight || 360;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      host.current.innerHTML = "";
      host.current.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      const cam = manifest.camera || defaultManifest.camera;
      camera = new THREE.PerspectiveCamera(cam.fov || 28, width / height, 0.05, 30);
      camera.position.set(...(cam.position || [0, 1.15, 2.6]));
      camera.lookAt(...(cam.target || [0, 0.95, 0]));
      scene.add(new THREE.HemisphereLight(0xfff4e8, 0x6b7c9a, 1.15));
      const key = new THREE.DirectionalLight(0xffe4c0, 1.35);
      key.position.set(1.6, 3.4, 2.8);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xc9dbff, 0.45);
      fill.position.set(-2.2, 1.4, 1.2);
      scene.add(fill);

      try {
        const loaded = await loadCharacterModel(
          { ...manifest, ...outfit, format: outfit.format || "vrm" },
          modelUrl,
          { renderer, actionsUrl, entry: { id: outfit.id, sha256: outfit.sha256, runtimeCandidate: outfit.id, actionPack: outfit.actionPack, clips: outfit.clips } }
        );
        if (dead) {
          disposeModel(loaded.scene);
          return;
        }
        root = loaded.scene;
        vrm = loaded.vrm;
        scene.add(root);
        if (vrm?.lookAt) vrm.lookAt.target = camera;
        if (loaded.clips?.length) {
          mixer = new THREE.AnimationMixer(root);
          for (const clip of loaded.clips) {
            const action = mixer.clipAction(clip);
            action.clip = outfit.clips?.[clip.name] || { loop: clip.name === "Idle_Breathe" };
            actions[clip.name] = action;
          }
          mixer.addEventListener("finished", (event) => {
            if (event.action === actions.Speak_PhraseCadence || event.action === actions.Thoughtful_Glance || event.action === actions.Nod_Subtle) {
              if (!speakingRef.current) play("Idle_Breathe");
            }
          });
          play("Idle_Breathe", { fade: 0, loop: true });
          mixer.update(0);
        }
        root.updateMatrixWorld(true);
        frameCharacterCamera(camera, root, vrm, cam);
        vrm?.springBoneManager?.setInitState?.();
        clock = new THREE.Clock();
        let ready = false;
        const animate = () => {
          frame = requestAnimationFrame(animate);
          const delta = Math.min(clock.getDelta(), 0.08);
          const elapsed = clock.elapsedTime;
          if (mixer && motionRef.current) {
            const want = speakingRef.current ? "Speak_PhraseCadence" : listeningRef.current ? "Listen_Attentive" : "Idle_Breathe";
            if (want === "Speak_PhraseCadence" && actions[want]) play(want, { loop: true });
            else if (want === "Listen_Attentive" && actions[want]) play(want, { loop: true });
            else if (want === "Idle_Breathe") {
              if (current === "Idle_Breathe" && actions.Thoughtful_Glance && elapsed > glanceAt) {
                glanceAt = elapsed + 14 + Math.random() * 10;
                play("Thoughtful_Glance", { loop: false });
              } else if (current !== "Thoughtful_Glance") {
                play("Idle_Breathe", { loop: true });
              }
            }
            mixer.update(delta);
          }
          if (vrm) vrm.update?.(delta);
          renderer.render(scene, camera);
          if (!ready) {
            ready = true;
            setMode("model");
            reportViewport({ status: "ready", outfit: outfit.id, error: "" });
          }
        };
        animate();
      } catch (error) {
        console.warn("模型加载失败，改用占位形象", error);
        if (!dead) {
          setMode("placeholder");
          reportViewport({ status: "error", outfit: outfit.id, error: String(error?.message || error) });
        }
      }
    })();

    const onResize = () => {
      if (!host.current || !renderer || !camera) return;
      const width = host.current.clientWidth || 240;
      const height = host.current.clientHeight || 360;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    window.addEventListener("resize", onResize);

    return () => {
      dead = true;
      window.removeEventListener("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
      mixer?.stopAllAction();
      if (root) disposeModel(root);
      renderer?.dispose();
      if (renderer?.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [outfitId]);

  if (mode === "placeholder") return <PlaceholderCharacter />;
  return (
    <div className={`character-stage model${mode === "loading" ? " loading" : ""}`} data-outfit={outfitId || ""} data-mode={mode}>
      <div className="character-canvas" ref={host} />
      {mode !== "model" && <div className="model-loading">正在唤出雪乃…</div>}
    </div>
  );
}
