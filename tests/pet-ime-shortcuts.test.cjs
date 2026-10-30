const test=require('node:test');
const assert=require('node:assert/strict');
const {videoRendererHarness}=require('./helpers/video-renderer-harness.cjs');

test('IME Escape cancels candidate selection without blurring the dock or stopping chat',async t=>{
  for(const signal of ['composition-event','isComposing','keyCode']){
    const h=await videoRendererHarness();t.after(()=>h.unload());
    let blurs=0,prevented=0;
    const input=h.nodes.get('pet-input');input.blur=()=>blurs++;input.value='正在输入的中文';
    h.emit({...h.state,chatBusy:true});
    if(signal==='composition-event')input.events.get('compositionstart')();
    const baseline=h.calls.length;
    h.windowEvents.get('keydown')({key:'Escape',isComposing:signal==='isComposing',keyCode:signal==='keyCode'?229:27,preventDefault(){prevented++;}});
    await h.settle();
    assert.equal(blurs,0,signal);assert.equal(prevented,0,'IME receives its own Escape');
    assert.equal(input.value,'正在输入的中文');
    assert.ok(!h.calls.slice(baseline).some(item=>item.action==='chat-stop'),signal);
  }
});

test('Escape retains its stop and blur behavior after composition ends',async t=>{
  const h=await videoRendererHarness();t.after(()=>h.unload());
  let blurs=0;const input=h.nodes.get('pet-input');input.blur=()=>blurs++;
  input.value='已确认的文字';input.events.get('compositionstart')();input.events.get('compositionend')();
  h.emit({...h.state,chatBusy:true});const baseline=h.calls.length;
  h.windowEvents.get('keydown')({key:'Escape',keyCode:27,preventDefault(){}});await h.settle();
  assert.equal(blurs,1);assert.equal(input.value,'已确认的文字');
  assert.equal(h.calls.slice(baseline).filter(item=>item.action==='chat-stop').length,1);
});
