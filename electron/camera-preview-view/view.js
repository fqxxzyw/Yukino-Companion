const bridge=window.cameraPreview,picture=document.getElementById('picture'),waiting=document.getElementById('waiting');
bridge.onFrame(image=>{picture.src=image;waiting.hidden=true;});
bridge.onClear(()=>{picture.removeAttribute('src');waiting.hidden=false;});
document.getElementById('hide').addEventListener('click',()=>bridge.hide().catch(()=>{}));
document.getElementById('stop').addEventListener('click',()=>bridge.stop().catch(()=>{}));
document.getElementById('settings').addEventListener('click',()=>bridge.settings().catch(()=>{}));
