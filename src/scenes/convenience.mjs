// Authored geometry/materials/animation extracted from 便利店.html.
// Standalone vendored Three, renderer, controls, DOM UI and animation loops are intentionally excluded.
import { Group as HostGroup, FogExp2 as HostFogExp2, CanvasTexture as jr, DataTexture as hs, MeshToonMaterial as ua, LineBasicMaterial as us, MeshBasicMaterial as ce, Mesh as ze, EdgesGeometry as ea, LineSegments as Js, Group as xt, BoxGeometry as Gn, CylinderGeometry as Ii, Vector3 as C, PlaneGeometry as Cn, SpriteMaterial as Zs, Sprite as Zr, ShaderMaterial as Pt, Color as Re, SphereGeometry as ni, MeshStandardMaterial as _i, CircleGeometry as gi, MeshPhysicalMaterial as sr, InstancedMesh as Jr, Object3D as Wt, IcosahedronGeometry as Di, TorusGeometry as ps, ConeGeometry as Ks, Shape as Qs, ExtrudeGeometry as ha, CatmullRomCurve3 as ds, TubeGeometry as nr, BufferGeometry as Ct, BufferAttribute as nn, RingGeometry as tr, HemisphereLight as fa, DirectionalLight as ms, PointLight as mn, Object3D as HostObject3D, Box3 as HostBox3, ACESFilmicToneMapping as HostACES } from 'three';
import { RoundedBoxGeometry as dc } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector as Ba } from 'three/addons/objects/Reflector.js';

