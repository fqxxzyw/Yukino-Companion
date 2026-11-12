// A classroom reply can carry board text as data, never executable code.
const {readFileSync} = require('node:fs');
const path = require('node:path');

const BLACKBOARD_TEXT_LIMIT = 300;
const BLACKBOARD_TITLE_LIMIT = 32;
const BLACKBOARD_ELEMENT_LIMIT = 32;
const BLACKBOARD_POINT_LIMIT = 64;
const BLACKBOARD_TOTAL_POINTS_LIMIT = 512;
const BLACKBOARD_COLORS = new Set(['white','pink','yellow','blue','green']);
const BLACKBOARD_TITLE_STYLES = new Set(['brush','outline','ribbon','block']);
const BLACKBOARD_SHAPES = new Set(['cake','balloon','heart','star','flower']);
const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const normalized = value => between(value, 0, 1);
const BLACKBOARD_SKILL = readFileSync(path.join(__dirname, 'skills', 'classroom-blackboard', 'SKILL.md'), 'utf8')
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  .trim();

const CHINESE_BOARD = '(?:黑板|白板)';
const BOARD_MODIFIER = '(?:(?:教室(?:里)?的?|这块|那块|当前的?)\\s*)*';
const BOARD_LOCATION = `(?:[在再到往于用]\\s*${BOARD_MODIFIER}${CHINESE_BOARD}(?:上(?:面)?)?|${CHINESE_BOARD}上(?:面)?)`;
const BOARD_ACTION = '(?:写|画|绘制|抄|贴|排版|重写|重画|设计|添加|修改|展示|讲解|解释|放|补)';
const BOARD_ACTION_MODIFIER = '(?:(?:请|帮我|给我|能不能|能|可以|再|重新|试着|用粉笔|顺便|来|\\s))*';
const CHINESE_BOARD_REQUEST = new RegExp([
  `${BOARD_LOCATION}${BOARD_ACTION_MODIFIER}(?:把.{1,30}?)?${BOARD_ACTION}(?!了|着|过|的|什么|画的)`,
  `${BOARD_ACTION}.{0,40}?(?:[到在往]\\s*${BOARD_MODIFIER}${CHINESE_BOARD}(?:上(?:面)?)?|${CHINESE_BOARD}上(?:面)?)(?:[吧吗呀啊呢]|给我看|让我看|$)`,
  `(?:画|绘制|设计|制作|做|写|排版|生成|来个|弄个).{0,16}?黑板报(?:[吧吗呀啊呢]|$)`,
  `黑板报(?:做|画|设计|制作|写)(?:一|个|张|份|点)`,
  `(?:用|调用|启动)(?:教室)?黑板(?:报|绘画)?技能`,
  `(?:改|修改|更新|重画|重写)(?:一下)?${CHINESE_BOARD}上(?:的)?(?:标题|内容|画|字|图|板书)`,
  `(?:^|请|帮我|给我|可以|能不能)\\s*板书(?:一下|出|下来|这些|这|$)`,
  `(?:列出|写出|制作)(?:这份|一份)?板书(?:[吧吗呀啊呢]|$)`,
].join('|'));
const ENGLISH_BOARD = '(?:(?:the|this|that|our|your|my|a)\\s+)?(?:classroom\\s+)?(?:blackboard|chalkboard|whiteboard)';
const ENGLISH_ACTION = '(?:write|draw|sketch|paint|copy|add|rewrite|redraw|put|place|post|illustrate)';
const ENGLISH_BOARD_REQUEST = new RegExp(`\\b(?:${ENGLISH_ACTION}\\b.{0,100}?\\b(?:on(?:to)?|to)\\s+${ENGLISH_BOARD}|use\\s+${ENGLISH_BOARD}\\s+to\\s+(?:${ENGLISH_ACTION}|explain|show))\\b`, 'i');
const JAPANESE_BOARD_REQUEST = /(?:黒板|ホワイトボード)(?:に|へ|の上に).{0,40}?(?:(?:書|描|か)いて(?!ある|あった|あります|ありました|あれば|いた|も?(?:いい|よい|よろしい|大丈夫))|書き込んで|書き直して|書きなさい|描きなさい|貼って|載せて|加えて)|板書(?:して|しなさい|を(?:書いて|作って))/;

