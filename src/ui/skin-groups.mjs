// Versions share one outfit and one progression rule. Changing a version never
// creates another swimsuit date counter or another affection requirement.
export function skinGroups(models=[],selectedId='',choices={}){
 const groups=new Map();for(const model of models){if(model.retired)continue;const key=model.outfitGroup||model.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(model);}
 return [...groups].map(([id,versions])=>{
  const model=versions.find(v=>v.id===choices[id])||versions.find(v=>v.id===selectedId)||versions.find(v=>v.approvedV2)||versions[0];
  return {id,versions,label:(model?.label||versions[0]?.label||id).split('·')[0],model};
 });
}
