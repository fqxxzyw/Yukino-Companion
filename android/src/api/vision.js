import { completeChat } from "./chat.js";

export async function describeImage({ service, dataUrl, prompt }) {
  if (!service?.base || !service?.key) throw new Error("请先配置视觉服务和密钥。");
  if (!dataUrl) throw new Error("请先选择一张图片。");
  const question = prompt || "请用中文说明这张图片中的内容。";
  const text = await completeChat({
    service,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]
  });
  return text;
}
