'use strict';
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {path7za} = require('7zip-bin');

// The release archive, never a manifest supplied by the old installation,
// limits which paths the installer may replace or the uninstaller may delete.
const [archive, destination, mode='uninstall'] = process.argv.slice(2);
const listing = execFileSync(path7za, ['l','-slt','-ba','-sccUTF-8',archive], {encoding:'utf8',maxBuffer:64*1024**2});
const files = [], directories = new Set();
for (const record of listing.trim().split(/\r?\n\r?\n/)) {
  const name = /^Path = (.+)$/m.exec(record)?.[1]?.trimEnd().replaceAll('/', '\\');
  if (!name || /["$:\x00-\x1f*?]/.test(name) || name.split('\\').some(x=>!x || x==='.' || x==='..')) throw Error('Invalid installer member');
  const components = name.split('\\');
  if (/^Attributes = D/m.test(record)) directories.add(name);
  else {
    const size = Number(/^Size = (\d+)/m.exec(record)?.[1]);
    if (!Number.isSafeInteger(size) || size<0 || size>=2**31) throw Error('Invalid installer member size');
    files.push({name,size});
  }
  for (let i=1;i<components.length;i++) directories.add(components.slice(0,i).join('\\'));
}
if (!files.some(f=>f.name==='resources\\app.asar')) throw Error('Missing installed app in NSIS manifest');
const dirs = [...directories].sort((a,b)=>a.length-b.length);
const lines=[];
if (mode==='install') {
  for(const {name,size} of files)lines.push('!insertmacro verifyStagedFile "'+name+'" '+size);
  for(const dir of dirs)lines.push('!insertmacro prepareOwnedDir "'+dir+'"');
  for(const {name} of files)lines.push('Push "'+name+'"','Call replaceOwnedFile','IfErrors rollbackStage');
  lines.push('Goto stageCommitted','rollbackStage:','StrCpy $rollbackFailed 0');
  for(const {name} of files.slice().reverse())lines.push('Push "'+name+'"','Call restoreOwnedFile');
} else {
  for(const {name} of files)lines.push('Delete "$INSTDIR\\'+name+'"');
  for(const dir of dirs.reverse())lines.push('RMDir "$INSTDIR\\'+dir+'"');
}
fs.writeFileSync(destination, '\ufeff'+lines.join('\r\n')+'\r\n');
