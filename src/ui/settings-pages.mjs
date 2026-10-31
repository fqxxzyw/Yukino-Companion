// Route IDs remain stable; navigation shows purposes, not every technical page.
export const SETTINGS_PAGES = [
  {id:'general',label:'常规',icon:'settings',description:'本机资料与陪伴记录。',keywords:'状态 帮助 社区 名称 使用时长'},
  {id:'appearance',label:'外观',icon:'palette',description:'调整颜色、背景和动态效果。',keywords:'壁纸 透明度 亮度 减少动态 主题'},
  {id:'characters',label:'角色管理',tabLabel:'管理与新建',icon:'user',description:'管理现有角色，或用名字和角色设定新建一个角色。',keywords:'人物 名称 新建 创建 提示词 性格'},
  {id:'conversation',label:'聊天与陪伴',icon:'chat',description:'选择聊天来源，调整主动聊天与日常陪伴。',keywords:'提醒 主动 勿扰'},
  {id:'api',label:'模型与 API',icon:'key',description:'添加服务配置，并分别分配聊天、翻译、语音识别与视觉任务。',keywords:'密钥 服务 模型 路由 API 管理'},
  {id:'translation',label:'双语与翻译',icon:'globe',description:'选择回复的显示语言与翻译方式。',keywords:'中文 日本語 双语 气泡'},
  {id:'memory',label:'个人记忆',icon:'brain',description:'记录希望角色记住的事，由你决定是否在对话中使用。',keywords:'导入 导出 清空 隐私'},
  {id:'speech-input',label:'语音输入',icon:'audio',description:'选择说话方式，检查麦克风与转写。',keywords:'ASR 麦克风 按住 自由 录音'},
  {id:'voice',label:'语音输出',tabLabel:'朗读与试听',icon:'audio',description:'调整角色朗读、播放音量与音色，不包含麦克风或语音识别。',keywords:'TTS 声音 音量 语速 播放 语音合成'},
  {id:'vision',label:'视觉',icon:'eye',description:'选择屏幕或摄像头，预览后再授权发送。',keywords:'屏幕 摄像头 截图 视觉感知'},
  {id:'desktop-companion',label:'人物与桌面',tabLabel:'显示与桌宠',icon:'user',description:'调整人物显示、陪伴窗口、桌宠气泡和日常互动。',keywords:'桌面陪伴 桌宠 模型 宽度 左侧 右侧 3D 置顶 穿透 大小 动作 预录 休息 专注'},
  {id:'advanced',label:'高级与资源',tabLabel:'管理入口',icon:'sliders',description:'管理本地资源，或在需要时检查技术配置。',keywords:'技术 路径 排查 设备 高级与诊断'},
  {id:'persona',parent:'characters',label:'角色性格',icon:'brain',description:'调整后续对话使用的角色设定，不改写已有聊天。',keywords:'人格 提示词 角色 规范 系统提示词'},
  {id:'voice-resources',parent:'voice',label:'音色与参考声音',icon:'database',description:'选择音色文件，以及与原文匹配的参考录音。',keywords:'GPT SoVITS 权重 下载 参考音频'},
  {id:'relationship',parent:'desktop-companion',label:'陪伴进度',icon:'user',description:'查看真实陪伴进度与签到；不会绕过服装解锁规则。',keywords:'好感 签到 使用日期 解锁'},
  {id:'local',parent:'advanced',label:'本地模型与资源',icon:'database',description:'查看本地文字模型、保存目录与资源进度。',keywords:'下载 安装 环境'},
  {id:'voice-advanced',parent:'advanced',label:'语音环境与诊断',icon:'sliders',description:'检查文件、推理设备与参数；打开页面不会自动加载模型。',keywords:'Python CUDA GPU CPU 路径 线程 超时'},
  {id:'model-import',parent:'advanced',label:'导入人物模型',icon:'user',description:'导入自己的模型文件，不改动内置草稿或解锁规则。',keywords:'GLB 自定义 骨骼 导入'},
  {id:'diagnostics',parent:'advanced',label:'能力检查',icon:'sliders',description:'分别查看文件准备和功能验证状态，未测试不会显示为已通过。',keywords:'状态 本地能力 云端服务 检查 排查'},
].map(page=>({...page,group:page.parent?'更多设置':'设置',hiddenInNavigation:Boolean(page.parent)}));

export const SETTINGS_ALIASES = {personal:'general',avatar:'characters',community:'general'};
export function settingsPage(value) {
  if (!value) return null;
  const id = SETTINGS_ALIASES[value] || value;
  return SETTINGS_PAGES.some(page => page.id === id) ? id : 'general';
}
export function settingsFamily(id) {
  const current=SETTINGS_PAGES.find(page=>page.id===id);
  if(!current)return [];
  const root=current.parent||current.id;
  return SETTINGS_PAGES.filter(page=>page.id===root||page.parent===root);
}
export function filterSettingsPages(query, pages = SETTINGS_PAGES) {
  const terms = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return pages.filter(page => terms.every(term => `${page.label} ${page.description} ${page.keywords}`.toLocaleLowerCase().includes(term)));
}
