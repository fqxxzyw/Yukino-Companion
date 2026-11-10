import {eulerDegreesToQuat,quatToEulerDegrees} from './motion/math.ts';
import type {Quat,Vec3} from './motion/types.ts';

// Local-axis approximations relative to the imported bind pose. Bone axes are
// not standardized between rigs, so these are symmetric guardrails, not an
// anatomical model. Unknown/native bones get conservative generic bounds.
export function jointLimits(id:string): Vec3 {
 const key=id.toLowerCase();
 if(/finger|thumb|index|middle|ring|little|proximal|intermediate|distal/.test(key)) return [95,45,45];
 if(/lowerarm|forearm|elbow|lowerleg|calf|shin|knee/.test(key)) return [150,55,55];
 if(/neck|head/.test(key)) return [65,75,55];
 if(/spine|chest|hips|pelvis/.test(key)) return [55,60,45];
 if(/hand|wrist|foot|ankle/.test(key)) return [75,60,60];
 if(/upperarm|shoulder|upperleg|thigh/.test(key)) return [135,100,120];
 return [90,90,90];
}
export function limitJointAngles(id:string,proposed:Vec3,previous:Vec3):Vec3 {
 const limits=jointLimits(id);
 // Existing poses outside a bound remain valid; editing may move back toward
 // the interval but cannot push the outlying value still farther away.
 return proposed.map((value,i)=>Math.max(Math.min(-limits[i],previous[i]),Math.min(Math.max(limits[i],previous[i]),value))) as Vec3;
}
export function limitJointQuaternion(id:string,proposed:Quat,previous:Quat):Quat {
 return eulerDegreesToQuat(limitJointAngles(id,quatToEulerDegrees(proposed),quatToEulerDegrees(previous)));
}
