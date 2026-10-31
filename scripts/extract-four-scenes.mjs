// Extract authored art from the supplied self-contained HTML without shipping its vendored Three.
// Usage: node scripts/extract-four-scenes.mjs <input-directory> [output-directory]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import { parseSync } from 'rolldown/experimental';

const input = process.argv[2];
if (!input) throw new Error('Pass the directory containing the four supplied HTML files.');
const output = path.resolve(process.argv[3] || 'src/scenes');

function children(node) {
  return Object.entries(node).flatMap(([key, value]) => key === 'parent' ? [] :
    Array.isArray(value) ? value.filter(v => v && typeof v.type === 'string').map(v => [key, v]) :
    value && typeof value.type === 'string' ? [[key, value]] : []);
}

// Resolve lexical scopes rather than matching identifier text: bundles reuse short local names.
function freeReferences(source) {
  const ast = parseSync('extracted.js', source).program;
  const scopes = new WeakMap(), declared = new WeakSet();
  const root = { parent: null, names: new Set(), function: true };
  function pattern(node, scope) {
    if (!node) return;
    if (node.type === 'Identifier') { scope.names.add(node.name); declared.add(node); }
    else if (node.type === 'AssignmentPattern') pattern(node.left, scope);
    else if (node.type === 'RestElement') pattern(node.argument, scope);
    else if (node.type === 'ArrayPattern') node.elements.forEach(n => pattern(n, scope));
    else if (node.type === 'ObjectPattern') node.properties.forEach(p => pattern(p.type === 'RestElement' ? p.argument : p.value, scope));
  }
  function build(node, scope) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') pattern(node.id, scope);
    if (/Function(?:Expression|Declaration)$/.test(node.type) || node.type === 'ArrowFunctionExpression') {
      scope = { parent: scope, names: new Set(), function: true };
      pattern(node.id, scope); node.params.forEach(p => pattern(p, scope));
    } else if (node.type === 'BlockStatement' || /^(ForStatement|ForOfStatement|ForInStatement|CatchClause|ClassExpression|ClassDeclaration)$/.test(node.type)) {
      scope = { parent: scope, names: new Set(), function: false };
      if (node.type === 'CatchClause') pattern(node.param, scope);
      if (node.type.startsWith('Class')) pattern(node.id, scope);
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclaration') {
      let target = scope;
      if (node.kind === 'var') while (!target.function) target = target.parent;
      node.declarations.forEach(d => pattern(d.id, target));
    }
    for (const [, child] of children(node)) build(child, scope);
  }
  build(ast, root);
  const free = new Set();
  function visit(node, parent, key) {
    if (node.type === 'Identifier' && !declared.has(node)) {
      const property = (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && key === 'key' && !parent.computed) ||
        ((parent?.type === 'LabeledStatement' || parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement') && key === 'label');
      if (!property) {
        let scope = scopes.get(node);
        while (scope && !scope.names.has(node.name)) scope = scope.parent;
        if (!scope) free.add(node.name);
      }
    }
    for (const [k, child] of children(node)) visit(child, node, k);
  }
  visit(ast, null, '');
  return free;
}

const commonStart = `
  if (!scene?.isScene || !renderer) throw new TypeError('createScene requires the host scene and renderer');
  const previous = { background: scene.background, environment:scene.environment, fog: scene.fog, exposure: renderer.toneMappingExposure, toneMapping:renderer.toneMapping, shadowType:renderer.shadowMap.type };
  const ownedTargets=new Set();
  const existing = new Set(scene.children);
  const root = new HostGroup();
  root.name = 'environment:SCENE_ID';
  let disposed = false;
  let ownedRendererState;
  function rememberRendererState(){ownedRendererState={exposure:renderer.toneMappingExposure,toneMapping:renderer.toneMapping,shadowType:renderer.shadowMap.type};}
`;
const commonFinish = `
  // Keep host characters/lights intact; move only newly authored objects under this factory root.
  for (const child of [...scene.children]) if (!existing.has(child)) root.add(child);
  scene.add(root);
  rememberRendererState();
  const ownedBackground = scene.background, ownedFog = scene.fog, ownedEnvironment=scene.environment;
  const resources = { geometries: new Set(), materials: new Set(), textures: new Set(), lights: new Set(), instances:new Set() };
  const visited=new Set();
  function collectResource(value) {
    if(!value || typeof value!=='object' || visited.has(value))return;
    visited.add(value);
    if(value.isTexture){resources.textures.add(value);return;}
    if(value.isBufferGeometry){resources.geometries.add(value);return;}
    if(value.isMaterial){resources.materials.add(value);Object.values(value).forEach(collectResource);return;}
    if(value.isObject3D)return;
    if(value instanceof Set || value instanceof Map){for(const item of value.values())collectResource(item);return;}
    if(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype)Object.values(value).forEach(collectResource);
  }
  root.traverse(object => {
    collectResource(object.geometry); collectResource(object.material);
    if(object.isLight)resources.lights.add(object);
    if(object.isInstancedMesh)resources.instances.add(object);
    if(object.isReflector)ownedTargets.add(object.getRenderTarget());
  });
  COLLECT_AUTHORED

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const light of resources.lights) light.shadow?.dispose();
    for (const instance of resources.instances) instance.dispose();
    for (const geometry of resources.geometries) geometry.dispose();
    for (const material of resources.materials) material.dispose();
    for (const target of ownedTargets) {resources.textures.delete(target.texture);target.dispose();}
    for (const texture of resources.textures) texture.dispose();
    if (scene.background === ownedBackground) scene.background = previous.background;
    if (scene.fog === ownedFog) scene.fog = previous.fog;
    if (scene.environment === ownedEnvironment) scene.environment = previous.environment;
    if(renderer.toneMappingExposure===ownedRendererState.exposure)renderer.toneMappingExposure=previous.exposure;
    if(renderer.toneMapping===ownedRendererState.toneMapping)renderer.toneMapping=previous.toneMapping;
    if(renderer.shadowMap.type===ownedRendererState.shadowType)renderer.shadowMap.type=previous.shadowType;
EXTRA_DISPOSE
  }
`;

const configs = [
  {
    file: '便利店', id: 'convenience',
    select: [[388, 733]],
    setup: `const Vt = scene, Jt = renderer; Vt.fog = new HostFogExp2(659482, .0085);`,
    extra: `
  var vf=jh.attributes.position;
  ${'UPDATE_FUNCTION'}
  const cameraPresets = {
    overview: { direction: [19.85,14.4,25.2], fov:34.5, padding:1.08, target:[-.2,.2,.1] },
    // J has no rotation: its +Z storefront is at -2.55 + 7.2/2 = 1.05.
    // Equal camera/target X and Y make this a genuinely frontal, level view.
    companion: { position:[-2.2,2.1,18.5], target:[-2.2,2.1,1.05], fov:34.5 }
  };
  const anchor = new HostObject3D(); anchor.name = 'Character_Anchor';
  // The authored sidewalk ends at z=5; wet-road surface is y=.022.
  anchor.position.set(-2.2,.022,6.15);anchor.userData.facing=[0,0,1];anchor.userData.frontPlaneNormal=[0,0,1];root.add(anchor);
  const anchors = { character: anchor, Character_Anchor: anchor };
  // Exclude the 100-unit sky sphere, broad contact shadow and rain volume from host framing.
  const bounds=new HostBox3(); scene.updateMatrixWorld(true);
  ht.traverse(object=>{if(object.isMesh && !object.isInstancedMesh){object.geometry.computeBoundingBox();bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));}});
  const lightingPresets = ['day','dusk','night'];
  let activeLighting='night';
  const authoredLights=[];scene.traverse(node=>{if(node.isLight)authoredLights.push([node,node.intensity]);});
  const authoredEmission=new Map();scene.traverse(node=>{for(const material of [node.material].flat().filter(Boolean))if(material.emissive&&!authoredEmission.has(material))authoredEmission.set(material,material.emissiveIntensity);});
  const profiles={day:{sky:[0x75a8ca,0xa8c9df,0xd6e0e4,0xc0d9e5],fog:0xa7bbc6,point:.18,ambient:2.2,sun:3.5,exposure:1},dusk:{sky:[0x444e78,0x987d91,0xdcafa4,0x968eaf],fog:0x665e77,point:.68,ambient:1.55,sun:2.4,exposure:.96},night:{sky:[395794,1054759,1778994,3814468],fog:659482,point:1,ambient:1.38,sun:2.2,exposure:.94}};
  function setLighting(id='night') {
    if(!Object.hasOwn(profiles,id))return false;activeLighting=id;const profile=profiles[id];
    for(const [node,intensity]of authoredLights)node.intensity=node.isPointLight?intensity*profile.point:intensity;
    Uy.intensity=profile.ambient;wn.intensity=profile.sun;
    Uy.color.set(id==='night'?8362185:id==='day'?0xd4ebff:0xffd8ba);wn.color.set(id==='night'?10993128:id==='day'?0xfff0d6:0xffbd91);
    for(const [material,intensity]of authoredEmission)material.emissiveIntensity=intensity*(id==='day'?.32:id==='dusk'?.7:1);
    ['topColor','midColor','lowColor','accent'].forEach((key,index)=>Ey.uniforms[key].value.set(profile.sky[index]));
    Vt.fog.color.set(profile.fog);renderer.toneMapping=HostACES;renderer.toneMappingExposure=profile.exposure;rememberRendererState();return true;
  }
  function update(dt,time){updateAuthored(dt,time);const profile=profiles[activeLighting];Qh.intensity*=profile.point;eu.intensity*=profile.point;}
  setLighting();
`,
    result: `return {root,bounds,anchors,cameraPresets,lightingPresets,setLighting,update,dispose,
    fidelityDifferences:['Original bloom, film grain, vignette and night grading composer are not applied by the host renderer.']};`,
  },
  {
    file: '教室', id: 'classroom',
    select: [[310,368],[381,394]],
    setup: `const As = scene, at = renderer;scene.background=new HostColor();`,
    extra: `
  let activeLighting = 'afterschool';
  const lightingPresets = Object.keys(Gn);
  function setLighting(id='afterschool') {
    if (!Object.hasOwn(Gn,id)) return false;
    activeLighting=id; const preset=Gn[id];
    Qt.color.set(preset.key.color); Qt.intensity=preset.key.intensity;
    Qt.position.set(...preset.key.position).normalize().multiplyScalar(18);
    La.color.set(preset.ambient.sky); La.groundColor.set(preset.ambient.ground); La.intensity=preset.ambient.intensity;
    renderer.toneMapping=HostNeutral;renderer.toneMappingExposure=preset.exposure;rememberRendererState();
    scene.background.set(preset.background);
    Mi.userData.lighting.setPreset(id); renderer.shadowMap.needsUpdate=true; return true;
  }
  const cameraPresets={
    ...vr,
    overview:{direction:[.516,.555,.644],fov:34,padding:1.075,target:[0,.35,0]},
    companion:{position:[...Bt.camera.position],target:[...Bt.camera.target],fov:Bt.camera.fov || 34}
  };
  const anchor=Mi.getObjectByName('Character_Anchor');
  const anchors={character:anchor,Character_Anchor:anchor};
  function update(dt,time) { if(!disposed) Mi.userData.animate(Number.isFinite(time)?time:0); }
  setLighting();
`,
    result: `return {root,anchors,cameraPresets,lightingPresets,setLighting,update,dispose};`,
  },
  {
    file: '书店', id: 'bookshop',
    select: [[395,678],[700,700],[707,709],[722,725]],
    setup: `const Ki=scene, we=renderer, Yd=new URLSearchParams(); Ki.background=new HostColor(12043210); const xh={strength:0},Rx=false;`,
    extra: `
  const cameraPresets={...O0,overview:{...O0.overview,padding:1.08}};
  const anchors={character:Nn,Character_Anchor:Nn};
  const lightingPresets=Object.keys(z0);
  function setLighting(id='dusk') { const applied=T0(id);if(applied){renderer.toneMapping=HostACES;rememberRendererState();}return applied; }
  function update(dt,time) { if(disposed)return; const t=Number.isFinite(time)?time:0; zw(t); B0(t); }
  setLighting();
`,
    result: `return {root,anchors,cameraPresets,lightingPresets,setLighting,update,dispose,
    fidelityDifferences:['Original bloom, film grain and subtle color/vignette grading composer are not applied by the host renderer.']};`,
  },
  {
    file: '林间', id: 'forest',
    select: [[336,609],[615,615],[617,626],[640,640]],
    setup: `const Is=scene, Se=renderer, ii=new URLSearchParams(); Is.fog=new HostFogExp2(12568772,.0062);scene.background=new HostColor();`,
    extra: `
  const cameraPresets={
    overview:{direction:Hf.toArray(),target:$c.toArray(),fov:34,padding:1.08},
    companion:{...Vh.companion,position:Vh.companion.position.toArray(),target:Vh.companion.target.toArray()}
  };
  const anchors={character:vi,Character_Anchor:vi,target:nl};
  const lightingPresets=Object.keys(kh);
  function setLighting(id='morning') { if(!Object.hasOwn(kh,id))return false; Hh(id);return true; }
  function update(dt,time) {
    if(disposed)return; const delta=Math.min(.06,Math.max(0,Number.isFinite(dt)?dt:0));
    an.time=Number.isFinite(time)?time:an.time+delta;
    if(an.enabled){hf.value=an.time;Ps.uTime.value=an.time;vf(an.time);Tv(delta);vv(delta);}
  }
  setLighting();
`,
    result: `return {root,anchors,cameraPresets,lightingPresets,setLighting,update,dispose,
    fidelityDifferences:['Original fullscreen procedural background and vignette overlay are omitted; the host uses the preset background color.']};`,
  },
];

const sourceHashes={
  convenience:'487328f844fd3f0449fb149cfc3f37145a99ad9bb7b16f37f26842b68ee0b946',
  classroom:'b2c96026b8d419cd431c075c4c66bf9b24d4d8fc74ac2c4db640819a19ffa7d1',
  bookshop:'a0a41677e229ffe693d4ad2d44a9f5feb38bef0f9d4d077c3ef187898f07b63f',
  forest:'4696b55362c374bde968ce6e131cb8888ac71b6a78f62f91be208492a230c286',
};
for (const config of configs) {
  const html = fs.readFileSync(path.join(input, config.file + '.html'), 'utf8');
  if(createHash('sha256').update(html).digest('hex')!==sourceHashes[config.id])throw new Error(`${config.file}.html differs from the supplied bundle; review extraction boundaries before proceeding.`);
  const source = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const parsed = parseSync(config.id + '.js', source);
  if (parsed.errors.length) throw new Error(JSON.stringify(parsed.errors));
  const body = parsed.program.body[0].expression.callee.expression.body.body;
  const binding = new Map(), aliases = new Map();
  for (const statement of body) {
    if (statement.type === 'VariableDeclaration') for (const decl of statement.declarations) {
      if (decl.id.type !== 'Identifier') continue;
      const name = decl.id.name, text = source.slice(decl.start, decl.end);
      binding.set(name, `var ${text};`);
      if (decl.init?.type === 'ClassExpression') {
        const type = text.match(/this\.type="([\w]+)"/)?.[1];
        const flag = [...text.matchAll(/(?:\.prototype|this)\.is([\w]+)=!0/g)].map(m => m[1]).find(n => n in THREE);
        if (type && (type in THREE || ['Reflector','RoundedBoxGeometry'].includes(type))) aliases.set(name,type);
        else if (flag) aliases.set(name,flag);
        else if (/super\(new (Float32|Float64|Uint8|Uint16|Uint32|Int8|Int16|Int32)Array\(/.test(text)) aliases.set(name,text.match(/super\(new (\w+)Array\(/)[1]+'BufferAttribute');
      } else if (decl.init?.type === 'ObjectExpression' && /DEG2RAD:.*RAD2DEG:.*generateUUID:.*clamp:/.test(text)) aliases.set(name,'MathUtils');
    }
    if (statement.type === 'FunctionDeclaration') binding.set(statement.id.name, source.slice(statement.start,statement.end));
  }
  // The bookshop contains the complete original Three export map; it also recovers constants.
  for (const match of source.matchAll(/\b(\w+):\(\)=>([\w$]+)/g)) if (match[1] in THREE) aliases.set(match[2],match[1]);
  if(config.id==='bookshop') { aliases.set('W_','mergeGeometries'); aliases.set('G_','mergeAttributes'); }
  if(config.id==='classroom') { aliases.set('Da','mergeGeometries'); aliases.set('bu','mergeAttributes'); }
  let authored = config.select.flatMap(([start,end]) => body.slice(start,end+1)).map(node => source.slice(node.start,node.end)).join('\n');
  let extra = config.extra;
  if (config.id === 'convenience') {
    let update = source.slice(body[762].start,body[762].end)
      .replace('function Ny(){let i=Math.min(xf.getDelta(),.05),e=xf.elapsedTime,t=vf.array;', 'function updateAuthored(dt,time){if(disposed)return;let i=Math.min(Math.max(Number.isFinite(dt)?dt:0,0),.05),e=Number.isFinite(time)?time:0,t=vf.array;')
      .replace('Mc.uniforms.uTime.value=e,$t.update(),yi.render()', 'void 0');
    if (update.includes('xf.') || update.includes('yi.render')) throw new Error('Convenience animation bootstrap changed');
    extra = extra.replace('UPDATE_FUNCTION',update);
  }
  if (config.id === 'classroom') {
    // Omit the host scene declaration/add twice; preserve the authored root and key/fill lights.
    authored=authored.replace('var As=new Hs;','').replace('As.background=null;','');
  }
  if (config.id === 'bookshop') {
    // Camera fit/collision helpers belong to the host, not authored geometry.
    authored=authored.replace('let a=o.fromEquirectangular(r).texture;', 'let target=o.fromEquirectangular(r),a=target.texture;ownedTargets.add(target);');
  }
  if (config.id === 'forest') {
    // The presets share a variable statement with fullscreen layers: preserve its kh/jh declarations.
    const omit=new Set([580,581,582,583,584,585]);
    authored=config.select.flatMap(([start,end])=>body.slice(start,end+1).map((node,index)=>({node,index:start+index})))
      .filter(({index})=>!omit.has(index))
      .map(({node,index})=>index===579 ? 'var '+node.declarations.slice(0,2).map(d=>source.slice(d.start,d.end)).join(',')+';' : source.slice(node.start,node.end)).join('\n');
    authored=authored.replace(',$b=new co,',',').replace(',rv(e);',';');
    // The background is a host-owned clear color, not geometry in the framing bounds.
    extra=extra.replace('Hh(id);return true;', 'Hh(id);renderer.toneMapping=HostNeutral;rememberRendererState();scene.background.set(kh[id].fogColor);return true;');
  }
  const dependencies=new Map(), imports=new Map();
  const customAliases={HostGroup:'Group',HostObject3D:'Object3D',HostFogExp2:'FogExp2',HostColor:'Color',HostBox3:'Box3',HostACES:'ACESFilmicToneMapping',HostNeutral:'NeutralToneMapping'};
  for (const [name,exported] of Object.entries(customAliases)) aliases.set(name,exported);
  const allowed=new Set(['scene','renderer','Math','Number','isFinite','Object','Array','Set','Map','WeakMap','Uint8Array','Float32Array','Uint16Array','Uint32Array','Int32Array','Uint8ClampedArray','Infinity','NaN','undefined','document','URLSearchParams','console','JSON','String','Boolean','Error','TypeError','performance']);
  const prefix=commonStart.replace('SCENE_ID',config.id)+config.setup;
  const authoredBindings=parseSync('authored.js',authored).program.body.flatMap(node=>node.type==='VariableDeclaration'?node.declarations.filter(d=>d.id.type==='Identifier').map(d=>d.id.name):[]);
  const suffix=commonFinish.replace('COLLECT_AUTHORED',`[${authoredBindings.join(',')}].forEach(collectResource);${config.id==='classroom'?'collectResource(Mi.userData.owned);':''}`).replace('EXTRA_DISPOSE','');
  function resolve(code) {
    for (const name of freeReferences(code)) {
      if(allowed.has(name)||imports.has(name)||dependencies.has(name))continue;
      if(aliases.has(name)) {imports.set(name,aliases.get(name));continue;}
      if(!binding.has(name))throw new Error(`${config.id}: unresolved ${name}`);
      dependencies.set(name,binding.get(name));resolve(binding.get(name));
    }
  }
  resolve(`function factory(scene,renderer){${prefix}\n${authored}\n${extra}\n${suffix}\n${config.result}}`);
  const vendored=[...dependencies].filter(([,code])=>/\bclass\b|THREE\./.test(code));
  if(vendored.length)throw new Error(`${config.id}: unrecognized library dependencies ${vendored.map(([n])=>n)}`);
  const addonImports=[];
  const coreImports=[];
  for(const [local,name]of imports) {
    if(name==='RoundedBoxGeometry')addonImports.push(`import { RoundedBoxGeometry as ${local} } from 'three/addons/geometries/RoundedBoxGeometry.js';`);
    else if(name==='Reflector')addonImports.push(`import { Reflector as ${local} } from 'three/addons/objects/Reflector.js';`);
    else if(['mergeGeometries','mergeAttributes'].includes(name))addonImports.push(`import { ${name} as ${local} } from 'three/addons/utils/BufferGeometryUtils.js';`);
    else coreImports.push(`${name} as ${local}`);
  }
  const module=`// Authored geometry/materials/animation extracted from ${config.file}.html.\n// Standalone vendored Three, renderer, controls, DOM UI and animation loops are intentionally excluded.\nimport { ${coreImports.join(', ')} } from 'three';\n${addonImports.join('\n')}\n\nexport function createScene({scene,renderer}={}) {\n${prefix}\n${[...dependencies.values()].join('\n')}\n${authored}\n${extra}\n${suffix}\n${config.result}\n}\n`;
  const errors=parseSync(config.id+'.mjs',module).errors;
  if(errors.length)throw new Error(`${config.id}: ${JSON.stringify(errors)}`);
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,config.id+'.mjs'),module);
  console.log(`${config.id}: ${module.length} chars; ${imports.size} shared imports; ${dependencies.size} primitive/helper bindings`);
}
