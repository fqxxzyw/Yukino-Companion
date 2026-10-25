const rgb = hex => /^#[\da-f]{6}$/i.test(hex || '') ? hex.slice(1).match(/../g).map(v => parseInt(v,16)) : [241,246,252];
const hex = c => '#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
const blend = (a,b,t) => a.map((v,i)=>v*(1-t)+b[i]*t);
export function luminance(color) { return rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0); }
export function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function readableAccent(accent,surface,otherSurface=surface) {
  const start=rgb(accent), toward=luminance(surface)<.3?[255,255,255]:[0,0,0];
  for(let t=0;t<=1;t+=.025){const color=hex(blend(start,toward,t));if(Math.min(contrast(color,surface),contrast(color,otherSurface))>=4.6)return color;}
  return hex(toward);
}
export function themeVariables(accent='#477fd1',background='#f1f6fc') {
  const bg=hex(rgb(background)),dark=luminance(bg)<.3,base=rgb(bg),surface=hex(blend(base,dark?[24,30,39]:[255,255,255],.88)),soft=hex(blend(base,dark?[35,44,58]:[255,255,255],.6)),action=readableAccent(accent,surface,soft);
  return {'--accent':hex(rgb(accent)),'--accent-text':action,'--on-accent':contrast(action,'#ffffff')>=contrast(action,'#000000')?'#ffffff':'#000000','--bg':bg,'--surface':surface,'--surface-soft':soft,'--text':dark?'#f4f7fc':'#202c3c','--secondary':readableAccent(dark?'#c3cfde':'#4e6076',surface,soft),'--tertiary':readableAccent(dark?'#b7c5d8':'#52647a',surface,soft),'--line':dark?'#ffffff26':'#19334d1c','--hover':dark?'#ffffff10':'#1c416509','--shadow':dark?'#00000040':'#3454750c','--danger':dark?'#ffb9a8':'#a33227','--danger-bg':dark?'#402622':'#fff0ed','--scheme':dark?'dark':'light'};
}
export function duration(ms=0){const minutes=Math.floor(Math.max(0,ms)/60000);return minutes<60?`${minutes} 分钟`:`${Math.floor(minutes/60)} 小时 ${minutes%60} 分钟`;}
