'use strict';
// A deliberately bounded, embedded-only glTF 2.0 import profile. Validation does
// not execute model code, fetch URIs, invent bones, or claim automatic skinning.
// Format reference: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const MAX_BYTES=64*1024**2,MAX_JSON=4*1024**2,MAX_VERTICES=500000,MAX_TRIANGLES=1000000;
const digest=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>{throw Error(message);};
const integer=(value,min,max,label)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(label+'无效或超出限制');return value;};
const list=(value,max,label)=>{if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)fail(label+'数量无效或超出限制');return value;};
const object=(value,label)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(label+'无效');return value;};
const ref=(items,index,label)=>items[integer(index,0,items.length-1,label)];
const boundedName=(value,fallback,max=80)=>typeof value==='string'&&value.trim()?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,max):fallback;
const EXTENSIONS=new Set(['KHR_materials_unlit','KHR_texture_transform','KHR_materials_emissive_strength']);
function imageSize(data,mime){
 if(mime==='image/png'){
  if(data.length<33||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.toString('ascii',12,16)!=='IHDR')fail('PNG 纹理格式无效');
  return [data.readUInt32BE(16),data.readUInt32BE(20)];
 }
 if(mime!=='image/jpeg'||data.length<4||data.readUInt16BE(0)!==0xffd8)fail('仅支持完整内嵌的 PNG/JPEG 纹理');
 let offset=2;
 while(offset<data.length){
  if(data[offset++]!==0xff)fail('JPEG 纹理格式无效');while(data[offset]===0xff)offset++;
  const marker=data[offset++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  if(offset+2>data.length)break;const length=data.readUInt16BE(offset);if(length<2||offset+length>data.length)break;
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(length<8)break;return [data.readUInt16BE(offset+5),data.readUInt16BE(offset+3)];}
  offset+=length;
 }
 fail('JPEG 纹理缺少有效尺寸');
}
function inspectGlbUnchecked(input){
 const data=Buffer.isBuffer(input)?input:Buffer.from(input||[]);
 if(data.length<28||data.length>MAX_BYTES||data.readUInt32LE(0)!==0x46546c67||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length)fail('需要完整的 GLB 2.0 文件，大小不得超过 64 MiB');
 const jsonBytes=data.readUInt32LE(12);if(jsonBytes<4||jsonBytes>MAX_JSON||jsonBytes%4||20+jsonBytes+8>data.length||data.readUInt32LE(16)!==0x4e4f534a)fail('GLB JSON 区块无效');
 const binHeader=20+jsonBytes,binBytes=data.readUInt32LE(binHeader);
 if(data.readUInt32LE(binHeader+4)!==0x004e4942||binBytes%4||binHeader+8+binBytes!==data.length)fail('GLB 必须仅包含 JSON 和内嵌 BIN 区块');
 let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(20,binHeader)).trim());}catch{fail('GLB JSON 无法解析');}
 object(json,'模型清单');if(json.asset?.version!=='2.0'||(json.asset.minVersion&&json.asset.minVersion!=='2.0'))fail('仅支持 glTF 2.0 模型');
 let objects=0;
 function scan(value,depth=0){
  if(depth>64||++objects>150000)fail('模型清单嵌套或属性数量过多');
  if(typeof value==='number'&&!Number.isFinite(value))fail('模型含有非有限数值');
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
   if(key==='uri'&&(typeof item!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(item)))fail('模型包含外部 URI，请将缓冲和纹理内嵌后重新导出 GLB');
   if(key==='extensions')for(const extension of Object.keys(object(item,'扩展')))if(!EXTENSIONS.has(extension))fail('当前不支持扩展 '+boundedName(extension,'未知扩展',80)+'，请导出普通未压缩 GLB');
   scan(item,depth+1);
  }
 }
 scan(json);
 for(const extension of [...list(json.extensionsUsed,16,'扩展'),...list(json.extensionsRequired,16,'必需扩展')])if(!EXTENSIONS.has(extension))fail('当前不支持扩展 '+boundedName(extension,'未知扩展',80)+'，请导出普通未压缩 GLB');
 const buffers=list(json.buffers,1,'缓冲');if(buffers.length!==1||buffers[0].uri!==undefined)fail('模型必须使用单一内嵌 BIN 缓冲');
 const bufferBytes=integer(buffers[0].byteLength,1,binBytes,'缓冲长度');if(binBytes-bufferBytes>3)fail('BIN 缓冲长度与清单不一致');
 const bin=data.subarray(binHeader+8,binHeader+8+bufferBytes),views=list(json.bufferViews,8192,'缓冲视图');
 for(const view of views){object(view,'缓冲视图');if(view.buffer!==0)fail('缓冲视图引用了不存在的缓冲');const offset=integer(view.byteOffset??0,0,bufferBytes,'视图偏移'),length=integer(view.byteLength,1,bufferBytes,'视图长度');if(offset+length>bufferBytes)fail('缓冲视图越界');if(view.byteStride!==undefined){integer(view.byteStride,4,252,'视图步长');if(view.byteStride%4)fail('视图步长未按四字节对齐');}if(view.target!==undefined&&![34962,34963].includes(view.target))fail('缓冲视图用途无效');}
 const components={5120:[1,'readInt8'],5121:[1,'readUInt8'],5122:[2,'readInt16LE'],5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']},shapes={SCALAR:[1,1],VEC2:[1,2],VEC3:[1,3],VEC4:[1,4],MAT2:[2,2],MAT3:[3,3],MAT4:[4,4]};
 const accessors=list(json.accessors,8192,'访问器'),readers=[];let componentBudget=0,sparseBudget=0;
 for(const accessor of accessors){
  object(accessor,'访问器');const component=components[accessor.componentType],shape=shapes[accessor.type];if(!component||!shape)fail('访问器类型无效');
  const count=integer(accessor.count,1,2000000,'访问器元素数量'),columns=shape[0],rows=shape[1],columnBytes=columns>1?Math.ceil(rows*component[0]/4)*4:rows*component[0],size=columns*columnBytes;
  componentBudget+=count*columns*rows;if(componentBudget>16000000)fail('模型访问器数据量过大，请简化后导入');
  if(accessor.normalized!==undefined&&typeof accessor.normalized!=='boolean')fail('访问器归一化标记无效');if(accessor.normalized&&[5125,5126].includes(accessor.componentType))fail('此访问器类型不可归一化');
  const offset=integer(accessor.byteOffset??0,0,bufferBytes,'访问器偏移');let view,start=0,stride=size;
  if(accessor.bufferView!==undefined){view=ref(views,accessor.bufferView,'访问器缓冲视图');stride=view.byteStride||size;start=(view.byteOffset||0)+offset;if(stride<size||offset+(count-1)*stride+size>view.byteLength||start%component[0]||(columns>1&&start%4))fail('访问器字节范围越界或未正确对齐');}
  else if(offset)fail('空缓冲访问器不能包含偏移');
  let sparseRows=null,sparseStart=0;
  if(accessor.sparse!==undefined){
   const sparse=object(accessor.sparse,'稀疏访问器'),sparseCount=integer(sparse.count,1,count,'稀疏元素数量'),indices=object(sparse.indices,'稀疏索引'),values=object(sparse.values,'稀疏数值'),indexType=components[indices.componentType];
   sparseBudget+=sparseCount;if(sparseBudget>1000000)fail('稀疏数据量过大，请简化模型');
   if(![5121,5123,5125].includes(indices.componentType))fail('稀疏索引类型无效');const indexView=ref(views,indices.bufferView,'稀疏索引缓冲'),valueView=ref(views,values.bufferView,'稀疏数值缓冲');
   const indexOffset=integer(indices.byteOffset??0,0,indexView.byteLength,'稀疏索引偏移'),valueOffset=integer(values.byteOffset??0,0,valueView.byteLength,'稀疏数值偏移');
   if(indexView.byteStride||valueView.byteStride||indexOffset+sparseCount*indexType[0]>indexView.byteLength||valueOffset+sparseCount*size>valueView.byteLength||((indexView.byteOffset||0)+indexOffset)%indexType[0]||((valueView.byteOffset||0)+valueOffset)%component[0])fail('稀疏访问器范围越界或未对齐');
   sparseRows=new Map();let previous=-1;sparseStart=(valueView.byteOffset||0)+valueOffset;
   for(let i=0;i<sparseCount;i++){const index=bin[indexType[1]]((indexView.byteOffset||0)+indexOffset+i*indexType[0]);if(index<=previous||index>=count)fail('稀疏索引重复、乱序或超出访问器范围');sparseRows.set(index,i);previous=index;}
  }
  const read=(row,column=0)=>{const sparseIndex=sparseRows?.get(row),componentOffset=Math.floor(column/rows)*columnBytes+(column%rows)*component[0];if(sparseIndex!==undefined)return bin[component[1]](sparseStart+sparseIndex*size+componentOffset);return view?bin[component[1]](start+row*stride+componentOffset):0;};
  for(const bound of ['min','max'])if(accessor[bound]!==undefined&&(!Array.isArray(accessor[bound])||accessor[bound].length!==columns*rows||accessor[bound].some(value=>!Number.isFinite(value))))fail('访问器边界无效');
  if(accessor.componentType===5126)for(let row=0;row<count;row++)for(let col=0;col<columns*rows;col++){const value=read(row,col);if(!Number.isFinite(value)||Math.abs(value)>1e12)fail('模型浮点数据无效或过大');}
  readers.push({accessor,view,read,count,stored:Boolean(view||sparseRows),components:columns*rows});
 }
 const nodes=list(json.nodes,4096,'节点'),meshes=list(json.meshes,256,'网格'),skins=list(json.skins,64,'蒙皮'),scenes=list(json.scenes,64,'场景');
 if(!nodes.length||!meshes.length||!scenes.length)fail('模型必须包含可展示的网格、节点和场景');
 const parents=new Map();
 for(const [index,node] of nodes.entries()){
  object(node,'节点');if(node.mesh!==undefined)ref(meshes,node.mesh,'网格引用');if(node.skin!==undefined){ref(skins,node.skin,'蒙皮引用');if(node.mesh===undefined)fail('蒙皮节点缺少网格');}
  for(const child of list(node.children,4096,'子节点')){ref(nodes,child,'子节点引用');if(parents.has(child))fail('节点存在重复父级');parents.set(child,index);}
  for(const [key,size] of [['matrix',16],['translation',3],['rotation',4],['scale',3]])if(node[key]!==undefined&&(!Array.isArray(node[key])||node[key].length!==size||node[key].some(value=>!Number.isFinite(value)||Math.abs(value)>1000000)))fail('节点变换无效');
  if(node.rotation&&Math.abs(node.rotation.reduce((sum,value)=>sum+value*value,0)-1)>.001)fail('节点四元数必须归一化');
  if(node.matrix&&['translation','rotation','scale'].some(key=>node[key]!==undefined))fail('节点矩阵不能同时包含独立变换');
 }
 const colors=new Map();function visit(index,depth=0){if(depth>128||colors.get(index)===1)fail('节点层级循环或过深');if(colors.get(index)===2)return;colors.set(index,1);for(const child of nodes[index].children||[])visit(child,depth+1);colors.set(index,2);}nodes.forEach((_node,index)=>visit(index));
 for(const scene of scenes){object(scene,'场景');for(const root of list(scene.nodes,4096,'场景根节点')){ref(nodes,root,'场景节点');if(parents.has(root))fail('场景根节点存在父级');}}
 const scene=ref(scenes,json.scene??0,'默认场景');if(!scene.nodes?.length)fail('默认场景为空');
 const activeNodes=new Set();function visible(index){activeNodes.add(index);for(const child of nodes[index].children||[])visible(child);}scene.nodes.forEach(visible);
 function positionBounds(reader){
  if(!reader.accessor.min||!reader.accessor.max)fail('顶点位置需要 min/max 边界，请重新导出完整 GLB');const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
  for(let row=0;row<reader.count;row++)for(let col=0;col<3;col++){const value=reader.read(row,col);minimum[col]=Math.min(minimum[col],value);maximum[col]=Math.max(maximum[col],value);}
  for(let col=0;col<3;col++){const tolerance=1e-5*Math.max(1,Math.abs(minimum[col]),Math.abs(maximum[col]));if(Math.abs(reader.accessor.min[col]-minimum[col])>tolerance||Math.abs(reader.accessor.max[col]-maximum[col])>tolerance)fail('顶点位置边界与实际数据不一致');}
 }
 const meshStats=[];let primitives=0,vertices=0,triangles=0,morphs=0;const morphNames=new Set();
 for(const mesh of meshes){
  const items=list(mesh.primitives,1024,'网格图元');if(!items.length)fail('网格缺少图元');let meshVertices=0,meshTriangles=0,targetCount=null;
  for(const primitive of items){
   if(++primitives>1024)fail('图元数量过多');object(primitive.attributes,'网格属性');if((primitive.mode??4)!==4)fail('当前只支持三角网格，请转换后导入');
   const position=ref(readers,primitive.attributes.POSITION,'顶点位置');if(position.accessor.type!=='VEC3'||position.accessor.componentType!==5126||!position.stored)fail('顶点位置必须是内嵌 FLOAT VEC3');positionBounds(position);
   for(const [name,index] of Object.entries(primitive.attributes)){
    const attribute=ref(readers,index,'网格属性');if(attribute.count!==position.count)fail('网格属性顶点数量不一致');
    if(/^(JOINTS|WEIGHTS)_/.test(name)&&! /^(JOINTS|WEIGHTS)_[01]$/.test(name))fail('当前仅支持每顶点四个非零骨骼影响');
    if(name==='NORMAL'&&(attribute.accessor.type!=='VEC3'||attribute.accessor.componentType!==5126))fail('法线属性格式无效');
    if(name==='TANGENT'&&(attribute.accessor.type!=='VEC4'||attribute.accessor.componentType!==5126))fail('切线属性格式无效');
    if(/^TEXCOORD_/.test(name)&&(attribute.accessor.type!=='VEC2'||![5121,5123,5126].includes(attribute.accessor.componentType)||(attribute.accessor.componentType!==5126&&!attribute.accessor.normalized)))fail('纹理坐标格式无效');
    if(/^COLOR_/.test(name)&&(!['VEC3','VEC4'].includes(attribute.accessor.type)||![5121,5123,5126].includes(attribute.accessor.componentType)||(attribute.accessor.componentType!==5126&&!attribute.accessor.normalized)))fail('顶点颜色格式无效');
   }
   const indices=primitive.indices===undefined?null:ref(readers,primitive.indices,'三角索引');if(indices&&(indices.accessor.type!=='SCALAR'||![5121,5123,5125].includes(indices.accessor.componentType)||indices.accessor.normalized||indices.view?.byteStride))fail('三角索引格式无效');
   const indexCount=indices?indices.count:position.count;if(indexCount%3)fail('三角索引数量必须为三的倍数');if(indices)for(let i=0;i<indices.count;i++)if(indices.read(i)>=position.count)fail('三角索引超出顶点范围');
   meshVertices+=position.count;meshTriangles+=indexCount/3;
   const targets=list(primitive.targets,64,'形态目标');if(targetCount!==null&&targetCount!==targets.length)fail('同一网格图元的形态目标数量不一致');targetCount=targets.length;
   for(const target of targets){object(target,'形态目标');for(const [name,index] of Object.entries(target)){if(!['POSITION','NORMAL','TANGENT'].includes(name))fail('形态目标属性无效');const item=ref(readers,index,'形态访问器');if(item.count!==position.count||item.accessor.componentType!==5126||item.accessor.type!=='VEC3')fail('形态目标访问器不匹配');if(name==='POSITION')positionBounds(item);}}
  }
  vertices+=meshVertices;triangles+=meshTriangles;morphs+=targetCount||0;if(morphs>256)fail('形态目标总数超过 256，请简化模型');if(vertices>MAX_VERTICES||triangles>MAX_TRIANGLES)fail('网格过大：最多 50 万顶点、100 万三角形');
  for(let index=0;index<(targetCount||0);index++)morphNames.add(boundedName(mesh.extras?.targetNames?.[index],`target_${index}`,128));
  if(mesh.weights!==undefined&&(!Array.isArray(mesh.weights)||mesh.weights.length!==targetCount||mesh.weights.some(value=>!Number.isFinite(value)||Math.abs(value)>2)))fail('默认形态权重无效');
  meshStats.push({vertices:meshVertices,triangles:meshTriangles,morphs:targetCount||0});
 }
 let displayedVertices=0,displayedTriangles=0,displayedMeshes=0;
 for(const index of activeNodes){const node=nodes[index];if(node.mesh!==undefined){displayedMeshes++;displayedVertices+=meshStats[node.mesh].vertices;displayedTriangles+=meshStats[node.mesh].triangles;if(node.weights!==undefined&&(!Array.isArray(node.weights)||node.weights.length!==meshStats[node.mesh].morphs||node.weights.some(value=>!Number.isFinite(value)||Math.abs(value)>2)))fail('节点形态权重无效');}}
 if(!displayedMeshes)fail('默认场景没有可展示网格');if(displayedVertices>MAX_VERTICES||displayedTriangles>MAX_TRIANGLES)fail('重复实例造成过多展示顶点或三角形');
 const bones=new Set();let skinnedMeshes=0,weightedVertices=0,additionalInfluences=false;
 for(const skin of skins){
  const joints=list(skin.joints,256,'骨骼');if(!joints.length||new Set(joints).size!==joints.length)fail('蒙皮骨骼列表为空或重复');for(const joint of joints){ref(nodes,joint,'骨骼节点');bones.add(joint);}if(skin.skeleton!==undefined){ref(nodes,skin.skeleton,'骨架根节点');for(const joint of joints){let current=joint;while(current!==skin.skeleton&&parents.has(current))current=parents.get(current);if(current!==skin.skeleton)fail('骨架根节点不是所有关节的祖先');}}
  if(skin.inverseBindMatrices!==undefined){const inverse=ref(readers,skin.inverseBindMatrices,'逆绑定矩阵');if(inverse.accessor.type!=='MAT4'||inverse.accessor.componentType!==5126||inverse.count<joints.length)fail('逆绑定矩阵与骨骼数量不匹配');for(let row=0;row<joints.length;row++)if(!determinant4(Array.from({length:16},(_,column)=>inverse.read(row,column))))fail('逆绑定矩阵不可逆，无法提供可用蒙皮');}
 }
 for(const [nodeIndex,node] of nodes.entries())if(node.skin!==undefined){
  const skin=skins[node.skin];if(activeNodes.has(nodeIndex))skinnedMeshes++;
  for(const primitive of meshes[node.mesh].primitives){
   const attributes=primitive.attributes,position=readers[attributes.POSITION];let sets=0;
   for(let set=0;set<=1;set++){
    const jointId=attributes['JOINTS_'+set],weightId=attributes['WEIGHTS_'+set];if(jointId===undefined&&weightId===undefined){if(set===0)fail('蒙皮网格缺少 JOINTS_0 和 WEIGHTS_0，不能复制骨架假装已蒙皮');continue;}
    if(jointId===undefined||weightId===undefined)fail('骨骼索引和权重必须成对存在');const joints=ref(readers,jointId,'骨骼索引'),weights=ref(readers,weightId,'骨骼权重');
    if(joints.accessor.type!=='VEC4'||![5121,5123].includes(joints.accessor.componentType)||joints.accessor.normalized||weights.accessor.type!=='VEC4'||![5121,5123,5126].includes(weights.accessor.componentType)||(weights.accessor.componentType!==5126&&!weights.accessor.normalized))fail('骨骼索引或权重格式无效');
    const scale=weights.accessor.componentType===5121?255:weights.accessor.componentType===5123?65535:1;
    for(let row=0;row<position.count;row++)for(let column=0;column<4;column++){if(joints.read(row,column)>=skin.joints.length)fail('骨骼索引超出蒙皮骨骼范围');const weight=weights.read(row,column)/scale;if(weight<0||weight>1)fail('蒙皮权重必须处于 0–1 范围');if(set===1&&weight>0)additionalInfluences=true;}
    sets++;
   }
   for(let row=0;row<position.count;row++){let sum=0;for(let set=0;set<sets;set++){const weights=readers[attributes['WEIGHTS_'+set]],scale=weights.accessor.componentType===5121?255:weights.accessor.componentType===5123?65535:1;for(let column=0;column<4;column++)sum+=weights.read(row,column)/scale;}if(sum<.99||sum>1.01)fail('存在零权重或未归一化顶点，请完成真实蒙皮后重新导出');}
   if(activeNodes.has(nodeIndex))weightedVertices+=position.count;
  }
 }
 const images=list(json.images,64,'纹理图片'),textures=list(json.textures,256,'纹理'),samplers=list(json.samplers,256,'采样器');let pixels=0;
 for(const image of images){
  let bytes,mime=image.mimeType;
  if(image.uri!==undefined){const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.uri);if(!match||image.bufferView!==undefined||match[2].length>24*1024**2)fail('内嵌纹理数据无效');mime=match[1];bytes=Buffer.from(match[2],'base64');}
  else{const view=ref(views,image.bufferView,'纹理缓冲');if(view.byteStride)fail('纹理缓冲不可包含步长');bytes=bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);}
  const [width,height]=imageSize(bytes,mime);integer(width,1,8192,'纹理宽度');integer(height,1,8192,'纹理高度');pixels+=width*height;if(pixels>64*1024**2)fail('纹理解码总像素过多，请降低分辨率');
 }
 for(const texture of textures){ref(images,texture.source,'纹理图片引用');if(texture.sampler!==undefined)ref(samplers,texture.sampler,'采样器引用');}
 const materials=list(json.materials,256,'材质');for(const material of materials)for(const texture of [material.pbrMetallicRoughness?.baseColorTexture,material.pbrMetallicRoughness?.metallicRoughnessTexture,material.normalTexture,material.occlusionTexture,material.emissiveTexture])if(texture)ref(textures,texture.index,'材质纹理');
 for(const mesh of meshes)for(const primitive of mesh.primitives)if(primitive.material!==undefined)ref(materials,primitive.material,'图元材质');
 const clips={};let animationChannels=0;
 for(const [index,animation] of list(json.animations,128,'动画').entries()){
  const animationSamplers=list(animation.samplers,1024,'动画采样器'),channels=list(animation.channels,4096,'动画通道');if(!animationSamplers.length||!channels.length)fail('动画缺少采样器或通道');let duration=0;
  for(const sampler of animationSamplers){const input=ref(readers,sampler.input,'动画时间'),output=ref(readers,sampler.output,'动画输出');if(input.accessor.type!=='SCALAR'||input.accessor.componentType!==5126||output.accessor.componentType!==5126||!['LINEAR','STEP','CUBICSPLINE'].includes(sampler.interpolation||'LINEAR'))fail('动画采样格式无效');let previous=-1;for(let i=0;i<input.count;i++){const time=input.read(i);if(time<0||time<=previous||time>3600)fail('动画时间无效或超过一小时');previous=time;duration=Math.max(duration,time);}}
  for(const channel of channels){if(++animationChannels>4096)fail('动画通道过多');const sampler=ref(animationSamplers,channel.sampler,'动画采样器引用'),target=channel.target,node=ref(nodes,target?.node,'动画目标节点'),input=readers[sampler.input],output=readers[sampler.output];const shapes={translation:'VEC3',rotation:'VEC4',scale:'VEC3',weights:'SCALAR'};if(!shapes[target.path]||output.accessor.type!==shapes[target.path])fail('动画目标属性不匹配');const count=target.path==='weights'?(node.mesh===undefined?0:meshStats[node.mesh].morphs):1;if(!count||output.count!==input.count*count*(sampler.interpolation==='CUBICSPLINE'?3:1))fail('动画关键帧数量不匹配');}
  const name=boundedName(animation.name,'animation_'+index,128);if(Object.hasOwn(clips,name))fail('动画名称重复，请重命名后导出');clips[name]={duration,loop:false};
 }
 const usableSkin=skinnedMeshes>0&&weightedVertices>0,warnings=['仅完成文件结构和资源边界检查；图形显示、动作和蒙皮效果仍需在预览中确认。'];
 if(!usableSkin)warnings.push('没有可用的蒙皮网格。可作为静态模型导入；复用雪乃骨架仍需实际绑定与顶点权重，不能仅复制骨骼。');
 if(additionalInfluences)warnings.push('检测到四个以上非零骨骼影响，当前渲染器不支持；请重新限制为每顶点四权重或接入专用渲染器。');
 if(morphs)warnings.push('已检测到形态目标，但口型、眨眼映射尚未校准，不会自动启用。');
 if(Object.keys(clips).length)warnings.push('自带动画仅做格式检查，动作表现与骨架兼容性仍需人工预览；不会套用内置骨架动作。');
 return {format:'glTF 2.0 / GLB',validationScope:'structural-embedded-assets',renderValidated:false,bytes:data.length,sha256:digest(data),meshes:meshes.length,displayedMeshes,primitives,vertices,triangles,displayedVertices,displayedTriangles,nodes:nodes.length,bones:bones.size,skins:skins.length,skinnedMeshes,weightedVertices,usableSkin,additionalInfluences,morphs,morphNames:[...morphNames],animations:Object.keys(clips).length,clips,textures:images.length,texturePixels:pixels,allowedModes:additionalInfluences?[]:usableSkin?['rigged']:['static'],warnings};
}

