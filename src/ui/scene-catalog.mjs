// Metadata only: scene geometry is loaded lazily from the supplied scene modules.
const entries={
 city:{label:'晚归灯火',kind:'outdoor',description:'蓝白罗森招牌、可见店内货架与自然枝叶；灯光、湿地和雨丝随时光天气变化。',clear:'#172638',direction:[1,.65,1.7]},
 classroom:{label:'放课之后',kind:'indoor',description:'窗边课桌与教室；窗外日光和室内灯光分开变化。',clear:'#b1b9bd',direction:[1,.8,1.5]},
 bookshop:{label:'街角余温',kind:'outdoor',description:'原有街边书店与相邻拉面店；木格窗、纸灯笼、吧台与红色圆凳。',clear:'#8e9a9c',direction:[1,.7,1.5]},
 forest:{label:'风过竹间',kind:'outdoor',description:'带竹节的高竹、枯枝篱笆、苔藓石边与后方 T 字路口；日光穿过林冠。',clear:'#56746a',direction:[1,.85,1.4]},
 school:{label:'春日回廊',kind:'outdoor',description:'校门与校园；夜晚窗户和门前灯亮起。',clear:'#839caa',direction:[.6,.65,1]},
 wedding:{label:'潮声誓约',kind:'outdoor',description:'参考照片中的高挑入口、加长石阶与自然枝叶树冠。',clear:'#6c7c8c',direction:[.46,.53,.86]},
 kasai:{label:'海风来信',kind:'outdoor',description:'海滨玻璃建筑与步道；白昼、暮色和夜景各有照明。',clear:'#91afbe',direction:[1,.65,1.5]},
 inage:{label:'未说出口',kind:'outdoor',description:'蓝色车行拱桥正下方是人行桥，地面道路从桥下横穿；纵向窄阶、两侧推行坡面与绕墩弧形坡道连接桥端。',clear:'#889caa',direction:[1,.8,1.2]},
 kyoto:{label:'朱影寻春',kind:'outdoor',description:'清水寺西门与三重塔、林间朱红鸟居通道的组合微缩景观；并非实地相邻关系。',clear:'#9daaa4',direction:[1,.85,1.3]},
 sakura:{label:'花影随流',kind:'outdoor',description:'垂樱小路旁的清浅溪流，能看见河床石子；花枝随风轻摇，花瓣落在水面后随流漂远。',clear:'#87b8cd',direction:[.55,.5,1.4]}
};
export const SCENES=Object.freeze(Object.fromEntries(Object.entries(entries).map(([id,v])=>[id,Object.freeze({...v,liveDaylight:true,background:`radial-gradient(ellipse at 50% 42%,${v.clear},#172332)`,lighting:Object.freeze({ambient:v.kind==='indoor'?.9:.75,key:1,color:'#eef4ff',direction:Object.freeze(v.direction)})})])));
// Old identifiers migrate without retaining any old geometry or changing model files.
const legacy={studio:'bookshop',beach:'kasai',seaside:'kasai'};
export const sceneId=value=>Object.hasOwn(SCENES,value)?value:Object.hasOwn(legacy,value)?legacy[value]:'classroom';
export const scenePreset=value=>SCENES[sceneId(value)];
export const SCENE_GROUPS=Object.freeze([{kind:'indoor',label:'室内'},{kind:'outdoor',label:'室外'}]);
