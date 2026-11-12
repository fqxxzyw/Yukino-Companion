// A captured board is already visible in the scene. Leave its synthetic image
// receipt in regular chat, where the original drawing remains available.
export const BLACKBOARD_RECEIPT_TEXT='这是我刚才在教室黑板上写画的内容，请结合我们的对话看看。';
const isBoardReceipt=message=>message.role==='user'&&Boolean(message.image)&&message.content===BLACKBOARD_RECEIPT_TEXT;

export function selectSceneMessages(messages, sceneActive) {
 return sceneActive ? messages.filter(message => !isBoardReceipt(message)) : messages;
}
