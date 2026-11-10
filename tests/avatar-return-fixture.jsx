import React from 'react';
import {createRoot} from 'react-dom/client';
import CharacterPanel from '../src/ui/CharacterPanel.jsx';
import '../src/style.css';

const listeners=new Set();
window.desktop={onAvatarHandoff(fn){listeners.add(fn);return()=>listeners.delete(fn)},avatarHandoffReady(seq){window.ready=seq;return Promise.resolve()},reportAvatarRect(){return Promise.resolve()}};
window.dispatchHandoff=message=>{for(const fn of listeners)fn(message)};
window.views=[];
window.renderer={setView(view){window.views.push(view)},resize(){window.resizeCount=(window.resizeCount||0)+1},prepareOutfit:async()=>({}),commitOutfit:async()=>{}};
createRoot(document.getElementById('root')).render(React.createElement(CharacterPanel,{side:'left',width:300,active:true,reducedMotion:true,renderer:window.renderer,character:{modelId:'custom-fixture'},models:[{id:'custom-fixture',ready:true}],containerRef:{current:document.getElementById('stage')},onChange(){},onSettings(){},onPresentationChange(){}}));
