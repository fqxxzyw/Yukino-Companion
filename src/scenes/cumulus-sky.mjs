// Bake the nearest surface of overlapping, noise-inflated cloud lobes. The
// panorama stores coverage and local normals, never a fixed sun colour.
const sat = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = sat(n); return t*t*(3-2*t); };
const mix = (a,b,t) => a + (b-a)*t;
const rgbMix = (a,b,t) => a.map((v,i) => mix(v,b[i],t));
const tau = 2 * Math.PI;
let volume;

function hash3(x,y,z) {
  let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2246822519);
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967295;
}

function noise3(x,y,z) {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const fx=smooth(x-ix),fy=smooth(y-iy),fz=smooth(z-iz);
  const row=(j,k)=>mix(hash3(ix,j,k),hash3(ix+1,j,k),fx);
  return mix(mix(row(iy,iz),row(iy+1,iz),fy),mix(row(iy,iz+1),row(iy+1,iz+1),fy),fz);
}

function cloudVolume(width,height) {
  if(volume?.width===width&&volume.height===height) return volume;
  const field=new Uint8Array(width*height*4),depth=new Float32Array(width*height);
  depth.fill(-1000);
  const sx=width/640,sy=height/320;
  function lobe(cx,cy,cz,rx,ry,rz,seed,bankBase,scale) {
    for(let j=Math.floor((cy-ry*1.28-1.5)*sy);j<=Math.ceil((cy+ry*1.28+1.5)*sy);j++){
      if(j<0||j>=height) continue;
      for(let i=Math.floor((cx-rx*1.28-1.5)*sx);i<=Math.ceil((cx+rx*1.28+1.5)*sx);i++){
        const x=(i+.5)/sx,y=(j+.5)/sy;
        const dx=x-cx,dy=y-cy;
        if(Math.abs(dx)>rx*1.3+1||Math.abs(dy)>ry*1.3+1)continue;
        const curl=(noise3(x*.115,y*.15,seed*.11)-.5)*2.8*scale;
        const nx=(dx+curl)/rx,ny=(dy+curl*.58)/ry;
        const q=nx*nx+ny*ny;
        if(q>1.44) continue;
        const nz=Math.sqrt(Math.max(.04,1-q));
        const bulge=noise3(x*.16,y*.18,seed+nz*.85)-.5;
        const inflate=bulge*.41+(noise3(x*.47,y*.47,seed+2.8+nz)-.5)*.12;
        const inside=1+inflate-q;
        if(inside<-.12) continue;
        const floor=bankBase+scale*(Math.sin(x*.14)*.63+Math.sin(x*.31+1.2)*.34+bulge*.85);
        const coverage=smooth(.48+inside*Math.min(rx,ry)*.67)*smooth((y-floor+.45)/(1.5*scale+.4));
        if(coverage<=0) continue;
        const front=cz+rz*Math.sqrt(Math.max(0,inside))+bulge*1.5*scale;
        const index=j*width+(i%width+width)%width,off=index*4;
        field[off]=Math.max(field[off],Math.round(255*coverage));
        field[off+3]=Math.round(255*sat((y-floor)/(10.5*scale)));
        const old=depth[index];
        if(old===-1000){depth[index]=front;continue;}
        // Join neighbouring volumes before reconstructing their normals. A
        // foreground lobe eases into the face behind it at its tangent,
        // instead of stamping a complete hard-edged disk onto that face.
        const blendRadius=3.9*scale,bridge=Math.max(0,blendRadius-Math.abs(old-front));
        const union=Math.max(old,front)+bridge*bridge/(4*blendRadius);
        depth[index]=mix(old,union,smooth((inside+.04)/.44)*coverage);
      }
    }
  }
  // Low shelves, high towers and detached puffs have different silhouettes.
  // Broad blank intervals keep blue sky next to the main billowing masses.
  const banks=[[3,.51,-1],[68,.32,1],[126,.87,-1],[214,.38,1],
    [279,.76,1],[352,.27,-1],[425,.88,1],[505,.39,-1],[569,.75,-1]];
  banks.forEach(([cx,s,lean],index)=>{
    const bankBase=161+hash3(index,7,1)*5;
    const leanShift=hash3(index,2,3)-.5,loft=.79+hash3(index,9,6)*.44;
    const stamp=(dx,dy,dz,rx,ry,rz,seed)=>lobe(cx+(lean*dx+dy*leanShift)*s,bankBase+dy*s*loft,dz*s,rx*s,ry*s*loft,rz*s,seed+index*14,bankBase,s);
    for(let n=0;n<8;n++){
      const dx=-37+n*10.2,scale=.83+hash3(index,n,4)*.34;
      stamp(dx,3+hash3(n,index,9)*2,-3,12*scale,(4.5+hash3(n,index,6)*2)*scale,5,1+n);
    }
    for(const [j,shape] of [
      [-19,8,0,14,8,8],[-8,13,-1,15,13,11],[4,17,-3,14,16,10],
      [12,24,-4,10,11,8],[19,18,-3,10,9,9],[23,11,-1,13,8,9],
      [10,13,3,10,8,9],[-4,8,5,12,6,8],[-16,8,5,8,5,6],
      [18,8,6,9,5,7],[30,5,3,10,5,6],
    ].entries()) {
      const seed=index*11+j;
      const [dx,dy,dz,rx,ry,rz]=shape;
      stamp(dx,dy,dz,rx,ry,rz,j*.94);
      if(j>6)continue;
      const offset=hash3(seed,6,2)*1.6-1.0;
      for(let tuft=0;tuft<3;tuft++){
        const a=offset+tuft*.54,extent=.24+.22*hash3(seed,tuft,2);
        stamp(dx+Math.sin(a)*rx*.81,dy+Math.cos(a)*ry*.83,dz-rz*.28,
          rx*extent,ry*extent*.83,rz*extent,seed+tuft+.5);
      }
    }
    stamp(-45,2.4,-5,12,2,3,23);stamp(42,3.2,-6,9,2.2,3,24);
  });
  // Differentiate the continuous front envelope at two brush scales. This
  // lets broad faces share their light and keeps a few smaller billows legible.
  const occlusion=new Uint8Array(width*height*2);
  for(let y=Math.floor(height*.5);y<Math.ceil(height*.72);y++)for(let x=0;x<width;x++){
    const idx=y*width+x;
    if(!field[idx*4])continue;
    const local=(dx,dy)=>{
      const i=(x+Math.round(dx*sx)+width)%width,j=y+Math.round(dy*sy);
      const d=depth[j*width+i];
      return d===-1000?depth[idx]-Math.hypot(dx,dy)*1.4:d;
    };
    const gx=(local(-1.3,0)-local(1.3,0))*.27+(local(-3,0)-local(3,0))*.048;
    const gy=(local(0,-1.3)-local(0,1.3))*.27+(local(0,-3)-local(0,3))*.048;
    const len=Math.hypot(gx,gy,1);
    field[idx*4+1]=Math.round(127.5+127.5*gx/len);
    field[idx*4+2]=Math.round(127.5+127.5*gy/len);
    for(let side=0;side<2;side++){
      let slope=0;
      for(const reach of [2,4,8,14]){
        const i=(x+(side?1:-1)*Math.round(reach*sx)+width)%width,j=y+Math.round(reach*sy*.85);
        slope=Math.max(slope,(depth[j*width+i]-depth[idx])/reach);
      }
      occlusion[idx*2+side]=Math.round(255*smooth((slope-.18)/1.6));
    }
  }
  volume={field,occlusion,width,height};
  return volume;
}

