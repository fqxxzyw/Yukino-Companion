// Frame playback only. All poses and facial changes are painted PNG assets.
export class SpritePlayer {
  constructor(image, manifest, base, { onState = () => {} } = {}) {
    this.image=image; this.manifest=manifest; this.base=base; this.onState=onState;
    this.state='idle';this.index=0;this.elapsed=0;this.paused=false;this.reduced=false;
    this.disposed=false;this.last=null;this.raf=null;this.cache=[];
    this.visibility=()=>{this.last=null;};
    document.addEventListener('visibilitychange',this.visibility);
  }
  async load() {
    const paths=[...new Set(Object.values(this.manifest.animations).flatMap(a=>a.frames))];
    await Promise.all(paths.map(path=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=resolve;img.onerror=()=>reject(new Error('无法加载动画帧：'+path));
      img.src=new URL(path,this.base).href;this.cache.push(img);
    })));
    if(this.disposed)return;
    this.render();this.raf=requestAnimationFrame(t=>this.tick(t));
  }
  render(){this.image.src=new URL(this.manifest.animations[this.state].frames[this.index],this.base).href;}
  setState(state){
    if(this.disposed)return;
    if(!this.manifest.animations[state])throw new Error('未知动画：'+state);
    this.state=state;this.index=0;this.elapsed=0;this.last=null;this.render();this.onState(state);
  }
  setPaused(value){this.paused=!!value;this.last=null;}
  setReduced(value){this.reduced=!!value;if(value){this.setState('idle');}this.last=null;}
  tick(now){
    if(this.disposed)return;
    this.raf=requestAnimationFrame(t=>this.tick(t));
    if(document.hidden||this.paused||this.reduced){this.last=null;return;}
    const dt=this.last===null?0:Math.min(100,Math.max(0,now-this.last));this.last=now;this.elapsed+=dt;
    let spec=this.manifest.animations[this.state];
    while(this.elapsed>=spec.durations[this.index]){
      this.elapsed-=spec.durations[this.index];this.index++;
      if(this.index>=spec.frames.length){
        if(!spec.loop){this.setState('idle');return;}
        this.index=0;
      }this.render();
    }
  }
  dispose(){this.disposed=true;cancelAnimationFrame(this.raf);document.removeEventListener('visibilitychange',this.visibility);this.cache=[];}
}
export async function loadSprite(image,base,options){
 const response=await fetch(new URL('manifest.json',base));
 if(!response.ok)throw new Error('无法加载桌宠资源清单');
 const manifest=await response.json();const player=new SpritePlayer(image,manifest,base,options);
 try{await player.load();return player;}catch(error){player.dispose();throw error;}
}
