import React, { useEffect, useMemo, useRef } from 'react';
import { Upload, Download, FolderOpen, X, CheckCircle2, AlertCircle, Clock3, ClipboardList } from 'lucide-react';
import { useTranslation } from '../i18n.js';
import Tiptop from './Tiptop.jsx';

const MAX_RENDER_UPLOAD_CARDS = 1000;

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function getStatusMeta(status, direction, t) {
  if (status === 'uploading') {
    return { label: direction === 'download' ? t('下载中') : t('上传中'), color: 'var(--accent)', bg: 'var(--accent-dim)', Icon: direction === 'download' ? Download : Upload };
  }
  if (status === 'completed') {
    return { label: t('已完成'), color: 'var(--success)', bg: 'var(--success-dim)', Icon: CheckCircle2 };
  }
  if (status === 'failed') {
    return { label: t('失败'), color: 'var(--danger)', bg: 'var(--danger-dim)', Icon: AlertCircle };
  }
  return { label: t('排队中'), color: 'var(--text-tertiary)', bg: 'var(--surface-sunken)', Icon: Clock3 };
}

function getChunkColor(status) {
  if (status === 'completed') return 'var(--success)';
  if (status === 'failed') return 'var(--danger)';
  if (status === 'retrying') return 'var(--warning)';
  if (status === 'uploading') return 'var(--accent)';
  if (status === 'reading') return 'color-mix(in srgb, var(--accent) 58%, var(--warning))';
  return 'var(--border)';
}

function getChunkLabel(chunk, t) {
  if (chunk.status === 'completed') return t('已完成');
  if (chunk.status === 'failed') return t('失败');
  if (chunk.status === 'retrying') return t('重试中');
  if (chunk.status === 'uploading') return t('上传中');
  if (chunk.status === 'reading') return t('读取中');
  return t('排队中');
}

function getUploadPhaseLabel(phase, direction, t) {
  if (phase === 'preparing') return t('准备中');
  if (phase === 'scanning') return t('扫描中');
  if (phase === 'compressing') return direction === 'download' ? t('远端压缩中') : t('压缩中');
  if (phase === 'uploading') return direction === 'download' ? t('下载压缩包') : t('上传压缩包');
  if (phase === 'uploading-file') return t('上传文件');
  if (phase === 'uploading-file-completed') return t('已完成');
  if (phase === 'downloading') return t('下载中');
  if (phase === 'verifying') return t('修复中');
  if (phase === 'extracting') return direction === 'download' ? t('本地解压中') : t('远端解压中');
  if (phase === 'cleanup-local' || phase === 'cleanup-remote') return t('清理中');
  if (phase === 'completed') return t('已完成');
  if (phase === 'failed') return t('失败');
  return t('排队中');
}

function formatCompressedPhaseBytes(item, t) {
  const bytesDone = Number(item.bytesUploaded) || 0;
  const bytesTotal = Number(item.bytesTotal) || 0;
  if (bytesTotal <= 0) {
    return t('当前阶段无字节指标');
  }
  return `${fmtSize(bytesDone)} / ${fmtSize(bytesTotal)}`;
}

function getCompressedPhaseDetail(item, t) {
  const direction = item.direction || 'upload';
  if (item.phase === 'scanning') return item.phaseDetail || t('正在扫描待压缩项目');
  if (item.phase === 'compressing') return item.phaseDetail || (direction === 'download' ? t('正在远端打包压缩包') : t('正在构建本机 tar.gz 压缩包'));
  if (item.phase === 'uploading') return item.phaseDetail || (direction === 'download' ? t('正在下载压缩包到本地') : t('正在上传压缩包到远端'));
  if (item.phase === 'uploading-file') return item.phaseDetail || '';
  if (item.phase === 'uploading-file-completed') return item.phaseDetail || t('已完成');
  if (item.phase === 'downloading') return item.phaseDetail || t('下载中');
  if (item.phase === 'verifying') return item.phaseDetail || t('正在自动修复远端目录和已有文件权限');
  if (item.phase === 'cleanup-local') return t('正在删除本机临时压缩包');
  if (item.phase === 'extracting') return direction === 'download' ? t('正在解压到本地目录') : t('正在远端解压压缩包');
  if (item.phase === 'cleanup-remote') return t('正在清理远端压缩包');
  if (item.phase === 'completed') return direction === 'download' ? t('下载传输已完成') : t('压缩传输已完成');
  if (item.phase === 'failed') return item.error || (direction === 'download' ? t('下载传输失败') : t('压缩传输失败'));
  return item.phaseDetail || '';
}

