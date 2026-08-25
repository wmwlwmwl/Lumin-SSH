import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { config } from '../../wailsjs/go/models.ts';
import type { ServerFormData } from './useServerCatalog.ts';

/** 编辑飞行动画条目（与 AppOverlays 的渲染分支契约一致的宽松形状） */
export interface EditFlyItemLike {
  id: string;
  type?: string;
  field?: string;
  from?: { x: number; y: number };
  mid?: { x: number; y: number };
  to?: { x: number; y: number };
  at?: { x: number; y: number };
  delay: number;
  path?: string;
  size?: number;
  label?: string;
  value?: string;
}

export interface UseAppAnimationsOptions {
  setServerEditor: Dispatch<SetStateAction<config.Connection | Record<string, unknown> | null>>;
  t: (key: string) => string;
}

export default function useAppAnimations({ setServerEditor, t }: UseAppAnimationsOptions) {
  const [editFlyAnimation, setEditFlyAnimation] = useState<{ id: number; items: EditFlyItemLike[] } | null>(null);
  const [editFlyShiningFields, setEditFlyShiningFields] = useState<Record<string, boolean>>({});
  const [saveFlowHighlights, setSaveFlowHighlights] = useState<{ serverId: string | null; rowPulse: string | null; fields: Record<string, string> }>({ serverId: null, rowPulse: null, fields: {} });
  const [editorModeBanner, setEditorModeBanner] = useState<{ id: string; text: string } | null>(null);

  const editFlyTimerRef = useRef<number | null>(null);
  const editFlyFieldTimerRefs = useRef<number[]>([]);
  const editFlyShineTimerRefs = useRef<number[]>([]);
  const editorModeBannerTimerRef = useRef<number | null>(null);

  const getAnimationViewport = useCallback(() => {
    const rootRect = document.querySelector('.app-layout')?.getBoundingClientRect();
    return {
      left: rootRect?.left || 0,
      top: rootRect?.top || 0,
      width: rootRect?.width || window.innerWidth,
      height: rootRect?.height || window.innerHeight,
    };
  }, []);

  const clampLayerPoint = useCallback((point: { x: number; y: number }, viewport: { left: number; top: number; width: number; height: number }, padding = 34) => ({
    x: Math.max(padding, Math.min(viewport.width - padding, point.x)),
    y: Math.max(padding, Math.min(viewport.height - padding, point.y)),
  }), []);

  const rectToLayerPoint = useCallback((rect: { left: number; top: number; width: number; height: number }, viewport: { left: number; top: number; width: number; height: number }) => clampLayerPoint({
    x: rect.left - viewport.left + rect.width / 2,
    y: rect.top - viewport.top + rect.height / 2,
  }, viewport), [clampLayerPoint]);

  const buildFlightMidPoint = useCallback((from: { x: number; y: number }, to: { x: number; y: number }, viewport: { left: number; top: number; width: number; height: number }, index: number) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const sway = Math.min(132, Math.max(38, distance * 0.18)) * (index % 2 === 0 ? -1 : 1);
    const lift = Math.min(148, Math.max(60, distance * 0.22)) + index * 8;
    return clampLayerPoint({
      x: (from.x + to.x) / 2 + sway,
      y: Math.min(from.y, to.y) - lift,
    }, viewport, 42);
  }, [clampLayerPoint]);

  const startEditFlyAnimation = useCallback((server: config.Connection | null, payload?: { sourceRects?: Record<string, DOMRect>; labels?: Record<string, string> }) => {
    if (editorModeBannerTimerRef.current) {
      clearTimeout(editorModeBannerTimerRef.current);
      editorModeBannerTimerRef.current = null;
    }
    setEditorModeBanner({
      id: String(Date.now()),
      text: server?.id ? t('已进入编辑 · 请在左侧修改') : t('已进入克隆 · 请在左侧填写'),
    });
    editorModeBannerTimerRef.current = setTimeout(() => {
      setEditorModeBanner(null);
      editorModeBannerTimerRef.current = null;
    }, 1600);

    if (!payload?.sourceRects) {
      setServerEditor(server);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});

    const sourceServer = server as unknown as Record<string, unknown>;
    setServerEditor(server ? {
      ...server,
      name: '',
      host: '',
      port: '',
      username: '',
      terminalInitPath: '',
      fileManagerInitPath: '',
    } : null);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const fields = ['name', 'host', 'port', 'username', 'terminalInitPath', 'fileManagerInitPath'];
        const fieldLabels: Record<string, string> = {
          name: t('服务器别名（选填）'),
          host: t('主机地址 *'),
          port: t('端口'),
          username: t('用户名'),
          terminalInitPath: t('终端默认 cd 目录'),
          fileManagerInitPath: t('文件管理器初始目录'),
        };

        const items = fields.flatMap((field, index) => {
          const sourceRect = payload.sourceRects?.[field];
          const targetEl = document.querySelector(`[data-editor-field="${field}"]`);
          const targetRect = targetEl?.getBoundingClientRect?.();
          if (!sourceRect || !targetRect) {
            return [];
          }
          const from = rectToLayerPoint(sourceRect, viewport);
          const to = rectToLayerPoint(targetRect, viewport);
          return [{
            id: `${field}-${Date.now()}-${index}`,
            field,
            label: fieldLabels[field],
            value: payload.labels?.[field] || '',
            from,
            to,
            mid: buildFlightMidPoint(from, to, viewport, index),
            delay: index * 52,
          }];
        });

        if (items.length === 0) {
          return;
        }

        setEditFlyAnimation({ id: Date.now(), items });
        items.forEach((item) => {
          const timer = setTimeout(() => {
            setServerEditor((current) => {
              if (!current || (current as config.Connection).id !== server?.id) {
                return current;
              }
              const nextValue = item.field === 'port'
                ? (server?.port || 22)
                : (sourceServer[item.field] || '');
              return { ...current, [item.field]: nextValue };
            });
            setEditFlyShiningFields((prev) => ({ ...prev, [item.field]: true }));
            const shineTimer = setTimeout(() => {
              setEditFlyShiningFields((prev) => {
                const next = { ...prev };
                delete next[item.field];
                return next;
              });
            }, 1150);
            editFlyShineTimerRefs.current.push(shineTimer);
          }, item.delay + 560);
          editFlyFieldTimerRefs.current.push(timer);
        });
        editFlyTimerRef.current = setTimeout(() => {
          setEditFlyAnimation(null);
          editFlyTimerRef.current = null;
        }, 980);
      });
    });
  }, [buildFlightMidPoint, getAnimationViewport, rectToLayerPoint, setServerEditor, t]);

  const startAddGuideAnimation = useCallback((sourceButton: HTMLElement | null) => {
    if (!sourceButton?.getBoundingClientRect) {
      setServerEditor(null);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});
    setServerEditor(null);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const sourceRect = sourceButton.getBoundingClientRect();
        const titleTargetEl = document.querySelector('[data-editor-add-target="true"]');
        const titleTargetRect = titleTargetEl?.getBoundingClientRect?.();
        const fields = ['host', 'port', 'username'];

        if (!titleTargetRect) {
          return;
        }

        const titleCenter = rectToLayerPoint(titleTargetRect, viewport);
        const addSource = rectToLayerPoint(sourceRect, viewport);
        const now = Date.now();
        const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
        const makeControlPoint = (from: { x: number; y: number }, to: { x: number; y: number }, index: number, padding = 28) => {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const normalX = -dy / distance;
          const normalY = dx / distance;
          const preferDown = normalY >= 0 ? 1 : -1;
          const bow = Math.min(120, Math.max(34, distance * randomBetween(0.08, 0.18))) * preferDown;
          const progress = randomBetween(0.36, 0.68);
          return clampLayerPoint({
            x: from.x + dx * progress + normalX * bow + randomBetween(-14, 14),
            y: from.y + dy * progress + normalY * bow + randomBetween(8, 34),
          }, viewport, padding);
        };
        const makePath = (from: { x: number; y: number }, control: { x: number; y: number }, to: { x: number; y: number }) =>
          `path("M ${from.x.toFixed(1)},${from.y.toFixed(1)} Q ${control.x.toFixed(1)},${control.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}")`;

        const coreMid = makeControlPoint(addSource, titleCenter, 0, 56);
        const particles = Array.from({ length: 14 }, (_, index) => {
          const angle = Math.random() * Math.PI * 2;
          const startRadius = randomBetween(7, 22);
          const endRadius = randomBetween(16, 42);
          const from = clampLayerPoint({
            x: addSource.x + Math.cos(angle) * startRadius,
            y: addSource.y + Math.sin(angle) * startRadius,
          }, viewport, 12);
          const to = clampLayerPoint({
            x: titleCenter.x + Math.cos(angle + randomBetween(0.45, 1.45)) * endRadius,
            y: titleCenter.y + Math.sin(angle + randomBetween(0.45, 1.45)) * endRadius,
          }, viewport, 12);
          const mid = makeControlPoint(from, to, index, 38);
          return {
            id: `add-particle-${now}-${index}`,
            type: 'add-particle',
            from,
            to,
            mid,
            path: makePath(from, mid, to),
            size: randomBetween(2.5, 5.5),
            delay: randomBetween(0, 150),
          };
        });

        setEditFlyAnimation({
          id: now,
          items: [
            {
              id: `add-core-${now}`,
              type: 'add-core',
              from: addSource,
              to: titleCenter,
              mid: coreMid,
              path: makePath(addSource, coreMid, titleCenter),
              delay: 0,
            },
            ...particles,
            {
              id: `add-ring-${now}`,
              type: 'add-ring',
              at: titleCenter,
              delay: 820,
            },
          ],
        });

        fields.forEach((field, index) => {
          const timer = setTimeout(() => {
            setEditFlyShiningFields((prev) => ({ ...prev, [field]: true }));
            const shineTimer = setTimeout(() => {
              setEditFlyShiningFields((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
              });
            }, 980);
            editFlyShineTimerRefs.current.push(shineTimer);
          }, 1040 + index * 105);
          editFlyFieldTimerRefs.current.push(timer);
        });

        editFlyTimerRef.current = setTimeout(() => {
          setEditFlyAnimation(null);
          editFlyTimerRef.current = null;
        }, 2050);
      });
    });
  }, [buildFlightMidPoint, getAnimationViewport, rectToLayerPoint, setServerEditor, t]);

  const startSaveFlowAnimation = useCallback((server: config.Connection | null | undefined, data: ServerFormData) => {
    const serverId = server?.id || data?.id;
    if (!serverId) {
      setServerEditor(null);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});
    setSaveFlowHighlights({ serverId: null, rowPulse: null, fields: {} });

    const serverData = server as unknown as Record<string, unknown> | null | undefined;

    const getServerTarget = (field: string) => {
      const nodes = Array.from(document.querySelectorAll(`[data-server-update-id="${serverId}"]`));
      const row = nodes.find((node) => (node as HTMLElement).offsetParent !== null) || nodes[0];
      if (!row) {
        return null;
      }
      const targetField = field === 'host' || field === 'port' || field === 'username' ? 'hostPort' : field;
      const targetEl = row.querySelector(`[data-edit-source-field="${targetField}"]`) || row;
      return targetEl.getBoundingClientRect?.() || null;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const fields = ['name', 'host', 'port', 'username', 'terminalInitPath', 'fileManagerInitPath'];
        const fieldLabels: Record<string, string> = {
          name: t('服务器别名（选填）'),
          host: t('主机地址 *'),
          port: t('端口'),
          username: t('用户名'),
          terminalInitPath: t('终端默认 cd 目录'),
          fileManagerInitPath: t('文件管理器初始目录'),
        };

        const items = fields.flatMap((field, index) => {
          const sourceEl = document.querySelector(`[data-editor-field="${field}"]`);
          const sourceRect = sourceEl?.getBoundingClientRect?.();
          const targetRect = getServerTarget(field);
          if (!sourceRect || !targetRect) {
            return [];
          }
          const from = rectToLayerPoint(sourceRect, viewport);
          const to = rectToLayerPoint(targetRect, viewport);
          return [{
            id: `save-flow-${field}-${Date.now()}-${index}`,
            type: 'save-flow-capsule',
            field,
            label: fieldLabels[field],
            value: field === 'port' ? String(data.port || server?.port || 22) : String(data[field] || serverData?.[field] || ''),
            from,
            to,
            mid: buildFlightMidPoint(from, to, viewport, index + 1),
            delay: index * 90,
          }];
        });

        if (items.length === 0) {
          setServerEditor(null);
          return;
        }

        setEditFlyAnimation({ id: Date.now(), items });
        setEditFlyShiningFields(Object.fromEntries(items.map((item) => [item.field, true])));

        items.forEach((item) => {
          const highlightTimer = setTimeout(() => {
            setSaveFlowHighlights((current) => ({
              serverId,
              rowPulse: item.id,
              fields: { ...current.fields, [item.field]: item.id },
            }));
          }, item.delay + 660);
          const shineTimer = setTimeout(() => {
            setSaveFlowHighlights((current) => {
              if (current.serverId !== serverId) return current;
              const nextFields = { ...current.fields };
              delete nextFields[item.field];
              return {
                serverId,
                rowPulse: current.rowPulse === item.id ? null : current.rowPulse,
                fields: nextFields,
              };
            });
            setEditFlyShiningFields((current) => {
              const next = { ...current };
              delete next[item.field];
              return next;
            });
          }, item.delay + 1420);
          editFlyFieldTimerRefs.current.push(highlightTimer);
          editFlyShineTimerRefs.current.push(shineTimer);
        });

        const closeTimer = setTimeout(() => {
          setServerEditor(null);
        }, Math.max(...items.map((item) => item.delay)) + 980);
        const cleanupTimer = setTimeout(() => {
          setEditFlyAnimation(null);
          setSaveFlowHighlights({ serverId: null, rowPulse: null, fields: {} });
          setEditFlyShiningFields({});
          editFlyTimerRef.current = null;
        }, Math.max(...items.map((item) => item.delay)) + 1660);
        editFlyFieldTimerRefs.current.push(closeTimer);
        editFlyTimerRef.current = cleanupTimer;
      });
    });
  }, [buildFlightMidPoint, getAnimationViewport, rectToLayerPoint, setServerEditor, t]);

  useEffect(() => () => {
    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    if (editorModeBannerTimerRef.current) {
      clearTimeout(editorModeBannerTimerRef.current);
      editorModeBannerTimerRef.current = null;
    }
  }, []);

  return {
    editFlyAnimation,
    editFlyShiningFields,
    saveFlowHighlights,
    editorModeBanner,
    startEditFlyAnimation,
    startAddGuideAnimation,
    startSaveFlowAnimation,
  };
}
