// Same-origin Yukino web account gateway. Browser credentials and production
// service secrets never originate here. No generic proxy and no storage.
const UPSTREAM = 'https://yukino-api.fqxxzyw.workers.dev';
const MAX_JSON = 65536;
const AUTH = '/api/v1/auth/';
const routes = new Map([
  ['/api/v1/health', ['GET',false,false]],
  ['/api/v1/public/downloads', ['GET',false,false]],
  [AUTH+'register/request-code', ['POST',false,false]],
  [AUTH+'register', ['POST',false,false]],
  [AUTH+'login', ['POST',false,false]],
  [AUTH+'refresh', ['POST',false,true]],
  [AUTH+'logout', ['POST',true,true]],
  [AUTH+'logout-all', ['POST',true,true]],
  [AUTH+'password/forgot', ['POST',false,false]],
  [AUTH+'password/verify-reset', ['POST',false,false]],
  [AUTH+'password/reset', ['POST',false,true]],
  [AUTH+'password/change', ['POST',true,true]],
  ['/api/v1/me', ['GET',true,false]],
  ['/api/v1/sessions', ['GET',true,false]],
  ['/api/v1/progress', ['GET',true,false]],
  ['/api/v1/progress/check-in', ['POST',true,false]]
]);

const jsonType=/^application\/json\s*(?:;|$)/i;
const refreshValue=/^[A-Za-z0-9._~%+-]+$/;
const cookieResponsePaths = new Set(
  ['register','login','refresh','logout','logout-all','password/reset','password/change'].map(p=>AUTH+p)
);
const issuesSession = new Set(['register','login','refresh','password/change'].map(p=>AUTH+p));
const revokesSession = new Set(['logout','logout-all','password/reset'].map(p=>AUTH+p));
const clearRefresh = 'yk_refresh=; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
const securityHeaders = {
  'cache-control':'no-store',
  'content-type':'application/json; charset=utf-8',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
};
const failure=(status,code,message,extra={})=>new Response(JSON.stringify({error:{code,message,...extra}}),{status,headers:securityHeaders});

function refreshCookie(header) {
  const cookies=String(header||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('yk_refresh='));
  if (cookies.length!==1) return '';
  const v=cookies[0].slice('yk_refresh='.length);
  return v.length<=4096 && refreshValue.test(v) ? cookies[0] : '';
}

function responseCookies(headers) {
  if(typeof headers.getSetCookie==='function') return headers.getSetCookie();
  // Cloudflare additionally exposes Headers#getAll for Set-Cookie.
  if(typeof headers.getAll==='function') return headers.getAll('Set-Cookie');
  const header=headers.get('set-cookie');
  return header ? header.split(/,(?=\s*[^;,=\s]+\s*=)/):[];
}

function sanitizedRefreshCookie(v) {
  const [pair,...attributes]=String(v).split(';');
  const m=pair.trim().match(/^yk_refresh=([A-Za-z0-9._~%+-]*)$/);
  if(!m || m[1].length>4096) return '';
  const attr = new Map();
  for(const part of attributes) {
    let [k,...v]=part.trim().split('=');
    k=k.toLowerCase();
    if (attr.has(k) && k) return '';
    attr.set(k,v.join('=').trim());
  }
  if(!attr.has('httponly') || !attr.has('secure') || attr.get('samesite')?.toLowerCase()!=='lax' ||
     attr.get('path')!=='/api/v1/auth') return '';
  // Never set a Domain, even if deployment config starts returning one.
  const out=[`yk_refresh=${m[1]}`,'Path=/api/v1/auth','HttpOnly','Secure','SameSite=Lax'];
  const max=attr.get('max-age');
  if(max!==undefined && !/^-?\d{1,12}$/.test(max)) return '';
  if(max!==undefined) out.push('Max-Age='+max);
  const expires=attr.get('expires');
  if(expires!==undefined) {
    const date=new Date(expires);
    if(!Number.isFinite(date.getTime())) return '';
    out.push('Expires='+date.toUTCString());
  }
  if(!m[1] && max===undefined && expires===undefined) return '';
  return out.join('; ');
}

async function readObject(request) {
  if(request.body===null) return '{}';
  if(!jsonType.test(request.headers.get('content-type')||'')) return failure(415,'invalid_content_type','请求必须使用 JSON。');
  const claimed=request.headers.get('content-length');
  if(claimed!==null && (!/^\d+$/.test(claimed)||Number(claimed)>MAX_JSON))
    return failure(413,'body_too_large','请求内容过大。');
  const reader=request.body.getReader();
  let total=0, data='';
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>MAX_JSON) {
        void reader.cancel().catch(()=>{});
        return failure(413,'body_too_large','请求内容过大。');
      }
      data+=decoder.decode(value,{stream:true});
    }
    data+=decoder.decode();
    const value=JSON.parse(data);
    if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('object');
    if(Object.hasOwn(value,'refreshToken')) return failure(400,'web_refresh_cookie_required','网页只能通过安全 Cookie 刷新。');
    // Uniformly force web. Keep arbitrary unrecognized fields out on refresh.
    if(request.url.endsWith(AUTH+'refresh')) return '{"client":"web"}';
    const path=new URL(request.url).pathname;
    if(path.startsWith(AUTH)) value.client='web';
    else delete value.client;
    const normalized=JSON.stringify(value);
    if(new TextEncoder().encode(normalized).length>MAX_JSON) return failure(413,'body_too_large','请求内容过大。');
    return normalized;
  } catch {
    return failure(400,'invalid_json','JSON 内容无效。');
  }
}