export function createScene({scene,renderer}={}) {

  if (!scene?.isScene || !renderer) throw new TypeError('createScene requires the host scene and renderer');
  const previous = { background: scene.background, environment:scene.environment, fog: scene.fog, exposure: renderer.toneMappingExposure, toneMapping:renderer.toneMapping, shadowType:renderer.shadowMap.type };
  const ownedTargets=new Set();
  const existing = new Set(scene.children);
  const root = new HostGroup();
  root.name = 'environment:convenience';
  let disposed = false;
  let ownedRendererState;
  function rememberRendererState(){ownedRendererState={exposure:renderer.toneMappingExposure,toneMapping:renderer.toneMapping,shadowType:renderer.shadowMap.type};}
const Vt = scene, Jt = renderer; Vt.fog = new HostFogExp2(659482, .0085);
var ls=1e3;
var cn="srgb";
var hr=1028;
var kt=1003;
var jt=1;
var hn=2;
var Ut=2;
var kv=Math.min(8,Jt.capabilities.getMaxAnisotropy());
function dn(i){return function(){i|=0,i=i+1831565813|0;let e=Math.imul(i^i>>>15,1|i);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}
var ka=dn(20261008),vr=(i,e)=>i+(e-i)*ka(),Hv=i=>i[Math.floor(ka()*i.length)];
function lt(i,e){let t=document.createElement("canvas");return t.width=i,t.height=e,[t,t.getContext("2d")]}
function ct(i,e=1,t=1,n=!0){let s=new jr(i);return s.wrapS=s.wrapT=ls,s.repeat.set(e,t),s.anisotropy=kv,n&&(s.colorSpace=cn),s}
function rn(i,e,t,n,s,r){let a=Math.min(r,Math.abs(n)/2,Math.abs(s)/2);i.beginPath(),i.moveTo(e+a,t),i.arcTo(e+n,t,e+n,t+s,a),i.arcTo(e+n,t+s,e,t+s,a),i.arcTo(e,t+s,e,t,a),i.arcTo(e,t,e+n,t,a),i.closePath()}
var pf=new Uint8Array([34,82,150,213,255]),Ha=new hs(pf,pf.length,1,hr);
Ha.minFilter=kt;
Ha.magFilter=kt;
Ha.generateMipmaps=!1;
Ha.needsUpdate=!0;
function Be(i,e={}){return new ua({color:i,gradientMap:Ha,...e})}
var Yh=new Map;
function Vv(i=529180,e=.58){let t=`${i}-${e}`;return Yh.has(t)||Yh.set(t,new us({color:i,transparent:!0,opacity:e,depthWrite:!1})),Yh.get(t)}
var Gv=new ce({color:594971,side:jt,toneMapped:!1});
function yf(i,e=.55,t=463643,n=28){if(!i.geometry)return null;let s=new ze(i.geometry,Gv);s.scale.setScalar(1.007),s.castShadow=!1,s.receiveShadow=!1,i.add(s);let r=new ea(i.geometry,n),a=new Js(r,Vv(t,e));return a.scale.setScalar(1.0025),a.renderOrder=4,i.add(a),a}
var I={wall:Be(14275264),wallShade:Be(11907751),wallSide:Be(12498855),warmWall:Be(10325886),teal:Be(1853515),darkTeal:Be(1191731),deepTeal:Be(926504),roof:Be(2502711),roofEdge:Be(1581864),concrete:Be(8225667),concreteDark:Be(5462620),curb:Be(11449522),metal:Be(6320246),metalDark:Be(3227204),whiteMetal:Be(10200997),orange:Be(13138243),wood:Be(5982781),woodDark:Be(4010797),leaf:Be(2379068),leafLight:Be(3500622),soil:Be(2827808),bridge:Be(8226179),black:Be(1119770),cream:Be(14998729),amber:new ce({color:16766619}),warmGlow:new ce({color:16767396}),coolGlow:new ce({color:12840191}),greenGlow:new ce({color:9174999}),paper:Be(15196111)};
function Wv(){let[i,e]=lt(768,768),t=e.createLinearGradient(0,0,768,768);t.addColorStop(0,"#171d25"),t.addColorStop(.55,"#1b2229"),t.addColorStop(1,"#12181f"),e.fillStyle=t,e.fillRect(0,0,768,768);let n=dn(77);for(let r=0;r<10500;r++){let a=n()*768,o=n()*768,l=n()*2.5+.4,c=Math.floor(42+n()*75);e.fillStyle=`rgba(${c},${c+3},${c+7},${.05+n()*.16})`,e.fillRect(a,o,l,l)}for(let r=0;r<24;r++){e.strokeStyle=`rgba(4,8,12,${.06+n()*.11})`,e.lineWidth=.7+n()*1.4,e.beginPath();let a=n()*768,o=n()*768;e.moveTo(a,o);for(let l=0;l<5;l++)a+=(n()-.5)*110,o+=(n()-.5)*85,e.lineTo(a,o);e.stroke()}for(let r=0;r<18;r++){let a=n()*768,o=n()*768,l=18+n()*80,c=e.createRadialGradient(a,o,0,a,o,l);c.addColorStop(0,"rgba(90,100,110,0.055)"),c.addColorStop(1,"rgba(0,0,0,0)"),e.fillStyle=c,e.beginPath(),e.arc(a,o,l,0,Math.PI*2),e.fill()}return ct(i,1,1,!1)}
function Xv(){let[e,t]=lt(1024,1024);t.fillStyle="rgb(48,48,48)",t.fillRect(0,0,1024,1024);let n=dn(912),s=(a,o)=>[(a+11.8)/23.6*1024,(o+11.8)/23.6*1024],r=[[-2.2,7.4,2.65,1.1,.92],[-6.2,6.5,1.65,.72,.72],[2.8,7.2,1.7,.85,.82],[7.9,8.8,2.05,.9,.92],[8.7,2.5,1.5,2.6,.75],[2,9.8,1.4,.55,.7],[-8.8,8.4,1.4,.65,.64],[6.1,5.6,1.05,.72,.7]];for(let[a,o,l,c,h]of r){let[d,u]=s(a,o);t.save(),t.translate(d,u),t.rotate(n()*Math.PI);let f=t.createRadialGradient(0,0,0,0,0,1024*.12);f.addColorStop(0,`rgba(255,255,255,${h})`),f.addColorStop(.45,`rgba(220,220,220,${h*.75})`),f.addColorStop(1,"rgba(48,48,48,0)"),t.fillStyle=f,t.beginPath(),t.ellipse(0,0,l/23.6*1024,c/23.6*1024,0,0,Math.PI*2),t.fill(),t.restore()}for(let a=0;a<230;a++){let o=n()*1024,l=n()*1024,c=2+n()*42,h=1+n()*15,d=.06+n()*.35;t.fillStyle=`rgba(210,218,220,${d})`,t.beginPath(),t.ellipse(o,l,c,h,n()*Math.PI,0,Math.PI*2),t.fill()}for(let a=0;a<9e3;a++){let o=110+n()*100;t.fillStyle=`rgba(${o},${o},${o},${n()*.1})`;let l=n()*1.6;t.fillRect(n()*1024,n()*1024,l,l)}return ct(e,1,1,!1)}
function Yv(){let[i,e]=lt(512,512);e.fillStyle="#666d70",e.fillRect(0,0,512,512);let t=dn(404);for(let r=0;r<6e3;r++){let a=Math.floor(80+t()*55);e.fillStyle=`rgba(${a},${a+2},${a+3},${.05+t()*.12})`,e.fillRect(t()*512,t()*512,1+t()*2,1+t()*2)}let n=4,s=512/n;for(let r=0;r<n;r++)for(let a=0;a<n;a++){let o=96+Math.floor(t()*10);e.fillStyle=`rgba(${o},${o+5},${o+5},${.08+t()*.06})`,e.fillRect(a*s+2,r*s+2,s-4,s-4)}e.strokeStyle="rgba(35,42,46,0.72)",e.lineWidth=3;for(let r=0;r<=n;r++)e.beginPath(),e.moveTo(r*s,0),e.lineTo(r*s,512),e.stroke(),e.beginPath(),e.moveTo(0,r*s),e.lineTo(512,r*s),e.stroke();e.strokeStyle="rgba(178,184,181,0.22)",e.lineWidth=1;for(let r=0;r<=n;r++)e.beginPath(),e.moveTo(r*s+2,0),e.lineTo(r*s+2,512),e.stroke(),e.beginPath(),e.moveTo(0,r*s+2),e.lineTo(512,r*s+2),e.stroke();return ct(i,1,1,!0)}
function qv(){let[i,e]=lt(128,256);e.fillStyle="#c7a947",e.fillRect(0,0,128,256),e.fillStyle="rgba(255,225,134,0.5)";for(let t=16;t<256;t+=32)for(let n=16;n<128;n+=32)e.beginPath(),e.arc(n,t,7,0,Math.PI*2),e.fill();return e.strokeStyle="rgba(105,80,24,0.35)",e.lineWidth=2,e.strokeRect(1,1,126,254),ct(i,1,1,!0)}
function Zv(){let[i,e]=lt(512,512),t=e.createLinearGradient(0,0,0,512);t.addColorStop(0,"#24272a"),t.addColorStop(.5,"#2d2c29"),t.addColorStop(1,"#1c2023"),e.fillStyle=t,e.fillRect(0,0,512,512);let n=dn(922);for(let s=0;s<110;s++){e.strokeStyle=`rgba(${58+n()*30},${47+n()*23},${39+n()*18},${.07+n()*.12})`,e.lineWidth=.5+n()*2;let r=n()*512;e.beginPath(),e.moveTo(0,r);for(let a=0;a<=512;a+=24)e.lineTo(a,r+Math.sin(a*.025+s)*(1+n()*3));e.stroke()}for(let s=0;s<34;s++)e.strokeStyle=`rgba(10,12,14,${.06+n()*.1})`,e.lineWidth=1+n()*2,e.beginPath(),e.ellipse(n()*512,n()*512,6+n()*24,2+n()*5,n(),0,Math.PI*2),e.stroke();return ct(i,1,1,!0)}
function $v(){let[i,e]=lt(1024,260),t=e.createLinearGradient(0,0,0,260);t.addColorStop(0,"#fffdf3"),t.addColorStop(.65,"#f7f0dd"),t.addColorStop(1,"#e8e1ce"),e.fillStyle=t,e.fillRect(0,0,1024,260),e.fillStyle="#1b5b5d",e.fillRect(0,222,1024,38),e.fillStyle="#e69a4e",e.fillRect(0,210,1024,10),e.fillStyle="rgba(255,255,255,0.42)",e.fillRect(0,6,1024,5),e.save(),e.translate(66,108),e.fillStyle="#e79544",e.beginPath();for(let s=0;s<10;s++){let r=s%2===0?42:16,a=-Math.PI/2+s*Math.PI/5,o=Math.cos(a)*r,l=Math.sin(a)*r;s===0?e.moveTo(o,l):e.lineTo(o,l)}e.closePath(),e.fill(),e.fillStyle="#1b5b5d",e.beginPath(),e.arc(0,0,8,0,Math.PI*2),e.fill(),e.restore(),e.fillStyle="#194c4f",e.font='700 92px "Yu Gothic UI","Meiryo","MS PGothic",sans-serif',e.textBaseline="middle",e.fillText("\u307B\u3057\u305E\u3089\u30DE\u30FC\u30C8",126,108),e.fillStyle="#65706d",e.font='600 25px "Segoe UI","Yu Gothic UI",sans-serif',e.letterSpacing="4px",e.fillText("HOSHIZORA  MART",132,170),e.fillStyle="#d8833d",e.font='700 60px "Segoe UI",sans-serif',e.fillText("24H",878,112),e.fillStyle="#1b5b5d",e.font='600 20px "Segoe UI",sans-serif',e.fillText("OPEN",891,165);let n=dn(56);for(let s=0;s<1300;s++)e.fillStyle=`rgba(60,60,55,${n()*.05})`,e.fillRect(n()*1024,n()*260,1.2,1.2);return ct(i,1,1,!0)}
function Jv(){let[i,e]=lt(384,768);return e.fillStyle="#f8f2df",e.fillRect(0,0,384,768),e.fillStyle="#1d5d5f",e.fillRect(0,0,384,80),e.fillRect(0,688,384,80),e.fillStyle="#e89a4c",e.fillRect(0,80,384,14),e.fillRect(0,674,384,14),e.fillStyle="#1d5d5f",e.font='700 124px "Segoe UI",sans-serif',e.textAlign="center",e.fillText("24",192,252),e.fillStyle="#e2833d",e.font='700 128px "Segoe UI",sans-serif',e.fillText("H",192,378),e.fillStyle="#1d5d5f",e.font='700 44px "Yu Gothic UI","Meiryo",sans-serif',e.fillText("\u307B\u3057\u305E\u3089",192,486),e.fillText("\u30DE\u30FC\u30C8",192,540),e.fillStyle="#75817d",e.font='600 23px "Segoe UI",sans-serif',e.fillText("OPEN 24 HOURS",192,625),ct(i,1,1,!0)}
function Mf(i,e,t,n,s,r,a){let o=i.createLinearGradient(e,t,e+n,t);o.addColorStop(0,r),o.addColorStop(.35,"#f4f7f2"),o.addColorStop(.55,r),o.addColorStop(1,r),i.fillStyle=o,a==="bottle"?(rn(i,e+n*.2,t,n*.6,s*.18,4),i.fill(),i.fillStyle=r,rn(i,e,t+s*.14,n,s*.82,5),i.fill()):(rn(i,e,t,n,s,5),i.fill()),i.fillStyle="rgba(255,255,255,0.72)",i.fillRect(e+n*.12,t+s*.32,n*.76,5),i.fillStyle="rgba(20,30,35,0.45)",i.fillRect(e+n*.16,t+s*.52,n*.68,2),i.fillStyle="rgba(255,255,255,0.28)",i.fillRect(e+n*.14,t+s*.08,2,s*.75)}
function Sf(i){let[e,t]=lt(512,1024),n=i?"#146f86":"#923e44",s=i?"#c8f4f4":"#ffe0d1",r=i?"#39a4b9":"#ca6b5e",a=t.createLinearGradient(0,0,0,1024);a.addColorStop(0,s),a.addColorStop(.16,s),a.addColorStop(.2,n),a.addColorStop(.86,n),a.addColorStop(1,i?"#093d50":"#562126"),t.fillStyle=a,t.fillRect(0,0,512,1024),t.fillStyle="#f6f2e4",rn(t,22,20,468,124,14),t.fill(),t.fillStyle=n,t.fillRect(22,22,468,10),t.fillStyle=i?"#0e657c":"#883d3e",t.font='700 52px "Yu Gothic UI","Meiryo",sans-serif',t.textAlign="center",t.fillText(i?"\u3064\u3081\u305F\u301C\u3044":"\u3042\u3063\u305F\u304B\u301C\u3044",256,80),t.font='600 21px "Segoe UI",sans-serif',t.fillStyle="rgba(20,60,70,0.62)",t.fillText(i?"COLD DRINKS  /  100":"HOT DRINKS  /  130",256,116),t.fillStyle="#071a22",rn(t,24,160,464,590,18),t.fill();let o=t.createLinearGradient(0,170,0,744);o.addColorStop(0,"#123847"),o.addColorStop(.55,"#0c2734"),o.addColorStop(1,"#071a23"),t.fillStyle=o,rn(t,34,170,444,570,12),t.fill();let l=["#e25a4b","#f0c24c","#5eaf68","#e8f0dd","#4a8bc7","#d47b9f","#7ed1df","#df7144","#f5e7bd","#6aa77a","#a88ad2","#f2b35b"],c=dn(i?72:99);for(let u=0;u<4;u++){let f=196+u*128;t.fillStyle="rgba(185,244,255,0.65)",t.fillRect(46,f+95,420,3),t.fillStyle="rgba(0,0,0,0.35)",t.fillRect(46,f+98,420,13);for(let g=0;g<5;g++){let m=59+g*81;t.save(),t.shadowColor="rgba(90,190,210,0.24)",t.shadowBlur=14,Mf(t,m,f+13,63,83,l[(u*5+g)%l.length],c()>.6?"bottle":"can"),t.restore(),t.fillStyle=g%2?"#ffe0a4":"#baf6ff",rn(t,m+13,f+107,37,10,4),t.fill()}}let h=t.createLinearGradient(0,170,512,750);h.addColorStop(0,"rgba(255,255,255,0)"),h.addColorStop(.32,"rgba(255,255,255,0.18)"),h.addColorStop(.43,"rgba(255,255,255,0.03)"),h.addColorStop(1,"rgba(255,255,255,0.08)"),t.fillStyle=h,t.fillRect(34,170,444,570),t.strokeStyle=i?"#6de1e7":"#ffad8e",t.lineWidth=5,rn(t,34,170,444,570,12),t.stroke(),t.fillStyle="#e8e6dc",rn(t,28,770,456,132,10),t.fill();for(let u=0;u<6;u++)t.fillStyle=u%2?"#405961":r,rn(t,46+u*70,790,50,30,6),t.fill();t.fillStyle="#12252e",t.fillRect(44,836,230,44),t.fillStyle="#bcebf1",t.font='600 21px "Segoe UI",sans-serif',t.textAlign="left",t.fillText("\xA5 100 / \xA5 130",56,865),t.fillStyle="#152b35",t.fillRect(300,836,166,44),t.fillStyle="#9be9f2",t.fillRect(314,848,138,12),t.fillStyle="rgba(255,255,255,0.55)",t.fillRect(44,896,424,3),t.fillStyle="#08151a",rn(t,24,918,464,80,12),t.fill(),t.fillStyle="rgba(200,235,235,0.35)",t.fillRect(48,936,416,4),t.fillStyle="#cbd4d0",t.font='600 17px "Segoe UI",sans-serif',t.textAlign="center",t.fillText("COLD  /  HOT  /  RAINY NIGHT",256,979);let d=t.createLinearGradient(0,0,40,0);return d.addColorStop(0,"rgba(255,255,255,0.3)"),d.addColorStop(1,"rgba(255,255,255,0)"),t.fillStyle=d,t.fillRect(0,0,40,1024),ct(e,1,1,!0)}
function xr(i){let[e,t]=lt(384,512),n={onigiri:["#f5e9cf","#2f6c57","#d77543"],coffee:["#eee2cf","#6b4634","#d9a45f"],oden:["#f0dfc3","#96502f","#d48a4b"],atm:["#d9e9e7","#285a63","#4f9da0"],fried:["#f2dfc2","#b75f32","#e7a34c"],magazine:["#e9e3d7","#4e5e7c","#b96946"]},s=n[i]||n.onigiri;if(t.fillStyle=s[0],t.fillRect(0,0,384,512),t.fillStyle=s[1],t.fillRect(0,0,384,94),t.fillStyle=s[2],t.fillRect(0,94,384,10),t.fillStyle="#fffdf4",t.font='700 37px "Yu Gothic UI","Meiryo",sans-serif',t.textAlign="center",t.textBaseline="middle",i==="onigiri")t.fillText("\u304A\u306B\u304E\u308A",192,50),t.fillStyle="#2e6b58",t.beginPath(),t.moveTo(192,152),t.lineTo(298,346),t.lineTo(86,346),t.closePath(),t.fill(),t.fillStyle="#fff8e9",t.fillRect(126,272,132,74),t.fillStyle="#274c40",t.font='700 28px "Yu Gothic UI","Meiryo",sans-serif',t.fillText("\u65B0\u767A\u58F2",192,416),t.fillStyle="#a25532",t.font='700 38px "Segoe UI",sans-serif',t.fillText("\xA5120",192,470);else if(i==="coffee"){t.fillText("HOT",192,50),t.fillStyle="#fbf4e7",rn(t,125,174,134,170,20),t.fill(),t.fillStyle="#6b4634",rn(t,138,188,108,40,12),t.fill(),t.strokeStyle="#d7c7ae",t.lineWidth=10,t.beginPath(),t.arc(268,238,26,-1.3,1.25),t.stroke(),t.strokeStyle="rgba(120,92,67,0.6)",t.lineWidth=5;for(let r=0;r<3;r++)t.beginPath(),t.moveTo(154+r*30,145),t.bezierCurveTo(142+r*30,115,168+r*30,105,156+r*30,80),t.stroke();t.fillStyle="#5a3c2d",t.font='700 32px "Yu Gothic UI","Meiryo",sans-serif',t.fillText("\u307B\u3063\u3068\u4E00\u606F",192,410),t.fillStyle="#9f7047",t.font='600 22px "Yu Gothic UI","Meiryo",sans-serif',t.fillText("\u3042\u305F\u305F\u304B\u3044\u30B3\u30FC\u30D2\u30FC",192,454)}else if(i==="oden"){t.fillText("\u304A\u3067\u3093",192,50),t.fillStyle="#7d452e",rn(t,82,210,220,140,26),t.fill(),t.fillStyle="#d5a16b";for(let r=0;r<4;r++)t.beginPath(),t.arc(118+r*50,226+r%2*28,25,0,Math.PI*2),t.fill();t.fillStyle="#e5d4b8",t.fillRect(122,184,140,28),t.strokeStyle="rgba(255,255,255,0.55)",t.lineWidth=4;for(let r=0;r<3;r++)t.beginPath(),t.moveTo(142+r*40,166),t.bezierCurveTo(134+r*40,140,156+r*40,132,146+r*40,110),t.stroke();t.fillStyle="#7a4127",t.font='700 28px "Yu Gothic UI","Meiryo",sans-serif',t.fillText("\u306F\u3058\u3081\u307E\u3057\u305F",192,418)}else if(i==="atm")t.fillText("ATM",192,50),t.fillStyle="#2f6e73",rn(t,104,164,176,230,15),t.fill(),t.fillStyle="#d8f6f1",t.fillRect(126,188,132,76),t.fillStyle="#79c3c8",t.fillRect(126,278,64,80),t.fillStyle="#1d4f55",t.fillRect(202,278,56,16),t.fillStyle="#395c60",t.font='600 23px "Yu Gothic UI","Meiryo",sans-serif',t.fillText("24\u6642\u9593 \u3054\u5229\u7528\u304F\u3060\u3055\u3044",192,446);else if(i==="fried"){t.fillText("\u304B\u3089\u3042\u3052",192,50),t.fillStyle="#c2783f",rn(t,103,210,178,120,24),t.fill(),t.fillStyle="#e2a65f";for(let r=0;r<5;r++)t.beginPath(),t.arc(128+r*33,248+r%2*20,25,0,Math.PI*2),t.fill();t.fillStyle="#345a4e",t.font='700 30px "Yu Gothic UI","Meiryo",sans-serif',t.fillText("\u3067\u304D\u305F\u3066",192,398)}else t.fillText("\u6708\u520A \u307B\u3057\u305E\u3089",192,50),t.fillStyle="#425b7a",t.fillRect(66,134,252,260),t.fillStyle="#f5efdf",t.fillRect(86,154,212,120),t.fillStyle="#c87343",t.beginPath(),t.arc(192,216,40,0,Math.PI*2),t.fill(),t.fillStyle="rgba(250,246,235,0.85)",t.fillRect(86,292,150,16),t.fillRect(86,320,212,9),t.fillRect(86,340,186,9);return t.strokeStyle="rgba(255,255,255,0.5)",t.lineWidth=3,t.strokeRect(8,8,368,496),ct(e,1,1,!0)}
function Kv(i=0){let[e,t]=lt(256,512),n=t.createLinearGradient(0,0,0,512);n.addColorStop(0,"#e8fbff"),n.addColorStop(.4,"#9ed9e2"),n.addColorStop(1,"#4b8e9f"),t.fillStyle=n,t.fillRect(0,0,256,512);let s=[["#d45b4c","#e3c05e","#5a9e6c","#eee4c8","#497fb0","#d68cae"],["#7bc8df","#e9e4d3","#cd776b","#71a15b","#c9b26a","#6b80bb"],["#f0e9d7","#d65a55","#6caa7b","#e6b155","#7cb6c9","#b47ea0"],["#bba8d5","#e5d8bf","#8ab8a0","#d78963","#ecf0e2","#6893b4"]],r=s[i%s.length];for(let o=0;o<4;o++){let l=52+o*113;t.fillStyle="rgba(255,255,255,0.46)",t.fillRect(14,l+88,228,4);for(let c=0;c<7;c++){let h=r[(o*3+c+i)%r.length],d=19+c*31,u=(c+o+i)%4===0?"bottle":"can";Mf(t,d,l+12,22,65,h,u)}}let a=t.createLinearGradient(0,0,256,512);return a.addColorStop(0,"rgba(255,255,255,0)"),a.addColorStop(.38,"rgba(255,255,255,0.45)"),a.addColorStop(.5,"rgba(255,255,255,0.02)"),a.addColorStop(1,"rgba(255,255,255,0.16)"),t.fillStyle=a,t.fillRect(0,0,256,512),t.strokeStyle="rgba(31,57,63,0.75)",t.lineWidth=8,t.strokeRect(0,0,256,512),t.strokeStyle="rgba(255,255,255,0.65)",t.lineWidth=2,t.strokeRect(10,10,236,492),ct(e,1,1,!0)}
function bf(i=!1){let[e,t]=lt(256,256),n=t.createLinearGradient(0,0,0,256);i?(n.addColorStop(0,"#a9d3dd"),n.addColorStop(1,"#386b82")):(n.addColorStop(0,"#ffe3a8"),n.addColorStop(.6,"#e9a35f"),n.addColorStop(1,"#a35d3e")),t.fillStyle=n,t.fillRect(0,0,256,256),t.fillStyle=i?"rgba(30,65,85,0.38)":"rgba(93,54,39,0.36)",t.fillRect(0,172,256,84),t.fillStyle=i?"rgba(25,55,70,0.6)":"rgba(100,58,39,0.5)";for(let s=0;s<5;s++)t.fillRect(24+s*45,38,19,190);return t.fillStyle=i?"rgba(185,229,239,0.34)":"rgba(255,235,192,0.55)",t.fillRect(100,36,60,118),t.fillStyle="rgba(38,43,42,0.8)",t.fillRect(119,0,9,256),t.fillRect(0,121,256,8),t.strokeStyle="rgba(45,47,42,0.9)",t.lineWidth=14,t.strokeRect(1,1,254,254),ct(e,1,1,!0)}
function jv(i){let[e,t]=lt(512,256);t.clearRect(0,0,512,256),t.fillStyle="rgba(229,236,232,0.85)",t.font='700 150px "Yu Gothic UI","Meiryo",sans-serif',t.textAlign="center",t.textBaseline="middle",t.fillText(i,256,128);let n=dn(81);t.globalCompositeOperation="destination-out";for(let s=0;s<300;s++)t.fillStyle=`rgba(0,0,0,${.2+n()*.6})`,t.fillRect(n()*512,n()*256,2+n()*14,1+n()*4);return t.globalCompositeOperation="source-over",ct(e,1,1,!0)}
function Qv(){let[i,e]=lt(512,1024);e.clearRect(0,0,512,1024);let t=dn(55),n=56,s=72;for(let r=24;r<1024;r+=n+s){let a=e.createLinearGradient(0,r,0,r+n);a.addColorStop(0,"rgba(233,240,236,0.92)"),a.addColorStop(1,"rgba(185,198,197,0.78)"),e.fillStyle=a,e.fillRect(18,r,476,n),e.globalCompositeOperation="destination-out";for(let o=0;o<40;o++)e.fillStyle=`rgba(0,0,0,${.08+t()*.24})`,e.fillRect(t()*512,r+t()*n,3+t()*25,1+t()*4);e.globalCompositeOperation="source-over"}e.fillStyle="rgba(220,232,229,0.32)";for(let r=100;r<980;r+=128)e.fillRect(246,r,20,62);return ct(i,1,1,!0)}
function ey(){let[i,e]=lt(768,192);return e.fillStyle="#22585e",e.fillRect(0,0,768,192),e.strokeStyle="#e9eee5",e.lineWidth=9,e.strokeRect(8,8,752,176),e.fillStyle="#f3f0df",e.font='700 72px "Yu Gothic UI","Meiryo",sans-serif',e.textAlign="center",e.textBaseline="middle",e.fillText("\u307B\u3057\u305E\u3089\u901A\u308A",384,79),e.fillStyle="#c7dcd9",e.font='600 28px "Segoe UI",sans-serif',e.fillText("HOSHIZORA  STREET",384,146),ct(i,1,1,!0)}
function ty(){let[i,e]=lt(422,560);return e.fillStyle="#2b5e97",e.fillRect(0,0,422,560),e.strokeStyle="#eef4eb",e.lineWidth=13,e.strokeRect(12,12,398,536),e.fillStyle="#f7f4e6",e.textAlign="center",e.textBaseline="middle",e.font='700 57px "Yu Gothic UI","Meiryo",sans-serif',e.fillText("\u307F\u306A\u307F",211,165),e.font='700 104px "Segoe UI",sans-serif',e.fillText("2",150,318),e.font='700 62px "Yu Gothic UI","Meiryo",sans-serif',e.fillText("\u4E01\u76EE",286,330),e.fillStyle="#d3e2ed",e.font='600 39px "Segoe UI",sans-serif',e.fillText("8 \u2014 14",211,450),ct(i,1,1,!0)}
function ny(){let[i,e]=lt(256,320);return e.fillStyle="#2b628e",e.fillRect(0,0,256,320),e.strokeStyle="#eff4f0",e.lineWidth=10,e.strokeRect(7,7,242,306),e.fillStyle="#f4f0e2",e.font='700 190px "Segoe UI",sans-serif',e.textAlign="center",e.textBaseline="middle",e.fillText("P",128,145),e.font='700 33px "Yu Gothic UI","Meiryo",sans-serif',e.fillText("\u99D0\u8ECA\u5834",128,268),ct(i,1,1,!0)}
function iy(i){let[e,t]=lt(128,128);return t.clearRect(0,0,128,128),t.fillStyle="rgba(229,236,232,0.86)",t.font='700 94px "Segoe UI",sans-serif',t.textAlign="center",t.textBaseline="middle",t.fillText(String(i),64,68),ct(e,1,1,!0)}
function sy(){let[i,e]=lt(512,192);e.fillStyle="#2f4c43",e.fillRect(0,0,512,192),e.strokeStyle="#c9b993",e.lineWidth=8,e.strokeRect(10,10,492,172),e.fillStyle="#d8cba9",e.textAlign="center",e.textBaseline="middle",e.font='600 46px "Segoe UI",sans-serif',e.fillText("WELCOME",256,96),e.fillStyle="rgba(230,220,191,0.75)",e.font='600 20px "Yu Gothic UI","Meiryo",sans-serif',e.fillText("\u307B\u3057\u305E\u3089\u30DE\u30FC\u30C8",256,145);let t=dn(9);for(let n=0;n<1800;n++)e.fillStyle=`rgba(10,20,15,${t()*.08})`,e.fillRect(t()*512,t()*192,1.4,1.4);return ct(i,1,1,!0)}
function ry(){let[i,e]=lt(512,512);e.fillStyle="#333b3c",e.fillRect(0,0,512,512);let t=e.createRadialGradient(256,256,40,256,256,252);t.addColorStop(0,"#4c5655"),t.addColorStop(.7,"#333d3e"),t.addColorStop(1,"#1a2124"),e.fillStyle=t,e.beginPath(),e.arc(256,256,252,0,Math.PI*2),e.fill(),e.strokeStyle="rgba(170,181,176,0.3)";for(let n=46;n<225;n+=34)e.lineWidth=3,e.beginPath(),e.arc(256,256,n,0,Math.PI*2),e.stroke();e.lineWidth=8,e.strokeStyle="rgba(10,14,16,0.7)";for(let n=0;n<Math.PI*2;n+=Math.PI/12)e.beginPath(),e.moveTo(256+Math.cos(n)*70,256+Math.sin(n)*70),e.lineTo(256+Math.cos(n)*214,256+Math.sin(n)*214),e.stroke();return e.fillStyle="rgba(190,196,184,0.38)",e.font='700 28px "Yu Gothic UI","Meiryo",sans-serif',e.textAlign="center",e.fillText("\u304A\u3059\u3044",256,246),e.font='600 22px "Segoe UI",sans-serif',e.fillText("RAIN WATER",256,280),ct(i,1,1,!0)}
function Ef(i=!0){let[e,t]=lt(512,512);t.clearRect(0,0,512,512);let n=dn(i?44:93),s=i?["rgba(255,203,125,","rgba(255,167,95,","rgba(255,231,181,"]:["rgba(119,224,255,","rgba(171,215,255,","rgba(101,255,211,"];t.filter="blur(8px)";for(let r=0;r<24;r++){let a=5+n()*30,o=70+n()*230,l=40+n()*430,c=180+n()*260,h=Hv(s),d=t.createLinearGradient(0,c,0,c+o);d.addColorStop(0,h+"0)"),d.addColorStop(.4,h+(.08+n()*.22)+")"),d.addColorStop(1,h+"0)"),t.fillStyle=d,t.fillRect(l,c,a,o)}return t.filter="none",ct(e,1,1,!0)}
function Tf(i="rgba(255,255,255,1)",e="rgba(255,255,255,0)"){let[t,n]=lt(256,256),s=n.createRadialGradient(128,128,0,128,128,128);return s.addColorStop(0,i),s.addColorStop(.27,i.replace(/[\d.]+\)$/,"0.55)")),s.addColorStop(1,e),n.fillStyle=s,n.fillRect(0,0,256,256),ct(t,1,1,!0)}
function ay(){let[i,e]=lt(256,256),t=e.createRadialGradient(128,128,0,128,128,128);return t.addColorStop(0,"rgba(0,0,0,0.55)"),t.addColorStop(.48,"rgba(0,0,0,0.27)"),t.addColorStop(1,"rgba(0,0,0,0)"),e.fillStyle=t,e.fillRect(0,0,256,256),ct(i,1,1,!0)}
var oy=Wv(),ly=Xv(),wf=Yv(),mf=qv(),cy=Zv(),hy=$v(),Af=Jv(),uy=Sf(!0),dy=Sf(!1),fy=[0,1,2,3].map(i=>Kv(i)),pc=bf(!1),mc=bf(!0),Rf=Qv(),py=ey(),my=ty(),gy=ny(),_y=sy(),xy=ry(),Cf=Tf("rgba(255,211,148,1)"),vy=Tf("rgba(145,236,255,1)"),yy=ay(),My=Ef(!0),Sy=Ef(!1),qi={onigiri:xr("onigiri"),coffee:xr("coffee"),oden:xr("oden"),atm:xr("atm"),fried:xr("fried"),magazine:xr("magazine")},ht=new xt;
Vt.add(ht);
function L(i,e,t,n,s,r,a,o={}){let{parent:l=ht,cast:c=!0,receive:h=!0,outline:d=!1,opacity:u,rotX:f=0,rotY:g=0,rotZ:y=0,name:m}=o,p=new ze(new Gn(i,e,t),n);return p.position.set(s,r,a),p.rotation.set(f,g,y),p.castShadow=c,p.receiveShadow=h,m&&(p.name=m),u!==void 0&&(p.material=n.clone(),p.material.transparent=!0,p.material.opacity=u),l.add(p),d&&yf(p,.42),p}
function ot(i,e,t,n,s,r,a,o={}){let{parent:l=ht,radialSegments:c=12,rotX:h=0,rotY:d=0,rotZ:u=0,cast:f=!0,receive:g=!0,outline:y=!1}=o,m=new ze(new Ii(i,e,t,c),n);return m.position.set(s,r,a),m.rotation.set(h,d,u),m.castShadow=f,m.receiveShadow=g,l.add(m),y&&yf(m,.45,463643,40),m}
function en(i,e,t,n,s=ht,r=6){let a=new C(...i),o=new C(...e),l=o.clone().sub(a),c=l.length(),h=new ze(new Ii(t,t,c,r),n);return h.position.copy(a).add(o).multiplyScalar(.5),h.quaternion.setFromUnitVectors(new C(0,1,0),l.normalize()),h.castShadow=!0,h.receiveShadow=!0,s.add(h),h}
function Xt(i,e,t,n,s,r,a=0,o=ht){let l=new xt;l.position.set(n,s,r),l.rotation.y=a;let c=new ze(new Cn(i,e),t);return c.rotation.x=-Math.PI/2,c.receiveShadow=!0,l.add(c),o.add(l),{group:l,mesh:c}}
function Xe(i,e,t,n,s,r,a=0,o=0,l=ht){let c=new ze(new Cn(i,e),t);return c.position.set(n,s,r),c.rotation.set(o,a,0),l.add(c),c}
function Un(i,e,t,n,s,r=.36){let a=new Zs({map:Cf,color:n,transparent:!0,opacity:r,blending:hn,depthWrite:!1,toneMapped:!1});(n===8448767||n===10810367)&&(a.map=vy);let o=new Zr(a);return o.position.set(i,e,t),o.scale.setScalar(s),ht.add(o),o}
function by(i,e,t,n,s,r=.3,a=Cf,o=0){let l=new ce({map:a,color:s,transparent:!0,opacity:r,blending:hn,depthWrite:!1,toneMapped:!1,side:Ut}),c=Xt(t,n,l,i,.158,e,o);return c.mesh.renderOrder=2,c}
var Ey=new Pt({uniforms:{topColor:{value:new Re(395794)},midColor:{value:new Re(1054759)},lowColor:{value:new Re(1778994)},accent:{value:new Re(3814468)}},vertexShader:`
    varying vec3 vWorldPosition;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPosition = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,fragmentShader:`
    uniform vec3 topColor;
    uniform vec3 midColor;
    uniform vec3 lowColor;
    uniform vec3 accent;
    varying vec3 vWorldPosition;
    void main() {
      vec3 dir = normalize(vWorldPosition);
      float h = dir.y;
      vec3 col = mix(lowColor, midColor, smoothstep(-0.16, 0.28, h));
      col = mix(col, topColor, smoothstep(0.25, 0.95, h));
      float horizon = exp(-pow((h + 0.02) * 5.0, 2.0));
      col += accent * horizon * 0.12;
      gl_FragColor = vec4(col, 1.0);
    }
  `,side:jt,depthWrite:!1,fog:!1}),Pf=new ze(new ni(100,32,20),Ey);
Pf.renderOrder=-10;
Vt.add(Pf);
var Ty=new ce({map:yy,transparent:!0,opacity:.7,depthWrite:!1}),$h=new ze(new Cn(42,42),Ty);
$h.rotation.x=-Math.PI/2;
$h.position.y=-1.315;
Vt.add($h);
var wy=new _i({map:cy,color:11711409,roughness:.54,metalness:.2,emissive:1118999,emissiveIntensity:.8}),gc=new ze(new dc(24,1.34,24,5,.16),wy);
gc.position.y=-.67;
gc.castShadow=!0;
gc.receiveShadow=!0;
ht.add(gc);
var fc=new _i({color:9139534,roughness:.35,metalness:.7});
function If(i,e=.035){L(24.01,e,.055,fc,0,i,12,{cast:!1,receive:!1}),L(24.01,e,.055,fc,0,i,-12,{cast:!1,receive:!1}),L(.055,e,24.01,fc,12,i,0,{cast:!1,receive:!1}),L(.055,e,24.01,fc,-12,i,0,{cast:!1,receive:!1})}
If(-.06,.028);
If(-1.24,.024);
L(23.82,.02,.08,I.roofEdge,0,-.015,11.72,{cast:!1,receive:!1});
L(23.82,.02,.08,I.roofEdge,0,-.015,-11.72,{cast:!1,receive:!1});
L(.08,.02,23.82,I.roofEdge,11.72,-.015,0,{cast:!1,receive:!1});
L(.08,.02,23.82,I.roofEdge,-11.72,-.015,0,{cast:!1,receive:!1});
var Ay={name:"WetRoadShader",uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null},tAsphalt:{value:null},tPuddle:{value:null},uTime:{value:0},uLampPos:{value:new C(-4.82,0,4.45)},uStorePos:{value:new C(-2.2,0,3.2)},uVendingPos:{value:new C(4.8,0,.2)}},vertexShader:`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }
  `,fragmentShader:`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tAsphalt;
    uniform sampler2D tPuddle;
    uniform float uTime;
    uniform vec3 uLampPos;
    uniform vec3 uStorePos;
    uniform vec3 uVendingPos;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_fragment>

    void main() {
      #include <logdepthbuf_fragment>

      vec2 wuv = (vWorld.xz + 11.8) / 23.6;
      vec3 asphaltRaw = texture2D(tAsphalt, wuv * 4.2).rgb;
      vec3 asphalt = pow(asphaltRaw, vec3(1.8)) * 1.6;
      float mask = texture2D(tPuddle, wuv).r;
      float coarse = texture2D(tAsphalt, wuv * 13.0).g;
      float puddle = smoothstep(0.30, 0.75, mask);
      float wet = clamp(0.18 + puddle * 0.82 + coarse * 0.08, 0.0, 1.0);

      // a fine, broken ripple distortion, never mirror-flat
      vec2 ripple = vec2(
        sin(vWorld.z * 51.0 + uTime * 1.15) + sin(vWorld.x * 37.0 - uTime * 0.8),
        cos(vWorld.x * 61.0 - uTime * 0.95) + cos(vWorld.z * 44.0 + uTime * 0.65)
      ) * 0.0014 * (0.5 + puddle);
      vec4 puv = vUv;
      puv.xy += ripple * puv.w;
      vec3 reflection = texture2DProj(tDiffuse, puv).rgb;
      reflection *= mix(vec3(0.82, 0.89, 1.0), vec3(1.0), puddle);

      float reflectionStrength = mix(0.14, 0.95, puddle) * (0.55 + wet * 0.45);
      vec3 base = asphalt * (0.70 + wet * 0.25);
      vec3 col = base + reflection * reflectionStrength;

      // damp blue sheen and a hint of sheen breakup from the aggregate
      col += vec3(0.012, 0.022, 0.038) * wet;
      col += (coarse - 0.5) * 0.024 * wet;

      // soft, broken pools from the street lamp and the shop front
      vec2 lampDelta = vWorld.xz - uLampPos.xz;
      vec2 storeDelta = vWorld.xz - uStorePos.xz;
      vec2 vendDelta = vWorld.xz - uVendingPos.xz;
      float lampPool = exp(-dot(lampDelta, lampDelta) * 0.047);
      float storePool = exp(-dot(storeDelta, storeDelta) * 0.075);
      float vendPool = exp(-dot(vendDelta, vendDelta) * 0.13);
      float brokenLight = 0.55 + coarse * 0.9;
      col += vec3(0.072, 0.034, 0.009) * lampPool * brokenLight;
      col += vec3(0.043, 0.022, 0.008) * storePool * brokenLight;
      col += vec3(0.005, 0.021, 0.032) * vendPool;

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `},$i=new Ba(new Cn(23.64,23.64),{clipBias:.008,textureWidth:1280,textureHeight:880,multisample:0,shader:Ay,color:16777215});
$i.rotation.x=-Math.PI/2;
$i.position.y=.022;
$i.material.uniforms.tAsphalt.value=oy;
$i.material.uniforms.tPuddle.value=ly;
$i.material.uniforms.tAsphalt.value.needsUpdate=!0;
$i.material.uniforms.tPuddle.value.needsUpdate=!0;
ht.add($i);
var Ry=[];
function Cy(i,e){let t=wf.clone();t.needsUpdate=!0,t.wrapS=t.wrapT=ls,t.repeat.set(i/1.6,e/1.6);let n=Be(13488847,{map:t});return Ry.push(n),n}
function _c(i,e,t,n){let s=t-i,r=n-e,a=(i+t)/2,o=(e+n)/2,l=.14;L(s,l,r,I.concreteDark,a,.02+l/2,o,{cast:!0,receive:!0});let c=Xt(s-.02,r-.02,Cy(s,r),a,.02+l+.003,o);c.mesh.receiveShadow=!0;let h=.025;L(s+.02,h,.03,I.concrete,a,.02+l+.015,n-.01,{cast:!1,receive:!1}),L(s+.02,h,.03,I.concrete,a,.02+l+.015,e+.01,{cast:!1,receive:!1}),L(.03,h,r+.02,I.concrete,i+.01,.02+l+.015,o,{cast:!1,receive:!1}),L(.03,h,r+.02,I.concrete,t-.01,.02+l+.015,o,{cast:!1,receive:!1})}
_c(-11.8,-11.8,5.6,2.1);
_c(-7.12,2.1,5.6,5);
_c(-11.8,10.62,11.8,11.8);
_c(10.62,-11.8,11.8,10.62);
Xt(4.3,2.86,Be(1910060),-9.33,.031,3.56);
L(4.42,.16,.16,I.curb,-9.33,.1,5,{outline:!1});
L(.16,.16,2.9,I.curb,-11.48,.1,3.55,{});
L(.16,.16,2.9,I.curb,-7.2,.1,3.55,{});
{let i=mf.clone();i.repeat.set(4,2),i.needsUpdate=!0;let e=Be(13219181,{map:i});Xt(2.15,.62,e,-2.4,.166,4.66);let t=mf.clone();t.repeat.set(6,2),t.needsUpdate=!0;let n=Be(13219181,{map:t});Xt(.58,2.45,n,5.23,.166,7.7)}
var Df=I.curb;
function Lf(i,e,t,n=.19){let s=e-i;L(s,n,.18,Df,(i+e)/2,.02+n/2,t,{cast:!1}),L(s,.025,.18,I.concrete,(i+e)/2,.02+n+.006,t,{cast:!1,receive:!1})}
function Uf(i,e,t,n=.19){let s=e-i;L(.18,n,s,Df,t,.02+n/2,(i+e)/2,{cast:!1}),L(.18,.025,s,I.concrete,t,.02+n+.006,(i+e)/2,{cast:!1,receive:!1})}
Lf(-11.8,-4.15,5);
Lf(-.65,5.6,5);
Uf(-11.8,6.2,5.6);
Uf(9.25,10.62,5.6);
function Nf(i,e,t,n,s=0){let r=L(t,.06,n,I.concrete,i,.115,e,{rotY:s,cast:!1});r.rotation.z=0}
Nf(-2.4,4.94,3.1,.48);
Nf(5.54,7.7,3.1,.48,Math.PI/2);
{let i=new ce({map:Rf,transparent:!0,opacity:.74,depthWrite:!1,toneMapped:!1,color:14213341});i.color.set(9016978),i.opacity=.46;let e=Xt(3.5,5.35,i,-2.4,.046,7.86);e.mesh.renderOrder=3}
{let i=new ce({map:Rf,transparent:!0,opacity:.44,depthWrite:!1,toneMapped:!1,color:9016978,side:Ut}),e=new xt;e.position.set(8.12,.047,7.68),e.rotation.y=Math.PI/2;let t=new ze(new Cn(3.2,5.1),i);t.rotation.x=-Math.PI/2,t.renderOrder=3,e.add(t),ht.add(e)}
{let i=new ce({color:14410716,transparent:!0,opacity:.62,depthWrite:!1,toneMapped:!1});for(let e of[-11.38,-9.3,-7.22])Xt(.1,2.62,i,e,.044,3.55);Xt(4.2,.09,i,-9.3,.044,2.24);for(let e=0;e<2;e++){let t=new ce({map:iy(e+1),transparent:!0,opacity:.65,depthWrite:!1,toneMapped:!1});Xt(.52,.52,t,e===0?-10.35:-8.26,.045,3)}for(let e=0;e<2;e++){let t=e===0?-10.35:-8.26;L(.85,.13,.18,I.concreteDark,t,.065,2.55,{outline:!0})}}
{let i=new ce({color:13358802,transparent:!0,opacity:.38,depthWrite:!1,toneMapped:!1});for(let n=-10.4;n<3.8;n+=2.6)n>1.8&&n<5.4||Xt(.11,1.3,i,8.1,.042,n);for(let n=-10.4;n<-4.5;n+=2.6)Xt(1.3,.11,i,n,.042,8);Xt(3.7,.13,i,8.1,.043,9.82);let e=jv("\u6B62\u307E\u308C"),t=new ce({map:e,transparent:!0,opacity:.6,depthWrite:!1,toneMapped:!1});Xt(2.5,1.25,t,8.08,.044,10)}
{let i=new ze(new gi(.62,40),Be(11843245,{map:xy}));i.rotation.x=-Math.PI/2,i.position.set(1.55,.048,8.35),i.receiveShadow=!0,ht.add(i)}
function Mr(i,e,t=0){let n=new xt;n.position.set(i,.055,e),n.rotation.y=t,L(.62,.035,.34,I.metalDark,0,0,0,{parent:n,cast:!1});for(let s=0;s<6;s++)L(.055,.018,.3,I.metal,0,.022,-.14+s*.055,{parent:n,cast:!1,receive:!1});ht.add(n)}
Mr(-6,5.17,0);
Mr(-1.1,5.17,0);
Mr(2.2,5.17,0);
Mr(5.77,.4,Math.PI/2);
Mr(5.77,-2.7,Math.PI/2);
Mr(5.77,-5.8,Math.PI/2);
{let i=new ce({color:593427,transparent:!0,opacity:.55,depthWrite:!1});Xt(23.3,.16,i,0,.043,5.1);let e=Xt(.16,23,i,5.7,.043,0);e.mesh.renderOrder=1}
{let i=new ce({map:My,transparent:!0,opacity:.5,blending:hn,depthWrite:!1,toneMapped:!1}),e=Xt(4,1.15,i,-2.4,.171,1.92);e.mesh.scale.set(1,1,1),e.mesh.renderOrder=2;let t=new ce({map:Sy,transparent:!0,opacity:.42,blending:hn,depthWrite:!1,toneMapped:!1}),n=Xt(2.2,.8,t,4.2,.173,.2);n.mesh.renderOrder=2}
var J=new xt;
J.position.set(-2.2,0,-2.55);
ht.add(J);
var Nn=9.4,Ji=7.2,vi=-Nn/2,Dt=Nn/2,Nt=-Ji/2,ft=Ji/2,ri=3.62;
L(Nn,.12,Ji,I.concreteDark,0,.21,0,{parent:J,outline:!1});
{let i=wf.clone();i.repeat.set(6,5),i.needsUpdate=!0;let e=new _i({map:i,color:14733232,roughness:.3,metalness:.04,emissive:3876629,emissiveIntensity:.8}),t=new ze(new Cn(Nn-.28,Ji-.28),e);t.rotation.x=-Math.PI/2,t.position.y=.276,t.receiveShadow=!0,J.add(t)}
L(Nn,ri-.24,.2,I.wall,0,(ri+.24)/2,Nt+.1,{parent:J,outline:!0});
L(.2,ri-.24,Ji,I.wallSide,vi+.1,(ri+.24)/2,0,{parent:J,outline:!0});
L(.2,ri-.24,4,I.wallSide,Dt-.1,(ri+.24)/2,-1.6,{parent:J,outline:!0});
L(.2,.32,.4,I.wall,Dt-.1,3.38,3.4,{parent:J});
L(.2,.42,2.9,I.wall,Dt-.1,.42,1.8,{parent:J});
L(.2,.64,2.9,I.wall,Dt-.1,3.3,1.8,{parent:J});
L(.2,.32,2.9,I.wall,Dt-.1,.36,1.8,{parent:J});
L(.24,ri-.24,.24,I.teal,vi+.12,(ri+.24)/2,ft-.1,{parent:J,outline:!0});
L(.24,ri-.24,.24,I.teal,Dt-.12,(ri+.24)/2,ft-.1,{parent:J,outline:!0});
L(Nn-.4,.3,.2,I.teal,0,.39,ft-.1,{parent:J});
L(Nn-.4,.58,.2,I.darkTeal,0,3.12,ft-.1,{parent:J});
L(Nn-.1,.12,.24,I.teal,0,3.47,ft-.08,{parent:J});
L(Nn-.3,.08,.18,I.teal,0,2.98,ft-.07,{parent:J});
L(8.6,.035,.05,I.warmGlow,0,3.04,ft+.02,{parent:J,cast:!1,receive:!1});
var Py=new sr({color:12772841,metalness:.04,roughness:.06,transparent:!0,opacity:.11,depthWrite:!1,side:Ut,clearcoat:1,clearcoatRoughness:.06});
function Va(i,e,t,n,s,r=0,a=J){let o=Xe(i,e,Py,t,n,s,r,0,a);return o.receiveShadow=!1,o.castShadow=!1,o}
Va(3,2.53,-3.05,1.72,ft-.06);
Va(1.28,2.53,-.72,1.72,ft-.06);
Va(1.28,2.53,.58,1.72,ft-.06);
Va(3.36,2.53,2.66,1.72,ft-.06);
for(let i of[-4.55,-1.36,.02,1.21,4.55])L(.065,2.6,.09,I.darkTeal,i,1.72,ft-.055,{parent:J,cast:!1});
L(3,.06,.09,I.darkTeal,-3.05,2.82,ft-.055,{parent:J,cast:!1});
L(3.36,.06,.09,I.darkTeal,2.66,2.82,ft-.055,{parent:J,cast:!1});
L(.045,2.5,.08,I.metal,-.07,1.71,ft-.045,{parent:J,cast:!1});
L(.035,.55,.06,I.metalDark,-.23,1.34,ft+.01,{parent:J,cast:!1});
L(.035,.55,.06,I.metalDark,.1,1.34,ft+.01,{parent:J,cast:!1});
L(2.35,.055,.012,new ce({color:14086108}),-.07,2.28,ft+.005,{parent:J,cast:!1,receive:!1});
L(.78,.28,.012,new ce({color:10213825}),-.07,2.52,ft+.006,{parent:J,cast:!1,receive:!1});
Va(2.78,2.5,Dt+.005,1.72,1.78,Math.PI/2,J);
L(.06,2.58,.08,I.darkTeal,Dt+.01,1.72,1.78,{parent:J,cast:!1});
L(.07,2.58,.08,I.darkTeal,Dt+.01,1.72,1.03,{parent:J,cast:!1});
L(.07,2.58,.08,I.darkTeal,Dt+.01,1.72,2.53,{parent:J,cast:!1});
L(.07,2.58,.08,I.darkTeal,Dt+.01,1.72,3.16,{parent:J,cast:!1});
L(.58,.1,.14,I.metalDark,-.08,2.92,ft-.03,{parent:J});
L(.2,.025,.04,new ce({color:10289109}),-.08,2.86,ft+.045,{parent:J,cast:!1,receive:!1});
L(9.6,.16,1.72,I.darkTeal,0,3.23,4.32,{parent:J,outline:!0});
L(9.6,.34,.14,I.teal,0,3.1,5.16,{parent:J});
L(9.48,.04,1.58,I.cream,0,3.16,4.32,{parent:J,cast:!1,receive:!1});
for(let i of[-3.05,0,3.05]){ot(.1,.13,.08,I.cream,i,3.13,4.45,{parent:J,radialSegments:20,cast:!1}),ot(.068,.068,.018,I.amber,i,3.082,4.45,{parent:J,radialSegments:20,cast:!1,receive:!1});let e=new ze(new ni(.055,10,8),new ce({color:16767392,toneMapped:!1}));e.position.set(i,3.075,4.45),J.add(e),Un(i-2.2,3.05,2,16763790,.65,.11)}
by(-2.2,2.02,7.2,3,16765595,.06);
var Iy=L(8.96,1.16,.24,I.darkTeal,0,4.25,ft+.22,{parent:J,outline:!0}),Ff=new ce({map:hy,color:11053224,toneMapped:!1}),Of=Xe(8.72,1.02,Ff,0,4.25,ft+.345,0,0,J);
Of.castShadow=!1;
Of.receiveShadow=!1;
for(let i of[-4.2,-1.4,1.4,4.2])L(.08,.7,.55,I.metalDark,i,3.72,ft+.1,{parent:J,cast:!1});
Iy.material=I.darkTeal;
L(.2,1.56,.8,I.darkTeal,Dt+.28,4.02,2.72,{parent:J,outline:!0});
var Bf=new ce({map:Af,color:11908533,toneMapped:!1});
Xe(.74,1.44,Bf,Dt+.39,4.02,2.72,Math.PI/2,0,J);
{let[i,e]=lt(512,128),t=e.createLinearGradient(0,0,512,128);t.addColorStop(0,"rgba(200,235,240,0)"),t.addColorStop(.2,"rgba(215,245,255,0.5)"),t.addColorStop(.28,"rgba(215,245,255,0.05)"),t.addColorStop(.55,"rgba(220,245,255,0.38)"),t.addColorStop(.62,"rgba(220,245,255,0)"),t.addColorStop(1,"rgba(255,255,255,0)"),e.fillStyle=t,e.fillRect(0,0,512,128);let n=ct(i,1,1,!0),s=new ce({map:n,transparent:!0,opacity:.18,blending:hn,depthWrite:!1,toneMapped:!1}),r=Xe(6.2,1.45,s,-1.2,1.75,ft+.08,0,0,J);r.rotation.z=.23;let a=Xe(2.8,1.15,s,2.8,1.55,ft+.04,0,0,J);a.rotation.z=-.18;let o=Xe(2.2,1.2,s,Dt+.04,1.7,1.7,Math.PI/2,0,J);o.rotation.z=.2}
L(Nn+.25,.24,Ji+.25,I.roof,0,3.74,0,{parent:J,outline:!0});
L(Nn+.1,.17,.12,I.roofEdge,0,3.91,ft+.03,{parent:J});
L(Nn+.1,.17,.12,I.roofEdge,0,3.91,Nt-.03,{parent:J});
L(.12,.17,Ji+.1,I.roofEdge,Dt+.02,3.91,0,{parent:J});
L(.12,.17,Ji+.1,I.roofEdge,vi-.02,3.91,0,{parent:J});
for(let[i,e,t,n,s]of[[-2.8,-2.4,1.55,1.1,.52],[1.5,-2.7,1.15,.9,.4],[3.1,-1.1,.85,.7,.34]]){L(t,s,n,I.metal,i,3.86+s/2,e,{parent:J,outline:!0});for(let r=0;r<4;r++)L(t-.2,.02,.025,I.metalDark,i,3.93+r*.09,e+n/2+.005,{parent:J,cast:!1,receive:!1})}
ot(.09,.12,1.1,I.metalDark,.2,4.36,-2,{parent:J,radialSegments:8});
ot(.12,.09,.12,I.roofEdge,.2,4.95,-2,{parent:J,radialSegments:8});
L(.48,.32,.48,I.concreteDark,-4,3.98,-2.7,{parent:J,outline:!0});
L(1.05,.09,.95,I.metalDark,-1.2,3.9,-3,{parent:J});
for(let i=0;i<4;i++)L(.045,.45,.045,I.metal,3.8+i*.001,4.03,-3.35+i*.65,{parent:J,cast:!1});
L(.04,.04,2.2,I.metal,3.8,4.25,-2.45,{parent:J,cast:!1});
for(let[i,e,t,n]of[[-3.05,1.5,2.1,.42],[-.95,1.5,2.1,.42],[1.3,1.5,2.1,.42],[-3.05,-.7,2.1,.42],[-.95,-.7,2.1,.42],[1.3,-.7,2.1,.42],[2.9,1.6,1.7,.42]])L(t,.035,n,I.warmGlow,i,3.47,e,{parent:J,cast:!1,receive:!1}),L(t+.09,.045,n+.09,I.metalDark,i,3.49,e,{parent:J,cast:!1,receive:!1});
L(8.8,2.9,.04,new ce({color:14468002,toneMapped:!0}),0,1.75,Nt+.23,{parent:J,cast:!1,receive:!1});
{let[i,e]=lt(1024,80);e.fillStyle="#1b5658",e.fillRect(0,0,1024,80),e.fillStyle="#e79a4b",e.fillRect(0,0,1024,7),e.fillStyle="#f1ead7",e.font='700 34px "Yu Gothic UI","Meiryo",sans-serif',e.textAlign="left",e.textBaseline="middle",e.fillText("HOSHIZORA",26,38),e.font='600 22px "Segoe UI",sans-serif',e.fillStyle="#b8d8cd",e.fillText("everyday, a little brighter",280,39),e.fillStyle="#e8b35f",e.beginPath(),e.arc(936,39,25,0,Math.PI*2),e.fill(),e.fillStyle="#1b5658",e.font='700 24px "Segoe UI",sans-serif',e.textAlign="center",e.fillText("24",936,41);let t=new ce({map:ct(i,1,1,!0),color:13816530,toneMapped:!0});Xe(8.25,.64,t,0,3.06,Nt+.81,0,0,J)}
for(let i=0;i<4;i++){let e=-3.45+i*1.14;L(1.08,2.45,.65,I.darkTeal,e,1.52,Nt+.52,{parent:J,outline:!0});let t=new ce({map:fy[i],toneMapped:!1});Xe(.92,2.15,t,e,1.55,Nt+.87,0,0,J),L(.03,2.28,.03,I.metal,e+.55,1.58,Nt+.89,{parent:J,cast:!1}),L(.84,.04,.04,I.coolGlow,e,2.56,Nt+.9,{parent:J,cast:!1,receive:!1})}
var gf=[12929598,14132797,5147744,15654845,5144758,12873362,8612018,13925430,6596266,14791018,9221227,14183512];
function Jh(i,e,t,n,s,r,a,o=0,l={}){let c=new xt;c.position.set(e,.28,t),c.rotation.y=o,i.add(c);let h=l.frame||I.darkTeal,d=l.accent||Be(13865809);L(.055,a,s,h,-n/2+.03,a/2,0,{parent:c,outline:!1}),L(.055,a,s,h,n/2-.03,a/2,0,{parent:c,outline:!1}),L(n,a,.045,h,0,a/2,-s/2+.025,{parent:c,outline:!1}),L(n+.04,.12,s+.03,h,0,.06,0,{parent:c,cast:!1}),L(n+.02,.06,s+.04,I.metal,0,a-.025,0,{parent:c,cast:!1,receive:!1});let u=[];for(let E=0;E<r;E++){let R=.1+E/Math.max(1,r)*(a-.24);u.push(R),L(n+.03,.045,s+.035,I.metal,0,R,0,{parent:c,cast:!1,receive:!1}),L(n+.03,.045,.025,d,0,R+.02,s/2+.016,{parent:c,cast:!1,receive:!1}),L(n*.9,.022,.012,I.cream,0,R+.062,s/2+.034,{parent:c,cast:!1,receive:!1})}let f=s>.66?2:1,g=Math.max(3,Math.floor(n/.13)),y=r*g*f,m=new Gn(.074,.145,.06),p=new ce({color:16777215,toneMapped:!0}),b=new Jr(m,p,y);b.castShadow=!1,b.receiveShadow=!0;let S=new Wt,v=0,w=dn(Math.floor((e+20)*937+(t+20)*117+n*13+s*71));for(let E=0;E<r;E++){let R=u[E];for(let _=0;_<f;_++)for(let T=0;T<g;T++){let P=-n/2+.1+T/Math.max(1,g-1)*(n-.2),D=f===2?_===0?-s*.16:s*.15:s*.06,N=.8+w()*.45;S.position.set(P+(w()-.5)*.02,R+.087,D+(w()-.5)*.03),S.rotation.set(0,(w()-.5)*.16,0),S.scale.set(N,.78+w()*.55,N),S.updateMatrix(),b.setMatrixAt(v,S.matrix),b.setColorAt(v,new Re(gf[v%gf.length])),v++}}return b.count=v,b.instanceMatrix.needsUpdate=!0,b.instanceColor&&(b.instanceColor.needsUpdate=!0),c.add(b),c}
Jh(J,-4.22,-1.2,3.3,.62,4,1.58,Math.PI/2,{accent:Be(13602637)});
Jh(J,-1.7,.92,2.9,.92,4,1.24,0,{accent:Be(13207878)});
L(2.94,.06,.96,I.darkTeal,-1.7,1.55,.92,{parent:J,cast:!1,receive:!1});
L(.07,1.12,.96,Be(13207878),-3.18,.85,.92,{parent:J});
L(.07,1.12,.96,Be(3107428),-.22,.85,.92,{parent:J});
{let i=new ce({map:qi.onigiri,toneMapped:!1});Xe(.44,.62,i,-3.14,1.01,1.41,0,0,J);let e=new ce({map:qi.coffee,toneMapped:!1});Xe(.44,.62,e,-.26,1.01,1.41,0,0,J)}
Jh(J,-3.9,2.82,1.1,.52,3,.9,0,{accent:Be(5997952)});
{let i=[qi.magazine,qi.oden,qi.coffee,qi.fried];for(let e=0;e<4;e++){let t=new ce({map:i[e],toneMapped:!1}),n=Xe(.25,.34,t,-4.3+e*.27,1.02,3.075,.06,0,J);n.rotation.x=.1}}
{L(2.1,.96,1.65,I.cream,2.95,.75,-1.4,{parent:J,outline:!0}),L(2,.08,1.58,I.wood,2.95,1.24,-1.4,{parent:J}),L(2.25,.28,.16,I.teal,2.95,.48,-.58,{parent:J}),L(.42,.32,.36,I.metalDark,3.3,1.42,-1.5,{parent:J,outline:!0});let i=new ce({color:8842192,toneMapped:!1});Xe(.32,.22,i,3.3,1.54,-1.68,0,0,J),L(.12,.1,.12,I.metal,3.7,1.32,-1.45,{parent:J,cast:!1}),L(2.15,2.35,.38,I.darkTeal,3,1.48,Nt+.55,{parent:J,outline:!0});let e=dn(606);for(let n=0;n<4;n++)for(let s=0;s<6;s++){let r=new ce({color:new Re().setHSL(e(),.45,.55),toneMapped:!1});Xe(.22,.12,r,2.28+s*.26,2.34-n*.28,Nt+.75,0,0,J)}L(.56,.4,.42,I.metalDark,2,1.4,-1.5,{parent:J,outline:!0}),L(.45,.22,.32,new ce({color:16760943,toneMapped:!1}),2,1.48,-1.49,{parent:J,cast:!1,receive:!1}),ot(.09,.07,.14,I.cream,3.75,1.34,-.72,{parent:J,radialSegments:10});let t=new ze(new Di(.18,1),I.leaf);t.position.set(3.75,1.52,-.72),t.castShadow=!0,J.add(t)}
function zf(i,e,t,n,s){let[r,a]=lt(512,128);a.fillStyle=n,a.fillRect(0,0,512,128),a.fillStyle=s,a.fillRect(0,0,16,128),a.fillStyle="#fbf7e9",a.font='700 58px "Yu Gothic UI","Meiryo",sans-serif',a.textAlign="center",a.textBaseline="middle",a.fillText(i,264,66);let o=ct(r,1,1,!0),l=new ce({map:o,toneMapped:!1,side:Ut});Xe(1.28,.32,l,e,2.78,t,0,0,J),L(.012,.5,.012,I.metalDark,e-.48,3.15,t,{parent:J,cast:!1}),L(.012,.5,.012,I.metalDark,e+.48,3.15,t,{parent:J,cast:!1})}
zf("\u304A\u306B\u304E\u308A",-2.8,.8,"#2c5f57","#e0a052");
zf("\u98F2\u307F\u3082\u306E",.2,.8,"#2e5975","#72c1c5");
function Ki(i,e,t,n,s,r,a=0,o=J){let l=new ce({map:qi[i],toneMapped:!1});return Xe(s,r,l,e,t,n,a,0,o)}
Ki("onigiri",-3.8,.87,ft+.065,.53,.72);
Ki("oden",-2.95,.87,ft+.065,.53,.72);
Ki("coffee",2.15,.9,ft+.065,.55,.76);
Ki("fried",3,.9,ft+.065,.55,.76);
Ki("atm",-4.25,2.12,ft+.067,.56,.76);
Ki("magazine",Dt+.015,1.38,-.2,.64,.86,Math.PI/2);
Ki("fried",Dt+.015,1.38,-1.05,.64,.86,Math.PI/2);
L(.12,1.56,1.32,I.metalDark,Dt+.06,2.16,-2.28,{parent:J,outline:!0});
{let i=new ce({map:qi.coffee,color:14736079,toneMapped:!0});Xe(1.18,1.4,i,Dt+.13,2.16,-2.28,Math.PI/2,0,J)}
L(.06,.05,1.42,I.warmGlow,Dt+.08,2.98,-2.28,{parent:J,cast:!1,receive:!1});
L(.06,.05,1.42,I.warmGlow,Dt+.08,1.34,-2.28,{parent:J,cast:!1,receive:!1});
L(.03,.06,6.85,I.teal,Dt+.01,3.02,0,{parent:J,cast:!1,receive:!1});
L(.02,.03,6.85,Be(13208136),Dt+.015,2.94,0,{parent:J,cast:!1,receive:!1});
for(let i=0;i<5;i++)L(.025,.035,.42,I.metalDark,Dt+.02,2.48+i*.06,-3.12,{parent:J,cast:!1,receive:!1});
Ki("oden",vi-.01,1.2,-.4,.56,.76,-Math.PI/2);
{let i=new ce({map:_y,toneMapped:!1});Xt(2.5,.93,i,-.08,.18,4.15,0,J)}
L(2.7,.06,.3,I.metal,-.08,.18,3.76,{parent:J,cast:!1});
{let i=L(8.7,.05,.04,I.warmGlow,0,.35,ft+.04,{parent:J,cast:!1,receive:!1});i.material=new ce({color:16766624,toneMapped:!1})}
var mb=Un(-2.2,2.55,-1.8,16765594,2.7,.13);
{let[i,e]=lt(512,128);e.clearRect(0,0,512,128),e.fillStyle="rgba(248,245,230,0.94)",rn(e,12,18,488,92,20),e.fill(),e.fillStyle="#28676a",e.font='700 44px "Yu Gothic UI","Meiryo",sans-serif',e.textAlign="center",e.textBaseline="middle",e.fillText("24\u6642\u9593 \u55B6\u696D\u4E2D",256,63);let t=new ce({map:ct(i,1,1,!0),transparent:!0,toneMapped:!1,side:Ut});Xe(1.4,.35,t,-.08,2.64,3.64,0,0,J)}
function kf(i,e){let t=new xt;t.position.set(4.55,.15,i),ht.add(t);let n=Be(e?14478575:15194063),s=Be(e?2853795:11096403);L(.84,1.86,1.02,n,0,.94,0,{parent:t,outline:!0}),L(.87,.13,1.05,s,0,1.91,0,{parent:t}),L(.87,.08,1.05,I.metalDark,0,.09,0,{parent:t,cast:!1});let r=new ce({map:e?uy:dy,color:15263976,toneMapped:!0});Xe(.96,1.77,r,.426,1,0,Math.PI/2,0,t);let a=new ce({color:14022399,transparent:!0,opacity:.055,blending:hn,depthWrite:!1,toneMapped:!1});return Xe(.82,1.35,a,.434,1.28,0,Math.PI/2,0,t),L(.06,1.55,.045,e?I.coolGlow:I.warmGlow,.43,1.04,-.47,{parent:t,cast:!1,receive:!1}),Un(4.98,1.22,i,e?9300735:16759691,.8,.1),t}
kf(-.35,!0);
kf(.78,!1);
function Hf(i,e,t,n,s=0){let r=new xt;r.position.set(i,.15,e),r.rotation.y=s,ht.add(r),L(.52,.86,.48,t,0,.43,0,{parent:r,outline:!0}),L(.4,.18,.025,I.black,0,.62,.245,{parent:r,cast:!1}),L(.36,.05,.02,I.metal,0,.63,.26,{parent:r,cast:!1,receive:!1});let[a,o]=lt(256,128);o.fillStyle="#e7e2d3",o.fillRect(0,0,256,128),o.fillStyle="#395449",o.font='700 42px "Yu Gothic UI","Meiryo",sans-serif',o.textAlign="center",o.textBaseline="middle",o.fillText(n,128,68);let l=new ce({map:ct(a,1,1,!0),toneMapped:!1});return Xe(.42,.2,l,0,.4,.251,0,0,r),r}
Hf(4.7,1.75,Be(3235163),"\u304B\u3093",0);
Hf(4.7,2.22,Be(5070441),"\u30DA\u30C3\u30C8",0);
function Dy(i,e,t=0){let n=new xt;n.position.set(i,.16,e),n.rotation.y=t,n.rotation.z=.045,ht.add(n);let s=Be(6324094),r=I.metalDark,a=new ps(.37,.022,8,30);for(let l of[-.55,.55]){let c=new ze(a,r);c.rotation.y=Math.PI/2,c.position.set(0,.4,l),c.castShadow=!0,n.add(c);let h=ot(.045,.045,.06,I.metal,0,.4,l,{parent:n,rotZ:Math.PI/2,radialSegments:8,cast:!1});for(let d=0;d<8;d++){let u=d/8*Math.PI*2;en([0,.4,l],[Math.sin(u)*.34,.4+Math.cos(u)*.34,l],.0045,I.metal,n,4)}}let o={rear:[0,.42,-.55],bb:[0,.38,-.06],seat:[0,.88,-.19],head:[0,.82,.43],front:[0,.42,.55]};en(o.rear,o.bb,.022,s,n),en(o.bb,o.seat,.024,s,n),en(o.seat,o.head,.022,s,n),en(o.bb,o.head,.022,s,n),en(o.head,o.front,.022,s,n),en(o.rear,o.seat,.018,s,n),en(o.seat,o.rear,.018,s,n),en([0,.88,-.19],[0,.98,-.24],.026,I.metal,n),L(.16,.045,.27,I.black,0,.925,-.22,{parent:n,outline:!1}),en([0,.82,.43],[0,1,.4],.017,I.metal,n),en([-.18,1,.4],[.18,1,.4],.017,I.metal,n);for(let l of[-1,1])en([l*.18,1,.4],[l*.22,1.04,.44],.015,I.metal,n);return L(.46,.24,.35,I.metal,0,1.06,.6,{parent:n,outline:!0}),L(.38,.18,.03,I.metalDark,0,1.05,.78,{parent:n,cast:!1}),en([0,.45,.2],[.18,.1,.16],.012,I.metalDark,n),L(.08,.07,.12,I.metal,0,1,.7,{parent:n,cast:!1}),n}
Dy(3.55,-3.95,.06);
{let i=new xt;i.position.set(-3.45,.15,1.55),ht.add(i),ot(.3,.25,.5,I.metalDark,0,.25,0,{parent:i,radialSegments:18,outline:!0}),ot(.25,.25,.025,I.cream,0,.135,0,{parent:i,radialSegments:18,cast:!1});let e=[2973544,9412226,11096910];for(let a=0;a<3;a++){let o=a*2.1+.4,l=Math.cos(o)*.11,c=Math.sin(o)*.11;en([l,.22,c],[l+.11,1.03,c+.06],.012,I.metalDark,i);let h=new ze(new Ks(.075,.58,8,1,!0),Be(e[a]));h.position.set(l+.08,.79,c+.05),h.rotation.z=-.14,h.castShadow=!0,i.add(h);let d=new ze(new ni(.022,8,6),I.metalDark);d.position.set(l+.14,1.1,c+.08),i.add(d)}let t=new xt;t.position.set(-.1,0,-.03),t.rotation.z=.15,t.rotation.x=-.04,i.add(t);let n=new sr({color:12577006,transparent:!0,opacity:.34,roughness:.08,metalness:.02,side:Ut,depthWrite:!1,clearcoat:1,clearcoatRoughness:.08}),s=new ze(new Ks(.57,.23,12,1,!0),n);s.position.set(.16,1.14,0),s.castShadow=!1,t.add(s),en([.04,.18,0],[.3,1.27,0],.012,I.metalDark,t);let r=new ze(new ps(.07,.012,6,12,Math.PI),I.woodDark);r.position.set(.04,.17,0),r.rotation.z=Math.PI,t.add(r);for(let a=0;a<8;a++){let o=a/8*Math.PI*2;en([.3,1.24,0],[.3+Math.cos(o)*.53,1.13,Math.sin(o)*.53],.0045,I.metal,t,4)}}
{let i=new xt;i.position.set(-4.75,.15,2.16),i.rotation.y=-.14,ht.add(i);let e=Be(3560783),t=L(.65,1,.045,e,0,.96,.14,{parent:i,outline:!0,rotX:.2}),n=L(.65,1,.045,e,0,.96,-.14,{parent:i,outline:!0,rotX:-.2}),[s,r]=lt(512,720);r.fillStyle="#35564c",r.fillRect(0,0,512,720),r.strokeStyle="#d8c9a6",r.lineWidth=14,r.strokeRect(12,12,488,696),r.fillStyle="#e9e1cc",r.textAlign="center",r.font='700 82px "Yu Gothic UI","Meiryo",sans-serif',r.fillText("\u672C\u65E5",256,160),r.fillText("\u304A\u3059\u3059\u3081",256,270),r.fillStyle="#e7a85f",r.beginPath(),r.arc(256,405,88,0,Math.PI*2),r.fill(),r.fillStyle="#345248",r.beginPath(),r.moveTo(256,340),r.lineTo(322,462),r.lineTo(190,462),r.closePath(),r.fill(),r.fillStyle="#efe6d2",r.font='700 48px "Yu Gothic UI","Meiryo",sans-serif',r.fillText("\u304A\u306B\u304E\u308A  \xA5120",256,595),r.font='500 32px "Yu Gothic UI","Meiryo",sans-serif',r.fillText("\u3042\u305F\u305F\u304B\u3044\u30B3\u30FC\u30D2\u30FC\u3082",256,650);let a=ct(s,1,1,!0),o=new ce({map:a,toneMapped:!1}),l=Xe(.58,.84,o,0,.98,.17,0,0,i);l.rotation.x=.2,L(.6,.05,.7,I.woodDark,0,.025,0,{parent:i,cast:!1})}
function Ga(i,e,t,n=0,s=1){let r=new xt;r.position.set(i,e,t),r.rotation.y=n,r.scale.setScalar(s),ht.add(r),L(.48,.36,.26,I.metal,0,0,0,{parent:r,outline:!0});let a=ot(.1,.1,.015,I.metalDark,.18,.02,0,{parent:r,radialSegments:24,rotZ:Math.PI/2,cast:!1});for(let o=0;o<4;o++)L(.33,.018,.27,I.metalDark,0,-.13+o*.08,0,{parent:r,cast:!1,receive:!1});return r}
Ga(2.64,1.2,-3.65,0,1);
Ga(2.64,1.2,-4.35,0,1);
Ga(-8.65,1.25,-4.3,Math.PI/2,.95);
Ga(-8.65,2.8,-6,Math.PI/2,.8);
{L(1.02,2.05,.09,I.darkTeal,-3.5,1.3,Nt-.045,{parent:J,outline:!0}),L(.48,.65,.02,I.metalDark,-3.5,1.72,Nt-.098,{parent:J,cast:!1}),Xe(.4,.5,new ce({color:9547441,toneMapped:!0}),-3.5,1.72,Nt-.111,Math.PI,0,J),L(.045,.26,.05,I.metal,-3.02,1.22,Nt-.12,{parent:J,cast:!1}),L(1.55,.08,.56,I.roofEdge,-3.5,2.45,Nt-.25,{parent:J,outline:!0}),L(.14,.18,.14,I.metalDark,-4.1,2.28,Nt-.25,{parent:J,cast:!1});let i=new ze(new ni(.065,8,6),new ce({color:16761213,toneMapped:!1}));i.position.set(-4.1,2.22,Nt-.33),J.add(i),Un(-6.3,2.25,-6.15,16759670,1,.18);let[e,t]=lt(512,160);t.fillStyle="#253f42",t.fillRect(0,0,512,160),t.strokeStyle="#d7cfb8",t.lineWidth=5,t.strokeRect(9,9,494,142),t.fillStyle="#e8dfc9",t.textAlign="center",t.textBaseline="middle",t.font='700 42px "Yu Gothic UI","Meiryo",sans-serif',t.fillText("\u95A2\u4FC2\u8005\u4EE5\u5916 \u7ACB\u5165\u7981\u6B62",256,83);let n=new ce({map:ct(e,1,1,!0),toneMapped:!0});Xe(.78,.24,n,-3.5,2.14,Nt-.112,Math.PI,0,J);for(let a=0;a<5;a++)L(.5,.035,.025,I.metalDark,.55,1.7+a*.09,Nt-.02,{parent:J,cast:!1});L(.32,.46,.16,I.metal,1.4,1.15,Nt-.1,{parent:J,outline:!0}),L(.2,.1,.02,I.coolGlow,1.4,1.22,Nt-.19,{parent:J,cast:!1,receive:!1}),L(.9,.55,.04,I.metalDark,1.95,2.15,Nt-.04,{parent:J,cast:!1});let s=new ce({color:9217953,toneMapped:!0});Xe(.78,.43,s,1.95,2.15,Nt-.065,Math.PI,0,J),L(.06,.95,1.3,I.metalDark,vi-.035,2.55,-1.2,{parent:J,cast:!1});let r=new ce({map:Af,color:7173232,toneMapped:!0});Xe(1.16,.78,r,vi-.073,2.55,-1.2,-Math.PI/2,0,J),L(.04,.66,.78,I.metalDark,vi-.03,1.92,.55,{parent:J,cast:!1}),Xe(.64,.52,new ce({color:16768934,toneMapped:!0}),vi-.055,1.92,.55,-Math.PI/2,0,J);for(let a=0;a<4;a++)L(.025,.05,.54,I.metalDark,vi-.02,1.1+a*.15,-1.8,{parent:J,cast:!1});Un(-6.92,1.95,-1.3,16763781,.7,.12)}
{for(let n=0;n<3;n++)L(.46,.24,.38,I.wood,-5.75,.29+n*.25,-6.72+n%2*.04,{outline:!0});L(.55,.9,.5,Be(3689286),1.4,.61,-6.65,{outline:!0}),L(.42,.12,.02,I.metalDark,1.4,.85,-6.39,{cast:!1});let[i,e]=lt(256,96);e.fillStyle="#dfd9c8",e.fillRect(0,0,256,96),e.fillStyle="#4a5b52",e.font='700 32px "Yu Gothic UI","Meiryo",sans-serif',e.textAlign="center",e.textBaseline="middle",e.fillText("\u8CC7\u6E90\u56DE\u53CE",128,50);let t=new ce({map:ct(i,1,1,!0),toneMapped:!0});Xe(.38,.1,t,1.4,.62,-6.395,0,0,ht)}
{let i=new ce({map:mc,toneMapped:!1}),e=new ce({map:pc,toneMapped:!1});Xe(.84,.8,i,-1.34,3.3,.1,-Math.PI/2,0,nt),Xe(.75,.7,e,-1.34,1.64,-1.7,-Math.PI/2,0,nt);for(let[t,n,s]of[[.1,3.3,.92],[-1.7,1.64,.82]])L(.08,s+.18,.1,I.woodDark,-1.36,n,t-.5,{parent:nt}),L(.08,s+.18,.1,I.woodDark,-1.36,n,t+.5,{parent:nt}),L(.08,.08,1.08,I.woodDark,-1.36,n+s/2,t,{parent:nt}),L(.08,.08,1.08,I.woodDark,-1.36,n-s/2,t,{parent:nt})}
{let i=new ce({map:pc,toneMapped:!1}),e=new ce({map:mc,toneMapped:!1});Xe(.8,.7,e,-.4,4,-1.605,Math.PI,0,It),Xe(.7,.66,i,.8,1.7,-1.605,Math.PI,0,It),Xe(.72,.66,e,-1.705,3.25,-.1,-Math.PI/2,0,It),Ga(1.58,1.5,-10,Math.PI,.8),L(.06,5.4,.06,I.metalDark,1.75,3,1,{parent:It})}
function xc(i,e,t,n=I.metal){ot(.055,.055,t,n,i,t/2+.16,e,{radialSegments:8}),ot(.08,.08,.08,I.metalDark,i,.25,e,{radialSegments:8,cast:!1});for(let s=1;s<4;s++)ot(.075,.075,.055,I.metalDark,i,.8+s*(t/4),e,{radialSegments:8,cast:!1})}
xc(2.36,3.42,3.35);
xc(-6.78,2.4,3.35);
xc(-8.67,-2.98,4.35,I.metalDark);
xc(5.15,-10.7,4.8,I.metalDark);
L(.38,.48,.18,I.metal,2.66,.78,2,{outline:!0});
L(.22,.12,.02,I.coolGlow,2.66,.84,2.1,{cast:!1,receive:!1});
function yr(i,e,t=1,n=.16){let s=new xt;s.position.set(i,n,e),s.scale.setScalar(t),ht.add(s),ot(.18,.24,.28,I.soil,0,.14,0,{parent:s,radialSegments:10});for(let r=0;r<4;r++){let a=new ze(new Di(.22,1),r%2?I.leaf:I.leafLight);a.position.set(vr(-.15,.15),.42+vr(-.06,.12),vr(-.15,.15)),a.scale.set(1,.9,1),a.castShadow=!0,s.add(a)}return s}
yr(-4.1,3.55,.9);
yr(-6.4,3.9,.75);
yr(3.4,3.4,.8);
yr(-8.4,-2.1,.8);
{let[i,e]=lt(512,512);e.fillStyle="#313635",e.fillRect(0,0,512,512);let t=dn(10);for(let r=0;r<3e3;r++){let a=45+t()*35;e.fillStyle=`rgba(${a},${a+3},${a},${.12+t()*.18})`,e.fillRect(t()*512,t()*512,1+t()*4,1+t()*4)}for(let r=0;r<512;r+=64)e.fillStyle="rgba(12,16,17,0.45)",e.fillRect(0,r,512,3);for(let r=0;r<512;r+=128)e.fillStyle="rgba(16,20,20,0.4)",e.fillRect(r,0,3,512);let n=ct(i,1,1,!0),s=Be(11184810,{map:n});Xt(1.68,8.8,s,-7.82,.157,-3.2)}
{L(1.7,2.1,.12,I.woodDark,-7.82,1.2,-7.65,{outline:!0});for(let t=0;t<7;t++)L(.035,1.8,.035,I.metalDark,-8.55+t*.24,1,-7.55,{cast:!1});L(1.65,.035,.035,I.metalDark,-7.82,1.86,-7.55,{cast:!1}),L(1.65,.035,.035,I.metalDark,-7.82,.34,-7.55,{cast:!1});for(let t=0;t<3;t++)L(.32,.26,.4,I.wood,-8.38,.3+t*.27,-5.8+t%2*.05,{outline:!0});let i=new _i({color:1058862,roughness:.08,metalness:.55,transparent:!0,opacity:.72}),e=Xt(1.3,.62,i,-7.8,.162,-4.2);e.mesh.renderOrder=1,ot(.18,.2,.38,new ce({color:16760949,toneMapped:!1}),-8.45,2.15,-3,{radialSegments:18,outline:!1}),ot(.12,.12,.05,I.woodDark,-8.45,2.36,-3,{radialSegments:12,cast:!1}),ot(.12,.12,.05,I.woodDark,-8.45,1.94,-3,{radialSegments:12,cast:!1}),Un(-8.45,2.15,-3,16758126,1.3,.3),L(.3,.06,.06,I.metalDark,-8.35,2.28,-3,{cast:!1}),ot(.07,.07,2.2,I.metalDark,-6.98,1.4,-5.6,{radialSegments:8}),ot(.1,.1,.16,I.metalDark,-6.98,2.56,-5.6,{radialSegments:8})}
var nt=new xt;
nt.position.set(-10.05,0,-5.55);
ht.add(nt);
{L(2.8,.28,5.55,I.concreteDark,0,.14,0,{parent:nt}),L(2.65,4.45,5.35,Be(7301727),0,2.34,0,{parent:nt,outline:!0}),L(2.7,1,5.4,Be(4998459),0,.72,0,{parent:nt});for(let u=0;u<6;u++)L(2.69,.018,.03,I.woodDark,0,1.35+u*.48,2.68,{parent:nt,cast:!1,receive:!1}),L(.03,.018,5.38,I.woodDark,1.34,1.35+u*.48,0,{parent:nt,cast:!1,receive:!1});let i=Be(2765879),e=.43,t=1.78,n=L(t,.14,5.85,i,-.79,5.18,0,{parent:nt,rotZ:e,outline:!0}),s=L(t,.14,5.85,i,.79,5.18,0,{parent:nt,rotZ:-e,outline:!0});L(.16,.14,5.9,I.roofEdge,0,5.55,0,{parent:nt});for(let u=0;u<5;u++)L(.06,.03,5.7,I.roofEdge,-1.15+u*.42,5.36+(u-2)*.09,0,{parent:nt,cast:!1,receive:!1});let r=new Qs;r.moveTo(-1.35,0),r.lineTo(1.35,0),r.lineTo(0,.87),r.closePath();let a=new ha(r,{depth:.12,bevelEnabled:!1});for(let u of[-2.61,2.55]){let f=new ze(a,Be(8089955));f.position.set(0,4.56,u),f.castShadow=!0,f.receiveShadow=!0,nt.add(f)}L(3.15,.12,.38,I.roofEdge,0,4.63,2.88,{parent:nt});let o=new ce({map:pc,toneMapped:!1}),l=new ce({map:mc,toneMapped:!1});Xe(.95,.9,o,-.46,3.3,2.69,0,0,nt),L(1.08,.06,.08,I.woodDark,-.46,3.79,2.72,{parent:nt}),L(1.08,.06,.08,I.woodDark,-.46,2.82,2.72,{parent:nt}),L(.055,1,.08,I.woodDark,-1,3.3,2.72,{parent:nt}),L(.055,1,.08,I.woodDark,.08,3.3,2.72,{parent:nt}),Xe(.82,.78,l,.74,1.7,2.69,0,0,nt),Xe(.78,.72,o,1.34,3.25,.8,Math.PI/2,0,nt),Xe(.68,.62,l,1.34,2.05,-1.7,Math.PI/2,0,nt),L(.6,.08,1.7,I.metalDark,1.55,2.72,-1.7,{parent:nt,cast:!0});for(let u=0;u<6;u++)L(.03,.55,.03,I.metalDark,1.83,3.02,-2.4+u*.28,{parent:nt,cast:!1});L(.035,.035,1.7,I.metalDark,1.83,3.27,-1.7,{parent:nt,cast:!1}),L(.12,1.75,1,I.woodDark,-1.33,1.3,2.2,{parent:nt}),L(.86,.06,.06,I.wood,-1.33,2.2,2.72,{parent:nt}),L(1,.06,.4,I.roofEdge,-1.33,2.3,2.86,{parent:nt}),L(.2,.12,.18,I.metalDark,-1.33,2.05,2.84,{parent:nt,cast:!1}),L(.1,.05,.1,I.warmGlow,-1.33,1.99,2.78,{parent:nt,cast:!1,receive:!1}),Un(-11.38,2.02,-2.7,16760954,.9,.22);let[c,h]=lt(256,128);h.fillStyle="#e7dfcf",h.fillRect(0,0,256,128),h.fillStyle="#46544c",h.font='700 46px "Yu Gothic UI","Meiryo",sans-serif',h.textAlign="center",h.textBaseline="middle",h.fillText("\u307F\u306A\u307F 2-8",128,65);let d=new ce({map:ct(c,1,1,!0),toneMapped:!1});Xe(.55,.27,d,.1,1.45,2.695,0,0,nt),ot(.025,.025,1.2,I.metalDark,.55,5.9,-1.7,{parent:nt,radialSegments:5});for(let u=0;u<3;u++)L(.8,.025,.025,I.metalDark,.55,6.03+u*.18,-1.7,{parent:nt,cast:!1});L(2.05,.72,.18,I.concrete,-.3,.5,2.72,{parent:nt,outline:!0});for(let u=0;u<5;u++){let f=new ze(new Di(.28,1),u%2?I.leaf:I.leafLight);f.position.set(-1.1+u*.4,.93,2.72),f.castShadow=!0,nt.add(f)}}
var It=new xt;
It.position.set(3.42,0,-9.82);
ht.add(It);
{L(3.5,.25,3.35,I.concreteDark,0,.13,0,{parent:It}),L(3.4,5.8,3.2,Be(6711649),0,3.05,0,{parent:It,outline:!0}),L(3.42,.12,3.22,I.woodDark,0,2.85,0,{parent:It,cast:!1}),L(3.42,.12,3.22,I.woodDark,0,5.52,0,{parent:It,cast:!1});for(let r=0;r<2;r++){let a=2.35+r*2.65;L(3.15,.1,.58,I.concreteDark,0,a,1.83,{parent:It,outline:!0});for(let o=0;o<12;o++)L(.025,.55,.025,I.metal,-1.48+o*.27,a+.31,2.08,{parent:It,cast:!1});L(3.1,.035,.035,I.metal,0,a+.6,2.08,{parent:It,cast:!1})}let i=new ce({map:pc,toneMapped:!1}),e=new ce({map:mc,toneMapped:!1});Xe(1.05,.95,i,.35,4.18,1.61,0,0,It),Xe(.95,.9,e,-.9,4.15,1.61,0,0,It),Xe(.9,.82,e,.35,1.68,1.61,0,0,It),Xe(.84,.84,i,1.71,3.15,-.2,Math.PI/2,0,It),L(.9,1.8,.1,I.woodDark,-1.22,1.02,1.6,{parent:It}),L(.2,.2,.2,I.metalDark,-1.22,2.06,1.6,{parent:It}),L(.12,.06,.1,I.warmGlow,-1.22,1.99,1.7,{parent:It,cast:!1,receive:!1}),Un(2.2,2,-8.2,16759928,.75,.2),L(3.55,.28,3.35,I.concreteDark,0,6.06,0,{parent:It,outline:!0}),L(1,.7,.8,I.metal,.2,6.55,-.2,{parent:It,outline:!0}),ot(.29,.29,.85,I.metal,-1.05,6.42,.8,{parent:It,radialSegments:12}),ot(.055,.055,5.6,I.metalDark,1.55,2.95,1.56,{parent:It,radialSegments:8});let[t,n]=lt(256,128);n.fillStyle="#d8d0be",n.fillRect(0,0,256,128),n.fillStyle="#394e4b",n.font='700 42px "Yu Gothic UI","Meiryo",sans-serif',n.textAlign="center",n.textBaseline="middle",n.fillText("\u307F\u306A\u307F 2-8-2",128,66);let s=new ce({map:ct(t,1,1,!0),toneMapped:!1});Xe(.64,.32,s,-1.23,2.25,1.59,0,0,It)}
{let[i,e]=lt(256,512);e.fillStyle="#2d2722",e.fillRect(0,0,256,512),e.strokeStyle="#d7b174",e.lineWidth=8,e.strokeRect(7,7,242,498),e.fillStyle="#ffd79d",e.textAlign="center",e.textBaseline="middle",e.font='700 96px "Yu Gothic UI","Meiryo",sans-serif',e.fillText("\u55AB",128,165),e.fillText("\u8336",128,290),e.fillStyle="#dba76b",e.font='600 26px "Segoe UI",sans-serif',e.fillText("AKARI",128,410);let t=new ce({map:ct(i,1,1,!0),color:12433064,toneMapped:!1});Xe(.38,.94,t,-8.68,2.22,-3.35,Math.PI/2,0,ht),L(.09,1.04,.46,I.woodDark,-8.75,2.22,-3.35,{outline:!0}),Un(-8.45,2.22,-3.35,16757868,.65,.15)}
{L(9.4,.95,.1,I.woodDark,-2.2,.62,-7.15,{outline:!0});for(let i=0;i<14;i++)L(.08,.95,.12,I.wood,-6.5+i*.67,.64,-7.14,{cast:!1});for(let i=0;i<3;i++)L(8.9,.06,.08,I.woodDark,-2.2,.8+i*.22,-7.08,{cast:!1});yr(-6.1,-7.5,1.2,.16),yr(-5.2,-8.4,.9,.16)}
function Kh(i,e,t=1){let n=new xt;n.position.set(i,.16,e),n.scale.setScalar(t),ht.add(n),ot(.1,.17,2.1,I.woodDark,0,1.05,0,{parent:n,radialSegments:7});let s=[[0,1.4,0,.45,2.6,.15],[.05,1.6,0,-.5,2.8,-.2],[0,1.8,0,.1,3.15,-.3]];for(let[o,l,c,h,d,u]of s)en([o,l,c],[h,d,u],.055,I.woodDark,n,5);let r=new Di(.85,1),a=[[0,3.5,0,1.4],[.7,3.15,.3,1],[-.7,3.3,.2,1.1],[.25,3.9,-.4,.95],[-.35,3.8,.55,.9],[.1,2.95,-.7,.8]];for(let o=0;o<a.length;o++){let[l,c,h,d]=a[o],u=new ze(r,o%3===0?I.leafLight:I.leaf);u.position.set(l,c,h),u.scale.set(d,d*.82,d),u.rotation.set(vr(0,1),vr(0,2),vr(0,1)),u.castShadow=!0,u.receiveShadow=!0,n.add(u)}return n}
Kh(-7.55,-8.75,1.2);
Kh(.4,-10.25,.95);
Kh(-11.05,-8.9,.8);
{let n=function(r,a=.014){let o=new ds(r.map(h=>new C(...h))),l=new nr(o,30,a,4,!1),c=new ze(l,t);c.castShadow=!1,c.receiveShadow=!1,ht.add(c)};ot(.105,.16,7.6,Be(6974308),4.85,3.96,-5.55,{radialSegments:10});for(let r of[6.65,7.15]){L(2.3,.09,.1,I.metalDark,4.85,r,-5.55,{});for(let a=0;a<4;a++)ot(.045,.06,.18,I.cream,4.85-1+a*.66,r+.15,-5.55,{radialSegments:8,cast:!1})}ot(.24,.24,.78,I.metal,4.85+.35,6,-5.55+.1,{radialSegments:12}),ot(.16,.16,.08,I.metalDark,4.85+.35,6.44,-5.55+.1,{radialSegments:12,cast:!1}),L(.2,.32,.04,I.cream,4.85,5.15,-5.55+.16,{cast:!1});let t=new ce({color:1120028}),s=[[-9.55,5.8,-5.25],[-9.55,5.95,-4.9],[-9.55,6.15,-4.55]];for(let r=0;r<3;r++){let a=s[r];n([[4.85-1+r*.55,6.85-r*.1,-5.55],[(4.85-1+r*.55+a[0])/2,6.3-r*.08,-5.45],a])}n([[4.85,7.1,-5.55],[3.45,6.35,-7.25],[3.2,6.7,-8.4]]),n([[4.85+.8,6.82,-5.55],[4,6.55,-7.3],[3.7,6.85,-8.5]]),n([[4.85-.1,6.4,-5.55+.1],[4.85-.22,5.4,-5.55+.18],[4.85-.5,4.55,-5.55+.15]],.01)}
{ot(.075,.14,5.9,I.darkTeal,-6.62,3.11,4.55,{radialSegments:12}),ot(.2,.26,.22,I.concreteDark,-6.62,.24,4.55,{radialSegments:14,cast:!1});let t=new ds([new C(-6.62,5.88,4.55),new C(-6.62+.55,6.32,4.55-.08),new C(-6.62+1.45,6.35,4.55-.1),new C(-6.62+1.8,6.1,4.55-.1)]),n=new ze(new nr(t,24,.055,6,!1),I.darkTeal);n.castShadow=!0,ht.add(n);let s=-6.62+1.8,r=4.55-.1;L(.5,.1,.32,I.darkTeal,s,6.06,r,{outline:!0}),L(.42,.36,.24,new ce({color:16234085,toneMapped:!1}),s,5.91,r,{cast:!1,receive:!1}),L(.44,.08,.26,I.darkTeal,s,6.28,r,{}),L(.5,.025,.32,I.metalDark,s,5.7,r,{cast:!1}),ot(.25,.28,.06,I.darkTeal,s,5.67,r,{radialSegments:20,cast:!1}),Un(s,5.9,r,16763014,2.2,.23),L(.9,.05,.05,I.metalDark,-6.62-.42,3.5,4.55,{}),L(.9,.05,.05,I.metalDark,-6.62-.42,4.35,4.55,{});let a=Be(4745056),o=L(.02,.8,.55,a,-6.62-.87,3.93,4.55,{outline:!0,cast:!1}),[l,c]=lt(256,384);c.fillStyle="#436158",c.fillRect(0,0,256,384),c.strokeStyle="#d9cfad",c.lineWidth=8,c.strokeRect(10,10,236,364),c.fillStyle="#e8dfc8",c.font='700 44px "Yu Gothic UI","Meiryo",sans-serif',c.textAlign="center",c.textBaseline="middle",c.fillText("\u96E8\u306E",128,118),c.fillText("\u8857\u89D2",128,176),c.fillStyle="#dca157",c.beginPath(),c.arc(128,280,40,0,Math.PI*2),c.fill();let h=new ce({map:ct(l,1,1,!0),toneMapped:!1});Xe(.48,.72,h,-6.62-.88,3.93,4.55+.03,0,0)}
{let t=new ce({map:py,toneMapped:!1,side:Ut});L(.08,.08,.62,I.metalDark,-6.62,2.82,3.96+.3,{cast:!1}),L(1.55,.4,.06,I.metalDark,-6.62,2.82,3.96+.02,{cast:!1}),Xe(1.5,.37,t,-6.62,2.82,3.96+.055,0,0);let n=new ce({map:my,toneMapped:!1,side:Ut});L(.38,.5,.05,I.metalDark,-6.62,2.26,3.96+.02,{cast:!1}),Xe(.35,.47,n,-6.62,2.26,3.96+.05,0,0)}
{let i=new xt;i.position.set(-9.05,.15,1.78),i.rotation.y=-.08,ht.add(i);for(let a of[-.5,.5])L(.055,1.35,.07,I.metalDark,a,.68,0,{parent:i});L(1.28,.92,.08,I.woodDark,0,1.25,0,{parent:i,outline:!0}),L(1.38,.07,.34,I.roofEdge,0,1.78,.02,{parent:i,outline:!0});let[e,t]=lt(512,384);t.fillStyle="#c2a77d",t.fillRect(0,0,512,384);let n=dn(778);for(let a=0;a<1200;a++)t.fillStyle=`rgba(90,64,35,${n()*.06})`,t.fillRect(n()*512,n()*384,1.5,1.5);t.strokeStyle="#5f4d35",t.lineWidth=14,t.strokeRect(7,7,498,370),t.fillStyle="#34524a",t.fillRect(22,20,468,44),t.fillStyle="#e8dcc3",t.font='700 27px "Yu Gothic UI","Meiryo",sans-serif',t.textAlign="center",t.fillText("\u307B\u3057\u305E\u3089\u753A\u5185\u4F1A \u304A\u3057\u3089\u305B",256,50);let s=[[42,92,132,168,"#f4edd8","#b85d45"],[190,84,124,146,"#f7f1e1","#3e7268"],[328,100,138,152,"#f0e5cc","#527895"],[190,246,124,104,"#f6eedb","#c58a45"],[328,270,138,80,"#f3ebd6","#6d5a8d"]];for(let a=0;a<s.length;a++){let[o,l,c,h,d,u]=s[a];t.save(),t.translate(o+c/2,l+h/2),t.rotate((n()-.5)*.07),t.fillStyle="rgba(38,32,23,0.22)",t.fillRect(-c/2+4,-h/2+4,c,h),t.fillStyle=d,t.fillRect(-c/2,-h/2,c,h),t.fillStyle=u,t.fillRect(-c/2,-h/2,c,16),t.fillStyle="rgba(70,62,48,0.7)",t.fillRect(-c/2+16,-h/2+34,c-32,5),t.fillRect(-c/2+16,-h/2+48,c-50,4),t.fillRect(-c/2+16,-h/2+60,c-60,4),t.fillStyle=u,t.font='700 23px "Yu Gothic UI","Meiryo",sans-serif',t.textAlign="left";let f=["\u79CB\u307E\u3064\u308A","\u8CC7\u6E90\u56DE\u53CE","\u30E8\u30AC\u6559\u5BA4","\u5B50\u80B2\u3066\u5E83\u5834","\u9632\u707D\u8A13\u7DF4"];t.fillText(f[a],-c/2+14,-h/2+26),t.restore()}let r=new ce({map:ct(e,1,1,!0),color:14209734,toneMapped:!0});Xe(1.16,.82,r,0,1.26,.046,0,0,i);for(let[a,o]of[[-.34,.3],[-.08,.32],[.27,.24],[-.07,-.04],[.26,-.1]]){let l=new ze(new ni(.014,6,5),I.orange);l.position.set(a,1.26+o,.058),i.add(l)}}
{let i=new xt;i.position.set(-7.05,.15,1.65),i.rotation.y=-.35,ht.add(i),ot(.055,.08,2.8,I.metalDark,0,1.4,0,{parent:i,radialSegments:10});let e=en([0,2.75,0],[.22,3,.16],.035,I.metalDark,i,8),[t,n]=lt(512,512),s=n.createRadialGradient(180,170,20,256,256,280);s.addColorStop(0,"#b8d3d6"),s.addColorStop(.45,"#779ba4"),s.addColorStop(.72,"#354f5b"),s.addColorStop(1,"#17262f"),n.fillStyle=s,n.fillRect(0,0,512,512),n.fillStyle="rgba(255,207,145,0.3)",n.fillRect(305,110,45,250),n.fillStyle="rgba(115,225,239,0.25)",n.fillRect(170,160,34,220),n.fillStyle="rgba(236,241,229,0.55)",n.fillRect(64,54,380,10),n.strokeStyle="rgba(255,255,255,0.5)",n.lineWidth=5,n.beginPath(),n.arc(256,256,240,0,Math.PI*2),n.stroke();let r=ct(t,1,1,!0),a=new ce({map:r,toneMapped:!1,side:Ut}),o=new ze(new gi(.47,32),a);o.position.set(.35,3.15,.27),o.rotation.y=Math.PI*.16,i.add(o);let l=new ze(new ps(.49,.055,8,36),I.orange);l.position.copy(o.position),l.rotation.y=o.rotation.y,i.add(l);let c=new ze(new gi(.45,24),I.orange);c.position.copy(o.position),c.position.x-=.025,c.rotation.y=o.rotation.y,c.scale.setScalar(1.02),i.add(c),Un(-6.55,3.3,1.95,12575975,.8,.1)}
{let i=new xt;i.position.set(-4.95,.15,4.3),ht.add(i),ot(.06,.09,3.15,I.metalDark,0,1.57,0,{parent:i,radialSegments:10}),L(.38,.72,.26,I.metalDark,0,3,0,{parent:i,outline:!0});let e=new ze(new gi(.09,20),new ce({color:3414814,toneMapped:!1}));e.position.set(0,3.2,.14),i.add(e);let t=new ze(new gi(.095,20),I.greenGlow);t.position.set(0,2.87,.14),i.add(t),L(.43,.04,.3,I.metal,0,3.37,0,{parent:i,cast:!1}),Un(-4.95,3.02,4.45,9174997,.8,.25)}
function vc(i,e,t,n,s){let r=new xt;ht.add(r);let a=new C(i,.15,e),o=new C(t,.15,n),l=o.clone().sub(a),c=l.length(),h=Math.atan2(l.z,l.x);for(let g=0;g<=s;g++){let y=g/s,m=a.clone().lerp(o,y);ot(.035,.045,.95,I.whiteMetal,m.x,.62,m.z,{radialSegments:7})}let d=a.clone().lerp(o,.5),u=new ze(new Ii(.045,.045,c,8),I.whiteMetal);u.position.set(d.x,1.02,d.z),u.rotation.z=Math.PI/2,u.rotation.y=-h,u.castShadow=!0,r.add(u);let f=u.clone();f.position.y=.68,r.add(f);for(let g=1;g<s;g+=3){let y=a.clone().lerp(o,g/s);L(.06,.04,.02,I.orange,y.x,1.03,y.z,{cast:!1,receive:!1})}return r}
vc(-11.35,11.02,-8.2,11.02,4);
vc(-5.5,11.02,-2.9,11.02,3);
vc(10.98,-10.6,10.98,-7.2,4);
vc(10.98,.1,10.98,3.6,4);
{ot(.035,.045,2.35,I.metalDark,-7.35,1.18,1.95,{radialSegments:8}),L(.58,.7,.06,I.metalDark,-7.35,2.3,1.95,{cast:!1});let t=new ce({map:gy,toneMapped:!1,side:Ut});Xe(.54,.66,t,-7.35,2.3,1.95+.04,0,0),L(.58,.05,.08,I.metal,-7.35,1.95,1.95,{cast:!1})}
{ot(.09,.13,.55,Be(10896962),3,.45,4.66,{radialSegments:10,outline:!0}),ot(.15,.15,.07,I.metalDark,3,.72,4.66,{radialSegments:12}),ot(.05,.05,.18,I.metalDark,3,.85,4.66,{radialSegments:8});for(let t of[-1,1])ot(.05,.05,.18,I.metal,3+t*.13,.53,4.66,{radialSegments:8,rotZ:Math.PI/2})}
var yc=560,jh=new Ct,Ms=new Float32Array(yc*6),Vf=new Float32Array(yc),Xi=dn(1666);
for(let i=0;i<yc;i++){let e=-11.7+Xi()*23.4,t=.2+Xi()*16,n=-11.7+Xi()*23.4,s=.18+Xi()*.38;Ms[i*6]=e,Ms[i*6+1]=t,Ms[i*6+2]=n,Ms[i*6+3]=e+.04,Ms[i*6+4]=t-s,Ms[i*6+5]=n+.02,Vf[i]=4.6+Xi()*4.4}
jh.setAttribute("position",new nn(Ms,3));
var Gf=new us({color:10469588,transparent:!0,opacity:.14,blending:hn,depthWrite:!1}),Wf=new Js(jh,Gf);
Wf.frustumCulled=!1;
ht.add(Wf);
var Ly=new tr(.075,.105,30),Xf=[],_f=[[-2,7.1],[-4,8.8],[1,9.4],[3.5,6.7],[7.2,8.3],[8.9,2.7],[7.4,5.1],[-8,7.4],[5.9,.2],[-1.1,5.9],[.6,1.8],[-4,1.95],[2.55,2.8],[-8.3,-3.3]];
for(let i=0;i<_f.length;i++){let[e,t]=_f[i],n=t<5&&e<5.6,s=new ce({color:i%3===0?10738153:12969706,transparent:!0,opacity:0,blending:hn,depthWrite:!1,side:Ut,toneMapped:!1}),r=new ze(Ly,s);r.rotation.x=-Math.PI/2,r.position.set(e,n?.176:.052,t),r.renderOrder=5,ht.add(r),Xf.push({mesh:r,base:n?.176:.052,phase:ka(),speed:.27+ka()*.2,max:.7+ka()*.65})}
var Zh=[];
for(let i=0;i<4;i++){let e=new ce({color:13889535,transparent:!0,opacity:.65,blending:hn,depthWrite:!1,toneMapped:!1}),t=new ze(new ni(.022,6,5),e);t.position.set(-4+i*1.7,3,2),ht.add(t),Zh.push({mesh:t,phase:i*.63,speed:.8+i*.1,x:-4+i*1.7,z:2})}
var Yf=[];
for(let i=0;i<4;i++){let e=new ce({color:13232626,transparent:!0,opacity:0,blending:hn,depthWrite:!1,side:Ut,toneMapped:!1}),t=new ze(new tr(.04,.065,24),e);t.rotation.x=-Math.PI/2,t.position.set(-4+i*1.7,.177,2),ht.add(t),Yf.push({mesh:t,phase:i*.63})}
var Uy=new fa(8362185,856344,1.38);
Vt.add(Uy);
var wn=new ms(10993128,2.2);
wn.position.set(-13,19,15);
wn.castShadow=!0;
wn.shadow.mapSize.set(2048,2048);
wn.shadow.camera.near=1;
wn.shadow.camera.far=55;
wn.shadow.camera.left=-18;
wn.shadow.camera.right=18;
wn.shadow.camera.top=18;
wn.shadow.camera.bottom=-18;
wn.shadow.bias=-7e-4;
wn.shadow.normalBias=.035;
wn.shadow.radius=3;
Vt.add(wn);
var qf=new ms(6719163,.55);
qf.position.set(15,8,-16);
Vt.add(qf);
var Zf=new ms(8228260,.5);
Zf.position.set(13,5,17);
Vt.add(Zf);
var $f=new mn(16767149,32,9.5,2);
$f.position.set(-2.2,2.55,-1.9);
Vt.add($f);
var Jf=new mn(16770754,24,8.5,2);
Jf.position.set(-2.2,2.5,.4);
Vt.add(Jf);
var Kf=new mn(16767404,12,5,2);
Kf.position.set(-.4,2.85,1.9);
Vt.add(Kf);
var jf=new mn(13037567,13,5.2,2);
jf.position.set(-2.6,1.9,-3.1);
Vt.add(jf);
var Qh=new mn(16764826,24,5.8,2);
Qh.position.set(-2.2,3,2.3);
Vt.add(Qh);
var Qf=new mn(8512767,4.8,4.2,2);
Qf.position.set(4.75,1.32,-.35);
Vt.add(Qf);
var ep=new mn(16758921,3.6,3.8,2);
ep.position.set(4.75,1.2,.78);
Vt.add(ep);
var tp=new mn(16762756,54,14,2);
tp.position.set(-4.82,5.85,4.45);
Vt.add(tp);
var eu=new mn(16760187,9,4,2);
eu.position.set(-8.2,2.15,-3);
Vt.add(eu);
var np=new mn(9174997,2.2,2.2,2);
np.position.set(-4.95,2.82,4.45);
Vt.add(np);
var ip=new mn(16760186,8.5,4.8,2);
ip.position.set(-5.7,2.15,-6.35);
Vt.add(ip);

  var vf=jh.attributes.position;
  function updateAuthored(dt,time){if(disposed)return;let i=Math.min(Math.max(Number.isFinite(dt)?dt:0,0),.05),e=Number.isFinite(time)?time:0,t=vf.array;for(let n=0;n<yc;n++){let s=n*6,r=t[s+1]-Vf[n]*i;if(r<.06){r=12+Xi()*5;let o=-11.7+Xi()*23.4,l=-11.7+Xi()*23.4;t[s]=o,t[s+2]=l,t[s+3]=o+.04,t[s+5]=l+.02}let a=t[s+1]-t[s+4];t[s+1]=r,t[s+4]=r-a}vf.needsUpdate=!0,Gf.opacity=.125+Math.sin(e*.37)*.014;for(let n of Xf){let s=(e*n.speed+n.phase)%1,r=.22+s*n.max;n.mesh.scale.setScalar(r),n.mesh.material.opacity=Math.sin(s*Math.PI)*.12}for(let n of Zh){let s=(e*n.speed+n.phase)%1;n.mesh.position.y=3.05-s*2.82,n.mesh.position.x=n.x,n.mesh.position.z=n.z,n.mesh.material.opacity=.65*(1-s*.5);let r=Yf[Zh.indexOf(n)];if(r){let a=(e*n.speed+n.phase)%1;if(s>.88){let o=(s-.88)/.12;r.mesh.scale.setScalar(.5+o*3),r.mesh.material.opacity=(1-o)*.24}else r.mesh.material.opacity*=.85}}$i.material.uniforms.uTime.value=e,Ff.color.setScalar(.63+Math.sin(e*.55)*.018),Bf.color.setScalar(.67+Math.sin(e*.47+1.7)*.025),Qh.intensity=24+Math.sin(e*.7)*.9,eu.intensity=9+Math.sin(e*1.1+.8)*.45,void 0}
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
  [kv,ka,vr,Hv,pf,Ha,Yh,Gv,I,oy,ly,wf,mf,cy,hy,Af,uy,dy,fy,pc,mc,Rf,py,my,gy,_y,xy,Cf,vy,yy,My,Sy,qi,ht,Ey,Pf,Ty,$h,wy,gc,fc,Ay,$i,Ry,Df,J,Nn,Ji,vi,Dt,Nt,ft,ri,Py,Iy,Ff,Of,Bf,gf,mb,nt,It,yc,jh,Ms,Vf,Xi,Gf,Wf,Ly,Xf,_f,Zh,Yf,Uy,wn,qf,Zf,$f,Jf,Kf,jf,Qh,Qf,ep,tp,eu,np,ip].forEach(collectResource);

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

  }

return {root,bounds,anchors,cameraPresets,lightingPresets,setLighting,update,dispose,
    fidelityDifferences:['Original bloom, film grain, vignette and night grading composer are not applied by the host renderer.']};
}
