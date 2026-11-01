'use strict';

// Electron display work areas and BrowserWindow dimensions are both in DIP.
function mainWindowSize(workAreaSize) {
  const minWidth=Math.min(760,workAreaSize.width);
  const minHeight=Math.min(580,workAreaSize.height);
  return {
    width:Math.min(1440,Math.max(minWidth,workAreaSize.width-32)),
    height:Math.min(940,Math.max(minHeight,workAreaSize.height-32)),
    minWidth,
    minHeight
  };
}

module.exports={mainWindowSize};
