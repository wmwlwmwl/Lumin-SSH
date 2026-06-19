import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { t } from './i18n.js';
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
          height: '100vh', background: '#0d1117', color: '#f85149', fontFamily: 'monospace', gap: 12,
          padding: 20, textAlign: 'center'
        }}>
          <div style={{ fontSize: 24 }}>⚠</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('界面渲染出错')}</div>
          <div style={{ fontSize: 11, color: '#8b949e', maxWidth: 500, wordBreak: 'break-all' }}>{msg}</div>
          <pre style={{ fontSize: 10, color: '#6e7681', maxHeight: 200, overflow: 'auto', background: 'rgba(255,255,255,0.05)', padding: 8, borderRadius: 4 }}>{stack}</pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid #f85149', background: 'rgba(248,81,73,0.1)',
            color: '#f85149', cursor: 'pointer', fontSize: 13
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

if (savedTheme === 'light') {
  document.body.classList.add('theme-light');
} else {
  document.body.classList.remove('theme-light');
}

// Ensure the green accent color is overridden
document.documentElement.style.setProperty('--green', savedAccent);

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
