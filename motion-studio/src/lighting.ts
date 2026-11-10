export const lightingPresets = {
  studio: { label: '标准摄影棚', group: '室内', sky: 0xe9f2ff, ground: 0x646074, ambient: 1.75,
    key: 0xfff3e9, keyIntensity: 2.2, keyPosition: [-3, 5, 6], rim: 0xc0d7ff, rimIntensity: 1.1, rimPosition: [4, 3, -5] },
  indoorWarm: { label: '暖光室内', group: '室内', sky: 0xffe2bd, ground: 0x827069, ambient: 1.65,
    key: 0xffca91, keyIntensity: 2, keyPosition: [-3, 5, 4], rim: 0xffedcf, rimIntensity: 0.7, rimPosition: [4, 3, -5] },
  indoorCool: { label: '冷光室内', group: '室内', sky: 0xe3efff, ground: 0x6d788b, ambient: 1.8,
    key: 0xe9f3ff, keyIntensity: 2.1, keyPosition: [-1, 6, 4], rim: 0xbad3ff, rimIntensity: 0.8, rimPosition: [4, 3, -4] },
  daylight: { label: '户外晴天', group: '室外', sky: 0xcfe6ff, ground: 0x94907d, ambient: 1.8,
    key: 0xfff2d4, keyIntensity: 2.7, keyPosition: [-5, 7, 4], rim: 0xbdd9ff, rimIntensity: 0.7, rimPosition: [5, 3, -5] },
  overcast: { label: '户外阴天', group: '室外', sky: 0xdce7ef, ground: 0x77848c, ambient: 2.1,
    key: 0xe8f1ff, keyIntensity: 1.2, keyPosition: [-3, 7, 4], rim: 0xd4e1ed, rimIntensity: 0.7, rimPosition: [4, 4, -5] },
  sunset: { label: '户外夕阳', group: '室外', sky: 0xffd0ac, ground: 0x665c75, ambient: 1.4,
    key: 0xffae79, keyIntensity: 2.2, keyPosition: [-6, 3, 4], rim: 0xc7b4f2, rimIntensity: 0.85, rimPosition: [5, 3, -5] },
} as const;

export type LightingPreset = keyof typeof lightingPresets;
