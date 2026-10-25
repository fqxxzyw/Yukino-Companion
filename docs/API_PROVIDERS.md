# API 服务商与模型选择

实现：`electron/providers.cjs`、`src/ui/ApiSettings.jsx`。官方文档核对日期：2026-10-25。

普通设置流程为「选择服务商 → 输入 API 密钥 → 获取模型 → 下拉选择 → 测试对话连接」。模型 ID 来自用户所配置服务的实时响应，不通过应用版本内置一份声称永久可用的列表。模型获取成功只说明列表请求成功，实际对话权限仍需测试。更换密钥后重新获取，不复用之前的验证状态。

## 支持范围

对话协议为 OpenAI Chat Completions。模型列表使用 HTTP GET，接受基础 API 地址或完整 `/chat/completions` 地址。本机服务允许 HTTP，远程服务要求 HTTPS。Anthropic 原生 Messages 协议未实现，不列为可直接使用的预设。

| 服务商 | 对话基础地址 | 获取模型 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `/models` |
| OpenAI | `https://api.openai.com/v1` | `/v1/models` |
| 通义千问 · 北京 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 同域名 `/api/v1/models`，使用原生分页格式 |
| 通义千问 · 新加坡 | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | 同域名 `/api/v1/models`，使用原生分页格式 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `/v1/models?sub_type=chat` |
| Kimi · 国内 | `https://api.moonshot.cn/v1` | `/v1/models` |
| Kimi · 国际 | `https://api.moonshot.ai/v1` | `/v1/models` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | 尝试同路径 `/models`；不保证厂商支持模型列表 |
| 本机兼容服务 | 默认 `http://127.0.0.1:1234/v1` | 同路径 `/models`；支持修改端口与地址 |
| 自定义兼容服务 | 用户配置 | 同路径 `/models` |

百炼的工作空间专属域名可以在高级设置替换；模型查询保持相同 origin。地域密钥不能混用。智谱预设使用普通按量接口，未把 Coding Plan 当作普通接口。

HTTP 401、403、402、429、5xx、非 JSON、错误结构、网络故障均显示错误，不悄悄替换为看似已验证的模型。404/405/501 单独标记「列表接口不支持，密钥尚未验证」；智谱此时可显示官方文档中的 GLM-5.3 / GLM-5.3-Flash，标注为未验证的文档预设，仍需实际对话测试。自定义模型 ID 保留在高级设置中。

过滤明确的嵌入、排序、纯图片/语音等非对话模型；未知新型号尽量保留为候选，不能仅凭名字保证接口兼容。最大处理 1,000 个模型、10 页、每次响应 2 MiB，超出分页上限明确提示截取。模型查询有 20 秒超时，不跟随重定向。

远程对话不固定 temperature，沿用服务商默认值，避免推理模型拒绝不支持的温度参数。本地雪乃性格对话保留原有采样设置。

## 密钥边界

- 已保存密钥只在 Electron 主进程中解密，渲染器只接收已保存配置 ID。
- 新输入密钥通过 IPC 交给主进程发请求；HTTP 200 且模型响应合法后可以加密保存。手动保存和连接测试允许不支持列表接口的服务继续使用，但不会宣称列表已验证。
- 主进程把密钥绑定至保存时的 API origin；切换地址不能将旧密钥发送给另一个站点。编辑地址清除尚未保存的新输入密钥。
- 错误消息不包含服务响应正文或网络库原始错误，防止它们回显密钥。凭据、查询参数、片段均不允许出现在 API 地址中。
- 查询不会向任意第三方获取模型目录，不需要申请或代管用户的服务商账户。

## 主进程接口

```js
providerCatalog();
discoverModels({profile: {providerId, base}, key, signal, fetcher});
// {status:'ready', verified:true, models:[{id,name}], endpoint, truncated, message}
// {status:'unsupported', verified:false, models:[], suggestions:[...], endpoint, message}
```

渲染器：`apiProviders()`、`apiModels({profileId,base,providerId,key?})`、`saveKey(id,key,base)`。有新密钥时只验证这一份；无新密钥时由主进程读取同 origin 的已保存密钥。列表结果不保存到用户配置或日志。

## 官方依据

- DeepSeek：[模型列表](https://api-docs.deepseek.com/api/list-models/)、[首次 API 调用](https://api-docs.deepseek.com/)。
- OpenAI：[List models](https://developers.openai.com/api/reference/resources/models/methods/list)。
- 阿里云：[地域基础地址](https://help.aliyun.com/en/model-studio/base-url)、[List models](https://www.alibabacloud.com/help/en/model-studio/list-models)、[OpenAI 兼容性](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)。
- 硅基流动：[List Models](https://docs.siliconflow.cn/docs/api/models-get)。
- Kimi：[国内模型列表](https://platform.kimi.com/docs/api/list-models)、[国际 API 概览](https://platform.moonshot.ai/docs/api)、[OpenAI 兼容性与温度约束](https://platform.moonshot.ai/docs/guide/migrating-from-openai-to-kimi)。
- 智谱：[快速开始与普通接口](https://docs.bigmodel.cn/cn/guide/start/quick-start)。

自动测试使用合成响应，不使用任何用户真实密钥，也不冒充已测试真实账户额度或网络可达性。
