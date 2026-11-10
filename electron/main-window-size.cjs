'use strict';

// Electron display work areas and BrowserWindow dimensions are both in DIP.
function mainWindowSize(workAreaSize) {
  // A 1920×1080 display at 150% scaling is only 1280×720 DIP; after the
  // taskbar its quarter-screen snap zone can be about 640×340 DIP.
  const minWidth=Math.min(480,workAreaSize.width);
  const minHeight=Math.min(300,workAreaSize.height);
  return {
    width:Math.min(1440,Math.max(minWidth,workAreaSize.width-32)),
    height:Math.min(940,Math.max(minHeight,workAreaSize.height-32)),
    minWidth,
    minHeight
  };
}

module.exports={mainWindowSize};
