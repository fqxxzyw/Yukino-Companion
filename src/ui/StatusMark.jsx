import React from 'react';
import {AlertTriangle, CheckCircle2, CircleDashed, Download, FileCheck2, LoaderCircle} from 'lucide-react';
import './status-mark.css';

// One small icon + short label. Colour never carries the state on its own:
// the label, tooltip and aria attributes stay readable for screen readers.
const KINDS = {
  pending: {icon: Download, label: '待下载'},
  downloading: {icon: LoaderCircle, label: '下载中', spin: true},
  checking: {icon: LoaderCircle, label: '检查中', spin: true},
  loading: {icon: LoaderCircle, label: '加载中', spin: true},
  installed: {icon: FileCheck2, label: '已安装'},
  ready: {icon: CheckCircle2, label: '可使用'},
  idle: {icon: CircleDashed, label: '未启用'},
  error: {icon: AlertTriangle, label: '需要处理'},
};

export function statusKind(value) {
  const state = typeof value === 'string' ? value : value?.code || value?.state || value?.status || value?.phase;
  if (['ready', 'valid', 'verified', 'passed', 'complete', 'available', 'configured'].includes(state)) return 'ready';
  if (['installed', 'found', 'present'].includes(state)) return 'installed';
  if (['checking', 'validating'].includes(state)) return 'checking';
  if (['loading', 'starting', 'synthesizing', 'translating'].includes(state)) return 'loading';
  if (['downloading', 'installing', 'extracting', 'merging', 'assembling'].includes(state)) return 'downloading';
  if (['missing', 'not-installed', 'error', 'failed', 'invalid', 'invalid_credentials', 'unsupported', 'unsupported_model', 'permission_denied', 'quota_exceeded', 'network_error'].includes(state)) return 'error';
  if (['pending', 'not-downloaded', 'waiting'].includes(state)) return 'pending';
  return 'idle';
}

export default function StatusMark({kind = 'idle', label, detail, className = ''}) {
  const spec = KINDS[kind] || KINDS.idle, Icon = spec.icon;
  const text = label || spec.label;
  return <span className={['status-mark', kind, className].filter(Boolean).join(' ')} title={detail || text}
    aria-label={detail ? `${text}：${detail}` : text} aria-busy={spec.spin || undefined}>
    <Icon size={13} className={spec.spin ? 'spin' : undefined} aria-hidden="true"/><span>{text}</span>
  </span>;
}
