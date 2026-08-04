import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t as $t } from '../../i18n.js';

/**
 * 轻量色盘 Popover 组件
 * - HSL 滑块（色相 + 饱和度/明度）
 * - Hex 输入框
 * - 当前终端背景色预览条（方便判断对比度）
 */

function hexToHsl(hex) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(clean)) return { h: 0, s: 100, l: 50 };
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export default function ColorPicker({ value, onChange, onClose, terminalBg }) {
  const [hsl, setHsl] = useState(() => hexToHsl(value));
  const [hexInput, setHexInput] = useState(value || '#ff6b6b');
  const popoverRef = useRef(null);

  const currentHex = hslToHex(hsl.h, hsl.s, hsl.l);

  useEffect(() => {
    setHexInput(currentHex);
  }, [currentHex]);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  const handleHexInput = useCallback((e) => {
    const val = e.target.value;
    setHexInput(val);
    if (/^#[\da-fA-F]{6}$/.test(val)) {
      setHsl(hexToHsl(val));
      onChange?.(val);
    }
  }, [onChange]);

  const handleHueChange = useCallback((e) => {
    const h = Number(e.target.value);
    setHsl((prev) => {
      const next = { ...prev, h };
      onChange?.(hslToHex(next.h, next.s, next.l));
      return next;
    });
  }, [onChange]);

  const handleSatChange = useCallback((e) => {
    const s = Number(e.target.value);
    setHsl((prev) => {
      const next = { ...prev, s };
      onChange?.(hslToHex(next.h, next.s, next.l));
      return next;
    });
  }, [onChange]);

  const handleLightChange = useCallback((e) => {
    const l = Number(e.target.value);
    setHsl((prev) => {
      const next = { ...prev, l };
      onChange?.(hslToHex(next.h, next.s, next.l));
      return next;
    });
  }, [onChange]);

  const sliderTrack = {
    width: '100%',
    height: 12,
    borderRadius: 6,
    cursor: 'pointer',
    WebkitAppearance: 'none',
    appearance: 'none',
    outline: 'none',
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute',
        zIndex: 9999,
        top: '100%',
        left: 0,
        marginTop: 6,
        background: 'var(--surface-overlay)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        width: 240,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}
    >
      {/* 预览色块 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 6,
          background: currentHex,
          border: '1px solid var(--border)',
          flexShrink: 0,
        }} />
        <input
          value={hexInput}
          onChange={handleHexInput}
          style={{
            flex: 1,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '5px 8px',
            fontSize: 12,
            color: 'var(--text-primary)',
            fontFamily: 'monospace',
          }}
          spellCheck={false}
        />
      </div>

      {/* 色相滑块 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{$t('色相')}</div>
        <input
          type="range" min="0" max="360" value={hsl.h}
          onChange={handleHueChange}
          style={{
            ...sliderTrack,
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
        />
      </div>

      {/* 饱和度滑块 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{$t('饱和度')}</div>
        <input
          type="range" min="0" max="100" value={hsl.s}
          onChange={handleSatChange}
          style={{
            ...sliderTrack,
            background: `linear-gradient(to right, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`,
          }}
        />
      </div>

      {/* 明度滑块 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{$t('明度')}</div>
        <input
          type="range" min="0" max="100" value={hsl.l}
          onChange={handleLightChange}
          style={{
            ...sliderTrack,
            background: `linear-gradient(to right, #000, ${hslToHex(hsl.h, hsl.s, 50)}, #fff)`,
          }}
        />
      </div>

      {/* 终端背景色参考条 */}
      {terminalBg && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{$t('终端背景参考')}</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: terminalBg,
            borderRadius: 6,
            padding: '6px 10px',
            border: '1px solid var(--border)',
          }}>
            <span style={{ color: currentHex, fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>
              Error Warning Info
            </span>
          </div>
        </div>
      )}

      {/* 确认按钮 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            padding: '4px 14px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {$t('确定')}
        </button>
      </div>
    </div>
  );
}
