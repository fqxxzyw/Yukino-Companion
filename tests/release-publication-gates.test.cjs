'use strict';
// Public source tests require only automation that actually ships in this tree.
const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const {registerPublicationContract}=require('./helpers/publication-contract.cjs');
const base=yaml.load(fs.readFileSync(path.join(__dirname,'../.github/workflows/base-installer.yml'),'utf8'));
registerPublicationContract({'base-installer':base});
