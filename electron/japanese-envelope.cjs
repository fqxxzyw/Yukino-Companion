// Only a top-level JSON string field is eligible. A quoted key in prose/code
// or inside zh is never a speech source. Incomplete escapes stay uncommitted.
function stringEnd(text,start){for(let i=start;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"')return i;}return -1;}
function japanesePrefix(raw,decode){
  const opening=/^\s*(?:```(?:json)?\s*)?\{\s*/i.exec(raw);if(!opening)return '';
  let cursor=opening[0].length;const keys=new Set();
  for(let fields=0;fields<2;fields++){
    while(/\s/.test(raw[cursor]||'')&&cursor<raw.length)cursor++;
    if(raw[cursor]!=='"')return '';const end=stringEnd(raw,cursor+1);if(end<0)return '';
    let key;try{key=JSON.parse(raw.slice(cursor,end+1));}catch{return '';}
    if(!['zh','ja'].includes(key)||keys.has(key))return '';keys.add(key);cursor=end+1;
    while(cursor<raw.length&&/\s/.test(raw[cursor]))cursor++;if(raw[cursor++]!==':')return '';
    while(cursor<raw.length&&/\s/.test(raw[cursor]))cursor++;if(raw[cursor++]!=='"')return '';
    const value=decode(raw,cursor);if(key==='ja')return value.text;
    if(!value.complete)return '';cursor=stringEnd(raw,cursor)+1;
    while(cursor<raw.length&&/\s/.test(raw[cursor]))cursor++;if(raw[cursor++]!==',')return '';
  }
  return '';
}
module.exports={japanesePrefix};
