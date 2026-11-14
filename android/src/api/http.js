import { Capacitor, CapacitorHttp } from "@capacitor/core";

function headerMap(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value != null && value !== "") out[key] = String(value);
  }
  return out;
}

export async function apiRequest({ url, method = "POST", headers = {}, body, timeout = 60000, responseType = "json" }) {
  const requestHeaders = headerMap(headers);
  if (Capacitor.isNativePlatform()) {
    const options = {
      url,
      method,
      headers: requestHeaders,
      connectTimeout: timeout,
      readTimeout: timeout,
      responseType: responseType === "bytes" ? "arraybuffer" : responseType === "text" ? "text" : "json"
    };
    if (body !== undefined) options.data = body;
    const res = await CapacitorHttp.request(options);
    return { status: res.status, data: res.data, headers: res.headers || {} };
  }
  const init = { method, headers: requestHeaders };
  if (body !== undefined) {
    init.body = typeof body === "string" || body instanceof Blob || body instanceof FormData ? body : JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (responseType === "bytes") {
      const buffer = await res.arrayBuffer();
      return { status: res.status, data: buffer, headers: Object.fromEntries(res.headers) };
    }
    const text = await res.text();
    if (responseType === "text") return { status: res.status, data: text, headers: Object.fromEntries(res.headers) };
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: Object.fromEntries(res.headers) };
  } finally {
    clearTimeout(timer);
  }
}

export function authHeaders(apiKey, extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function apiErrorMessage(status, data) {
  const detail = typeof data === "string" ? data : data?.error?.message || data?.message || data?.error || "";
  if (status === 401 || status === 403) return "密钥无效或没有权限，请检查 API 密钥。";
  if (status === 404) return "接口地址或模型不存在，请检查服务配置。";
  if (status === 429) return "请求过于频繁或额度不足，请稍后再试。";
  if (status >= 500) return "服务暂时不可用，请稍后再试。";
  if (detail && !/sk-|Bearer |api[_-]?key/i.test(String(detail))) {
    return String(detail).slice(0, 180);
  }
  return status ? `请求失败（${status}）` : "网络请求失败，请检查网络和接口地址。";
}