export async function handleApi(request,{fetchUpstream=fetch}={}) {
  const url=new URL(request.url);
  const path=url.pathname;
  const match=routes.get(path) ?? (/^\/api\/v1\/sessions\/[A-Za-z0-9_-]{1,128}$/.test(path) ? ['DELETE',true,false] : null);
  if(!match) return failure(404,'not_found','接口不存在。');
  const [method,bearer,allowRefreshCookie]=match;
  if(request.method!==method) {
    const r=failure(405,'method_not_allowed','不支持此请求方式。');
    r.headers.set('allow',method);
    return r;
  }
  if(url.search) return failure(400,'invalid_query','此接口不接受查询参数。');
  const origin=request.headers.get('origin');
  const site=request.headers.get('sec-fetch-site');
  if((origin && origin!==url.origin) || (site && site!=='same-origin' && site!=='none') ||
     (method!=='GET' && origin!==url.origin))
    return failure(403,'origin_not_allowed','请从官网页面发起请求。');
  const headers=new Headers({'accept':'application/json','origin':UPSTREAM,'x-client':'web'});
  if(bearer) {
    const token=request.headers.get('authorization');
    if(token && /^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(token)) headers.set('authorization',token);
    else return failure(401,'authorization_required','请先登录。');
  }
  if(allowRefreshCookie) {
    const cookie=refreshCookie(request.headers.get('cookie'));
    if(cookie) headers.set('cookie',cookie);
  }
  let body;
  if(method==='POST') {
    body=await readObject(request);
    if(body instanceof Response) return body;
    if(request.body===null && path===AUTH+'refresh') body='{"client":"web"}';
    headers.set('content-type','application/json');
  } else if(request.body!==null) {
    return failure(400,'unexpected_body','此请求不接受请求正文。');
  }
  let latest;
  try {
    latest=await fetchUpstream(UPSTREAM+path,{
      method,headers,body,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(25000)
    });
  } catch {
    return failure(503,'upstream_unreachable','暂时无法连接账号服务，请稍后重试。');
  }
  if(latest.status>=300&&latest.status<400) return failure(502,'unexpected_redirect','账号服务返回了意外的跳转。');
  if(latest.status===204) {
    if(issuesSession.has(path))return failure(502,'missing_refresh_cookie','账号服务未能建立网页会话，请重试。');
    const empty=new Response(null,{status:204,headers:securityHeaders});
    if(revokesSession.has(path))empty.headers.append('set-cookie',clearRefresh);
    return empty;
  }
  if(!jsonType.test(latest.headers.get('content-type')||''))
    return failure(latest.status>=500?503:502,'unexpected_response','账号服务暂未返回有效结果，请稍后重试。');
  let data;
  try { data=await latest.json(); }
  catch { return failure(502,'unexpected_response','账号服务暂未返回有效结果，请稍后重试。'); }
  if(!data || typeof data!=='object') return failure(502,'unexpected_response','账号服务暂未返回有效结果，请稍后重试。');
  // Web clients must never receive a refresh token in JSON, even if an
  // upstream release misclassifies the client. The only carrier is the cookie.
  delete data.refreshToken;
  const r=new Response(JSON.stringify(data),{status:latest.status,headers:securityHeaders});
  const wait=latest.headers.get('retry-after');
  if(wait && /^\d{1,7}$/.test(wait)) r.headers.set('retry-after',wait);
  if(cookieResponsePaths.has(path)) {
    const values=responseCookies(latest.headers).map(sanitizedRefreshCookie).filter(Boolean);
    if(latest.ok && issuesSession.has(path)) {
      const c=values[0]||'';
      if(values.length!==1 || !/^yk_refresh=[^;]/.test(c) || /; Max-Age=-?0(?:;|$)|; Max-Age=-\d/.test(c))
        return failure(502,'missing_refresh_cookie','账号服务未能建立网页会话，请重试。');
      const e=c.match(/; Expires=([^;]+)/);
      if(e && new Date(e[1]).getTime()<=Date.now())
        return failure(502,'missing_refresh_cookie','账号服务未能建立网页会话，请重试。');
      r.headers.append('set-cookie',c);
    } else if(latest.ok && revokesSession.has(path)) {
      r.headers.append('set-cookie',clearRefresh);
    } else if(values.length===1) {
      r.headers.append('set-cookie',values[0]);
    }
  }
  return r;
}
