'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mainWindowSize}=require('../electron/main-window-size.cjs');

test('default main window grows on large displays and fits small work areas',()=>{
  assert.deepEqual(mainWindowSize({width:1920,height:1040}),{width:1440,height:940,minWidth:480,minHeight:300});
  assert.deepEqual(mainWindowSize({width:1280,height:680}),{width:1248,height:648,minWidth:480,minHeight:300});
  assert.deepEqual(mainWindowSize({width:800,height:600}),{width:768,height:568,minWidth:480,minHeight:300});
  assert.deepEqual(mainWindowSize({width:640,height:480}),{width:608,height:448,minWidth:480,minHeight:300});
});
