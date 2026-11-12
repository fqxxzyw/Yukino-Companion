import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import BilingualBubble from '../src/ui/BilingualBubble.jsx';

const root=createRoot(document.getElementById('root'));
window.revealCount=0;
window.showReply=({id='reply',content='',zh='',ja='',status='streaming',animate=false,reducedMotion=false,language='zh'})=>{
 flushSync(()=>root.render(<BilingualBubble key={id} message={{id,role:'assistant',content,zh,ja,status}} language={language} animate={animate} reducedMotion={reducedMotion} onReveal={()=>window.revealCount++}/>));
};