function buildCompressedPhaseChunks(item) {
  const bytesTotal = Math.max(0, Number(item.bytesTotal) || 0);
  if (bytesTotal <= 0) {
    return { chunks: [], chunkSizeBytes: 0, chunksDone: 0, chunksFailed: 0, chunksActive: 0 };
  }

  const chunkSizeBytes = Math.max(1, Number(item.chunkSizeBytes) || 256 * 1024);
  const bytesUploaded = Math.max(0, Number(item.bytesUploaded) || 0);
  const totalChunks = Math.max(1, Math.ceil(bytesTotal / chunkSizeBytes));
  const completedChunks = Math.min(totalChunks, Math.floor(bytesUploaded / chunkSizeBytes));
  const hasPartialChunk = bytesUploaded > completedChunks * chunkSizeBytes && completedChunks < totalChunks;
  const failedChunkIndex = item.status === 'failed'
    ? Math.min(totalChunks - 1, completedChunks)
    : -1;
  const activeChunkIndex = item.status === 'uploading' && hasPartialChunk ? completedChunks : -1;

  const chunks = Array.from({ length: totalChunks }, (_, index) => {
    if (index < completedChunks) {
      return { index, status: 'completed', attempt: 0, error: '' };
    }
    if (index === failedChunkIndex && item.status === 'failed') {
      return { index, status: 'failed', attempt: 0, error: item.error || '' };
    }
    if (index === activeChunkIndex) {
      return { index, status: 'uploading', attempt: 0, error: '' };
    }
    return { index, status: 'queued', attempt: 0, error: '' };
  });

  return {
    chunks,
    chunkSizeBytes,
    chunksDone: chunks.filter((chunk) => chunk.status === 'completed').length,
    chunksFailed: chunks.filter((chunk) => chunk.status === 'failed').length,
    chunksActive: chunks.filter((chunk) => chunk.status === 'uploading').length,
  };
}

function getTransferErrorSummary(message, t) {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return t('查看详情');
  }
  const firstLine = normalized.split(/\r?\n/)[0] || '';
  return firstLine.trim() || t('查看详情');
}

function AutoFollowChunkGrid({ chunks, titleBuilder }) {
  const containerRef = useRef(null);
  const shouldAutoFollowRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !shouldAutoFollowRef.current) {
      return undefined;
    }
    const rafId = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [chunks]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoFollowRef.current = distanceToBottom <= 12;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8px, 1fr))', gap: 3, maxHeight: 88, overflowY: 'auto' }}
    >
      {chunks.map((chunk) => (
        <Tiptop key={chunk.index} text={titleBuilder(chunk)} style={{ display: 'block' }}>
          <div
            style={{
              height: 8,
              minWidth: 8,
              borderRadius: 999,
              background: getChunkColor(chunk.status),
              opacity: chunk.status === 'queued' ? 0.42 : 1,
              boxShadow: chunk.status === 'uploading' || chunk.status === 'retrying' ? `0 0 8px ${getChunkColor(chunk.status)}` : 'none',
              transition: 'background 120ms ease, opacity 120ms ease, box-shadow 120ms ease',
            }}
          />
        </Tiptop>
      ))}
    </div>
  );
}

function isPriorityVisibleItem(item, isAbortable) {
  return Boolean(isAbortable?.(item));
}

