'use strict';
const {exact,prefixes}=require('../resources/model-replacements.json');
const prefixList=Object.entries(prefixes);
// Shared with the renderer through resources/model-replacements.json so a
// packaged asar never depends on an unlisted source directory.
function approvedModelId(id){
 if(typeof id!=='string'||!id)return '';
 if(Object.hasOwn(exact,id))return exact[id];
 const match=prefixList.find(([prefix])=>id.startsWith(prefix+'-'));
 return match?match[1]:id;
}
module.exports={approvedModelId};
