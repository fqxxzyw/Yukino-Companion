export const BLACKBOARD_RECEIPT_TEXT='这是我刚才在教室黑板上写画的内容，请结合我们的对话看看。';

export function latestSceneTurnStart(messages) {
 const lastIndex=messages.length-1;
 return messages.at(-1)?.role==='assistant'&&messages.at(-2)?.role==='user' ? lastIndex-1 : lastIndex;
}
