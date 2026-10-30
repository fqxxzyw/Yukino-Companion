import React from 'react';

// The filter displaces the browser's actual backdrop, not a screenshot or a
// painted approximation of the scene. It is clipped to the glass rim in CSS.
// This operates only inside the application window; it does not capture the desktop.
export default function GlassFilters(){
 return <svg aria-hidden="true" width="0" height="0" className="glass-filter-definitions">
  <defs>
   <filter id="yukino-glass-refraction" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="2" seed="5" result="lens"/>
    <feDisplacementMap in="SourceGraphic" in2="lens" scale="7" xChannelSelector="R" yChannelSelector="G"/>
   </filter>
  </defs>
 </svg>;
}
