// Narrow, offline extractor for the three user-supplied standalone scene bundles.
// Reads source text only: never evaluates the supplied HTML or its bundled Three.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/experimental';
import * as THREE from 'three';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = [
  ['婚礼.html', 'surf-hall', 'Dd', 'Ad'],
  ['雪乃学校.html', 'school', 'Nh', 'Ch'],
  ['葛西临海公园.html', 'kasai', 'wu', 'yu'],
];
const union = (...sets) => new Set(sets.flatMap(s => [...s]));
function names(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'AssignmentPattern') return names(pattern.left);
  if (pattern.type === 'RestElement') return names(pattern.argument);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(names);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(p => names(p.value || p.argument));
  return [];
}
function declarations(node) {
  if (node.type === 'VariableDeclaration') return node.declarations.flatMap(d => names(d.id));
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return names(node.id);
  return [];
}
function children(node) {
  return Object.entries(node).filter(([k]) => !['start', 'end', 'type'].includes(k))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter(value => value && typeof value === 'object' && value.type);
}
function free(node) {
  if (!node) return new Set();
  if (node.type === 'Identifier') return new Set([node.name]);
  if (node.type === 'MemberExpression') return union(free(node.object), node.computed ? free(node.property) : new Set());
  if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(node.type))
    return union(node.computed ? free(node.key) : new Set(), free(node.value));
  if (node.type === 'VariableDeclarator') return union(free(node.init), patternDefaults(node.id));
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
    const refs = union(free(node.body), ...node.params.map(patternDefaults));
    for (const name of [...names(node.id), ...node.params.flatMap(names)]) refs.delete(name);
    return refs;
  }
  const refs = union(...children(node).map(free));
  if (node.type === 'Program' || node.type === 'BlockStatement')
    for (const name of node.body.flatMap(declarations)) refs.delete(name);
  if (['ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type))
    for (const name of declarations(node.init || node.left || {})) refs.delete(name);
  if (node.type === 'CatchClause') for (const name of names(node.param)) refs.delete(name);
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression')
    for (const name of names(node.id)) refs.delete(name);
  return refs;
}
function patternDefaults(pattern) {
  if (!pattern || pattern.type === 'Identifier') return new Set();
  if (pattern.type === 'AssignmentPattern') return union(patternDefaults(pattern.left), free(pattern.right));
  return union(...children(pattern).filter(n => n.type !== 'Identifier').map(patternDefaults));
}
function walk(node, visit) {
  if (!node) return;
  visit(node);
  children(node).forEach(child => walk(child, visit));
}
function parse(code) {
  const result = parseSync('scene.js', code);
  if (result.errors.length) throw new Error(JSON.stringify(result.errors));
  return result.program;
}
function bindingMap(body) {
  const bindings = new Map();
  for (const node of body) {
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) bindings.set(d.id.name, d.init);
    else if (node.type === 'FunctionDeclaration') bindings.set(node.id.name, node);
  }
  return bindings;
}
function exportedName(node, text) {
  const markers = [...text.matchAll(/this\.(?:type\s*=\s*["']([^"']+)["']|is(\w+)\s*=\s*!0)/g)]
    .map(m => m[1] || m[2]).filter(name => THREE[name]);
  if (markers.length) return markers.at(-1);
  const prototypeMarker = text.match(/\.prototype\.is(\w+)\s*=\s*!0/);
  if (prototypeMarker && THREE[prototypeMarker[1]]) return prototypeMarker[1];
  if (text.includes('super(new Float32Array(')) return 'Float32BufferAttribute';
  if (text.includes('this._pingPongRenderTarget=null')) return 'PMREMGenerator';
  if (node?.type === 'Literal') {
    const matches = Object.keys(THREE).filter(name => THREE[name] === node.value);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function replaceOnce(code, before, after) {
  if (!code.includes(before) || code.indexOf(before) !== code.lastIndexOf(before))
    throw new Error(`Expected unique adaptation target: ${before}`);
  return code.replace(before, after);
}
function adaptFactory(code, output) {
  const program = parse(code);
  let tree;
  walk(program, node => {
    if (node.type === 'MethodDefinition' && node.key.name === 'tree') tree = node;
  });
  if (!tree) throw new Error('Missing environment toolkit tree method');
  const random = { 'surf-hall': 'He', school: 'qe', kasai: 'Ce' }[output];
  code = code.slice(0, tree.start) + leafCardTree(random) + code.slice(tree.end);
  if (output === 'surf-hall') {
    const replacements = [
      ['o=15,c=.165,l=.34,u=o*l,h=2.475,d=4.9,f=d-u', 'o=26,c=.165,l=.34,u=o*l,h=o*c,d=4.9+(o-15)*l,f=d-u'],
      ['position:[1.55,2.475,-.85]', 'position:[1.55,26*.165,-.85]'],
      ['ct=[d+.2,4.05,3,1.95,.9,f]', 'ct=Array.from({length:Math.ceil((d+.2-f)/1.05)+1},(_,index)=>d+.2-(d+.2-f)*index/Math.ceil((d+.2-f)/1.05))'],
      ['ht=new I(bt,$e,d+.24)', 'ht=new I(bt,Kn(d+.24),d+.24)'],
      ['let L=[1,4,7,10,13],k=', 'let L=Array.from({length:Math.ceil((o-1)/3)},(_,index)=>1+index*3).filter(index=>index<o),k='],
      ['[L*2.56,5.9,-4.2]', '[L*2.56,h+3.425,-4.2]'],
      ['L.position.set(0,7.15,-5.78)', 'L.position.set(0,h+4.675,-5.78)'],
      ['[5.415,6.5,L]', '[5.415,h+4.025,L]'],
      ['[-5.415,6.5,L]', '[-5.415,h+4.025,L]'],
      ['[5.42,4.86,L]', '[5.42,h+2.385,L]'],
      ['[-5.42,4.86,L]', '[-5.42,h+2.385,L]'],
      ['[5.4,8.12,L]', '[5.4,h+5.645,L]'],
      ['[-5.4,8.12,L]', '[-5.4,h+5.645,L]'],
      ['[L,5.2,-8.11]', '[L,h+2.725,-8.11]'],
      ['Hl.position.set(0,7.2,-4.4)', 'Hl.position.set(0,h+4.725,-4.4)'],
      ['Gl.position.set(-2.8,1.1,3.9)', 'Gl.position.set(-2.8,1.1,d-1)'],
      ['Wl.position.set(2.8,1.1,3.9)', 'Wl.position.set(2.8,1.1,d-1)'],
      ['let L=new sn(Pn+.06,vr+.06),k=', 'let L=e._trackGeo(new sn(Pn+.06,vr+.06)),k='],
    ];
    for (const [before, after] of replacements) code = replaceOnce(code, before, after);
  }
  // Both supplied entrances face +Z. Center on their actual facades and pull
  // back enough to keep the school wings / full Crystal View frontage visible.
  if (output === 'school') {
    code = replaceOnce(code, 'companion:{position:[8.6,2.05,19.8],target:[.2,4.4,1.8],fov:42}', 'companion:{position:[0,8.2,52],target:[0,6.4,-8.4],fov:42}');
    code = replaceOnce(code, 'Ih=["morning","afternoon","dusk"]', 'Ih=["morning","afternoon","dusk","night"]');
    code = replaceOnce(code, 'var Ph=Object.freeze({morning:', 'var Ph=Object.freeze({night:Ol({id:"night",label:"夜",sky:["#0b1424","#19273d","#344358","#655d63"],exposure:1.02,envIntensity:.2,sun:{color:"#a4bee3",intensity:.35,position:[-18,24,-12]},ambient:{sky:"#56708e",ground:"#302d29",intensity:.48},fill:{color:"#829fc3",intensity:.17,position:[12,8,16]},lamp:!0}),morning:');
    code = replaceOnce(code, 'Qn.intensity=rt.id==="dusk"?.55:rt.id==="morning"?.12:.06;', 'Qn.intensity=rt.id==="night"?.12:rt.id==="dusk"?.55:rt.id==="morning"?.12:.06;Tt.emissive.set("#ffd49a"),Tt.emissiveIntensity=rt.id==="night"?.72:rt.id==="dusk"?.13:0,Yt.emissive.set("#ffca8a"),Yt.emissiveIntensity=rt.id==="night"?.16:0,Zt.emissive.set("#ffd49a"),Zt.emissiveIntensity=rt.id==="night"?.4:rt.id==="dusk"?.08:0;');
    code = replaceOnce(code, 'return ye.opacity=rt.lamp?.82:0,', 'return bs.intensity=rt.id==="night"?.06:.3,ye.opacity=rt.id==="night"?.94:rt.lamp?.82:0,');
  }
  if (output === 'kasai') {
    code = replaceOnce(code, 'companion:{position:[2.6,1.82,16.4],target:[.2,-.3,-38],fov:40}', 'companion:{position:[0,6.4,70],target:[0,5.6,-16],fov:42}');
    code = replaceOnce(code, 'j?.dispose(),j=null,i&&Q&&(i.environment=Q)', 'i&&j&&i.environment===j.texture&&(i.environment=Q),j?.dispose(),j=null');
  }
  // Toolkit geometries/materials are tracked separately; instance-specific GPU buffers are not.
  code = code.replace(/e\.dispose\(\),Ke\.shadow/g, 'n.traverse(object=>{if(object.isInstancedMesh)object.dispose()}),e.dispose(),Ke.shadow');
  code = code.replace(/t\.dispose\(\),Ae\.shadow/g, 'e.traverse(object=>{if(object.isInstancedMesh)object.dispose()}),t.dispose(),Ae.shadow');
  code = code.replace(/e\.dispose\(\),n\.parent/g, 'n.traverse(object=>{if(object.isInstancedMesh)object.dispose()}),e.dispose(),n.parent');
  return code;
}
function leafCardTree(random) {
  return `tree({position=[0,0,0],height=7,radius=2.6,seed=1,palette=null,trunkColor="#6c5b48",trunkRadius=.2,clusters=22,lean=0,canopyStart=.44,name="tree"}={}) {
  // Open, irregular branch structure, not scaled sphere/icosahedron crowns.
  const random=${random}(seed), tree=new SceneTreeGroup();
  tree.name=name; tree.position.set(...position);
  const colors=palette||["#3f5a34","#4a6738","#5e7c42","#74904d","#8aa557"];
  const bark=this.standard(trunkColor,{roughness:1,name:"tree:trunk"});
  const trunkTop=new SceneTreeVector(lean*height*.46,height*.66,0);
  const trunk=this.beam([0,0,0],trunkTop.toArray(),trunkRadius,bark,{name:"tree:trunk"});
  tree.add(trunk);
  const twigTips=[], branchCount=7+Math.floor(random()*4);
  for(let branch=0;branch<branchCount;branch++) {
    const level=branch/(branchCount-1), angle=branch*2.39996+(random()-.5)*.85;
    const base=new SceneTreeVector(lean*height*(.25+level*.2),height*(canopyStart*.82+level*.25),0);
    const reach=radius*(.42+random()*.55)*(1-level*.34);
    const tip=new SceneTreeVector(Math.cos(angle)*reach+lean*height*.48,height*(.61+level*.32+(random()-.5)*.09),Math.sin(angle)*reach);
    tree.add(this.beam(base.toArray(),tip.toArray(),trunkRadius*(.29-level*.12),bark,{name:"tree:branch"}));
    for(let fork=0;fork<3;fork++) {
      const start=base.clone().lerp(tip,.57+fork*.14);
      const forkAngle=angle+(fork-1)*.86+(random()-.5)*.6;
      const forkReach=radius*(.2+random()*.21);
      const end=tip.clone().add(new SceneTreeVector(Math.cos(forkAngle)*forkReach,(random()-.25)*height*.11,Math.sin(forkAngle)*forkReach));
      tree.add(this.beam(start.toArray(),end.toArray(),trunkRadius*.085,bark,{name:"tree:twig"}));
      twigTips.push(end);
    }
  }
  const count=Math.max(240,Math.round(clusters*18));
  const canopy=new SceneTreeInstances(this._unit.card,this._leafCardMaterial(),count);
  canopy.name="tree:canopy"; canopy.castShadow=true; canopy.receiveShadow=true;
  canopy.userData.foliage="instanced-leaf-cards";
  const transform=new SceneTreeTransform(), color=new SceneTreeColor();
  for(let index=0;index<count;index++) {
    const tip=twigTips[index%twigTips.length], spread=radius*(.12+random()*.17);
    transform.position.copy(tip).add(new SceneTreeVector((random()-.5)*spread*2,(random()-.5)*height*.15,(random()-.5)*spread*2));
    transform.rotation.set((random()-.5)*Math.PI,random()*Math.PI*2,(random()-.5)*Math.PI);
    const size=radius*(.15+random()*.15);
    transform.scale.set(size*(.75+random()*.6),size*(.7+random()*.6),1);
    transform.updateMatrix(); canopy.setMatrixAt(index,transform.matrix);
    color.set(colors[Math.floor(random()*colors.length)]).offsetHSL((random()-.5)*.02,(random()-.5)*.06,(random()-.5)*.045);
    canopy.setColorAt(index,color);
  }
  canopy.instanceMatrix.needsUpdate=true;
  if(canopy.instanceColor)canopy.instanceColor.needsUpdate=true;
  tree.add(canopy); return tree;
}`;
}
function factoryWrapper(factory) {
  return `// Keep the supplied factory's API while respecting the host's shared renderer/scene.
export function createScene({scene=null,renderer=null}={}) {
  const previous={background:scene?.background,environment:scene?.environment,environmentIntensity:scene?.environmentIntensity,exposure:renderer?.toneMappingExposure};
  const instance=${factory}({scene,renderer});
  let disposed=false, lighting=instance.defaultLighting;
  function ownedState() {
    return {background:scene?.background,environment:scene?.environment,environmentIntensity:scene?.environmentIntensity,exposure:renderer?.toneMappingExposure};
  }
  const originalSetLighting=instance.setLighting, originalUpdate=instance.update, originalDispose=instance.dispose;
  if(renderer&&instance.exposureFor)renderer.toneMappingExposure=instance.exposureFor(lighting);
  let owned=ownedState();
  instance.setLighting=(id)=>{
    if(disposed)return lighting;
    lighting=originalSetLighting(id);
    if(renderer&&instance.exposureFor)renderer.toneMappingExposure=instance.exposureFor(lighting);
    owned=ownedState();
    return lighting;
  };
  instance.update=(...args)=>{if(!disposed)originalUpdate(...args)};
  instance.dispose=()=>{
    if(disposed)return;
    disposed=true;
    const restoreBackground=scene&&scene.background===owned.background;
    const restoreEnvironment=scene&&scene.environment===owned.environment;
    const restoreIntensity=scene&&scene.environmentIntensity===owned.environmentIntensity;
    const restoreExposure=renderer&&renderer.toneMappingExposure===owned.exposure;
    originalDispose();
    if(restoreBackground)scene.background=previous.background;
    if(restoreEnvironment)scene.environment=previous.environment;
    if(restoreIntensity)scene.environmentIntensity=previous.environmentIntensity;
    if(restoreExposure)renderer.toneMappingExposure=previous.exposure;
  };
  return instance;
}`;
}

export function extract(inputDir, outputDir = path.join(project, 'src/scenes')) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [filename, output, factory, bootstrap] of sources) {
    const html = fs.readFileSync(path.join(inputDir, filename), 'utf8');
    const source = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
    let callee = parse(source).body[0].expression.callee;
    while (callee.type === 'ParenthesizedExpression') callee = callee.expression;
    const body = callee.body.body;
    const bindings = bindingMap(body);
    const rounded = [...bindings].find(([, n]) => n?.type === 'ClassExpression' && source.slice(n.start, n.end).includes('this.type="RoundedBoxGeometry"'));
    if (!rounded) throw new Error(`Missing RoundedBoxGeometry boundary in ${filename}`);
    const start = body.findIndex(node => node.start <= rounded[1].start && node.end >= rounded[1].end) + 1;
    const candidates = body.slice(start).filter(node => !(node.type === 'FunctionDeclaration' && node.id.name === bootstrap) && node !== body.at(-1));
    const owners = new Map(candidates.flatMap(node => declarations(node).map(name => [name, node])));
    const reachable = new Set();
    function include(name) {
      const node = owners.get(name);
      if (!node || reachable.has(node)) return;
      reachable.add(node);
      free(node).forEach(include);
    }
    include(factory);
    const retained = candidates.filter(node => reachable.has(node));
    let code = retained.map(node => source.slice(node.start, node.end)).join('\n');
    code = adaptFactory(code, output);
    const refs = free(parse(code));
    const globals = new Set(['Math', 'Object', 'Array', 'Number', 'String', 'Map', 'Set', 'Uint8Array', 'Float32Array', 'document', 'console', 'Infinity', 'undefined', 'parseInt']);
    const imports = [];
    const unresolved = [];
    for (const ref of [...refs].sort()) {
      if (globals.has(ref)) continue;
      if (ref === rounded[0]) continue;
      const node = bindings.get(ref);
      let name = ({ SceneTreeGroup: 'Group', SceneTreeInstances: 'InstancedMesh', SceneTreeTransform: 'Object3D', SceneTreeColor: 'Color', SceneTreeVector: 'Vector3' })[ref]
        || exportedName(node, node ? source.slice(node.start, node.end) : '');
      if (!name) {
        // Some base classes mark isX on their prototype rather than in constructors.
        const marker = source.match(new RegExp(ref + '\\.prototype\\.is(\\w+)\\s*=\\s*!0'));
        if (marker && THREE[marker[1]]) name = marker[1];
      }
      if (!name && node?.type === 'Literal') {
        const constants = { '': 'NoColorSpace', srgb: 'SRGBColorSpace', 1008: 'LinearMipmapLinearFilter' };
        name = constants[node.value];
        if (!name && node.value === 0) name = 'FrontSide';
        if (!name && node.value === 1) name = 'NormalBlending';
        if (!name && node.value === 2) name = new RegExp('blending:' + ref + '\\b').test(code) ? 'AdditiveBlending' : 'DoubleSide';
      }
      if (!name) unresolved.push([ref, node ? source.slice(node.start, Math.min(node.end, node.start + 120)) : 'missing']);
      else imports.push(`${name} as ${ref}`);
    }
    if (unresolved.length) throw new Error(`${filename}: unresolved imports ${JSON.stringify(unresolved)}`);
    const header = `// Geometry/material toolkit and factory extracted from user-supplied ${filename}.\n// The standalone renderer, controls, bundled Three, and HTML bootstrap are intentionally omitted.\n`;
    const result = `${header}import { ${imports.join(', ')} } from 'three';\nimport { RoundedBoxGeometry as ${rounded[0]} } from 'three/addons/geometries/RoundedBoxGeometry.js';\n\n${code}\n\n${factoryWrapper(factory)}\n`;
    fs.writeFileSync(path.join(outputDir, `${output}.mjs`), result);
    console.log(`${output}: ${Buffer.byteLength(result)} bytes; ${imports.length} Three imports`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/extract-coastal-scene-factories.mjs <supplied-html-directory> [output-directory]');
  extract(process.argv[2], process.argv[3]);
}
