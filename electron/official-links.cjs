'use strict';
const {website}=require('../resources/official-links.json');

// The public website is the worker root. Account traffic stays on the same
// origin but uses its existing /api/v1/ paths in account-client.cjs.
const OFFICIAL_SITE_URL=website;

async function openOfficialSite(shell,{url=OFFICIAL_SITE_URL}={}){
 if(!shell||typeof shell.openExternal!=='function')throw Error('无法打开系统默认浏览器：当前环境不支持外部链接。');
 try{
  await shell.openExternal(url);
  return true;
 }catch(error){
  const wrapped=Error(`无法打开系统默认浏览器，请手动访问 ${url}`);
  wrapped.code='OFFICIAL_SITE_OPEN_FAILED';
  wrapped.cause=error;
  throw wrapped;
 }
}

module.exports={OFFICIAL_SITE_URL,openOfficialSite};
