/* Exercise the shipping Electron-owned JSONL worker, without any API endpoint. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { LocalChatService } = require('../../electron/local-chat.cjs');
const { buildPersonaPrompt, preparePersonaChat } = require('../../electron/persona.cjs');

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1]) throw Error('Expected --name value pairs');
    options[args[i].slice(2)] = args[i + 1];
  }
  for (const key of ['python', 'model', 'output']) if (!options[key]) throw Error(`Missing --${key}`);
  const root = path.resolve(__dirname, '../..');
  const output = path.resolve(options.output);
  try { await fs.access(output); throw Error('Evaluation output already exists; use a new path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const compact = buildPersonaPrompt({}, { base: 'http://127.0.0.1', model: 'oregairu-small' });
  const system = `${compact.content}\n\n请用简体中文自然回答。不要自行附加其他语言翻译。`;
  const development = [
    '你是谁？', '你和八幡是什么关系？', '你姐姐叫什么？',
    '你好，今天有点累，不想讲道理。', '你是真人还是应用里的AI？',
    '请分析原著中雪乃和八幡关系变化。',
  ].map((question, index) => ({ id: `development-${index + 1}`, split: 'development',
    messages: [{ role: 'system', content: system }, { role: 'user', content: question }] }));
  const heldout = options.prompts ? (await fs.readFile(options.prompts, 'utf8')).trim().split(/\r?\n/).map(JSON.parse).map(row => {
    let messages = row.messages.slice(1);
    if (messages.at(-1)?.role === 'assistant') messages = messages.slice(0, -1);
    return { id: `${row.family_id}-${row.variant_id}`, split: 'heldout',
      family: row.family_id, category: row.category,
      messages: [{ role: 'system', content: system }, ...messages] };
  }) : [];
  const regression = options.regression ? JSON.parse(await fs.readFile(options.regression, 'utf8')).rows
    .filter(row => ['development-2', 'development-5', 'development-6', 'daily_05-c', 'identity_01-a', 'natural_thanks-c'].includes(row.id))
    .map(row => ({ id: row.id, split: 'development-regression', sourceReport: options.regression,
      messages: [{ role: 'system', content: system }, ...row.messages.slice(1)] })) : null;
  const service = new LocalChatService({
    script: path.join(root, 'model-service/desktop_worker.py'),
    stateDir: path.join(path.dirname(output), '.desktop-evaluation-state'),
    modelDir: path.resolve(options.model), python: path.resolve(options.python),
  });
  service.configure({ device: 'auto', cpuThreads: 8, temperature: 0, maxNewTokens: 192 });
  const report = { completed: false, transport: 'owned JSONL subprocess; no HTTP/API',
    developmentWarning: 'Development questions overlap training; they are regression probes, not generalization accuracy.',
    heldoutWarning: 'Held-out scenario families have synthetic targets. Similar themes may remain across splits. No automated character-fidelity score.',
    humanAcceptance: false, rows: [] };
  async function save() { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  try {
    const start = Date.now();
    report.loaded = await service.load(); report.loadSeconds = (Date.now() - start) / 1000;
    if (regression) report.regressionWarning = 'These previously observed failures informed the prompt changes. This is development regression, not a fresh held-out evaluation.';
    if (options.recheck) report.regressionWarning = 'All these questions were inspected during prompt development. This entire rerun is development regression, not a fresh held-out evaluation.';
    for (const row of regression || [...development, ...heldout]) {
      const started = Date.now(); let chunk = '';
      const prepared = preparePersonaChat({}, { base: 'http://127.0.0.1', model: 'oregairu-small' }, row.messages);
      prepared.messages[0].content += '\n\n请用简体中文自然回答。不要自行附加其他语言翻译。';
      const reply = await service.generate(prepared.messages, { requestId: row.id, onChunk: text => { chunk += text; } });
      if (chunk !== reply.text) throw Error('Local chunk and final answer differ');
      report.rows.push({ ...row, ...(options.recheck ? { sourceSplit: row.split, split: 'development-recheck' } : {}), effectiveMessages: prepared.messages, answer: reply.text, seconds: (Date.now() - started) / 1000,
        finishReason: reply.finishReason, device: reply.device,
        metaLanguageFlag: /数字人|数字角色|在原著中|故事后期/.test(reply.text) });
      await save(); console.log(row.id, JSON.stringify(reply.text));
    }
    report.completed = true;
    report.responses = report.rows.length;
    report.heldoutResponses = regression || options.recheck ? 0 : heldout.length;
    await service.unload(); report.unload = await service.status();
    if (report.unload.ready) throw Error('Unloading did not release local generation');
    await save();
  } finally { service.dispose(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
