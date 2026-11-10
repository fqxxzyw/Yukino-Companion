// A temporary canvas rectangle lets the two independently rendered models
// share the same viewport during the native-window crossfade.
export function prepareAvatarReturn(host, rect) {
 const parent=host?.offsetParent;
 if(!parent||!rect||!['x','y','width','height'].every(key=>Number.isFinite(rect[key]))||rect.width<=0||rect.height<=0)return null;
 const bounds=parent.getBoundingClientRect(),style=host.style,names=['inset','left','top','right','bottom','width','height'];
 const saved=names.map(name=>[name,style.getPropertyValue(name),style.getPropertyPriority(name)]);
 host.dataset.avatarHandoff='true';
 style.setProperty('inset','auto');style.setProperty('left',`${rect.x-bounds.left-(parent.clientLeft||0)}px`);style.setProperty('top',`${rect.y-bounds.top-(parent.clientTop||0)}px`);
 style.setProperty('width',`${rect.width}px`);style.setProperty('height',`${rect.height}px`);
 return ()=>{for(const [name,value,priority] of saved){if(value)style.setProperty(name,value,priority);else style.removeProperty(name);}delete host.dataset.avatarHandoff;};
}
