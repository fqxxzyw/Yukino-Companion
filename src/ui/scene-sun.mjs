import * as THREE from 'three';
import {sceneDaylight} from './scene-daylight.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rad = THREE.MathUtils.degToRad;

// The authored scenes look toward local +Z from their companion camera. Keeping
// a small forward bias makes the sun arc readable, while the compressed Z term
// and the 15° bias move the afternoon beam far enough to the side that roofs,
// walls and ground receive a direction instead of a flat frontal wash.
const SUN_AZIMUTH_BIAS = 15;
const SUN_Z_SCALE = .62;

export function normalizeWeather(weather = null) {
  return {
    cloud: clamp(Number(weather?.cloud) || 0, 0, 1),
    rain: clamp(Number(weather?.rain) || 0, 0, 1),
    fog: clamp(Number(weather?.fog) || 0, 0, 1),
    snow: clamp(Number(weather?.snow) || 0, 0, 1),
  };
}

// One artistic solar arc shared by the background scene and the separately
// rendered character. The direction is a unit vector in scene world space,
// from the ground toward the sun. Site orientation is the scene's authored
// sunAzimuthOffset; nothing here depends on a camera's screen axes.
export function sceneSunDirection(timeOfDay, azimuthOffset = 0) {
  const daylight = sceneDaylight(timeOfDay);
  const solar = timeOfDay?.kind === 'solar' ? timeOfDay : null;
  const hourAngle = solar ? solar.hourAngle : (daylight.hour - 12) * 15;
  // A 46° maximum keeps mid-afternoon shadows long enough to read in a
  // miniature without inventing an artificial golden-hour sun.
  const elevation = solar
    ? solar.elevation
    : 5 + Math.max(0, Math.sin((daylight.hour - 6) / 12 * Math.PI)) * 41;
  const azimuth = rad(hourAngle + SUN_AZIMUTH_BIAS);
  const altitude = rad(clamp(elevation, 5, 70));
  const horizontal = Math.cos(altitude);
  let x = Math.sin(azimuth) * horizontal;
  let y = Math.sin(altitude);
  // Keep a small camera-side component through sunrise/sunset. A real low sun
  // still grazes the face and front wall instead of becoming a pure backlight,
  // so morning/evening direction changes stay readable on the character too.
  let z = Math.cos(azimuth) * horizontal * SUN_Z_SCALE + .16;
  const turn = rad(Number.isFinite(azimuthOffset) ? azimuthOffset : 0);
  if (turn) {
    const cos = Math.cos(turn), sin = Math.sin(turn);
    const rotatedX = x * cos + z * sin;
    z = -x * sin + z * cos;
    x = rotatedX;
  }
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

// Compute the sun once from time + weather. Both renderers consume this
// snapshot; each side may calibrate its final exposure, but not the direction.
export function sceneSun({timeOfDay, weather = null, baseIntensity = 1, outdoor = true, azimuthOffset = 0} = {}) {
  const daylight = sceneDaylight(timeOfDay);
  const {cloud, rain, fog, snow} = normalizeWeather(weather);
  const {brightness, night, twilight, hour} = daylight;
  const direction = sceneSunDirection(timeOfDay, azimuthOffset);
  const attenuated = (1 - cloud * .72) * (1 - rain * .15) * (1 - fog * .42) * (1 - snow * .20);
  // The curve's evening intensity is part of the sun, not a post-process
  // exposure change: a low warm sun is physically weaker than noon.
  const solarScale = clamp((daylight.sun.intensity || 0) / 3.1, 0, 1);
  const directScale = night ? (outdoor ? 0 : .04) : (.12 + .88 * brightness) * solarScale * attenuated;
  const intensity = baseIntensity * directScale * (outdoor && !night ? 1.24 : 1);
  const color = '#' + new THREE.Color(daylight.sun.color)
    .lerp(new THREE.Color('#fff8ed'), brightness * .38 * (1 - cloud))
    .lerp(new THREE.Color('#dce5eb'), cloud * .7)
    .lerp(new THREE.Color('#c8d5df'), rain * .25 + fog * .28)
    .getHexString();
  // Clear days keep a deliberate direct-to-fill gap. Overcast, fog and snow
  // lift the sky fill to soften the beam instead of painting it out.
  const fillScale = night
    ? (outdoor ? .77 * .42 : .9 * .7)
    : outdoor
      ? .58 + cloud * .36 + fog * .08 + snow * .10 + rain * .05
      : .74 + cloud * .12;
  const environmentScale = night ? .22 : .26 + cloud * .14 + fog * .05 + snow * .06;
  return {
    direction, color, intensity, directScale, solarScale, fillScale, environmentScale,
    brightness, night, twilight, hour, outdoor,
    cloud, rain, fog, snow,
  };
}
