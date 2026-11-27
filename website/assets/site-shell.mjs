export function closeSiteNav(){
  document.getElementById('header-nav')?.classList.remove('open');
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded','false');
}
export function bindSiteShell(){
  const header=document.getElementById('site-header'),nav=document.getElementById('header-nav'),toggle=document.getElementById('nav-toggle');
  if(!header||!nav||!toggle||header.dataset.shellBound)return;
  header.dataset.shellBound='true';
  const scroll=()=>header.classList.toggle('scrolled',window.scrollY>24);
  scroll();
  window.addEventListener('scroll',scroll,{passive:true});
  toggle.addEventListener('click',()=>{
    const open=toggle.getAttribute('aria-expanded')!=='true';
    toggle.setAttribute('aria-expanded',String(open));
    nav.classList.toggle('open',open);
  });
  header.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){
      closeSiteNav();
      toggle.focus();
    }
  });
  matchMedia('(max-width: 860px)').addEventListener('change',closeSiteNav);
}
bindSiteShell();
