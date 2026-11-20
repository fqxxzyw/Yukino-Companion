// The clinic, tile merchant and walk-up apartments share a street frontage.
// Their masonry, timber, glazed tile and roof hardware each catch light differently.
export function lawsonArchitecture(b) {
  const material=(name,color,roughness,metalness=0)=>{
    const result=b.mat(name,color,{roughness,metalness});
    result.userData.surfaceFinish={roughness,metalness,envMapIntensity:metalness?.54:.20};
    return result;
  };
  const brick=material('wall:kiln-brick','#c78863',.95);
  const limestone=material('stone:cream-lintel','#e7cfaa',.92);
  const copper=material('metal:patinated-standing-seam','#467e80',.64,.24);
  const zinc=material('metal:galvanized-tank','#8dabb0',.42,.62);
  const tiles=material('ceramic:teal-glazed-tile','#508989',.33);
  const timber=material('wood:oiled-cedar','#945d3e',.84);
  const seam=material('paint:teal-shadow','#375b60',.88);
  const canvas=material('fabric:striped-shop-awning','#d47c59',.98);
  const cotton=material('fabric:awning-ecru','#f4e4c4',.98);
  const tankStraps=material('metal:tank-collar','#66777a',.55,.53);
  const finishGrid=(mat,brickwork)=>{
    mat.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vMasonry;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vMasonry=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader='varying vec3 vMasonry;\n'+shader.fragmentShader.replace('#include <color_fragment>',`
        #include <color_fragment>
        vec3 wallNormal=abs(normalize(cross(dFdx(vMasonry),dFdy(vMasonry))));
        vec2 masonry=vec2(wallNormal.x>wallNormal.z?vMasonry.z:vMasonry.x,vMasonry.y)/vec2(${brickwork?'.51,.224':'.234,.234'});
        ${brickwork?'masonry.x+=mod(floor(masonry.y),2.)*.5;':''}
        vec2 joint=min(fract(masonry),1.-fract(masonry));
        vec2 fill=smoothstep(vec2(.025),vec2(.025)+max(fwidth(masonry)*.70,vec2(.025)),joint);
        float jointCoverage=fill.x*fill.y;
        float kiln=fract(sin(dot(floor(masonry),vec2(15.93,79.63)))*3154.81);
        float detail=1.-smoothstep(.25,1.,max(fwidth(masonry.x),fwidth(masonry.y)));
        diffuseColor.rgb*=mix(1.,1.+(kiln-.5)*${brickwork?'.20':'.13'},detail);
        diffuseColor.rgb=mix(diffuseColor.rgb, ${brickwork?'vec3(.58,.46,.33)':'vec3(.16,.29,.26)'},(1.-jointCoverage)*detail*.75);
      `);
    };
    mat.customProgramCacheKey=()=>brickwork?'shop-kiln-bond':'shop-glazed-square-tile';
  };
  finishGrid(brick,true);finishGrid(tiles,false);
  function cornice(x,y,z,w,group){
    for(const [dy,depth,thickness] of [[0,.31,.20],[.17,.44,.10],[.29,.54,.10]])
      b.box([x,y+dy,z+depth*.36],[w+depth,thickness,depth],limestone,group);
  }
  function fabricAwning(x,z,y,w,group) {
    const stripes=9;
    for(let j=0;j<stripes;j++){
      const xx=x-w*.5+(j+.5)*w/stripes,cloth=j%2?cotton:canvas;
      const clothTop=b.box([xx,y-.15,z+.57],[w/stripes,.055,1.30],cloth,group);
      clothTop.rotation.x=.27;
      b.box([xx,y-.38,z+1.18],[w/stripes,.22,.04],cloth,group);
    }
    for(const side of [-1,1])b.tube([x+side*w*.46,y-.82,z],[x+side*w*.46,y-.29,z+1.15],.032,tankStraps,group);
  }
  function roofTank(x,z,y,group){
    for(const dx of [-.76,.76])for(const dz of [-.6,.6])b.beam([x+dx,y,z+dz],[x+dx*.72,y+1.24,z+dz*.72],.08,tankStraps,group);
    b.cylinderAt([x,y+2.10,z],1.04,1.82,zinc,group);
    for(const dy of [1.24,1.66,2.53,2.99])b.cylinderAt([x,y+dy,z],1.075,.060,tankStraps,group);
    b.tube([x-.82,y+.68,z],[x-1.46,y+.68,z],.07,zinc,group);
    b.tube([x-1.46,y+.68,z],[x-1.46,y+.04,z],.07,zinc,group);
  }
  function neighbour({id,x,z,w,d,h,front,group}) {
    if(id%4===0){
      cornice(x,h+.14,front,w,group);
      for(const side of [-1,1]){
        const xx=x+side*(w*.5-.25);
        b.box([xx,h*.51,front+.11],[.36,h-.25,.31],brick,group);
        b.box([xx,h*.51,front+.28],[.13,h-.29,.06],limestone,group);
      }
      if(id<4)roofTank(x+w*.18,z,h+.24,group);
    }else if(id%4===1){
      fabricAwning(x,front+.23,2.86,w*.86,group);
      b.box([x,h-.24,front+.05],[w,.38,.17],tiles,group);
      for(const side of [-1,1])b.box([x+side*(w/2-.18),h*.5,front+.10],[.26,h,.22],tiles,group);
    }else if(id%4===2){
      for(const side of [-1,1]){
        const roofPanel=b.box([x+side*w*.253,h+.53,z],[w*.55,.12,d+.60],copper,group);
        roofPanel.rotation.z=-side*.20;
        for(let zz=z-d/2;zz<z+d/2;zz+=.74)
          b.beam([x,h+.79,zz],[x+side*w*.52,h+.25,zz],.050,seam,group);
      }
      for(const xx of [x-w*.44,x+w*.44])b.box([xx,h/2,front+.14],[.15,h,.20],timber,group);
    }else{
      const xx=x+w*.27;
      b.box([xx,h-.03,z-.32],[w*.43,1.38,d*.79],tiles,group);
      b.box([xx,h+.71,z-.32],[w*.48,.13,d*.82],limestone,group);
    }
  }
  function storefront() {
    // Tiled pilasters hold the recessed soffit clear of the sliding-door track.
    for(const x of [-6.36,6.36])b.box([x,1.59,1.44],[.29,2.78,.36],tiles);
    b.box([0,3.94,1.36],[13.82,.17,1.05],zinc);
    for(let x=-6.2;x<=6.21;x+=.45)b.box([x,3.824,1.39],[.30,.075,.63],timber);
    const side=b.group('lawson:bakery-counter',[-7.91,0,.15]);
    b.box([0,1.53,0],[2.62,2.62,1.18],timber,side);
    b.box([0,1.82,.61],[2.25,1.24,.06],seam,side);
    b.box([0,1.10,.82],[2.54,.14,.54],limestone,side);
    fabricAwning(0,.55,2.94,2.93,side);
    b.sign('焼きたてパン',2.46,.35,[0,2.55,.68],{parent:side,bg:'#6b422f',fg:'#fff0d6',size:100});
    for(const x of [-.79,-.08,.66]) {
      b.box([x,1.27,.83],[.56,.18,.34],timber,side);
      b.box([x,1.40,.84],[.41,.10,.23],cotton,side);
    }
    for(const x of [-5.1,5.8]) {
      b.box([x,.053,8.19],[.89,.024,.55],tankStraps);
      for(let j=0;j<9;j++)b.box([x-.36+j*.09,.072,8.19],[.045,.012,.41],seam);
    }
  }
  return {brick,tiles,limestone,neighbour,storefront};
}
