const path=require('node:path');
// A prior app-managed runtime may have been replaced or removed. Never rewrite
// an explicitly selected Python outside the application's own runtime trees.
function managedRuntimeBinary(saved,selected,{dataRoot,resourceRoot}){
 if(!saved)return selected||'';
 const roots=[path.join(dataRoot,'runtime'),path.join(dataRoot,'python-runtime'),path.join(resourceRoot,'python-runtime')];
 const managed=roots.some(root=>{const relative=path.relative(root,saved);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));});
 return managed?(selected||''):saved;
}
module.exports={managedRuntimeBinary};
