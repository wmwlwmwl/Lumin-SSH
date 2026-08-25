import { FolderOpen, Loader2, RotateCcw } from 'lucide-react';
import type React from 'react';
import { useTranslation } from '../../../i18n.ts';
import { Button } from '../../ui';
import { handleInputDragSelectAll } from '../inputDragSelect.ts';
import {
  formatTokenCountInMillions,
  ToggleSwitchControl,
} from './AIPanelSettingsWidgets.tsx';

export interface AIPanelBasicSettingsTabProps {
  aiTerminalIsolation: boolean;
  onToggleAiTerminalIsolation: () => void;
  confirmDelete: boolean;
  onToggleConfirmDelete: () => void;
  continueAfterToolRejection: boolean;
  soundEnabled?: boolean;
  soundVolume?: number;
  terminalOutputLineLimit: number;
  onTerminalOutputLineLimitChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  toolResultTokenThreshold: number;
  aiRequestProxyId: string;
  proxyNodes: Array<{ id?: string; name?: string; type?: string; host?: string; port?: string | number }>;
  tasksDir: string;
  isCustomTasksDir: boolean;
  tasksDirMigrating: boolean;
  handleChangeTasksDir: () => void;
  handleResetTasksDir: () => void;
  onSaveGlobalAISettings?: (settings: Record<string, unknown>) => Promise<unknown> | void;
}

