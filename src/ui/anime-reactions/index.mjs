import {MathUtils} from 'three';
import {measureReactionAnchor} from './anchor.mjs';
import {createCheekEffects} from './cheeks.mjs';
import {createAnimeReactionIcons} from './icons.mjs';
import {bindReactionMorphs} from './morphs.mjs';
import {REACTION_ICON_DEFAULTS, reactionDuration, resolveReactionId, sampleReaction} from './presets.mjs';
export {ANIME_REACTION_IDS, REACTION_DURATION} from './presets.mjs';

// A style name alone is insufficient to apply Yukino's authored morphs.
const modelDigests = {
  beret: '03dbd98f767d8214bea7ee3bcfface63a44934bcd635637e0fcec22a34e98fd8',
  'black-qipao': '1cd18dad58c0ca03485235ad0cfa7101060410d4ba662deca8a0df28eca042e1',
  kimono: 'b8b26e8c49fff87f2797d3e12b9f7d8d5042de01ce204ce81c1a24492ea70b54',
  'summer-uniform': 'dd2cd3c0ccba9af80ba74531e8f32364e696d271db14fed8242e17f583b6b168',
  swimsuit: 'b6bf109f5e754d1a73e9a139079c52255cea2b3279b12894d90302353efbaead',
  'twin-tail': '30598576bc3fdcf52c6b399a2f818ba78ff602d3479e0c65f37e94eb0adc82d6',
  'winter-uniform': '6e5103b41d415628daf1c61bf932f4a9cfbed3e17fe38bf9bdbc6822285a7e6b',
};

export function bindAnimeReactions({gltf, entry}) {
  const outfit = entry?.runtimeCandidate;
  if (entry?.characterId !== 'yukino' || !Object.hasOwn(modelDigests, outfit) ||
      (entry.compatibilityBaseSha256 ?? entry.sha256) !== modelDigests[outfit] || !gltf?.scene) return null;

  const meshes = gltf.scene.getObjectsByProperty('isMesh', true);
  const headReference = measureReactionAnchor(gltf, outfit, meshes);
  if (!headReference) return null;
  const {anchor, head, headWidth, iconDepth} = headReference;
  const morphs = bindReactionMorphs(meshes, outfit);
  const [, vertical] = REACTION_ICON_DEFAULTS.anchor;
  // Keep the symbols readable in the companion's full-body view.
  const horizontal = .90;
  const iconWidth = .40;
  const icons = createAnimeReactionIcons(anchor, {
    headWidth, side: outfit === 'kimono' ? -1 : 1, horizontal, vertical,
    depth: iconDepth, iconWidth,
  });
  let cheeks, active = null, elapsed = 0, disposed = false;

  // Lift the previous overlay before the mixer, gaze, blink and speech update.
  function restore() {
    morphs.restore();
    anchor.removeFromParent();
  }
  function stopEmotion() {
    restore();
    icons.hide();
    active = null;
  }
  function playEmotion(id, strength = 1) {
    const reaction = typeof id === 'string' && resolveReactionId(id);
    if (disposed || !reaction || !Number.isFinite(strength) || strength <= 0) return false;
    stopEmotion();
    if (!cheeks) {
      cheeks = createCheekEffects(headReference);
      headReference.disposeSurface();
    }
    active = {id: reaction, strength: MathUtils.clamp(strength, 0, 1), duration: reactionDuration(outfit, reaction)};
    elapsed = 0;
    return true;
  }
  function update(deltaSeconds, {speaking = false, camera} = {}) {
    if (!active) return null;
    restore();
    elapsed += Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (elapsed >= active.duration - 1e-9) {
      stopEmotion();
      return null;
    }
    const {id, strength} = active;
    const sample = sampleReaction(outfit, id, elapsed, strength, headWidth);
    morphs.apply(sample.pose, speaking);
    cheeks.update(sample.blush, sample.hatches);
    head.add(anchor);
    icons.update(sample.icons, camera);
    return id;
  }
  function dispose() {
    if (disposed) return;
    stopEmotion();
    icons.dispose();
    if (cheeks) cheeks.dispose();
    else headReference.disposeSurface();
    disposed = true;
  }
  return {playEmotion, stopEmotion, trigger: playEmotion, cancel: stopEmotion, ready: icons.ready, restore, update, dispose};
}