// Gate the skill on an explicit placement or board-art request in this turn.
// Quoted examples, references to existing writing, and refusals do not count.
function requestsBlackboardWriting(text) {
  if (typeof text !== 'string') return false;
  const clauses = text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g, ' ').split(/[，,。！？!?；;\n]+/);
  return clauses.some(clause => {
    const request = clause.trim();
    if (/(?:不要(?!忘)|别(?!忘)|不必|不用|不许|不准|禁止).{0,40}(?:写|画|抄|贴|黑板|白板|板书)/.test(request)) return false;
    if (/^(?:请|麻烦|帮我|你能|可以|能否|\s)*(?:看看|看一下|读一下|读出|阅读|解释|描述|总结|概括|翻译|识别|转录|复述)/.test(request)) return false;
    if (/^(?:这是|那是|为什么|为何|怎么|如何|怎样|我(?:刚才|之前|能|可以|会|在|(?:想|要)(?!请|让|你|您)))/.test(request)) return false;
    if (/\b(?:do not|don't|never|avoid|without)\b.{0,65}\b(?:write|draw|use|blackboard|chalkboard|whiteboard)\b/i.test(request)) return false;
    if (/^(?:(?:please|(?:can|could|would) you)\s+)*(?:read|explain|describe|translate|transcribe|summarize|how|why|what)\b|\b(?:what(?:ever)?|text|writing)\s+(?:is|was|that is)\s+on\b/i.test(request)) return false;
    if (/^(?:(?:can|could|should|may|do)\s+(?:i|we)\b|(?:i|we)\s+(?:want|would like|need)\s+to\b|(?:i|we)\s+(?:will|can|could|might|should)\b)/i.test(request)) return false;
    if (/(?:書|描|か)(?:かない|いては(?:いけない|だめ)|くな)|(?:黒板|ホワイトボード)を使わない/.test(request)) return false;
    return CHINESE_BOARD_REQUEST.test(request) || ENGLISH_BOARD_REQUEST.test(request) || JAPANESE_BOARD_REQUEST.test(request);
  });
}

// Poster or lettering requests call for visual artwork. Keep ordinary
// questions about artwork out of this path.
function requestsBlackboardPoster(text) {
  if (typeof text !== 'string') return false;
  const subject='(?:海报|黑板报|装饰画|插画|贺卡|彩绘|艺术字)';
  const verb='(?:画|绘制|设计|制作|做|来|要|弄|加|配|写|排)';
  return new RegExp(`${verb}[^。！？!?\\n]{0,40}${subject}|${subject}[^。！？!?\\n]{0,40}(?:画|绘制|设计|制作|加|配)`).test(text);
}

function blackboardResponseStatus(userText, blackboard) {
  if (!requestsBlackboardWriting(userText)) return undefined;
  const poster=requestsBlackboardPoster(userText);
  if (!blackboard) return 'missing';
  if (poster && !blackboard.title && !blackboard.elements?.length) return 'missing_art';
  return undefined;
}

function classroomBoardActive(state) {
  const presentation = state?.presentation;
  if (!presentation || presentation.scene !== 'classroom' || presentation.spread !== true || presentation.sceneEnabled === false) return false;
  const wallpaper = presentation.wallpaper;
  const hasWallpaper = wallpaper?.enabled === true && Array.isArray(wallpaper.items) && wallpaper.items.some(item => typeof item?.id === 'string' && /^[a-f0-9]{64}$/.test(item.id));
  return !hasWallpaper;
}

function blackboardInstruction({bilingual = false} = {}) {
  const envelope = bilingual
    ? '{"zh":"中文对话","ja":"自然日语对话","blackboard":null}'
    : '{"zh":"中文对话","blackboard":null}';
  return BLACKBOARD_SKILL
    .replace('{{ENVELOPE}}', envelope)
    .replace('{{DIALOGUE}}', bilingual ? 'zh、ja 是语义对应的对话，ja 使用自然日语。' : 'zh 是自然的中文对话。')
    .replace('{{TITLE_LIMIT}}', BLACKBOARD_TITLE_LIMIT)
    .replace('{{TEXT_LIMIT}}', BLACKBOARD_TEXT_LIMIT)
    .replace('{{ELEMENT_LIMIT}}', BLACKBOARD_ELEMENT_LIMIT)
    .replace('{{POINT_LIMIT}}', BLACKBOARD_POINT_LIMIT)
    .replace('{{TOTAL_POINTS_LIMIT}}', BLACKBOARD_TOTAL_POINTS_LIMIT);
}

function parseTitle(value) {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const {text, x, y, size, style, color, rotation, spacing, accent, letters} = value;
  if (typeof text !== 'string' || /[\u0000-\u001f\u007f\u2028\u2029]/.test(text)) return null;
  const trimmedText = text.trim();
  const characterCount = Array.from(trimmedText).length;
  if (!characterCount || characterCount > BLACKBOARD_TITLE_LIMIT) return null;
  if (!normalized(x) || !normalized(y) || !between(size, .08, .42)) return null;
  if (!BLACKBOARD_TITLE_STYLES.has(style) || !BLACKBOARD_COLORS.has(color)) return null;
  if (rotation !== undefined && !between(rotation, -16, 16)) return null;
  if (spacing !== undefined && !between(spacing, 0, .35)) return null;
  if (accent !== undefined && !BLACKBOARD_COLORS.has(accent)) return null;

  const title = {text: trimmedText, x, y, size, style, color};
  if (rotation !== undefined) title.rotation = rotation;
  if (spacing !== undefined) title.spacing = spacing;
  if (accent !== undefined) title.accent = accent;
  if (letters === undefined) return title;
  if (!Array.isArray(letters) || letters.length !== characterCount) return null;

  title.letters = [];
  for (const letter of letters) {
    if (!letter || typeof letter !== 'object' || Array.isArray(letter)) return null;
    const {dy, scale, rotation, color} = letter;
    if (dy !== undefined && !between(dy, -.2, .2)) return null;
    if (scale !== undefined && !between(scale, .75, 1.25)) return null;
    if (rotation !== undefined && !between(rotation, -20, 20)) return null;
    if (color !== undefined && !BLACKBOARD_COLORS.has(color)) return null;

    const appearance = {};
    if (dy !== undefined) appearance.dy = dy;
    if (scale !== undefined) appearance.scale = scale;
    if (rotation !== undefined) appearance.rotation = rotation;
    if (color !== undefined) appearance.color = color;
    title.letters.push(appearance);
  }
  return title;
}

function parseElements(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > BLACKBOARD_ELEMENT_LIMIT) return null;
  const result = [];
  let totalPoints = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !BLACKBOARD_COLORS.has(item.color)) return null;
    if (BLACKBOARD_SHAPES.has(item.type)) {
      if (!normalized(item.x) || !normalized(item.y) || typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size < .05 || item.size > .38) return null;
      result.push({type:item.type,x:item.x,y:item.y,size:item.size,color:item.color});
    } else if (item.type === 'path') {
      if (!Array.isArray(item.points) || item.points.length < 2 || item.points.length > BLACKBOARD_POINT_LIMIT) return null;
      totalPoints += item.points.length;
      if (totalPoints > BLACKBOARD_TOTAL_POINTS_LIMIT || item.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(normalized))) return null;
      result.push({type:'path',color:item.color,points:item.points.map(point=>[point[0],point[1]])});
    } else return null;
  }
  return result;
}

function readBlackboardResponse(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/<(think|thinking|reasoning|analysis)>[\s\S]*?<\/\1>/gi, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  try { value = JSON.parse(cleaned); } catch { return null; }
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const field = value.blackboard;
  // Some providers flatten the requested object to a string. It is still an
  // explicit structured field, so accept it under the same strict bounds.
  const object = field && typeof field === 'object' && !Array.isArray(field) ? field : null;
  const text = typeof field === 'string' ? field : object ? (object.text === undefined ? '' : object.text) : null;
  if (typeof text !== 'string' || Array.from(text).length > BLACKBOARD_TEXT_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  const elements=parseElements(object?.elements);
  const title=parseTitle(object?.title);
  if (!elements || title===null || (!text.trim() && !elements.length && !title)) return null;
  return title ? {text:text.trim(),elements,title} : {text:text.trim(),elements};
}

module.exports = {BLACKBOARD_TEXT_LIMIT, BLACKBOARD_ELEMENT_LIMIT, BLACKBOARD_POINT_LIMIT, BLACKBOARD_TOTAL_POINTS_LIMIT, classroomBoardActive, blackboardInstruction, readBlackboardResponse, requestsBlackboardWriting, requestsBlackboardPoster, blackboardResponseStatus};
