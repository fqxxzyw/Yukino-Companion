import * as THREE from 'three';

// A screen-aligned additive veil that reads as scattered daylight around the
// sun. It never writes depth and stays extremely faint: the purpose is the
// atmospheric bloom around bright afternoons, not a visible lens-flare overlay.
export function createSunShafts(scene) {
  const uniforms = {
    uSun: {value: new THREE.Vector2(.5, .72)},
    uAspect: {value: 1},
    uIntensity: {value: 0},
    uVisible: {value: 0},
  };
  const material = new THREE.ShaderMaterial({
    name: 'weather:sun-shafts',
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform vec2 uSun;
      uniform float uAspect;
      uniform float uIntensity;
      uniform float uVisible;
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        vec2 s = (uSun - 0.5) * vec2(uAspect, 1.0);
        vec2 d = p - s;
        float radial = length(d);
        float angle = atan(d.y, d.x);
        float fine = 0.5 + 0.5 * sin(angle * 61.0 + sin(angle * 23.0) * 2.4);
        float coarse = 0.5 + 0.5 * sin(angle * 113.0 + 0.7);
        float spokes = fine * 0.66 + coarse * 0.34;
        float shafts = pow(max(0.0, 1.0 - radial * 0.78), 1.9) * (0.22 + 0.78 * spokes);
        float glow = exp(-radial * radial * 9.0) * 0.55 + exp(-radial * 2.6) * 0.16;
        float alpha = (shafts * 0.56 + glow * 0.44) * uIntensity * uVisible;
        alpha *= smoothstep(1.45, 0.18, radial);
        if (alpha < 0.0005) discard;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.78), alpha);
      }`,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'weather:sun-shafts';
  mesh.frustumCulled = false;
  mesh.renderOrder = 90;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  const direction = new THREE.Vector3(0, 1, 0);
  const projected = new THREE.Vector3();
  const forward = new THREE.Vector3();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    if (!mesh.visible || !camera) return;
    uniforms.uAspect.value = camera.aspect || 1;
    projected.copy(camera.position).addScaledVector(direction, 1000).project(camera);
    camera.getWorldDirection(forward);
    const facing = forward.dot(direction);
    const behind = facing <= .02 || projected.z > 1;
    uniforms.uVisible.value = behind ? 0 : 1;
    uniforms.uSun.value.set(
      THREE.MathUtils.clamp(projected.x * .5 + .5, -1, 2),
      THREE.MathUtils.clamp(projected.y * .5 + .5, -1, 2),
    );
  };
  scene.add(mesh);
  let disposed = false;

  return {
    mesh,
    // brightness/cloud/rain/fog/snow are normalized artistic inputs. Night
    // removes the veil entirely; twilight keeps a warm, longer shaft.
    update({direction: value, brightness = 1, cloud = 0, rain = 0, fog = 0, snow = 0, night = false, twilight = false} = {}) {
      if (disposed) return;
      if (value?.isVector3) direction.copy(value);
      else if (Array.isArray(value) && value.length === 3) direction.set(value[0], value[1], value[2]);
      if (direction.lengthSq() < 1e-6) direction.set(0, 1, 0);
      direction.normalize();
      const clear = Math.pow(1 - THREE.MathUtils.clamp(cloud, 0, 1), 2)
        * (1 - THREE.MathUtils.clamp(rain, 0, 1) * .85)
        * (1 - THREE.MathUtils.clamp(fog, 0, 1) * .8)
        * (1 - THREE.MathUtils.clamp(snow, 0, 1) * .45);
      const lowSun = THREE.MathUtils.clamp(.72 + direction.y * .55, .55, 1.1);
      const strength = night ? 0 : THREE.MathUtils.clamp(brightness, 0, 1) * clear * lowSun * (twilight ? .26 : .17);
      uniforms.uIntensity.value = strength;
      mesh.visible = strength > .002;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
