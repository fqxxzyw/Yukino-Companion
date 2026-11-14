const eaBrows = {
  sadBrow: 'EA_brow_sad', surpriseBrow: 'EA_brow_surprised',
  questionBrow: 'EA_brow_relaxed', historicQuestionBrow: 'EA_brow_relaxed',
  angryBrow: 'EA_brow_angry',
};
const historic = {
  historicQuestionBrow: 'Anime_Question_Brow', questionMouth: 'Anime_Question_Mouth',
  angryBrow: 'Anime_Annoyed_Brow', angryMouth: 'Anime_Annoyed_Mouth',
  flusteredBrow: 'Anime_Sweat_Brow', flusteredMouth: 'Anime_Sweat_Mouth',
};
const animeBrows = {
  ...historic,
  surpriseBrow: 'AnimeV2_Surprise_Brow', surpriseEyes: 'AnimeV2_Surprise_Eyes',
  questionBrow: 'AnimeV2_Thinking_Brow', surpriseMouth: 'AnimeV2_Surprise_Mouth',
};
const mouthRoles = new Set(['surpriseMouth', 'smile', 'historicSoftJoy', 'frown', 'questionMouth', 'angryMouth', 'flusteredMouth']);

const channelsByOutfit = {
  beret: {
    ...eaBrows, smile: 'EA_happy_mouth', frown: 'EA_sad_mouth', surpriseMouth: 'EA_surprised_mouth',
    flusteredBrow: 'EA_brow_surprised', blink: 'EA_blink', talk: 'EA_aa',
  },
  'black-qipao': {
    ...animeBrows, smile: 'Daily_SubtleSmile_Corners', sadBrow: 'Anime_Sweat_Brow', frown: 'Anime_Annoyed_Mouth',
    blink: 'EA_blink', talk: 'Qipao20261112_aa',
  },
  kimono: {
    ...animeBrows, sadBrow: 'YK20_brow_sad', smile: 'YK76_ClosedSubtleSmile_Coordinated_REVIEW',
    historicSoftJoy: 'AnimeV2_SoftJoy_Mouth', historicSoftJoyBrow: 'AnimeV2_SoftJoy_Brow',
    frown: 'YK20_sad_mouth',
    flusteredEyes: 'AnimeV4_Flustered_EyeLift',
    blink: 'YK20_blink', talk: 'AnimeV4_Talk_aa',
  },
  'summer-uniform': {
    ...eaBrows, smile: 'YK_gentle_smile', flusteredBrow: 'EA_brow_surprised', blink: 'EA_blink', talk: 'EA_aa',
  },
  swimsuit: {
    ...eaBrows, ...historic, questionBrow: 'Anime_Question_Brow', smile: 'SwimNarrow_happy_mouth',
    frown: 'SwimNarrow_sad_mouth', surpriseMouth: 'SwimNarrow_surprised_mouth',
    blink: 'EA_blink', talk: 'SwimNarrow_aa',
  },
  'twin-tail': {
    ...eaBrows, smile: 'YK_Talk_SoftSmile', flusteredBrow: 'EA_brow_surprised', blink: 'EA_blink', talk: 'YK_Talk_AA',
  },
  'winter-uniform': {
    ...animeBrows, smile: 'REVIEW_SubtleCornerSmile', sadBrow: 'Anime_Sweat_Brow',
    frown: 'Anime_Annoyed_Mouth', blink: ['EA_blink', 'Anime_Blink_Sync'],
  },
};

function hasPositionDelta(mesh, index) {
  const base = mesh.geometry.getAttribute('position');
  const target = mesh.geometry.morphAttributes.position?.[index];
  if (!base || !target || base.count !== target.count) return false;
  for (let i = 0; i < target.count; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const reference = mesh.geometry.morphTargetsRelative ? 0 : base.getComponent(i, axis);
      if (Math.abs(target.getComponent(i, axis) - reference) > 1e-8) return true;
    }
  }
  return false;
}

export function bindReactionMorphs(meshes, outfit) {
  const bind = name => meshes.flatMap(mesh => {
    const index = mesh.morphTargetDictionary?.[name];
    const values = mesh.morphTargetInfluences;
    return Number.isInteger(index) && Number.isFinite(values?.[index]) && hasPositionDelta(mesh, index)
      ? [{values, index}] : [];
  });
  const channels = new Map(Object.entries(channelsByOutfit[outfit]).map(([role, names]) =>
    [role, [names].flat().filter(Boolean).flatMap(bind)]));
  const applied = [];
  function currentWeight(role) {
    let weight = 0;
    for (const {values, index} of channels.get(role) || []) weight = Math.max(weight, values[index]);
    return weight;
  }

  return {
    restore() {
      for (let i = applied.length - 1; i >= 0; i--) {
        const {values, index, base, weight} = applied[i];
        if (values[index] === weight) values[index] = base;
      }
      applied.length = 0;
    },
    apply(pose, speaking) {
      const eyes = Math.max(0, 1 - currentWeight('blink'));
      const mouthAvailable = !speaking && currentWeight('talk') <= .015;
      for (const [role, target] of Object.entries(pose)) {
        if (target <= 0 || (!mouthAvailable && mouthRoles.has(role))) continue;
        const weight = role.endsWith('Eyes') ? target * eyes : target;
        for (const {values, index} of channels.get(role) || []) {
          const base = values[index];
          if (weight <= base) continue;
          values[index] = weight;
          applied.push({values, index, base, weight});
        }
      }
    },
  };
}
