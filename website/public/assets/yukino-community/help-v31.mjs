const root=document.querySelector('main.yk-help');
if(root){
  const docs=Array.from(root.querySelectorAll('.yk-help-doc'));
  const links=Array.from(root.querySelectorAll('[data-help-link]'));
  const mobile=root.querySelector('.yk-help-toc-mobile');
  const lookup=new Map(docs.map(doc=>[doc.id,doc]));
  function update({focus=false,scroll=false}={}){
    let hash=location.hash.slice(1).replace(/^help\//,'');
    try{hash=decodeURIComponent(hash);}catch{hash='';}
    const doc=lookup.get(hash)||docs[0];
    if(location.hash.startsWith('#help/')&&lookup.has(hash))history.replaceState(history.state,'','#'+hash);
    for(const item of docs)item.hidden=item!==doc;
    for(const link of links){
      if(link.getAttribute('href')==='#'+doc.id)link.setAttribute('aria-current','location');
      else link.removeAttribute('aria-current');
    }
    document.title=hash===doc.id?`${doc.querySelector('h2').textContent} · Yukino 帮助`:'Yukino · 帮助';
    if(hash===doc.id){
      if(mobile)mobile.open=false;
      if(focus)doc.focus({preventScroll:true});
      if(scroll)doc.scrollIntoView({block:'start'});
    }
  }
  window.addEventListener('hashchange',()=>update({focus:location.hash!=='#content',scroll:location.hash!=='#content'}));
  root.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#"]');
    if(link?.hash===location.hash&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){
      event.preventDefault();update({focus:true,scroll:true});
    }
  });
  update({scroll:location.hash.length>1});
}
