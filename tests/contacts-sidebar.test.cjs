const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
async function component(t){
 const {transformWithOxc}=await import('vite'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-contacts-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let {code}=await transformWithOxc(await fs.readFile(path.join(root,'src/ui/ContactsSidebar.jsx'),'utf8'),'ContactsSidebar.jsx');
 for(const name of ['react','react/jsx-runtime','lucide-react'])code=code.replaceAll(JSON.stringify(name),JSON.stringify(pathToFileURL(require.resolve(name)).href));
 const file=path.join(directory,'ContactsSidebar.mjs');await fs.writeFile(file,code);return import(pathToFileURL(file).href);
}
test('contacts show each character with their own expandable histories and search across roles',async t=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{default:ContactsSidebar,contactGroups}=await component(t);
 const characters=[{id:'yukino',name:'雪乃'},{id:'alice',name:'爱丽丝'}],conversations=[{id:'a',characterId:'yukino',title:'校内散步'},{id:'b',characterId:'alice',title:'海边旅行'}];
 const groups=contactGroups(characters,conversations);assert.deepEqual(groups.map(item=>item.conversations.map(row=>row.id)),[['a'],['b']]);
 const render=props=>renderToStaticMarkup(React.createElement(ContactsSidebar,{characters,conversations,activeCharacter:'yukino',activeConversation:'a',...props}));
 const html=render({});assert.match(html,/雪乃/);assert.match(html,/爱丽丝/);assert.match(html,/校内散步/);assert.doesNotMatch(html,/海边旅行/);assert.match(html,/aria-expanded="true"/);
 const search=render({query:'海边'});assert.match(search,/爱丽丝/);assert.match(search,/海边旅行/);assert.doesNotMatch(search,/校内散步/);
 const collapsed=render({collapsed:true});assert.match(collapsed,/雪乃/);assert.match(collapsed,/爱丽丝/);assert.doesNotMatch(collapsed,/校内散步/);
});
test('opening a conversation switches to its owner and never crosses character histories',async()=>{
 const {normalizeCharacters,selectCharacterConversation}=await import('../src/companion/characters.mjs');
 const state=normalizeCharacters({characters:[{id:'alice',name:'爱丽丝',persona:'她的设定'}],conversations:[{id:'a',characterId:'yukino',messages:[]},{id:'b',characterId:'alice',messages:[]}],activeCharacter:'yukino'});
 const next=selectCharacterConversation(state,'alice','b');assert.equal(next.activeCharacter,'alice');assert.equal(next.activeConversation,'b');assert.equal(next.persona,'她的设定');
 assert.equal(selectCharacterConversation(state,'alice','a'),state);assert.equal(selectCharacterConversation(state,'missing','a'),state);
});
test('contacts use the selected local outfit preview for each character and reject remote thumbnails',async t=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{ContactAvatar}=await component(t);
 const models=[{id:'school',thumbnail:'./characters/thumbnails/yukino-07.png'},{id:'dress',thumbnail:'./characters/thumbnails/yukino-05.png'},{id:'external',thumbnail:'https://example.test/track.png'}];
 const render=modelId=>renderToStaticMarkup(React.createElement(ContactAvatar,{character:{id:'yukino',modelId},models}));
 assert.match(render('school'),/yukino-07\.png/);assert.match(render('dress'),/yukino-05\.png/);assert.doesNotMatch(render('external'),/example\.test/);assert.doesNotMatch(render('missing'),/<img/);
});