function buildVisibleQueue(items, isAbortable) {
  if (items.length <= MAX_RENDER_UPLOAD_CARDS) {
    return { visibleItems: items, hiddenItems: [] };
  }

  const visibleLimit = MAX_RENDER_UPLOAD_CARDS - 1;
  const activeItems = items.filter((item) => isPriorityVisibleItem(item, isAbortable));
  const visibleIds = new Set();
  let visibleItems = [];

  if (activeItems.length >= visibleLimit) {
    visibleItems = activeItems.slice(-visibleLimit);
    visibleItems.forEach((item) => visibleIds.add(item.id));
  } else {
    visibleItems = [...activeItems];
    activeItems.forEach((item) => visibleIds.add(item.id));
    for (let index = items.length - 1; index >= 0 && visibleItems.length < visibleLimit; index -= 1) {
      const item = items[index];
      if (visibleIds.has(item.id)) continue;
      visibleItems.push(item);
      visibleIds.add(item.id);
    }
    visibleItems.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  return {
    visibleItems,
    hiddenItems: items.filter((item) => !visibleIds.has(item.id)),
  };
}

function renderActionButton(label, danger, onClick) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: '1px solid',
        borderColor: danger ? 'color-mix(in srgb, var(--danger) 40%, var(--border))' : 'var(--border)',
        background: danger ? 'color-mix(in srgb, var(--danger-dim) 72%, var(--surface-base))' : 'var(--surface-base)',
        color: danger ? 'var(--danger)' : 'var(--text-secondary)',
        borderRadius: 8,
        padding: '4px 8px',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

export default function FileUploadQueuePanel({
  items,
  onClose,
  isAbortable,
  onAbortItem,
  onAbortItems,
  onRemoveItems,
}) {
  const { t } = useTranslation();

  const handleOpenCompletedDownload = async (item) => {
    const localPath = String(item?.localPath || '').trim();
    if (!localPath) {
      return;
    }
    try {
      await window?.go?.main?.App?.OpenLocalPathInExplorer?.(localPath, item.mode !== 'download-file');
    } catch (err) {
      window.luminDialog?.alert?.(`${t('打开所在目录失败')}: ${err}`);
    }
  };

  const openTransferErrorDetails = async (item, explicitMessage = '') => {
    const message = String(explicitMessage || item?.error || '').trim();
    if (!message) {
      return;
    }
    const title = item?.direction === 'download' ? t('下载失败详情') : t('上传失败详情');
    if (window?.luminDialog?.alert) {
      await window.luminDialog.alert(message, title, { copyable: true });
      return;
    }
    window.alert(message);
  };

  const orderedItems = useMemo(
    () => [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [items],
  );
  const removableItems = useMemo(
    () => orderedItems.filter((item) => !isAbortable?.(item)),
    [orderedItems, isAbortable],
  );
  const removableIds = useMemo(
    () => removableItems.map((item) => item.id),
    [removableItems],
  );
  const { visibleItems, hiddenItems } = useMemo(
    () => buildVisibleQueue(orderedItems, isAbortable),
    [orderedItems, isAbortable],
  );
  const hiddenActiveItems = useMemo(
    () => hiddenItems.filter((item) => isAbortable?.(item)),
    [hiddenItems, isAbortable],
  );

  const hiddenRepresentative = hiddenActiveItems[hiddenActiveItems.length - 1] || hiddenItems[hiddenItems.length - 1] || null;
  const hiddenMeta = hiddenRepresentative ? getStatusMeta(hiddenActiveItems.length > 0 ? 'uploading' : hiddenRepresentative.status, hiddenRepresentative.direction || 'upload', t) : null;
  const hiddenPhaseLabel = hiddenRepresentative
    ? ((hiddenRepresentative.mode === 'compressed' || hiddenRepresentative.mode === 'download-compressed')
      ? getUploadPhaseLabel(hiddenRepresentative.phase, hiddenRepresentative.direction || 'upload', t)
      : hiddenMeta?.label || t('排队中'))
    : t('排队中');

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-raised)' }}>
      <div className="modal-header" style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)' }}>
        <div className="modal-title" style={{ fontSize: 14 }}>
          <ClipboardList size={14} />
          {t('传输队列')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {removableIds.length > 0 ? renderActionButton(t('清空'), false, () => onRemoveItems?.(removableIds)) : null}
          <Tiptop text={t('关闭')} placement="bottom">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={t('关闭')}>
              <X size={14} />
            </button>
          </Tiptop>
        </div>
      </div>
      <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-subtle)' }}>
        {t('当前会话中的所有路径传输任务都会显示在这里')}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visibleItems.length === 0 && hiddenItems.length === 0 ? (
          <div className="empty-state" style={{ padding: '48px 16px' }}>
            <div className="empty-state-icon"><ClipboardList size={40} strokeWidth={1.5} /></div>
            <div className="empty-state-text">{t('当前会话暂无传输任务')}</div>
          </div>
        ) : (
          <>
            {visibleItems.map((item) => {
              const direction = item.direction || 'upload';
              const meta = getStatusMeta(item.status, direction, t);
              const progress = item.status === 'completed'
                ? 100
                : Math.max(0, Math.min(100, Number.isFinite(item.progress) ? item.progress : 0));
              const Icon = meta.Icon;
              const chunks = Array.isArray(item.chunks) ? item.chunks : [];
              const chunksDone = item.chunksCompleted || chunks.filter((chunk) => chunk.status === 'completed').length;
              const chunksFailed = item.chunksFailed || chunks.filter((chunk) => chunk.status === 'failed').length;
              const chunksActive = chunks.filter((chunk) => chunk.status === 'reading' || chunk.status === 'uploading' || chunk.status === 'retrying').length;
              const isCompressed = item.mode === 'compressed' || item.mode === 'download-compressed';
              const phaseLabel = getUploadPhaseLabel(item.phase, direction, t);
              const phaseProgress = Math.max(0, Math.min(100, Number.isFinite(item.phaseProgress) ? item.phaseProgress : 0));
              const phaseDetail = getCompressedPhaseDetail(item, t);
              const compressedPhaseChunks = isCompressed ? buildCompressedPhaseChunks(item) : null;
              const statusLabel = isCompressed ? phaseLabel : meta.label;
              const abortable = isAbortable?.(item);
              const displayPath = direction === 'download' ? (item.localPath || item.remotePath) : item.remotePath;
              const showOpenCompletedDownload = direction === 'download' && item.status === 'completed' && item.localPath;

              return (
                <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-base)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, flexShrink: 0 }}>
                      <Icon size={14} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayPath}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {showOpenCompletedDownload ? (
                        <Tiptop text={t('打开所在目录')} placement="bottom">
                          <button
                            type="button"
                            aria-label={t('打开所在目录')}
                            onClick={() => handleOpenCompletedDownload(item)}
                            style={{
                              width: 30,
                              height: 24,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 999,
                              border: '1px solid color-mix(in srgb, var(--success) 44%, var(--border))',
                              background: 'var(--success-dim)',
                              color: 'var(--success)',
                              cursor: 'pointer',
                            }}
                          >
                            <FolderOpen size={14} />
                          </button>
                        </Tiptop>
                      ) : (
                        <div style={{ padding: '2px 8px', borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600 }}>
                          {statusLabel}
                        </div>
                      )}
                      {abortable
                        ? renderActionButton(t('强制终止'), true, () => onAbortItem?.(item))
                        : renderActionButton(t('从列表中移除'), false, () => onRemoveItems?.([item.id]))}
                    </div>
                  </div>

                  {isCompressed ? (
                    <>
                      <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 8, background: 'var(--surface-sunken)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
                          <span>{t('当前阶段')}: <span style={{ color: item.status === 'failed' ? 'var(--danger)' : item.status === 'completed' ? 'var(--success)' : 'var(--accent)' }}>{phaseLabel}</span></span>
                          <span style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatCompressedPhaseBytes(item, t)}
                          </span>
                          <span>{t('当前阶段进度')}: {phaseProgress.toFixed(0)}%</span>
                        </div>
                        <div className="progress-bar-track">
                          <div className="progress-bar-fill" style={{ width: `${phaseProgress}%`, background: item.status === 'failed' ? 'var(--danger)' : item.status === 'completed' ? 'var(--success)' : 'var(--accent)' }} />
                        </div>
                        {item.phaseCurrent ? (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t('当前文件')}: {item.phaseCurrent}
                          </div>
                        ) : null}
                        {phaseDetail ? (
                          item.status === 'failed' ? (
                            <button
                              type="button"
                              onClick={() => { void openTransferErrorDetails(item, phaseDetail); }}
                              title={phaseDetail}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                padding: 0,
                                textAlign: 'left',
                                fontSize: 11,
                                color: 'var(--danger)',
                                lineHeight: 1.45,
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                textDecorationStyle: 'dotted',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {getTransferErrorSummary(phaseDetail, t)}
                            </button>
                          ) : (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {phaseDetail}
                            </div>
                          )
                        ) : null}
                        {compressedPhaseChunks && compressedPhaseChunks.chunks.length > 0 ? (
                          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 8, background: 'color-mix(in srgb, var(--surface-sunken) 72%, transparent)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
                              <span>{t('分块进度')}: {compressedPhaseChunks.chunksDone}/{compressedPhaseChunks.chunks.length}</span>
                              <span>{compressedPhaseChunks.chunksFailed > 0 ? `${compressedPhaseChunks.chunksFailed} ${t('失败')}` : `${fmtSize(compressedPhaseChunks.chunkSizeBytes || 0)} / ${t('块')}`}</span>
                            </div>
                            <AutoFollowChunkGrid
                              chunks={compressedPhaseChunks.chunks}
                              titleBuilder={(chunk) => `${t('分块')} ${chunk.index + 1}: ${getChunkLabel(chunk, t)}${chunk.error ? ` · ${chunk.error}` : ''}`}
                            />
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="progress-bar-track">
                        <div className="progress-bar-fill" style={{ width: `${progress}%`, background: item.status === 'failed' ? 'var(--danger)' : item.status === 'completed' ? 'var(--success)' : 'var(--accent)' }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        <span>{fmtSize(item.bytesUploaded || 0)} / {fmtSize(item.bytesTotal || 0)}</span>
                        <span style={{ color: chunksActive > 0 ? 'var(--accent)' : 'var(--text-tertiary)' }}>{t('块并发')}: {chunksActive}</span>
                        <span style={{ textAlign: 'right' }}>{progress.toFixed(0)}%</span>
                      </div>
                      {chunks.length > 0 ? (
                        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 8, background: 'var(--surface-sunken)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
                            <span>{t('分块进度')}: {chunksDone}/{chunks.length}</span>
                            <span>{chunksFailed > 0 ? `${chunksFailed} ${t('失败')}` : `${fmtSize(item.chunkSizeBytes || 0)} / ${t('块')}`}</span>
                          </div>
                          <AutoFollowChunkGrid
                            chunks={chunks}
                            titleBuilder={(chunk) => `${t('分块')} ${chunk.index + 1}: ${getChunkLabel(chunk, t)}${chunk.attempt ? ` · ${t('重试')} ${chunk.attempt}/5` : ''}${chunk.error ? ` · ${chunk.error}` : ''}`}
                          />
                        </div>
                      ) : null}
                    </>
                  )}

                  {item.error && (!isCompressed || String(item.error).trim() !== String(phaseDetail || '').trim()) ? (
                    <button
                      type="button"
                      onClick={() => { void openTransferErrorDetails(item); }}
                      title={item.error}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        textAlign: 'left',
                        fontSize: 11,
                        color: 'var(--danger)',
                        lineHeight: 1.5,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                        wordBreak: 'break-all',
                      }}
                    >
                      {getTransferErrorSummary(item.error, t)}
                    </button>
                  ) : null}
                </div>
              );
            })}

            {hiddenItems.length > 0 && hiddenMeta && (
              <div style={{ border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface-base)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: hiddenMeta.bg, color: hiddenMeta.color, flexShrink: 0 }}>
                    <hiddenMeta.Icon size={14} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      + {hiddenItems.length} {t('项')}
                    </div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.45 }}>
                      {t('已折叠显示，避免传输队列卡片总数超过 {count}', { count: MAX_RENDER_UPLOAD_CARDS })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ padding: '2px 8px', borderRadius: 999, background: hiddenMeta.bg, color: hiddenMeta.color, fontSize: 11, fontWeight: 600 }}>
                      {hiddenPhaseLabel}
                    </div>
                    {hiddenActiveItems.length > 0
                      ? renderActionButton(t('强制终止'), true, () => onAbortItems?.(hiddenActiveItems))
                      : renderActionButton(t('从列表中移除'), false, () => onRemoveItems?.(hiddenItems.map((item) => item.id)))}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                  {hiddenActiveItems.length > 0
                    ? t('当前有 {count} 项活跃任务被折叠隐藏，仅保留最基本的阶段与终止操作。', { count: hiddenActiveItems.length })
                    : t('这些折叠项均已结束，仅保留从列表中移除操作。')}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}