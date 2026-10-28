import * as THREE from 'three';
import {createEnvironment,disposeEnvironment,sunlightConfig} from './procedural-scenes.mjs';
// A static, owned 3D environment behind UI surfaces. Render only when inputs or
// viewport change; it never captures or displays the user's desktop.
export class EnvironmentBackdrop{
 constructor(host){this.host=host;this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(42,1,.1,100);this.camera.position.set(0,2.1,6);this.camera.lookAt(0,1,-2);this.gl=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});this.gl.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.25));this.gl.outputColorSpace=THREE.SRGBColorSpace;host.append(this.gl.domElement);this.light=new THREE.DirectionalLight(0xffffff,2);this.ambient=new THREE.HemisphereLight(0xffffff,0xbbbbaa,1);this.scene.add(this.light,this.ambient);this.observer=new ResizeObserver(()=>this.render());this.observer.observe(host);}
 update(scene,timeOfDay){if(this.environment){this.scene.remove(this.environment);disposeEnvironment(this.environment)}this.environment=createEnvironment(scene,{timeOfDay});this.scene.add(this.environment);const sun=sunlightConfig(timeOfDay);this.light.color.set(sun.color);this.light.intensity=sun.intensity;this.light.position.set(...sun.position);this.ambient.color.set(sun.ambientColor);this.ambient.groundColor.set(sun.groundColor);this.ambient.intensity=sun.ambient;this.render();}
 render(){const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height||this.disposed)return;this.gl.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.gl.render(this.scene,this.camera);}
 dispose(){this.disposed=true;this.observer.disconnect();disposeEnvironment(this.environment);this.gl.dispose();this.gl.domElement.remove();}
}
