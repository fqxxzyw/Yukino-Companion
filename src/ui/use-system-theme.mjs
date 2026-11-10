import {useEffect,useState} from 'react';
export function useSystemDark(){
 const [dark,setDark]=useState(()=>globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches===true);
 useEffect(()=>{const media=globalThis.matchMedia?.('(prefers-color-scheme: dark)');if(!media)return;const update=()=>setDark(media.matches);update();media.addEventListener?.('change',update);return()=>media.removeEventListener?.('change',update);},[]);
 return dark;
}
