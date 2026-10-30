const {isYukinoLocal}=require('./persona.cjs');
function endpoint(base){const u=new URL(base); if(u.username||u.password||u.search||u.hash)throw Error('地址不能包含凭据、查询或锚点');if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('请使用 HTTPS，或本机 HTTP 地址');return u.href.replace(/\/$/,'').replace(/\/chat\/completions$/,'')+'/chat/completions'}
async function chat({profile,key,messages,signal,onToken,fetcher=fetch,localRoleplay=false}){
 const address=endpoint(profile.base);let response;
 try{response=await fetcher(address,{method:'POST',redirect:'error',credentials:'omit',signal,headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model:profile.model,messages,stream:true,...(localRoleplay&&isYukinoLocal(profile)?{temperature:.7,use_knowledge:false}:{})})});}
 catch(error){if(signal?.aborted)throw error;throw Error('无法连接 API 服务。请检查网络、系统代理和 API 地址；ChatGPT 网页可用不代表 API 一定可用。');}
 if(!response.ok){await response.body?.cancel();const detail=response.status===401?'请检查 API 密钥。':response.status===403?'请检查账户、模型权限及服务地域。':response.status===429?'请求受限；请检查速率限制和 API 账户额度。':response.status>=500?'服务暂时不可用，请稍后重试。':'请检查 API 地址、模型及账户权限。';throw Error(`请求失败 HTTP ${response.status}：${detail}`)}
 if(!response.headers.get('content-type')?.includes('text/event-stream')){const j=await response.json();const t=j.choices?.[0]?.message?.content;if(typeof t!=='string')throw Error('服务返回格式不兼容');onToken(t);return}
 const decoder=new TextDecoder();let buffer='',done=false;
 function event(block){const data=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(!data)return;if(data==='[DONE]'){done=true;return}const j=JSON.parse(data);if(j.error)throw Error('模型服务返回错误');const t=j.choices?.[0]?.delta?.content;if(typeof t==='string')onToken(t)}
 for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let i;while((i=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,i));buffer=buffer.slice(i+2);if(done)break}if(done)break}
 buffer+=decoder.decode();if(!done&&buffer.trim())event(buffer);
}
module.exports={chat,endpoint};
