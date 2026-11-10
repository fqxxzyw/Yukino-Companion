// Scene authors must explicitly provide a clear region; a scene's bounding box
// alone says nothing about floors, furniture, or holes. Coordinates are local
// to the authored scene and the radius includes the character's footprint.
const finite = (...values) => values.every(Number.isFinite);

export function navigationFromAnchor(anchor, {radius = 0} = {}) {
 const data = anchor?.userData, area = data?.standingArea, position = anchor?.position;
 if (!area || !position || !finite(area.minX, area.maxX, area.minZ, area.maxZ, position.x, position.y, position.z, data.floorY, data.clearRadius, radius) || radius < 0 || data.clearRadius <= radius) return null;
 const bounds = {minX:area.minX + radius, maxX:area.maxX - radius, minZ:area.minZ + radius, maxZ:area.maxZ - radius};
 if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) return null;
 // clearRadius is the only authored collision guarantee. Intersect it with the
 // standing area instead of assuming that the whole rectangular floor is empty.
 const navigation = {bounds, center:{x:position.x, z:position.z}, radius:data.clearRadius-radius, floorY:data.floorY};
 return isSafePoint(navigation, navigation.center) ? navigation : null;
}

export function isSafePoint(navigation, point) {
 if (!navigation || !point || !finite(point.x, point.z)) return false;
 const {bounds, center, radius} = navigation;
 return point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ && Math.hypot(point.x-center.x, point.z-center.z) <= radius + 1e-9;
}

// A rectangle intersected with a circle is convex: a segment with both ends in
// this conservative region remains safe throughout, not just at sampled frames.
export function isSafeSegment(navigation, from, to) {
 return isSafePoint(navigation, from) && isSafePoint(navigation, to);
}

export function chooseSceneDestination(navigation, from, random = Math.random) {
 if (!isSafePoint(navigation, from)) return null;
 for (let attempt=0; attempt<24; attempt++) {
  const angle=random()*Math.PI*2, distance=Math.sqrt(random())*navigation.radius;
  const point={x:navigation.center.x+Math.cos(angle)*distance,z:navigation.center.z+Math.sin(angle)*distance};
  if (isSafeSegment(navigation,from,point) && Math.hypot(point.x-from.x,point.z-from.z) >= navigation.radius*.2) return {...point,y:navigation.floorY};
 }
 return null;
}
