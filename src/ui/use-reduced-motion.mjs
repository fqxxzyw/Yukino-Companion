import {useEffect,useState} from 'react';
export function observeReducedMotion(listener,scope=globalThis){const query=scope.matchMedia?.('(prefers-reduced-motion: reduce)');listener(Boolean(query?.matches));const change=event=>listener(event.matches);query?.addEventListener?.('change',change);return()=>query?.removeEventListener?.('change',change)}
export function useReducedMotion(preference=false){const [system,setSystem]=useState(()=>Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches));useEffect(()=>observeReducedMotion(setSystem),[]);return preference||system}
