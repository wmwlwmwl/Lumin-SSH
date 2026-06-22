import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { t } from './i18n.js';
import { AlertTriangle } from 'lucide-react';
import './index.css';

// 全局错误边界，防止渲染错误导致白屏
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || String(this.state.error);
      const stack = this.state.error?.stack || '';
      console.error('[ErrorBoundary] 完整错误:', msg);
      console.error('[ErrorBoundary] 堆栈:', stack);
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: 'var(--surface-base)', color: 'var(--danger)', fontFamily: 'monospace', gap: 12,
          padding: 20, textAlign: 'center'
        }}>
          <div style={{ fontSize: 24 }}><AlertTriangle size={24} /></div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('界面渲染出错')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 500, wordBreak: 'break-all' }}>{msg}</div>
          <pre style={{ fontSize: 10, color: 'var(--text-tertiary)', maxHeight: 200, overflow: 'auto', background: 'var(--surface-raised)', padding: 8, borderRadius: 4 }}>{stack}</pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid var(--danger)', background: 'var(--danger-dim)',
            color: 'var(--danger)', cursor: 'pointer', fontSize: 13
          }}>{t('重新加载')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Load initial theme and accent color
const savedTheme = localStorage.getItem('themeMode') || 'dark';
const savedAccent = localStorage.getItem('themeAccent') || '#10b981';

const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
const applyLight = savedTheme === 'light' || (savedTheme === 'system' && isSystemLight);
if (applyLight) {
  document.body.classList.add('theme-light');
} else {
  document.body.classList.remove('theme-light');
}

// Ensure the accent color is overridden
const hexToRgb = (hex) => {
  const c = hex.replace('#', '');
  return `${parseInt(c.slice(0,2), 16)}, ${parseInt(c.slice(2,4), 16)}, ${parseInt(c.slice(4,6), 16)}`;
};
const useCustomAccent = localStorage.getItem('useCustomAccent') === 'true';
if (useCustomAccent) {
  document.documentElement.style.setProperty('--accent', savedAccent);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(savedAccent));
  document.documentElement.style.setProperty('--success', savedAccent);
  document.documentElement.style.setProperty('--green', savedAccent);
}

// 禁用浏览器默认右键菜单（完全拦截，以便使用统一的自定义玻璃菜单）
document.addEventListener('contextmenu', (e) => e.preventDefault());

// 全局未捕获错误捕获，帮助定位白屏原因
window.addEventListener('error', (e) => {
  console.error('[Global Error]', e.message, e.filename, e.lineno, e.colno, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Rejection]', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </ErrorBoundary>
);
