"""Cut generated 4x2 atlases into aligned full-body PNG frames. No pose synthesis."""
from PIL import Image
from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
out=root/'public/avatars/yukino-sprite'
files=dict(zip(('idle','talk','greet'),sys.argv[1:]))
assert len(files)==3, 'Pass idle, talk and greet atlas paths'
manifest={'version':1,'name':'雪乃 · 逐帧桌宠','width':384,'height':512,'animations':{}}
for name,path in files.items():
 im=Image.open(path).convert('RGBA'); w,h=im.size; assert w%4==0 and h%2==0
 frames=[]
 for i in range(8):
  cell=im.crop((i%4*w//4,i//4*h//2,(i%4+1)*w//4,(i//4+1)*h//2))
  # Ignore negligible alpha noise when finding the silhouette.
  mask=cell.getchannel('A').point(lambda a:255 if a>32 else 0)
  box=mask.getbbox(); assert box
  # Uniform scale only: no warping, artificial limb motion or generated interpolation.
  crop=cell.crop(box); size=(round(crop.width*490/crop.height),490)
  crop=crop.resize(size,Image.Resampling.LANCZOS)
  frame=Image.new('RGBA',(384,512))
  frame.alpha_composite(crop,((384-size[0])//2,12))
  file=f'frames/{name}-{i:02}.png';frame.save(out/file,optimize=True);frames.append(file)
 manifest['animations'][name]={'frames':frames,'durations': {'idle':[2400,450,65,95,65,500,500,800],'talk':[140,110,120,100,130,110,120,140],'greet':[100,110,110,140,350,110,110,160]}[name],'loop':name!='greet'}
# Shared neutral bookends prevent a jump at loop/state boundaries.
neutral=Image.open(out/'frames/idle-00.png')
for name,i in [('idle',7),('talk',0),('talk',7),('greet',0),('greet',7)]:neutral.save(out/f'frames/{name}-{i:02}.png',optimize=True)
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
# Animated preview uses genuine source frames, with a pale background for GIF compatibility.
for name,spec in manifest['animations'].items():
 frames=[]
 for f in spec['frames']:
  bg=Image.new('RGBA',(384,512),'#edf4fa');bg.alpha_composite(Image.open(out/f));frames.append(bg.convert('RGB'))
 frames[0].save(out/f'{name}-preview.gif',save_all=True,append_images=frames[1:],duration=spec['durations'],loop=0,disposal=2)
print('Prepared 24 aligned RGBA frames, manifest, three GIF previews')
