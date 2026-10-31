import React from 'react';
import './preview.css';

export default function PreviewNotice({desktop}) {
  if (!import.meta.env.DEV) return null;
  return <div className="development-notice" role="note">
    <strong>{desktop ? 'Electron 开发模式' : '浏览器 UI 预览 · 无 Electron IPC'}</strong>
    <span>{desktop
      ? '开发数据与正式版隔离；模型和音频需独立验证，不会自动下载。'
      : '仅展示现有界面；聊天、模型、语音、屏幕与摄像头未验证，无模拟成功结果。'}</span>
  </div>;
}
