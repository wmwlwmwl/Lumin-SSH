import { ClipboardList, Copy, RefreshCw, XCircle } from 'lucide-react';
import { useTranslation } from '../i18n.ts';
import { cn } from '../utils/cn.ts';
import { Button, ContextMenu } from './ui';
import type { MenuItem } from './ui';
import { ProcessTable } from './process/ProcessTable.tsx';
import { ProcessDetailDrawer } from './process/ProcessDetailDrawer.tsx';
import { useProcessPage } from './process/useProcessPage.ts';

export interface ProcessPageProps {
  sessionId: string;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  active: boolean;
}

export default function ProcessPage({ sessionId, addToast, active }: ProcessPageProps) {
  const { t } = useTranslation();

  const {
    processes,
    filtered,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    sortKey,
    sortAsc,
    selectedPids,
    killing,
    contextMenu,
    setContextMenu,
    detailState,
    detailDispatch,
    activeProcess,
    detailHeight,
    envVars,
    envLoading,
    showEnv,
    setShowEnv,
    tableColumns,
    visibleRange,
    scrollRef,
    load,
    handleSort,
    toggleSelect,
    selectAll,
    killSelected,
    killOne,
    copyText,
    copyEnv,
    handleRowClick,
    handleRowContextMenu,
    startDetailDrag,
    startColResize,
    handleScroll,
  } = useProcessPage({ sessionId, addToast, active });

  return (
    <div className="data-page">
      <div className="data-page-header">
        <h3 className="data-page-title">
          <ClipboardList size={16} /> {t('进程管理')}
        </h3>
        <div className="flex gap-1.5">
          {selectedPids.size > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => void killSelected()}
              disabled={killing}
            >
              <XCircle size={12} />
              {t('终止选中')} ({selectedPids.size})
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            {t('刷新')}
          </Button>
        </div>
      </div>

      <div className="data-toolbar">
        <input
          className="input"
          type="search"
          autoComplete="off"
          name="processSearch"
          aria-label={t('搜索 PID / 进程名 / 用户...')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('搜索 PID / 进程名 / 用户...')}
        />
        <span className="data-count">
          {processes ? `${filtered.length} / ${processes.length}` : '—'}
        </span>
      </div>

      <ProcessTable
        processes={processes}
        filtered={filtered}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        searchQuery={searchQuery}
        selectedPids={selectedPids}
        onSelectAll={selectAll}
        onToggleSelect={toggleSelect}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={handleSort}
        onStartColResize={startColResize}
        tableColumns={tableColumns}
        visibleRange={visibleRange}
        scrollRef={scrollRef}
        onScroll={handleScroll}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        contextMenu={contextMenu}
        activePid={detailState.activePid}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          minWidth={170}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: t('终止'),
              icon: <XCircle size={14} />,
              danger: true,
              onSelect: () => {
                const p = contextMenu.process;
                void killOne(p);
              },
            },
            'separator',
            {
              label: t('复制名称'),
              icon: <Copy size={14} />,
              onSelect: () => {
                const p = contextMenu.process;
                copyText(p?.name, `${t('已复制')}: ${p?.name || ''}`);
              },
            },
            {
              label: t('复制命令行'),
              icon: <Copy size={14} />,
              onSelect: () => {
                const p = contextMenu.process;
                copyText(p?.cmd || p?.name, t('命令已复制到剪贴板'));
              },
            },
            ...(contextMenu.hasEnv ? [{
              label: t('复制环境变量'),
              icon: <Copy size={14} />,
              onSelect: () => {
                const p = contextMenu.process;
                void copyEnv(p);
              },
            }] : []),
          ] as MenuItem[]}
        />
      )}

      <ProcessDetailDrawer
        detailProcesses={detailState.processes}
        activePid={detailState.activePid}
        activeProcess={activeProcess}
        detailDispatch={detailDispatch}
        detailHeight={detailHeight}
        onStartDetailDrag={startDetailDrag}
        envLoading={envLoading}
        envVars={envVars}
        showEnv={showEnv}
        setShowEnv={setShowEnv}
      />
    </div>
  );
}
