import React,{useEffect,useState} from 'react';
import spriteUrl from '../../electron/companion-view/assets/spritesheet.png';
// Authentic pinned desktop-pet frames; supplied Q illustration until decoded.
export default function PetAvatar({reducedMotion=false}){const [loaded,setLoaded]=useState(false);useEffect(()=>{let active=true;const image=new Image();image.onload=()=>{if(active)setLoaded(true)};image.src=spriteUrl;return()=>{active=false;image.onload=null}},[]);return <span className={'pet-chat-avatar '+(reducedMotion?'still ':'')+(loaded?'sprite-ready':'')} role="img" aria-label="Q版雪之下雪乃"><img src="./yukino-q.png" alt=""/><span className="pet-avatar-frames" style={{backgroundImage:loaded?`url(${spriteUrl})`:'none'}}/></span>}
