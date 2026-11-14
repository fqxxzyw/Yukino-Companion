import {conversationExpression} from './conversation-expression.mjs';

const replyMoods = [
  ['broken_heart', /^(?:我心碎了|这让我心碎|我的心都碎了|胸が張り裂け)|(?:我(?:真的|好|很)心痛|胸が痛む|my heart is broken)/iu],
  ['heart', /^(?:给你一个爱心|送你一颗心|ハートをあげる)|(?:我(?:也(?:很|好)?|真的|很|好)?喜欢你|我也爱你|あなたが(?:大好き|好き)|I (?:really )?(?:like|love) you\b)/iu],
  ['shy_talking', /(?:我(?:真的|有点|也有点)害羞|别这样夸我|你这么说我.{0,5}不好意思|照れるわ|恥ずかしいわ|you(?:'re| are) making me blush)/iu],
  ['flustered', /^(?:糟了|しまった)|(?:我(?:有点|一下子|真的)慌了|我.{0,5}手忙脚乱|焦っちゃった|I(?:'m| am) flustered)/iu],
  ['embarrassed', /^(?:好尴尬|有点尴尬|気まずい)|(?:我.{0,6}(?:好尴尬|很尴尬|觉得尴尬)|I(?:'m| am) embarrassed)/iu],
  ['angry', /^(?:我(?:有点|很|真的)?生气(?:了)?|怒ってる)|(?:这让我(?:很|真的)?生气|I(?:'m| am) angry)/iu],
  ['pout', /^(?:哼|真是的|もう)[，、,…。！!\s]/u],
  ['surprise', /^(?:我(?:真|完全)没想到|这也太意外了|びっくりした|I didn't expect that)/iu],
  ['confused', /^(?:我(?:有点|还是)?没弄明白|我(?:有点|还是)?不明白|我(?:有点|还是)?搞不懂|どういうこと)|(?:我有点困惑|I(?:'m| am) confused)/iu],
  ['happy', /^(?:好开心|太开心了|我(?:真|很|好|也很)开心|やった|I(?:'m| am) so happy)/iu],
];

export function animeReplyCue(text) {
  const reply = typeof text === 'string' ? text.trim().slice(0, 600) : '';
  if (!reply) return '';
  if (/^(?:呃|唔|うっ)[，、,…。!！\s]/u.test(reply) && /(?:慌|糟了|手忙脚乱|焦っ)/u.test(reply)) {
    return 'flustered';
  }
  for (const [id, pattern] of replyMoods) if (pattern.test(reply)) return id;
  const legacy = conversationExpression(reply);
  if (legacy === 'surprise') return 'surprise';
  if (legacy === 'warm') return 'happy';
  return '';
}
