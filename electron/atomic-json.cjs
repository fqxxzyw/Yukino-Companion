'use strict';

const path = require('node:path');
const {randomUUID} = require('node:crypto');

// Windows may temporarily deny replacement while another process reads a file.
// Use a private sibling and retry only transient rename failures; the existing
// data is never deleted or truncated. A failed sibling is left for recovery.
async function writeAtomicJson(fs, destination, encoded, options = {}) {
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const delays = options.delays || [30, 70, 150, 300, 600, 1000];
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), {recursive:true});
  await fs.writeFile(temporary, encoded, {encoding:'utf8', flag:'wx'});
  for (let attempt = 0;; attempt++) {
    try {
      await fs.rename(temporary, destination);
      return;
    } catch (error) {
      if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt >= delays.length) throw error;
      await pause(delays[attempt]);
    }
  }
}

module.exports = {writeAtomicJson};
