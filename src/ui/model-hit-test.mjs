// Use the actual model geometry rather than the transparent canvas rectangle.
// The caller supplies a reused raycaster and invokes this at a bounded frequency.
export function modelHitTest({x,y,rect,camera,root,raycaster}){
 if(!camera||!root||!raycaster||!rect||rect.width<=0||rect.height<=0||x<rect.left||y<rect.top||x>=rect.right||y>=rect.bottom)return false;
 root.updateWorldMatrix(true,true);camera.updateMatrixWorld();
 raycaster.setFromCamera({x:(x-rect.left)/rect.width*2-1,y:1-(y-rect.top)/rect.height*2},camera);
 return raycaster.intersectObject(root,true).some(hit=>{
  for(let item=hit.object;item;item=item.parent)if(item.visible===false)return false;
  const materials=Array.isArray(hit.object.material)?hit.object.material:[hit.object.material];
  return materials.some(material=>material&&material.visible!==false&&(!material.transparent||material.opacity>0.01));
 });
}