function inspectGlb(input){try{return inspectGlbUnchecked(input);}catch(error){if(error instanceof TypeError||error instanceof RangeError)throw Error('GLB 结构或引用格式无效，请重新导出完整模型');throw error;}}
function determinant4(values){
 const matrix=Array.from({length:4},(_,row)=>Array.from({length:4},(_,column)=>values[column*4+row]));let determinant=1;
 for(let column=0;column<4;column++){let pivot=column;for(let row=column+1;row<4;row++)if(Math.abs(matrix[row][column])>Math.abs(matrix[pivot][column]))pivot=row;if(Math.abs(matrix[pivot][column])<1e-12)return 0;if(pivot!==column){[matrix[pivot],matrix[column]]=[matrix[column],matrix[pivot]];determinant*=-1;}const value=matrix[column][column];determinant*=value;for(let row=column+1;row<4;row++){const factor=matrix[row][column]/value;for(let item=column+1;item<4;item++)matrix[row][item]-=factor*matrix[column][item];}}
 return determinant;
}
async function readBounded(file,limit=MAX_BYTES){
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>limit||before.size<1)fail('请选择不超过限制的普通文件，不能使用目录或符号链接');
 const handle=await fs.open(file,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW||0));
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==before.size||stat.ino!==before.ino||stat.dev!==before.dev)fail('文件在检查时发生变化，请重新选择');const data=Buffer.alloc(stat.size+1);let offset=0;while(offset<data.length){const {bytesRead}=await handle.read(data,offset,data.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}if(offset!==stat.size)fail('文件长度在读取时发生变化');return data.subarray(0,offset);}finally{await handle.close();}
}
function customEntry(inspection,{label,mode}){
 return {id:'custom-'+inspection.sha256,characterId:'custom',label,version:inspection.sha256.slice(0,12),ready:true,status:'local_custom_import',url:'local-character-model:'+inspection.sha256,bytes:inspection.bytes,sha256:inspection.sha256,custom:true,importMode:mode,diagnostics:inspection,clips:mode==='rigged'?inspection.clips:{},defaultClip:'',mouth:null,blink:false,hairPhysics:false,limits:[...inspection.warnings,'本机导入；未上传，不会自动进行骨架绑定或动作重定向。']};
}
class CharacterModelStore{
 constructor({dataRoot,builtinRoot,builtins=require('../resources/character-models.json'),now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){this.root=path.join(dataRoot,'character-models');this.builtinRoot=builtinRoot;this.builtins=builtins;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.custom=[];this.pending=null;this.pendingTimer=null;this.epoch=0;this.initializing=null;this.installing=false;}
 async initialize(){
  if(this.initializing)return this.initializing;
  this.initializing=(async()=>{await this.checkRoot();let data;try{data=await readBounded(path.join(this.root,'custom-models.json'),8*1024**2);}catch(error){if(error.code==='ENOENT')return;throw error;}let catalog;try{catalog=JSON.parse(data.toString('utf8'));}catch{fail('自定义模型清单损坏，已保留原文件');}if(catalog.schemaVersion!==1)fail('自定义模型清单版本无效');
   const seen=new Set();this.custom=list(catalog.models,100,'自定义模型').map(entry=>{if(!/^[a-f0-9]{64}$/.test(entry?.sha256||'')||entry.id!=='custom-'+entry.sha256||seen.has(entry.id)||!['rigged','static'].includes(entry.importMode))fail('自定义模型登记无效');integer(entry.bytes,1,MAX_BYTES,'模型大小');seen.add(entry.id);const diagnostics=object(entry.diagnostics,'模型诊断');for(const key of ['meshes','displayedMeshes','primitives','vertices','triangles','nodes','bones','skins','skinnedMeshes','weightedVertices','morphs','animations','textures'])integer(diagnostics[key],0,2000000,'模型诊断计数');if(!Array.isArray(diagnostics.warnings)||diagnostics.warnings.length>20||diagnostics.warnings.some(value=>typeof value!=='string'||value.length>500)||!Array.isArray(diagnostics.morphNames)||diagnostics.morphNames.length>256||diagnostics.morphNames.some(value=>typeof value!=='string'||value.length>128)||typeof diagnostics.usableSkin!=='boolean')fail('自定义模型诊断格式无效');object(diagnostics.clips,'动作清单');for(const [name,clip] of Object.entries(diagnostics.clips)){if(name.length>128||!clip||!Number.isFinite(clip.duration)||clip.duration<0||clip.duration>3600||typeof clip.loop!=='boolean')fail('自定义动作清单无效');}if(diagnostics.sha256!==entry.sha256||diagnostics.bytes!==entry.bytes||!Array.isArray(diagnostics.allowedModes)||!diagnostics.allowedModes.includes(entry.importMode))fail('自定义模型诊断不匹配');return customEntry(diagnostics,{label:boundedName(entry.label,'自定义模型'),mode:entry.importMode});});
  })();try{return await this.initializing;}catch(error){this.initializing=null;throw error;}
 }
 entry(id){if(typeof id!=='string'||id.length>100)fail('人物模型标识无效');const entry=[...this.builtins.models,...this.custom].find(item=>item.id===id&&item.ready);if(!entry)fail('该人物模型尚未登记或准备好');if(!entry.custom&&!/^\.\/characters\/[-A-Za-z0-9_]+\.glb$/.test(entry.url))fail('内置模型路径无效');return entry;}
 async catalog(){await this.initialize();return {schemaVersion:1,models:structuredClone([...this.builtins.models,...this.custom])};}
 verify(entry,data){if(data.length!==entry.bytes||digest(data)!==entry.sha256)fail('人物模型完整性检查失败，请重新选择对应的 GLB 文件');}
 async read(id){await this.initialize();await this.checkRoot();const entry=this.entry(id);let data;try{data=await readBounded(path.join(this.root,entry.sha256+'.glb'));}catch(error){if(error.code!=='ENOENT'||entry.custom)throw error;try{data=await readBounded(path.join(this.builtinRoot,entry.url.slice(2)));}catch(inner){if(inner.code==='ENOENT')fail('该人物模型尚未安装，请导入对应版本的 GLB 文件');throw inner;}}this.verify(entry,data);if(entry.custom)inspectGlb(data);return new Uint8Array(data);}
 cancel(){this.epoch++;this.clearTimer(this.pendingTimer);this.pendingTimer=null;if(this.pending)this.pending.data.fill(0);this.pending=null;}
 async inspectFile(file){this.cancel();const epoch=this.epoch;if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.glb')fail('请选择 GLB 文件');const data=await readBounded(file);if(epoch!==this.epoch){data.fill(0);fail('模型检查已取消');}let diagnostics;try{diagnostics=inspectGlb(data);}catch(error){data.fill(0);throw error;}const token=randomUUID(),expires=this.now()+300000,filename=path.basename(file);this.pending={token,expires,data,diagnostics,filename};this.pendingTimer=this.setTimer(()=>this.cancel(),300000);this.pendingTimer?.unref?.();return {token,expires,filename,bytes:diagnostics.bytes,sha256:diagnostics.sha256,diagnostics,allowedModes:diagnostics.allowedModes,warnings:diagnostics.warnings};}
 async checkRoot(){try{const stat=await fs.lstat(this.root);if(!stat.isDirectory()||stat.isSymbolicLink())fail('模型存储目录不是普通目录');}catch(error){if(error.code!=='ENOENT')throw error;}}
 async ensureRoot(){await fs.mkdir(this.root,{recursive:true});const stat=await fs.lstat(this.root);if(!stat.isDirectory()||stat.isSymbolicLink())fail('模型存储目录不是普通目录');}
 async saveFile(entry,data){await this.ensureRoot();const destination=path.join(this.root,entry.sha256+'.glb'),temporary=path.join(this.root,entry.sha256+'.'+randomUUID()+'.tmp');try{try{const stat=await fs.lstat(destination);if(!stat.isFile()||stat.isSymbolicLink())fail('模型目标不是普通文件');}catch(error){if(error.code!=='ENOENT')throw error;}await fs.writeFile(temporary,data,{flag:'wx'});await fs.rename(temporary,destination);}finally{await fs.rm(temporary,{force:true}).catch(()=>{});}}
 async importBuiltin(id,file){await this.initialize();const entry=this.entry(id);if(entry.custom)fail('请通过自定义模型检查流程导入');const data=await readBounded(file);this.verify(entry,data);await this.saveFile(entry,data);return true;}
 async confirm({token,confirm,mode,label}={}){
  if(confirm!==true)fail('请先确认导入检查结果');if(this.installing)fail('模型正在导入，请稍候');const pending=this.pending;if(!pending||pending.token!==token||pending.expires<=this.now())fail('模型检查已过期或取消，请重新选择');if(!pending.diagnostics.allowedModes.includes(mode))fail('此模型不支持所选导入方式；无权重模型需要真实蒙皮，不能复制骨架代替');if(label!==undefined&&(typeof label!=='string'||label.length>80||!label.trim()))fail('模型名称需要 1–80 字符');
  const data=Buffer.from(pending.data),entry=customEntry(pending.diagnostics,{label:boundedName(label,boundedName(pending.filename.replace(/\.glb$/i,''),'自定义模型')),mode});this.cancel();const epoch=this.epoch;this.installing=true;let temporary;
  try{await this.initialize();if(epoch!==this.epoch)fail('模型导入已取消');if(!this.custom.some(item=>item.id===entry.id)&&this.custom.length>=100)fail('自定义模型数量已达 100 个');await this.saveFile(entry,data);if(epoch!==this.epoch)fail('模型导入已取消');const models=[...this.custom.filter(item=>item.id!==entry.id),entry];temporary=path.join(this.root,'custom-models.'+randomUUID()+'.tmp');const encoded=JSON.stringify({schemaVersion:1,models},null,2);if(Buffer.byteLength(encoded)>8*1024**2)fail('自定义模型清单过大，原清单已保留');await fs.writeFile(temporary,encoded,{flag:'wx'});if(epoch!==this.epoch)fail('模型导入已取消');await fs.rename(temporary,path.join(this.root,'custom-models.json'));temporary=null;this.custom=models;return structuredClone(entry);
  }finally{data.fill(0);this.installing=false;if(temporary)await fs.rm(temporary,{force:true}).catch(()=>{});}
 }
}
module.exports={CharacterModelStore,inspectGlb,MAX_BYTES,MAX_VERTICES,MAX_TRIANGLES};
