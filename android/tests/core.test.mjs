import { test } from "node:test";
import assert from "node:assert/strict";
import { joinEndpoint, validateBase, providerById, normalizeBase } from "../src/api/providers.js";
import { buildSystemPrompt, parseBilingual, historyToMessages, BILINGUAL_FORMAT } from "../src/api/chat.js";
import { emptyState, normalizeState, serviceFor, serviceLabel } from "../src/storage.js";
import { detectFormat, resolveModelUrl, defaultManifest, modelExists, loadManifest, listOutfits, resolveOutfit, resolveOutfitDirectory, DEFAULT_OUTFIT_ID, OUTFIT_LABELS } from "../src/model/characterModelConfig.js";

test("joinEndpoint avoids double /v1", () => {
  assert.equal(joinEndpoint("https://api.openai.com/v1", "/v1/chat/completions"), "https://api.openai.com/v1/chat/completions");
  assert.equal(joinEndpoint("https://api.deepseek.com", "/v1/chat/completions"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(joinEndpoint("https://open.bigmodel.cn/api/paas/v4", "/v1/chat/completions"), "https://open.bigmodel.cn/api/paas/v4/chat/completions");
});

test("validateBase rejects keys in the URL", () => {
  assert.equal(validateBase("https://api.deepseek.com"), "");
  assert.match(validateBase("https://user:pass@api.deepseek.com"), /密钥/);
  assert.match(validateBase("http://example.com"), /https/);
  assert.equal(validateBase("http://127.0.0.1:8080/v1"), "");
});

test("parseBilingual splits on a dashed rule", () => {
  const parsed = parseBilingual("随你。\n---\n好きにすればいいわ。");
  assert.equal(parsed.zh, "随你。");
  assert.equal(parsed.ja, "好きにすればいいわ。");
  assert.equal(parseBilingual("只有中文").ja, "");
});

test("system prompt adds bilingual format and memory only when requested", () => {
  const text = buildSystemPrompt({ personaText: "你是雪乃。", memory: "我喜欢红茶。", useMemory: true, bilingual: true });
  assert.match(text, /你是雪乃/);
  assert.match(text, /红茶/);
  assert.match(text, /输出格式/);
  const off = buildSystemPrompt({ personaText: "你是雪乃。", memory: "秘密", useMemory: false, bilingual: false });
  assert.doesNotMatch(off, /秘密/);
  assert.doesNotMatch(off, /输出格式/);
  assert.ok(BILINGUAL_FORMAT);
});

test("historyToMessages keeps a short window and uses Chinese for assistant turns", () => {
  const msgs = historyToMessages([
    { role: "user", content: "你好" },
    { role: "assistant", contentZh: "嗯。", contentJa: "ええ。" },
    { role: "system", content: "ignore" }
  ]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].content, "嗯。");
});

test("state normalization drops dangling routes and keeps Yukino", () => {
  const state = normalizeState({
    services: [{ id: "s1", providerId: "deepseek", name: "DeepSeek", base: "https://api.deepseek.com", key: "sk-test" }],
    routes: { chat: "missing", translation: "s1" },
    characters: [{ id: "other", name: "自定义" }],
    settings: { scene: "sakura" }
  });
  assert.equal(state.routes.chat, "");
  assert.equal(state.routes.translation, "s1");
  assert.ok(state.characters.some((item) => item.id === "yukino"));
  assert.equal(state.settings.scene, "sakura");
  assert.equal(serviceFor(state, "translation")?.name, "DeepSeek");
  assert.equal(serviceLabel(serviceFor(state, "chat")), "未配置");
  assert.ok(emptyState().characters[0].builtin);
});

test("model manifest helpers isolate the swap path", () => {
  assert.equal(resolveModelUrl({ file: "yukino.vrm" }), "./models/yukino.vrm");
  assert.equal(detectFormat({ file: "hero.vrm", format: "auto" }), "vrm");
  assert.equal(detectFormat({ file: "hero.glb", format: "auto" }), "glb");
  assert.equal(defaultManifest.file, "yukino.glb");
});

test("modelExists uses HEAD then GET", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push(init.method);
    if (init.method === "HEAD") return { ok: false, status: 405 };
    return { ok: true, status: 200 };
  };
  assert.equal(await modelExists("./models/yukino.glb", fake), true);
  assert.deepEqual(calls, ["HEAD", "GET"]);
  assert.equal(await modelExists("", fake), false);
});

test("loadManifest falls back when the file is missing", async () => {
  const manifest = await loadManifest("./missing.json", async () => ({ ok: false, status: 404 }));
  assert.equal(manifest.file, "yukino.glb");
  assert.equal(manifest.missing, true);
});

test("provider catalog includes the designed services", () => {
  assert.equal(providerById("aliyun").base.includes("dashscope"), true);
  assert.equal(normalizeBase("https://api.deepseek.com/"), "https://api.deepseek.com");
});

test("outfit catalog helpers resolve the six bundled VRMs", async () => {
  const manifest = await loadManifest("/workspace/yukino-android/public/models/character-model.json", async (url) => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = url.startsWith("/") ? url : fileURLToPath(new URL(url, import.meta.url));
    try {
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, "utf8")) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });
  const outfits = listOutfits(manifest);
  assert.equal(outfits.length, 6);
  assert.equal(manifest.defaultOutfit, DEFAULT_OUTFIT_ID);
  assert.equal(resolveOutfit(manifest, "black-qipao").label, OUTFIT_LABELS["black-qipao"]);
  assert.equal(resolveOutfit(manifest, "missing").id, "summer-uniform");
  assert.equal(resolveOutfitDirectory(manifest), "./models/local-yukino-outfits/");
  assert.ok(outfits.every((item) => item.file.endsWith(".vrm") && item.actions.endsWith(".actions.json") && item.actionPack.sha256));
  assert.deepEqual(outfits.map((item) => item.id), ["kimono", "summer-uniform", "swimsuit", "black-qipao", "twin-tail", "beret"]);
  assert.ok(!outfits.some((item) => item.id === "winter-uniform"));
});
