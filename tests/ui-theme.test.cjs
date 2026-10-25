const test=require('node:test');
const assert=require('node:assert/strict');
test('custom colors preserve readable text and accent labels',async()=>{
 const {themeVariables,contrast}=await import('../src/ui/theme.mjs');
 for(const background of ['#f1f6fc','#111111','#777777','#ff0000','#00ff00','#0000ff','#ffffff','#00a0e0','#99a000'])
  for(const accent of ['#477fd1','#ffffff','#000000','#aabbcc','#ff0066']){
   const theme=themeVariables(accent,background);
   for(const surface of ['--surface','--surface-soft'])
    for(const ink of ['--text','--secondary','--tertiary','--accent-text'])
     assert.ok(contrast(theme[ink],theme[surface])>=4.5,`${ink} against ${surface} for ${background}/${accent}`);
   assert.ok(contrast(theme['--accent-text'],theme['--on-accent'])>=4.5,`button label for ${accent}`);
  }
});
