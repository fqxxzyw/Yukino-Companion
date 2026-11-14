import { launch } from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const base = process.argv[2] || "http://127.0.0.1:4173/";
const outDir = process.argv[3] || "/workspace/yukino-android";
const outfits = (process.argv[4] || "summer-uniform,black-qipao").split(",").map((s) => s.trim()).filter(Boolean);
const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome";

await mkdir(outDir, { recursive: true });

const browser = await launch({
  executablePath: chrome,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--window-size=390,844",
    "--hide-scrollbars"
  ]
});

const results = [];
try {
  for (const outfit of outfits) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    page.on("console", (msg) => console.log(`[${outfit} console.${msg.type()}]`, msg.text()));
    page.on("pageerror", (err) => console.log(`[${outfit} pageerror]`, err.message));
    const url = new URL(base);
    url.searchParams.set("outfit", outfit);
    console.log("open", url.href);
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 120000 });
    const status = await page.waitForFunction(() => {
      const state = window.__yukinoViewport;
      return state && (state.status === "ready" || state.status === "error" || state.status === "placeholder");
    }, { timeout: 180000 }).then(async () => page.evaluate(() => window.__yukinoViewport)).catch(async () => page.evaluate(() => window.__yukinoViewport || { status: "timeout" }));
    // Let a couple of animation frames and idle motion settle.
    await new Promise((r) => setTimeout(r, 1800));
    const webgl = await page.evaluate(() => {
      const canvas = document.querySelector(".character-canvas canvas, .character-stage canvas");
      if (!canvas) return { ok: false, reason: "no-canvas", pixels: 0 };
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const pixels = canvas.width * canvas.height;
      // Sample a few center-right pixels from the visible canvas via a 2d copy if possible.
      return { ok: Boolean(gl), reason: gl ? "webgl" : "no-webgl", width: canvas.width, height: canvas.height, pixels };
    });
    const sample = await page.evaluate(() => {
      const canvas = document.querySelector(".character-canvas canvas, .character-stage canvas");
      if (!canvas) return { sampled: false };
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx = tmp.getContext("2d");
      ctx.drawImage(canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, tmp.width, tmp.height);
      let opaque = 0;
      let colorish = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a > 8) opaque++;
        if (a > 32 && (Math.abs(data[i] - data[i + 1]) > 6 || Math.abs(data[i] - data[i + 2]) > 6)) colorish++;
      }
      const total = data.length / 4;
      return { sampled: true, width: tmp.width, height: tmp.height, opaqueRatio: opaque / total, colorRatio: colorish / total };
    });
    const file = path.join(outDir, `companion-${outfit}.png`);
    await page.screenshot({ path: file, type: "png" });
    results.push({ outfit, file, status, webgl, sample });
    console.log("captured", JSON.stringify({ outfit, file, status, webgl, sample }));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("RESULT", JSON.stringify(results, null, 2));
if (results.some((item) => item.status?.status !== "ready" || !item.webgl?.ok || (item.sample?.sampled && item.sample.opaqueRatio < 0.02))) {
  process.exitCode = 2;
}