export default function AIPanelBasicSettingsTab({
  aiTerminalIsolation,
  onToggleAiTerminalIsolation,
  confirmDelete,
  onToggleConfirmDelete,
  continueAfterToolRejection,
  soundEnabled,
  soundVolume,
  terminalOutputLineLimit,
  onTerminalOutputLineLimitChange,
  toolResultTokenThreshold,
  aiRequestProxyId,
  proxyNodes,
  tasksDir,
  isCustomTasksDir,
  tasksDirMigrating,
  handleChangeTasksDir,
  handleResetTasksDir,
  onSaveGlobalAISettings,
}: AIPanelBasicSettingsTabProps) {
  const { t } = useTranslation();
  const toolResultTokenThresholdDisplay = formatTokenCountInMillions(toolResultTokenThreshold);

  return (
    <>
      <div className="grid gap-1">
        <div className="text-[18px] font-bold text-primary leading-[1.3]">{t('基本')}</div>
      </div>
      <div className="bg-canvas p-4 rounded-xl border border-line grid gap-3">
        <div className="flex justify-between items-center gap-4">
          <div className="min-w-0">
            <div className="text-primary text-base font-bold">{t('终端隔离')}</div>
            <div className="text-tertiary text-sm leading-[1.6]">{t('为每个终端创建独立的 AI 面板与运行期会话。修改后将在下次启动应用时生效。')}</div>
          </div>
          <ToggleSwitchControl checked={aiTerminalIsolation} onChange={onToggleAiTerminalIsolation} />
        </div>
        <div className="border-t border-line" />
        <div className="flex justify-between items-center gap-4">
          <div className="min-w-0">
            <div className="text-primary text-base font-bold">{t('删除前需要二次确认')}</div>
            <div className="text-tertiary text-sm leading-[1.6]">{t('删除 AI 对话或消息前先弹出确认提示')}</div>
          </div>
          <ToggleSwitchControl checked={confirmDelete} onChange={onToggleConfirmDelete} />
        </div>
        <div className="border-t border-line" />
        <div className="flex justify-between items-center gap-4">
          <div className="min-w-0">
            <div className="text-primary text-base font-bold">{t('拒绝工具后自动继续')}</div>
            <div className="text-tertiary text-sm leading-[1.6]">{t('关闭后，点击“拒绝”会停止本次请求并等待下一条消息。')}</div>
          </div>
          <ToggleSwitchControl
            checked={continueAfterToolRejection}
            onChange={() => onSaveGlobalAISettings?.({ continueAfterToolRejection: !continueAfterToolRejection })}
          />
        </div>
        <div className="border-t border-line" />
        <div className="flex justify-between items-center gap-4">
          <div className="min-w-0">
            <div className="text-primary text-base font-bold">{t('任务提示音')}</div>
            <div className="text-tertiary text-sm leading-[1.6]">{t('在追问需要处理和任务完成时播放提示音。')}</div>
          </div>
          <ToggleSwitchControl
            checked={soundEnabled !== false}
            onChange={() => onSaveGlobalAISettings?.({ soundEnabled: soundEnabled === false })}
          />
        </div>
        {soundEnabled !== false ? (
          <>
            <div className="border-t border-line" />
            <div className="grid gap-2">
              <div className="flex justify-between items-center gap-4">
                <div className="min-w-0">
                  <div className="text-primary text-base font-bold">{t('提示音音量')}</div>
                  <div className="text-tertiary text-sm leading-[1.6]">{t('默认 20%，可按需调节。')}</div>
                </div>
                <span className="text-base min-w-14 text-right text-primary tabular-nums">{`${Math.round((Number.isFinite(Number(soundVolume)) ? Number(soundVolume) : 0.2) * 100)}%`}</span>
              </div>
              <input
                id="ai-panel-sound-volume"
                name="ai-panel-sound-volume"
                type="range"
                min="0"
                max="100"
                step="1"
                autoComplete="off"
                value={Math.round((Number.isFinite(Number(soundVolume)) ? Number(soundVolume) : 0.2) * 100)}
                onChange={(event) => onSaveGlobalAISettings?.({ soundVolume: Math.max(0, Math.min(1, (parseInt(event.target.value, 10) || 0) / 100)) })}
                className="w-full cursor-pointer"
              />
            </div>
          </>
        ) : null}
        <div className="border-t border-line" />
        <div className="grid gap-2">
          <div className="flex justify-between items-center gap-4">
            <div className="min-w-0">
              <div className="text-primary text-base font-bold">{t('终端输出行数上限')}</div>
              <div className="text-tertiary text-sm leading-[1.6]">{t('控制 MCP 终端输出保留的最大行数')}</div>
            </div>
            <span className="text-base min-w-14 text-right text-primary tabular-nums">{terminalOutputLineLimit}</span>
          </div>
          <input
            id="ai-panel-terminal-output-line-limit"
            name="ai-panel-terminal-output-line-limit"
            type="range"
            min="10"
            max="5000"
            step="10"
            autoComplete="off"
            value={terminalOutputLineLimit}
            onChange={onTerminalOutputLineLimitChange}
            className="w-full cursor-pointer"
          />
        </div>
        <div className="border-t border-line" />
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
              <div className="text-primary text-base font-bold">{t('工具阈值')}</div>
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full border border-[rgba(var(--accent-rgb),0.24)] bg-[rgba(var(--accent-rgb),0.08)] text-primary text-sm font-bold tabular-nums font-mono">{toolResultTokenThresholdDisplay}</span>
            </div>
            <div className="text-tertiary text-sm leading-[1.6]">{t('当工具返回结果的预估 Token 数超过此阈值时,原始内容将被省略,并显示“结果过大”的提示.调高可保留更多原始输出,但也会增加上下文膨胀风险.')}</div>
          </div>
          <input
            id="ai-panel-tool-result-token-threshold"
            name="ai-panel-tool-result-token-threshold"
            type="number"
            min="1"
            step="1000"
            autoComplete="off"
            value={toolResultTokenThreshold}
            onChange={(event) => {
              const nextValue = parseInt(event.target.value, 10);
              if (Number.isFinite(nextValue)) {
                void onSaveGlobalAISettings?.({ toolResultTokenThreshold: nextValue });
              }
            }}
            onMouseLeave={handleInputDragSelectAll}
            className="w-full rounded-lg border border-line bg-canvas text-primary px-2.5 py-2 text-base font-mono box-border"
          />
        </div>
        <div className="border-t border-line" />
        <div className="grid gap-2">
          <div className="min-w-0">
            <div className="text-primary text-base font-bold">{t('AI 请求代理')}</div>
            <div className="text-tertiary text-sm leading-[1.6]">{t('选择 AI 请求使用的代理节点，首项为不使用。')}</div>
          </div>
          <select
            id="ai-panel-proxy"
            name="ai-panel-proxy"
            value={aiRequestProxyId}
            onChange={(event) => onSaveGlobalAISettings?.({ aiRequestProxyId: event.target.value })}
            className="w-full min-h-[30px] py-[5px] pl-2.5 pr-8 bg-sunken border border-line rounded-sm text-primary text-sm outline-none cursor-pointer appearance-none bg-no-repeat transition-colors duration-[80ms] focus:border-focus focus:shadow-[0_0_0_2px_var(--accent-dim)]"
            style={{
              backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236e7681\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")',
              backgroundPosition: 'right 12px center',
            }}
          >
            <option value="">{t('不使用')}</option>
            {proxyNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {[
                  node.name || t('未命名节点'),
                  node.type === 'http' ? t('HTTP 代理') : t('SOCKS5 代理'),
                  `${node.host}:${node.port}`,
                ].join(' · ')}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-1 mt-1">
        <div className="text-[18px] font-bold text-primary leading-[1.3]">{t('数据存储')}</div>
      </div>
      <div className="bg-canvas p-4 rounded-xl border border-line grid gap-3">
        <div className="grid gap-2">
          <div className="min-w-0">
            <div className="text-primary text-base font-bold">{t('对话存储目录')}</div>
            <div className="text-tertiary text-sm leading-[1.6]">{t('AI 对话数据保存在此目录。更改目录会自动迁移现有数据。')}</div>
          </div>
          <input
            id="ai-tasks-dir"
            name="tasksDir"
            type="text"
            value={tasksDir || ''}
            readOnly
            className="w-full min-h-[30px] px-2.5 py-[5px] bg-sunken border border-line rounded-sm text-primary text-sm outline-none cursor-default transition-colors duration-[80ms] focus:border-focus focus:shadow-[0_0_0_2px_var(--accent-dim)]"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={handleChangeTasksDir}
              disabled={tasksDirMigrating}
              className="h-[30px] px-3.5 gap-1.5"
            >
              {tasksDirMigrating ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
              {tasksDirMigrating ? t('迁移中...') : t('更改目录')}
            </Button>
            {isCustomTasksDir ? (
              <Button
                variant="secondary"
                onClick={handleResetTasksDir}
                disabled={tasksDirMigrating}
                className="h-[30px] px-3.5 gap-1.5 text-secondary hover:text-secondary"
              >
                <RotateCcw size={14} />
                {t('恢复默认')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
