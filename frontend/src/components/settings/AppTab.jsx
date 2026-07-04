import React from 'react';
import { t as $t } from '../../i18n.js';
import logoImg from '../../assets/logo.png';
import { Z } from '../../constants/zIndex';
import { AboutLink } from './SharedComponents';

export default function AppTab({ CURRENT_VERSION, updateInfo, checkingUpdate, downloadProgress, onCheckUpdate, onApplyUpdate }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 24px', gap: 32, maxWidth: 640 }}>
      {/* 顶部布局：图标与标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <img
          src={logoImg}
          alt="Lumin"
          style={{
            width: 96,
            height: 96,
            borderRadius: 24,
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.25)',
            border: '1px solid var(--border-light)'
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 32,
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '-0.5px',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8
          }}>
            Lumin
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '0' }}>by WuMing</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {CURRENT_VERSION}
            </span>
            {(updateInfo?.hasUpdate || downloadProgress >= 0) && (
              <span
                onClick={onApplyUpdate}
                style={{
                  background: downloadProgress >= 0 ? '#1e3a8a' : '#065f46',
                  color: downloadProgress >= 0 ? '#93c5fd' : '#34d399',
                  borderRadius: 12,
                  padding: '2px 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: downloadProgress >= 0 ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: downloadProgress >= 0 ? '0 2px 8px rgba(30,58,138,0.3)' : '0 2px 8px rgba(6,95,70,0.3)',
                  position: 'relative',
                  overflow: 'hidden',
                  minWidth: 80,
                  justifyContent: 'center'
                }}
              >
                {downloadProgress >= 0 && (
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: 'rgba(59, 130, 246, 0.4)', width: `${downloadProgress}%`, transition: 'width 0.2s ease-out' }}></div>
                )}
                <span style={{ position: 'relative', zIndex: Z.CONTENT, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {downloadProgress >= 0 ? (
                    <>
                      <svg className="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                      {downloadProgress}%
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                      {updateInfo.latestVersion} {$t('立即更新')}
                    </>
                  )}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 0 }}>
        <button
          onClick={onCheckUpdate}
          disabled={checkingUpdate}
          style={{
            background: 'var(--surface-overlay)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 500,
            cursor: checkingUpdate ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 0.2s',
            opacity: checkingUpdate ? 0.7 : 1
          }}
          onMouseEnter={(e) => { if(!checkingUpdate) { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
          onMouseLeave={(e) => { if(!checkingUpdate) { e.currentTarget.style.background = 'var(--surface-overlay)'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
        >
          <svg className={checkingUpdate ? 'spin' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
          {checkingUpdate
             ? $t('检查中...')
             : $t('检查更新')}
        </button>
      </div>

      {/* 列表项 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        <AboutLink
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 15L15 15"></path><path d="M12 12L12 18"></path></svg>}
          title={$t('反馈问题')} desc={$t('生成预填的 GitHub issue')}
          url="https://github.com/wmwlwmwl/Lumin-SSH/issues/new"
        />

        <AboutLink
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>}
          title={$t('社区')} desc={$t('参与 GitHub Discussions 讨论')}
          url="https://github.com/wmwlwmwl/Lumin-SSH/discussions"
        />

        <AboutLink
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>}
          title={$t('GitHub')} desc={$t('源代码')}
          url="https://github.com/wmwlwmwl/Lumin-SSH"
        />

        <AboutLink
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>}
          title={$t('更新内容')} desc={$t('查看发布说明')}
          url="https://github.com/wmwlwmwl/Lumin-SSH/releases"
        />
      </div>
    </div>
  );
}
