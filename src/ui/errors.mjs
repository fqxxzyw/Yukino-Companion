export function friendlyError(error, fallback = '操作没有完成，请重试。') {
  let message = typeof error === 'string' ? error : error?.message || '';
  message = message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '').replace(/^(?:Error:\s*)+/i, '').trim();
  if (!message) return fallback;
  if (/[\u3400-\u9fff]/.test(message)) return message;
  if (/abort|cancel/i.test(message)) return '操作已取消。';
  if (/timeout|timed out/i.test(message)) return '等待超时，请检查连接或重试。';
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(message)) return '暂时无法连接，请检查网络或服务地址。';
  if (/401|unauthorized|invalid.*key/i.test(message)) return '密钥验证未通过，请检查 API Key。';
  if (/out of memory|allocation|CUDA/i.test(message)) return '推理设备暂时不可用，可在设置中切换为 CPU 后重试。';
  return fallback;
}
export const voiceSetupNeeded = value => /未配置|先配置|尚未|未安装|找不到|不存在|缺少|参考音频|对应文本|运行环境|模型路径|加载语音模型/.test(String(value || ''));
