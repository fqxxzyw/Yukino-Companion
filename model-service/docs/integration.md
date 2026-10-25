# 给桌面端 / 语音端的接入约定

先启动本服务，桌面端 API Base URL 填 `http://127.0.0.1:8765/v1`，模型名 `oregairu-small`。默认本地无密钥；设置环境变量 `YUKI_API_KEY` 后，客户端必须传 `Authorization: Bearer ...`。自定义客户端若强制要求非空密钥，无鉴权本地模式可填写任意占位文本。

`POST /v1/chat/completions` 示例：

```json
{
  "model": "oregairu-small",
  "messages": [{"role":"user","content":"雪乃的姐姐是谁？"}],
  "stream": true,
  "temperature": 0.2,
  "max_tokens": 256,
  "use_knowledge": true,
  "max_volume": 6.5
}
```

- 原作问答使用 `use_knowledge:true`（默认）；普通闲聊可显式传 `false`，否则无检索资料时会返回无法确认。桌面端负责模式选择。
- `messages` 支持一个开头 system 和 user/assistant 历史；最后必须为 user。只支持文本，不支持图片、工具调用或语音输入。
- SSE 使用 `data: JSON` 与最后 `[DONE]`。读取 `choices[0].delta.content` 逐块追加文字。第一个事件还包含 `sources`；这是提供给模型的检索候选，不能当成逐句事实核验。
- 响应头 `X-Request-ID` 是取消 ID。停止按钮调用 `DELETE /v1/requests/{id}` 并关闭读取；HTTP 连接断开也触发停止。
- 每个进程一次生成；忙时 HTTP 429 / Retry-After: 2。接口开始后出错，以 SSE `error` 事件报告；非流式出错返回 503。取消已结束请求返回 404。
- 对话输出可按中文句末标点交给 GPT-SoVITS；停止时桌面端还须清空自己的语音队列。声音推理代码独立维护。
- `GET /health` 返回 loaded、busy、device、cpu_fallback_used。status=ok 表示服务存活，loaded=false 表示模型尚未懒加载，并非已经可生成。
- `GET /v1/models`、`GET /v1/hardware`；`GET /v1/search?q=...&max_volume=...` 提供检索检查。
- `max_volume` 只限制检索的章节，**不能阻止基础模型或微调权重泄露后续剧情**。界面应称“检索卷数上限”，不能宣称严格防剧透。
- 超长上下文先丢弃最早的历史消息；保留系统提示和最后问题，仍过长则报错。单条输入 6,000 字符、总消息 20,000 字符、最多 30 条、请求体 128 KiB。
- 当前 completion 不统计精确 token usage，finish_reason 统一 stop；不要据此计费或判断是否碰到生成长度上限。

模型服务默认不开 CORS，应由 Electron 主进程请求，不直接向不受信任网页开放。本地监听保持 127.0.0.1。需要远程部署时配置至少 24 字符密钥、allowed_hosts，并由运维配置 HTTPS 反向代理；本服务本身不会自动配置 TLS。

模型与索引单独下载，不内嵌进 EXE；建议桌面端实现下载进度、SHA256 校验、安装目录选择和子进程退出清理。此次只添加独立模型服务，不改变现有 Electron、语音或人物模型代码。

可选 GGUF 代理限制：上游长时间无输出时，取消要等下一行或读取超时才完全释放生成槽，不能保证即时取消；默认 Transformers 后端的取消路径另有实测。

基础事实默认直接摘录匹配人物卡，不经过模型改写。SSE 第一个事件与非流式顶层均有 `answer_mode`：`source_excerpt` 为来源摘录，`model` 为模型生成，`no_evidence` 为无资料提示。界面应显示对应来源方式，不把摘录表现算成训练准确率。服务配置 `profile_answers:false` 关闭人物卡摘录；`use_knowledge:false` 的闲聊始终走模型。真实取消测试专门用无检索的长问题，以验证模型生成确实被取消。
