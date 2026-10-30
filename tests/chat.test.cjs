const test=require('node:test');const assert=require('node:assert/strict');const {chat,endpoint}=require('../electron/chat.cjs');
test('endpoint normalization and insecure remote rejection',()=>{assert.equal(endpoint('https://example.com/v1/'),'https://example.com/v1/chat/completions');assert.equal(endpoint('https://example.com/v1/chat/completions'),'https://example.com/v1/chat/completions');assert.throws(()=>endpoint('http://example.com'));assert.throws(()=>endpoint('https://secret@example.com'));assert.equal(endpoint('http://127.0.0.1:1234/v1'),'http://127.0.0.1:1234/v1/chat/completions')});
test('UTF-8 split SSE chunks and ignored reasoning',async()=>{const bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\ndata: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n');let result='';await chat({profile:{base:'https://example.com',model:'test'},messages:[],onToken:t=>result+=t,fetcher:async()=>new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close()}}),{headers:{'Content-Type':'text/event-stream'}})});assert.equal(result,'你好')});
test('JSON fallback and HTTP failures',async()=>{let out='';await chat({profile:{base:'https://example.com',model:'m'},messages:[],onToken:t=>out+=t,fetcher:async()=>Response.json({choices:[{message:{content:'hello'}}]})});assert.equal(out,'hello');await assert.rejects(chat({profile:{base:'https://example.com'},messages:[],onToken(){},fetcher:async()=>new Response('secret',{status:401})}),/HTTP 401/)});
test('abort reaches network request',async()=>{const c=new AbortController();c.abort();await assert.rejects(chat({profile:{base:'https://example.com'},messages:[],signal:c.signal,onToken(){},fetcher:async(u,o)=>{o.signal.throwIfAborted()}}),{name:'AbortError'})});
test('remote models use provider sampling defaults for reasoning model compatibility',async()=>{await chat({profile:{base:'https://api.moonshot.cn/v1',model:'test-model'},messages:[],onToken(){},fetcher:async(u,o)=>{const body=JSON.parse(o.body);assert.equal(Object.hasOwn(body,'temperature'),false);return Response.json({choices:[{message:{content:'ok'}}]})}})});
test('network errors are safe and distinguishable from API responses',async()=>{
 const args={profile:{base:'https://example.test/v1',model:'test'},key:'TEST_SECRET',messages:[],onToken(){}};
 await assert.rejects(chat({...args,fetcher:async()=>{throw Error('TEST_SECRET transport failed')}}),error=>/系统代理/.test(error.message)&&!/TEST_SECRET/.test(error.message));
 await assert.rejects(chat({...args,fetcher:async()=>new Response('TEST_SECRET',{status:401})}),error=>/HTTP 401/.test(error.message)&&!/TEST_SECRET/.test(error.message));
});
test('production requests reject redirects and omit browser cookies',async()=>{
 await chat({profile:{base:'https://example.test',model:'test'},messages:[],onToken(){},fetcher:async(_url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return Response.json({choices:[{message:{content:'ok'}}]});}});
});
test('production chat adapter sends the request through Electron networking',async()=>{
 const {createSystemProxyChat}=require('../electron/api-transport.cjs'),seen=[];let result='';
 const transport=createSystemProxyChat({fetch:async(url,options)=>{seen.push({url,options});return Response.json({choices:[{message:{content:'ok'}}]});}});
 await transport({profile:{base:'https://example.test/v1',model:'test'},key:'fixture',messages:[],onToken:value=>result+=value,fetcher:()=>{throw Error('untrusted override');}});
 assert.equal(result,'ok');assert.equal(seen.length,1);assert.equal(seen[0].url,'https://example.test/v1/chat/completions');assert.equal(seen[0].options.redirect,'error');assert.equal(seen[0].options.credentials,'omit');
});
