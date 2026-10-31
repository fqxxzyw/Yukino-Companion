// Pure metadata for the bounded seaside miniature. This module deliberately has
// no Three.js or DOM dependency so scene pickers can read it without creating a
// WebGL context. Geometry, shaders and renderer lighting consume the same values.

export const SEASIDE_LIGHTING_IDS = Object.freeze(['morning', 'noon', 'evening']);
export const SEASIDE_DEFAULT_LIGHTING = 'evening';

const freezeLighting = (entry) => Object.freeze({
  ...entry,
  sun: Object.freeze({...entry.sun, position: Object.freeze(entry.sun.position)}),
  ambient: Object.freeze({...entry.ambient}),
  water: Object.freeze({...entry.water}),
  sky: Object.freeze([...entry.sky]),
});

const lighting = {
  morning: freezeLighting({
    id: 'morning',
    label: '清晨微蓝',
    hour: 7.4,
    background: 'linear-gradient(180deg,#a9bbc9 0%,#becbd4 38%,#d5dcdf 70%,#e9e2d5 100%)',
    sky: ['#a9bbc9', '#becbd4', '#d5dcdf', '#e9e2d5'],
    clear: '#b4c3ce',
    exposure: 1.03,
    sun: {color: '#e9f1f4', intensity: 2.05, position: [-6.1, 5.4, 5.2]},
    ambient: {color: '#dbe9f2', groundColor: '#a2a7a2', intensity: 1.28},
    water: {
      deep: '#597584', middle: '#76959b', shallow: '#acbdb4',
      crest: '#c8d5cf', glint: '#ffe6b8', foam: '#f2f2e8', sky: '#cedce4',
    },
    glintStrength: 0.3,
    foamStrength: 0.82,
    reflectionCenter: 2.1,
  }),
  noon: freezeLighting({
    id: 'noon',
    label: '正午清透',
    hour: 12.4,
    background: 'linear-gradient(180deg,#b8cedb 0%,#ccdde2 42%,#e0e5e2 72%,#eee7da 100%)',
    sky: ['#b8cedb', '#ccdde2', '#e0e5e2', '#eee7da'],
    clear: '#c1d3db',
    exposure: 1.08,
    sun: {color: '#fff7e7', intensity: 2.7, position: [-3.2, 8.2, 4.1]},
    ambient: {color: '#dfeef7', groundColor: '#a6aaa2', intensity: 1.32},
    water: {
      deep: '#4d7080', middle: '#6c9599', shallow: '#a8c1b5',
      crest: '#c8dbd4', glint: '#fff0ca', foam: '#f5f4e9', sky: '#d5e5ec',
    },
    glintStrength: 0.2,
    foamStrength: 0.92,
    reflectionCenter: 2.4,
  }),
  evening: freezeLighting({
    id: 'evening',
    label: '傍晚柔金',
    hour: 17.7,
    background: 'linear-gradient(180deg,#889caf 0%,#acb5c0 36%,#d0c5c4 70%,#e8d4bf 100%)',
    sky: ['#889caf', '#acb5c0', '#d0c5c4', '#e8d4bf'],
    clear: '#aeb9c5',
    exposure: 1.0,
    sun: {color: '#ffd0a0', intensity: 2.15, position: [-6.4, 3.15, -2.6]},
    ambient: {color: '#d6e0ee', groundColor: '#818995', intensity: 1.35},
    water: {
      deep: '#405562', middle: '#566e78', shallow: '#81908c',
      crest: '#a1a69f', glint: '#ffc98f', foam: '#ebe7da', sky: '#b6bdc0',
    },
    glintStrength: 1.0,
    foamStrength: 1,
    reflectionCenter: 1.15,
  }),
};

export const SEASIDE_LIGHTING_PRESETS = Object.freeze(lighting);

export function seasideLightingPreset(value = SEASIDE_DEFAULT_LIGHTING) {
  if (typeof value === 'string' && Object.hasOwn(SEASIDE_LIGHTING_PRESETS, value)) return SEASIDE_LIGHTING_PRESETS[value];
  if (typeof value === 'number' && Number.isFinite(value)) {
    // A compact, deterministic mapping for the host's local or solar hour. It is
    // not a claim about real weather: these three art presets are the whole range
    // this miniature owns, and the night hours stay on the dusk reading.
    if (value < 10.3) return SEASIDE_LIGHTING_PRESETS.morning;
    if (value < 15.2) return SEASIDE_LIGHTING_PRESETS.noon;
    return SEASIDE_LIGHTING_PRESETS.evening;
  }
  return SEASIDE_LIGHTING_PRESETS[SEASIDE_DEFAULT_LIGHTING];
}

// Anchor and both cameras are data for the host. The showcase camera is applied
// by EnvironmentBackdrop; the closer companion framing is retained for the host
// to apply when it adds the existing character model later.
export const SEASIDE_ANCHOR = Object.freeze({
  name: 'Character_Anchor',
  x: 0.5,
  y: 0,
  z: 5,
  width: 4,
  depth: 3,
  standMinX: -1.5,
  standMaxX: 2.5,
  standMinZ: 3.5,
  standMaxZ: 6.5,
  surface: 'dry-sand',
  note: 'Flat, dry, unobstructed character floor; hidden and never animated by the sea.',
});

export const SEASIDE_CAMERAS = Object.freeze({
  overview: Object.freeze({
    direction: Object.freeze([1.30, 1.22, 1.50]),
    fov: 35,
    padding: 1.06,
    tight: true,
    minZoom: 0.42,
    maxZoom: 3.6,
    minPolar: Math.PI * 0.13,
    maxPolar: Math.PI * 0.45,
    pan: true,
    targetBounds: Object.freeze({x: Object.freeze([-4.2, 4.2]), y: Object.freeze([0.25, 2.2]), z: Object.freeze([-4.2, 6.2])}),
  }),
  companion: Object.freeze({
    position: Object.freeze([3.6, 1.8, 9.1]),
    target: Object.freeze([0.5, 1.05, 5]),
    fov: 31,
    note: 'Host-owned close companion view: character surface in the foreground, open sea behind.',
  }),
});

// Kept separate from Three.js geometry for tests and for the app catalogue.
export const SEASIDE_FOOTPRINT = Object.freeze({size: 20, half: 10});
