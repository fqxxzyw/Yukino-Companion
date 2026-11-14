import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareViewer(source, destination) {
  const inside = (parent, child) => {
    const subpath = relative(resolve(parent), resolve(child));
    return !subpath || (!isAbsolute(subpath) && subpath !== '..' && !subpath.startsWith('..' + sep));
  };
  if (inside(source, destination) || inside(destination, source)) throw new Error('Viewer source and destination must be separate directories');
  const runtime = await readFile(join(source, 'runtime/renderer.js'), 'utf8');
  const entry = '    async frame(values) {';
  if (!runtime.includes(entry)) throw new Error('Unexpected Cubism viewer API');
  const patched = runtime.replace(entry, `    drawPose(values) {
      draw(values);
    },
    resetPose() {
      const reset = document.querySelector("#panel button");
      if (reset) reset.click();
      else draw();
    },
    hitMask() {
      const { width, height } = canvas;
      const gl = canvas.getContext("webgl2");
      const pixels = new Uint8Array(width * height * 4);
      const mask = new Uint8Array(Math.ceil(width * height / 8));
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (pixels[((height - 1 - y) * width + x) * 4 + 3] < 24) continue;
        const index = y * width + x;
        mask[index >> 3] |= 1 << (index & 7);
      }
      return { width, height, mask };
    },
${entry}`);
  const html = await readFile(join(source, 'index.html'), 'utf8');
  await mkdir(destination, { recursive: true });
  await Promise.all([
    ...['model', 'runtime', 'parameters.json'].map(name =>
      cp(join(source, name), join(destination, name), { recursive: true })),
    cp(new URL('./viewer-bridge.js', import.meta.url), join(destination, 'viewer-bridge.js')),
  ]);
  await writeFile(join(destination, 'runtime/renderer.js'), patched);
  await writeFile(join(destination, 'index.html'), html.replace('</style>', `
    body:not(.debug) { height: 100vh; display: grid; place-items: center; }
    body:not(.debug) canvas { width: min(100vw, 74.642857vh); height: auto; }
  </style>`).replace('</body>', '<script defer src="viewer-bridge.js"></script>\n</body>'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , source, destination] = process.argv;
  if (!source || !destination || resolve(source) === resolve(destination)) {
    throw new Error('Usage: node prepare-viewer.mjs <existing dist/live2d> <candidate viewer directory>');
  }
  await prepareViewer(source, destination);
}
