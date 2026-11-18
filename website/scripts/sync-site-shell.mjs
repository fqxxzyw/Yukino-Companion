import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../public/',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const home=await read('index.html');
const parts={
  header:home.match(/<header class="site-header v2-header"[^>]*>[\s\S]*?<\/header>/)?.[0],
  footer:home.match(/<footer class="site-footer v2-footer"[^>]*>[\s\S]*?<\/footer>/)?.[0],
};
if(!parts.header||!parts.footer)throw Error('Official page shell not found');
const isCheck=process.argv.includes('--check');
const idCss=['/assets/style.css','/assets/apple.css','/assets/site-final.css','/assets/product.css?v=glass-title-10','/assets/site-shell.css?v=31'];
const shellHead='<!-- SITE_SHELL_HEAD_START -->\n  <link rel="icon" href="/assets/favicon-32.png" sizes="32x32">\n  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">\n'+idCss.map(path=>'  <link rel="stylesheet" href="'+path+'">').join('\n')+'\n<!-- SITE_SHELL_HEAD_END -->';
for(const page of ['community','help']){
 const file=page+'/index.html',original=await read(file);
 const header=parts.header.replace('href="/'+page+'/"','href="/'+page+'/" aria-current="page"');
 let value=original;
 for(const [name,markup] of Object.entries({header,footer:parts.footer})){
  const pattern=new RegExp('<!-- SITE_'+name.toUpperCase()+' -->|<'+name+'(?:\\s[^>]+)?>[\\s\\S]*?<\\/'+name+'>');
  if(!pattern.test(value)) throw Error('Missing '+name+' placeholder in '+file);
  value=value.replace(pattern,()=>markup);
 }
 value=value.replace(/<body(?:\s+class="([^"]*)")?([^>]*)>/,(_all,classes='',other='')=>'<body class="'+[...new Set([...classes.split(/\s+/).filter(Boolean),'v2-body','v2-subpage'])].join(' ')+'"'+other+'>');
 if(value.includes('<!-- SITE_SHELL_HEAD_START -->'))value=value.replace(/<!-- SITE_SHELL_HEAD_START -->[\s\S]*?<!-- SITE_SHELL_HEAD_END -->/,shellHead);
 else value=value.replace(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>/g,'').replace('</head>',shellHead+'\n</head>');
 if(!value.includes('/assets/site-shell.mjs?v=31'))value=value.replace('</body>','<script type="module" src="/assets/site-shell.mjs?v=31"></script>\n</body>');
 if(isCheck&&value!==original)throw Error('Run node scripts/sync-site-shell.mjs before building: '+file);
 if(!isCheck&&value!==original)await writeFile(new URL(file,root),value);
}
