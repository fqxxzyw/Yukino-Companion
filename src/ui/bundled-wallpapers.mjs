import manifest from '../../resources/default-wallpapers.json' with {type:'json'};

// These are app-owned assets, not arbitrary user-provided file URLs.
export const BUNDLED_WALLPAPERS=Object.freeze(manifest.items.map(item=>Object.freeze({...item})));
export const bundledWallpaper=id=>BUNDLED_WALLPAPERS.find(item=>item.id===id);
export function defaultWallpaperConfig(){
 return {enabled:true,rotation:true,intervalSeconds:300,opacity:1,items:BUNDLED_WALLPAPERS.map(({id,name})=>({id,name}))};
}