const palettes={
  noon:[[34,122,208],[172,226,242],[255,250,232],[212,224,234],[136,162,200]],
  afternoon:[[42,126,204],[190,226,232],[255,244,214],[220,222,222],[142,163,196]],
  gold:[[68,118,178],[254,198,140],[255,226,168],[232,174,154],[144,136,174]],
  sunset:[[52,72,134],[238,144,132],[255,194,162],[198,138,158],[122,108,154]],
  rain:[[96,126,150],[166,186,194],[216,222,220],[172,188,200],[126,146,170]],
  night:[[16,30,66],[52,72,106],[108,130,156],[68,86,122],[40,54,88]],
};

export function paintCumulus(pixels,width,height,daylight,weather,sun) {
  const {field,occlusion}=cloudVolume(width,height),cloud=sat(weather?.cloud||0);
  const rain=sat(weather?.rain||0),fog=sat(weather?.fog||0),snow=sat(weather?.snow||0);
  const day=sat(daylight?.brightness??1),low=smooth((.62-sun[1])/.45);
  const late=smooth((Math.abs((daylight?.hour??12)-12)-1)/4);
  const sunset=smooth((.85-day)/.62),night=smooth((.42-day)/.39);
  const palette=palettes.noon.map((color,i)=>{
    let c=rgbMix(color,palettes.afternoon[i],late);
    c=rgbMix(c,palettes.gold[i],low);c=rgbMix(c,palettes.sunset[i],sunset);
    c=rgbMix(c,palettes.rain[i],sat(cloud*.58+rain*.48+fog*.28));
    return rgbMix(c,palettes.night[i],night);
  });
  const [zenith,horizon,top,half,base]=palette;
  const lateral=new Float32Array(width),front=new Float32Array(width);
  for(let x=0;x<width;x++){
    const az=((x+.5)/width-.5)*tau;
    lateral[x]=-Math.sin(az)*sun[0]+Math.cos(az)*sun[2];
    front[x]=-Math.cos(az)*sun[0]-Math.sin(az)*sun[2];
  }
  for(let y=0;y<height;y++){
    const elevation=(y+.5)/height-.5;
    const t=Math.pow(sat(elevation*3.15),.62);
    const row=rgbMix(horizon,zenith,t);
    // The underside of the panorama is also reflected by upward-facing glazing.
    const below=smooth(-elevation*3.7);
    for(let c=0;c<3;c++) row[c]*=1-below*[.45,.43,.41][c];
    const mist=(fog*.28+snow*.18)*(1-night);
    // Delicate painted cirrus streaks high above the cumulus towers.
    if(elevation>.22&&elevation<.43){
      const band=smooth((elevation-.22)/.06)*(1-smooth((elevation-.34)/.09))*(1-rain*.75)*(1-night*.85);
      for(let x=0;x<width;x++){
        const u=x/width,v=elevation*14;
        const n=noise3(u*14+Math.sin(v)*.6,v*2.6,3.1)*.65+noise3(u*31,v*5.2,7.4)*.35;
        const wisp=smooth((n-.63)/.20)*band*(.22+cloud*.24);
        const k=(y*width+x)*4;
        for(let c=0;c<3;c++){
          const sky=mix(row[c],top[c],wisp);
          pixels[k+c]=Math.round(mix(sky,216+c*3,mist));
        }
        pixels[k+3]=255;
      }
      continue;
    }
    // Most of a sphere is clear sky. Equal-colour spans can be copied without
    // evaluating any lobe or lighting math, even on a night/weather change.
    if(elevation<0||elevation>=.43){
      const rowBytes=row.map((v,c)=>Math.round(mix(v,216+c*3,mist)));
      const packed=(255<<24)|(rowBytes[2]<<16)|(rowBytes[1]<<8)|rowBytes[0];
      new Uint32Array(pixels.buffer,pixels.byteOffset+y*width*4,width).fill(packed);
      continue;
    }
    for(let x=0;x<width;x++){
      const k=(y*width+x)*4,cover=field[k]/255;
      const nx=field[k+1]/127.5-1,ny=field[k+2]/127.5-1;
      const nz=Math.sqrt(Math.max(0,1-nx*nx-ny*ny)),rise=field[k+3]/255;
      const light=nx*lateral[x]+ny*Math.max(.18,sun[1])+nz*front[x];
      const shade=mix(occlusion[k/2],occlusion[k/2+1],sat(.5+lateral[x]*1.2))/255;
      const illumination=(.14+.45*light+.24*rise+.11*Math.max(ny,0)-shade*.23)*(1-rain*.12);
      const penumbra=smooth((illumination-.12)/.31);
      const highlight=smooth((illumination-.49)/.24);
      const rim=smooth((rise-.55)/.38)*(1-smooth((cover-.72)/.26))*sat(.45+.55*light)*(1-rain*.7);
      const halo=Math.pow(Math.max(0,-front[x]),9)*Math.exp(-Math.abs(elevation-.025)*10)*low*(1-cloud)*.26;
      for(let c=0;c<3;c++){
        let sky=mix(row[c],horizon[c],halo);
        let cloudColor=mix(mix(base[c],half[c],penumbra),top[c],highlight);
        cloudColor=mix(cloudColor,Math.min(255,top[c]*1.04),rim*.22);
        sky=mix(sky,cloudColor,cover*(.97-fog*.18));
        pixels[k+c]=Math.round(mix(sky,216+c*3,mist));
      }
      pixels[k+3]=255;
    }
  }
}
