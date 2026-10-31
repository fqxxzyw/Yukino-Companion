const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const load=()=>import('../src/ui/resource-readiness.mjs');
const flush=()=>new Promise(setImmediate);

test('resource summary requires a complete all-scope check, never skipped or browser guesses',async()=>{
 const {resourceReadiness,RESOURCE_STEPS}=await load();
 const status={scope:'all',steps:RESOURCE_STEPS.map(id=>({id,state:'ready'}))};
 assert.equal(resourceReadiness(status).kind,'ready');
 assert.equal(resourceReadiness({...status,scope:'selected',features:[]}).kind,'unknown');
 assert.equal(resourceReadiness({...status,steps:status.steps.slice(1)}).kind,'unknown');
 assert.equal(resourceReadiness({...status,steps:status.steps.map(step=>({...step,state:'skipped'}))}).kind,'unknown');
 assert.equal(resourceReadiness(null).kind,'unknown');
 status.steps[0].state='waiting-runtime';status.steps[1].state='missing';status.steps[2].state='error';
 assert.deepEqual(resourceReadiness(status),{kind:'incomplete',missing:1,waiting:1,failed:1});
 status.phase='installing';assert.equal(resourceReadiness(status).kind,'active');
 delete status.phase;status.steps[4].state='downloading';assert.equal(resourceReadiness(status).kind,'active');
});

test('resource observer never installs, coalesces events, and ignores responses after disposal',async()=>{
 const {observeResourceReadiness}=await load();
 let event,off=0,calls=0,resolve,scheduled,cleared=0;const results=[],options=[];
 const api={setupStatus(value){calls++;options.push(value);return new Promise(done=>resolve=done);},onSetupStatus(fn){event=fn;return ()=>off++;},setupInstall(){assert.fail('opening settings must not install');}};
 const stop=observeResourceReadiness(api,value=>results.push(value),{schedule(fn,delay){assert.equal(delay,1000);assert.equal(scheduled,undefined);scheduled=fn;return 7;},unschedule(id){assert.equal(id,7);cleared++;scheduled=undefined;}});
 assert.equal(calls,1);event();event();assert.equal(calls,1);
 resolve({scope:'all',steps:[{id:'chat',state:'missing'}]});await flush();
 assert.equal(results[0].kind,'incomplete');assert.equal(typeof scheduled,'function');
 event();event();assert.equal(calls,1);
 const next=scheduled;scheduled=undefined;next();assert.equal(calls,2);
 stop();resolve({scope:'all',steps:[]});await flush();assert.equal(results.length,1);assert.equal(off,1);
 assert.deepEqual(options,[{scope:'all'},{scope:'all'}]);assert.equal(cleared,0);
 event();assert.equal(scheduled,undefined);
});

test('observer cancels scheduled rechecks and reports unavailable or failed checks truthfully',async()=>{
 const {observeResourceReadiness}=await load();let event,cleared=0;const results=[];
 observeResourceReadiness(undefined,value=>results.push(value))();assert.equal(results.at(-1).kind,'unavailable');
 const stop=observeResourceReadiness({setupStatus:async()=>{throw Error('disk unavailable');},onSetupStatus(fn){event=fn;return ()=>{};}},value=>results.push(value),{schedule(){return 4;},unschedule(id){assert.equal(id,4);cleared++;}});
 await flush();assert.equal(results.at(-1).kind,'error');event();stop();assert.equal(cleared,1);
});

// Compile the actual notice and exercise its rendered buttons without a browser.
// This checks wiring only, not visual layout, clipboard, or native focus.
async function noticeHarness(){
 const {transformWithOxc}=await import('vite'),runtime=require('react/jsx-runtime'),helpers=await load();
 const source=await fs.readFile(path.join(__dirname,'../src/ui/ResourceReadinessNotice.jsx'),'utf8');
 let {code}=await transformWithOxc(source,'ResourceReadinessNotice.jsx');code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 let cursor=0,tree;const values=[],opened=[];
 const icon=()=>null,deps={React:{},useState(initial){const id=cursor++;if(!(id in values))values[id]=initial;return [values[id],next=>values[id]=next];},useEffect(){},CircleX:icon,Download:icon,LoaderCircle:icon,X:icon,...helpers,_jsx:runtime.jsx,_jsxs:runtime.jsxs};
 const Notice=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps);
 function render(state){cursor=0;if(state)values[0]=state;tree=Notice({api:{setupInstall(){assert.fail('render/click cannot download');}},onOpenSetup:features=>opened.push(features)});return tree;}
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 return {render,opened,nodes:()=>walk(tree)};
}
test('notice shows a small missing-resource cross and opens all four features without installing',async()=>{
 const h=await noticeHarness();h.render({kind:'incomplete',missing:3,waiting:1,failed:0});
 const button=h.nodes().find(node=>node.type==='button');assert.ok(button);
 assert.ok(h.nodes().some(node=>node.props?.children==='一键部署全部'));
 button.props.onClick();assert.deepEqual(h.opened,[['chat','translation','voice','pet']]);
 h.render({kind:'active'});assert.ok(h.nodes().some(node=>node.props?.children==='查看部署进度'));
 assert.equal(h.render({kind:'ready'}),null);
 h.render({kind:'unavailable'});assert.equal(h.nodes().filter(node=>node.type==='button').length,0);
 h.render({kind:'error'});assert.ok(h.nodes().some(node=>node.props?.children==='检查资源'));
 h.render({kind:'incomplete',missing:2});h.nodes().find(node=>node.props?.['aria-label']==='暂时隐藏资源提示').props.onClick();
 assert.equal(h.render(),null,'close hides only this settings-session notice, not any resource files');
});
