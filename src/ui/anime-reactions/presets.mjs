import {MathUtils} from 'three';
import {sampleEmotion} from './sample-emotion.mjs';
import runtime from './presets/runtime-presets.json' with {type: 'json'};
import originalSymbols from './presets/original-symbol-frames.json' with {type: 'json'};
import kimonoBlush from './presets/和服_原版脸红时序_24fps.json' with {type: 'json'};

const presetIds = {
  surprise: 'surprise',
  confused: 'question',
  angry: 'annoyed',
  embarrassed: 'awkward',
  shy_talking: 'shy_speaking',
  flustered: 'flustered',
  happy: 'pleased',
  pout: 'mild_protest',
  heart: 'heart',
  broken_heart: 'broken_heart',
};

export const ANIME_REACTION_IDS = Object.freeze(Object.keys(presetIds));
export const REACTION_DURATION = runtime.presets.heart.seconds;
export const REACTION_ICON_DEFAULTS = runtime.defaults;

const reactionIdsByPreset = new Map(Object.entries(presetIds).map(([id, preset]) => [preset, id]));
export function resolveReactionId(id) {
  return Object.hasOwn(presetIds, id) ? id : reactionIdsByPreset.get(id);
}

const historicSymbols = {
  confused: {icon: 'question', brow: 'historicQuestionBrow', mouth: 'questionMouth'},
  angry: {icon: 'anger', brow: 'angryBrow', mouth: 'angryMouth'},
  embarrassed: {icon: 'sweat', brow: 'flusteredBrow', mouth: 'flusteredMouth'},
};
const blushSegments = new Map(kimonoBlush.segments.map(({id, frames: [start, end]}) =>
  [id, kimonoBlush.samples.slice(start - 1, end)]));

function framePair(frames, seconds, fps) {
  const position = MathUtils.clamp(seconds * fps, 0, frames.length - 1);
  const index = Math.floor(position);
  return [frames[index], frames[Math.min(index + 1, frames.length - 1)], position - index];
}

export function reactionDuration(outfit, id) {
  const original = originalSymbols.outfits[outfit];
  const historic = historicSymbols[id];
  const segment = historic && original?.segments[historic.icon];
  return segment ? segment.frames.length / original.fps : runtime.presets[presetIds[id]].seconds;
}

export function sampleReaction(outfit, id, seconds, strength, headWidth) {
  const preset = runtime.presets[presetIds[id]];
  const historic = historicSymbols[id];
  const original = originalSymbols.outfits[outfit];
  const segment = historic && original?.segments[historic.icon];
  if (segment) {
    const [from, to, fraction] = framePair(segment.frames, seconds, original.fps);
    const [brow, mouth, scale, rotation, height] = from.map((value, i) => MathUtils.lerp(value, to[i], fraction));
    const pose = {[historic.brow]: brow * strength};
    if (segment.mouth) pose[historic.mouth] = mouth * strength;
    return {
      pose, blush: 0, hatches: 0,
      icons: [{name: historic.icon, opacity: scale > 1e-5 ? strength : 0,
        x: segment.x / headWidth, y: height / headWidth, scale,
        rotation: -MathUtils.radToDeg(rotation)}],
    };
  }

  const {face, icons} = sampleEmotion(preset, seconds, strength);
  const frames = outfit === 'kimono' && blushSegments.get(presetIds[id]);
  if (frames) {
    const [from, to, fraction] = framePair(frames, seconds, kimonoBlush.fps);
    const value = key => MathUtils.lerp(from[key], to[key], fraction);
    // Preserve the live blink scheduler and TTS channels. The archived demo
    // blink and mouth-open controls were for silent playback in Blender.
    const symbol = value(preset.icon === 'sweat' ? 'sweat' : preset.icon === 'anger' ? 'annoyed' : 'soft_joy');
    return {
      pose: {
        historicSoftJoy: value('soft_joy') * strength,
        historicSoftJoyBrow: value('soft_joy') * strength,
        flusteredBrow: value('sweat') * strength,
        flusteredMouth: value('sweat') * strength,
        angryBrow: value('annoyed') * strength,
        angryMouth: value('annoyed') * strength,
      },
      blush: value('blush') * strength,
      hatches: value('blush_lines') * strength,
      icons: icons.map(layer => ({
        ...layer, opacity: MathUtils.clamp(symbol * value('symbol_gain'), 0, 1) * strength,
      })),
    };
  }

  const {surprise = 0, mouthOpen = 0, question = 0, annoyed = 0, awkward = 0,
    softJoy = 0, innerBrowRaise = 0, mouthCornerDown = 0, blush = 0, blushLines = 0} = face;
  return {
    pose: {surpriseBrow: surprise, surpriseEyes: surprise, surpriseMouth: mouthOpen,
      questionBrow: question, angryBrow: annoyed, flusteredBrow: awkward, flusteredEyes: awkward,
      smile: softJoy, sadBrow: innerBrowRaise, frown: mouthCornerDown},
    blush, hatches: blushLines, icons,
  };
}
