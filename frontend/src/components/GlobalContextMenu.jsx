import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n.js';
import * as runtime from '../../wailsjs/runtime/runtime.js';

export default function GlobalContextMenu() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [targetInput, setTargetInput] = useState(null);

  useEffect(() => {
    const handleContextMenu = (e) => {
      // 仅拦截输入框
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        e.preventDefault();
        setTargetInput(e.target);
        
        let x = e.clientX;
        let y = e.clientY;
        const menuWidth = 160;
        const menuHeight = 150; // 近似高度
        
        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

        setPosition({ x, y });
        setVisible(true);
      } else {
        setVisible(false);
      }
    };

    const handleClick = () => {
      if (visible) setVisible(false);
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClick);
    };
  }, [visible]);

  const handleAction = async (action) => {
    if (!targetInput) return;
    targetInput.focus();

    try {
      if (action === 'copy') {
        const text = targetInput.value.substring(targetInput.selectionStart, targetInput.selectionEnd);
        if (text) await runtime.ClipboardSetText(text);
      } else if (action === 'cut') {
        const text = targetInput.value.substring(targetInput.selectionStart, targetInput.selectionEnd);
        if (text) {
          await runtime.ClipboardSetText(text);
          const start = targetInput.selectionStart;
          const end = targetInput.selectionEnd;
          // 使用原生 setter 以兼容 React 受控输入框
          const proto = targetInput.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          const newVal = targetInput.value.substring(0, start) + targetInput.value.substring(end);
          nativeSetter.call(targetInput, newVal);
          targetInput.setSelectionRange(start, start);
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else if (action === 'paste') {
        let text;
        try {
          text = await runtime.ClipboardGetText();
        } catch {}
        if (!text) {
          try { text = await navigator.clipboard.readText(); } catch {}
        }
        if (text) {
          const start = targetInput.selectionStart;
          const end = targetInput.selectionEnd;
          // 使用原生 setter 以兼容 React 受控输入框
          const proto = targetInput.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          nativeSetter.call(targetInput,
            targetInput.value.substring(0, start) + text + targetInput.value.substring(end)
          );
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else if (action === 'selectAll') {
        targetInput.select();
      }
    } catch (err) {
      console.error('Clipboard action failed:', err);
    }
    
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div 
      className="context-menu" 
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="context-menu-item" onClick={() => handleAction('cut')}>
        <span className="item-label">{t('剪切')}</span>
        <span className="item-shortcut">Ctrl+X</span>
      </div>
      <div className="context-menu-item" onClick={() => handleAction('copy')}>
        <span className="item-label">{t('复制')}</span>
        <span className="item-shortcut">Ctrl+C</span>
      </div>
      <div className="context-menu-item" onClick={() => handleAction('paste')}>
        <span className="item-label">{t('粘贴')}</span>
        <span className="item-shortcut">Ctrl+V</span>
      </div>
      <div className="context-menu-divider"></div>
      <div className="context-menu-item" onClick={() => handleAction('selectAll')}>
        <span className="item-label">{t('全选')}</span>
        <span className="item-shortcut">Ctrl+A</span>
      </div>
    </div>
  );
}
