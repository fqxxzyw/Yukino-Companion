// Only the seven pinned NORMAL contracts are executable. Renderer catalog data
// cannot supply JavaScript, enable diagnostic pressure or widen a pose envelope.
import manifest from './garments/manifest.json' with {type:'json'};
import p01 from './garments/profiles/01-normal.json' with {type:'json'};
import p02 from './garments/profiles/02-normal.json' with {type:'json'};
import p03 from './garments/profiles/03-normal.json' with {type:'json'};
import p04 from './garments/profiles/04-normal.json' with {type:'json'};
import p05 from './garments/profiles/05-normal.json' with {type:'json'};
import p06 from './garments/profiles/06-normal.json' with {type:'json'};
import p07 from './garments/profiles/07-normal.json' with {type:'json'};
import {createBoundedGarmentDriver} from './garments/bounded-garment-driver.mjs';
import {createMaidContactDriver} from './garments/maid-contact-driver.mjs';
import {createGarmentDriver} from './garments/garment-driver-v4.mjs';
const profiles={'01':p01,'02':p02,'03':p03,'04':p04,'05':p05,'06':p06,'07':p07};
const factories={createBoundedGarmentDriver,createMaidContactDriver,createGarmentDriver};
export function garmentCapability(entry){
 const pinned=manifest.models.find(item=>item.id===entry?.id);
 if(!pinned&&!entry?.garment)return null;
 if(!pinned||entry.custom||entry.reviewOnly||entry.sha256!==pinned.assetSha256||entry.bytes!==pinned.bytes||entry.garment?.assetSha256!==pinned.assetSha256||entry.garment?.profileId!==pinned.modelId+'-normal'||entry.garment?.mode!=='normal')throw Error('衣物修正版本或正常姿态合约不匹配。');
 return pinned;
}
export function bindNormalGarment(root,entry,THREE){
 const capability=garmentCapability(entry);if(!capability)return null;
 if(THREE.REVISION!=='185')throw Error('衣物姿态修正需要已校准的 Three r185。');
 const config=profiles[capability.modelId];
 const driver=factories[capability.driverFactory]({root,THREE,config,assetSha256:entry.sha256});
 if(!driver.compatible){driver.dispose();throw Error('模型缺少衣物修正所需的精确骨骼或形态。');}
 let disposed=false;
 return {capability,update(dt){if(disposed)return {active:false,weights:{},warnings:['disposed']};return driver.update(dt)},reset(){if(!disposed)driver.reset()},dispose(){if(disposed)return;driver.dispose();disposed=true}};
}
