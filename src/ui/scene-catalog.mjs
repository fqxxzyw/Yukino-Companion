// Metadata only: scene geometry is loaded lazily from the supplied scene modules.
const entries={
 city:{label:'街角便利店',kind:'outdoor',description:'雨夜便利店与街角；白天保留柔和店内照明，入夜亮起招牌。',clear:'#172638',direction:[1,.65,1.7]},
 classroom:{label:'放课后教室',kind:'indoor',description:'窗边课桌与教室；窗外日光和室内灯光分开变化。',clear:'#b1b9bd',direction:[1,.8,1.5]},
 bookshop:{label:'街边书店',kind:'indoor',description:'书架、橱窗与街道；室内阅读灯不会随夜色一同熄灭。',clear:'#8e9a9c',direction:[1,.7,1.5]},
 forest:{label:'林间小径',kind:'outdoor',description:'林间溪流、枝叶与小桥；随日光变换明暗。',clear:'#56746a',direction:[1,.85,1.4]},
 school:{label:'雪乃学校',kind:'outdoor',description:'校门与校园；夜晚窗户和门前灯亮起。',clear:'#839caa',direction:[.6,.65,1]},
 wedding:{label:'海边婚礼礼堂',kind:'outdoor',description:'参考照片中的高挑入口、加长石阶与自然枝叶树冠。',clear:'#6c7c8c',direction:[.46,.53,.86]},
 kasai:{label:'葛西临海公园',kind:'outdoor',description:'海滨玻璃建筑与步道；白昼、暮色和夜景各有照明。',clear:'#91afbe',direction:[1,.65,1.5]}
};
export const SCENES=Object.freeze(Object.fromEntries(Object.entries(entries).map(([id,v])=>[id,Object.freeze({...v,liveDaylight:true,background:`radial-gradient(ellipse at 50% 42%,${v.clear},#172332)`,lighting:Object.freeze({ambient:v.kind==='indoor'?.9:.75,key:1,color:'#eef4ff',direction:Object.freeze(v.direction)})})])));
// Old identifiers migrate without retaining any old geometry or changing model files.
const legacy={studio:'bookshop',beach:'kasai',seaside:'kasai'};
export const sceneId=value=>Object.hasOwn(SCENES,value)?value:Object.hasOwn(legacy,value)?legacy[value]:'classroom';
export const scenePreset=value=>SCENES[sceneId(value)];
export const SCENE_GROUPS=Object.freeze([{kind:'indoor',label:'室内'},{kind:'outdoor',label:'室外'}]);
