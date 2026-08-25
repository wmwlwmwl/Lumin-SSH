import { useMemo } from 'react';
import { X, ClipboardList } from 'lucide-react';
import { useTranslation } from '../i18n.ts';
import Tiptop from './Tiptop.tsx';
import { Button } from './ui';
import { type TransferQueueItem } from '../utils/fileWorkbench.ts';
import UploadQueueCard from './filemanager/UploadQueueCard.tsx';
import {
  MAX_RENDER_UPLOAD_CARDS,
  buildVisibleQueue,
  getStatusMeta,
  getUploadPhaseLabel,
  renderActionButton,
} from './filemanager/uploadQueueMeta.tsx';

export interface FileUploadQueuePanelProps {
  items: TransferQueueItem[];
  closing?: boolean;
  onClose: () => void;
  isAbortable?: (item: TransferQueueItem) => boolean;
  onAbortItem?: (item: TransferQueueItem) => void;
  onAbortItems?: (items: TransferQueueItem[]) => void;
  onRemoveItems?: (ids: string[]) => void;
}

export default function FileUploadQueuePanel({
  items,
  closing = false,
  onClose,
  isAbortable,
  onAbortItem,
  onAbortItems,
  onRemoveItems,
}: FileUploadQueuePanelProps) {
  const { t } = useTranslation();

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
    <div
      className="w-full h-full flex flex-col bg-raised"
      style={{
        opacity: closing ? 0 : 1,
        transform: closing ? 'translateX(100%)' : 'translateX(0)',
        transformOrigin: 'right center',
        transition: 'opacity 100ms ease, transform 100ms ease-in-out',
        willChange: 'opacity, transform',
        pointerEvents: closing ? 'none' : 'auto',
      }}
    >
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5 border-b border-line">
        <div className="flex items-center gap-2 text-md font-semibold text-primary">
          <ClipboardList size={14} className="shrink-0" />
          {t('传输队列')}
        </div>
        <div className="flex items-center gap-2">
          {removableIds.length > 0 ? renderActionButton(t('清空'), false, () => onRemoveItems?.(removableIds)) : null}
          <Tiptop text={t('关闭')} placement="bottom">
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('关闭')}>
              <X size={14} />
            </Button>
          </Tiptop>
        </div>
      </div>
      <div className="px-3.5 py-2 text-xs text-tertiary border-b border-line-subtle">
        {t('当前会话中的所有路径传输任务都会显示在这里')}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-2.5">
        {visibleItems.length === 0 && hiddenItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center text-muted">
            <div className="leading-none text-tertiary opacity-80"><ClipboardList size={40} strokeWidth={1.5} /></div>
            <div className="text-base">{t('当前会话暂无传输任务')}</div>
          </div>
        ) : (
          <>
            {visibleItems.map((item) => (
              <UploadQueueCard
                key={item.id}
                item={item}
                isAbortable={isAbortable}
                onAbortItem={onAbortItem}
                onRemoveItems={onRemoveItems}
                t={t}
              />
            ))}

            {hiddenItems.length > 0 && hiddenMeta && (
              <div className="rounded-lg border border-dashed border-line bg-canvas p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0" style={{ background: hiddenMeta.bg, color: hiddenMeta.color }}>
                    <hiddenMeta.Icon size={14} />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="text-primary text-base font-semibold truncate">
                      + {hiddenItems.length} {t('项')}
                    </div>
                    <div className="text-tertiary text-xs leading-[1.45]">
                      {t('已折叠显示，避免传输队列卡片总数超过 {count}', { count: MAX_RENDER_UPLOAD_CARDS })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: hiddenMeta.bg, color: hiddenMeta.color }}>
                      {hiddenPhaseLabel}
                    </div>
                    {hiddenActiveItems.length > 0
                      ? renderActionButton(t('强制终止'), true, () => onAbortItems?.(hiddenActiveItems))
                      : renderActionButton(t('从列表中移除'), false, () => onRemoveItems?.(hiddenItems.map((item) => item.id)))}
                  </div>
                </div>
                <div className="text-xs text-tertiary leading-[1.45]">
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
