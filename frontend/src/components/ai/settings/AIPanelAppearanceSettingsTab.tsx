import { useTranslation } from '../../../i18n.ts';
import {
  PositionSelectorCard,
  ToggleSwitchControl,
} from './AIPanelSettingsWidgets.tsx';

export interface AIPanelAppearanceSettingsTabProps {
  approvalButtonOrder: string;
  commandActionButtonOrder: string;
  messageActionBarAtBottom: boolean;
  messageNavEnabled: boolean;
  onSaveGlobalAISettings?: (settings: Record<string, unknown>) => Promise<unknown> | void;
}

export default function AIPanelAppearanceSettingsTab({
  approvalButtonOrder,
  commandActionButtonOrder,
  messageActionBarAtBottom,
  messageNavEnabled,
  onSaveGlobalAISettings,
}: AIPanelAppearanceSettingsTabProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="grid gap-1">
        <div className="text-[18px] font-bold text-primary leading-[1.3]">{t('外观')}</div>
        <div className="text-sm text-tertiary leading-[1.5]">{t('控制底部审批与命令处理按钮的左右位置。')}</div>
      </div>
      <PositionSelectorCard
        title={t('工具审批按钮位置')}
        description={t('左侧为预览区,右侧点击交换"拒绝 / 批准"的左右顺序.')}
        items={approvalButtonOrder === 'approve-reject'
          ? [
              { key: 'approve', label: t('批准'), primary: true },
              { key: 'reject', label: t('拒绝'), primary: false },
            ]
          : [
              { key: 'reject', label: t('拒绝'), primary: false },
              { key: 'approve', label: t('批准'), primary: true },
            ]}
        onToggle={() => onSaveGlobalAISettings?.({
          approvalButtonOrder: approvalButtonOrder === 'approve-reject' ? 'reject-approve' : 'approve-reject',
        })}
        toggleLabel={t('交换位置')}
      />
      <PositionSelectorCard
        title={t('命令处理按钮位置')}
        description={t('左侧为预览区,右侧点击交换"强制继续 / 终止工具"的左右顺序.')}
        items={commandActionButtonOrder === 'continue-terminate'
          ? [
              { key: 'continue', label: t('强制继续'), primary: true },
              { key: 'terminate', label: t('终止工具'), primary: false },
            ]
          : [
              { key: 'terminate', label: t('终止工具'), primary: false },
              { key: 'continue', label: t('强制继续'), primary: true },
            ]}
        onToggle={() => onSaveGlobalAISettings?.({
          commandActionButtonOrder: commandActionButtonOrder === 'continue-terminate' ? 'terminate-continue' : 'continue-terminate',
        })}
        toggleLabel={t('交换位置')}
      />
      <div className="bg-canvas p-3.5 rounded-xl border border-line flex justify-between items-center gap-4">
        <div className="min-w-0">
          <div className="text-primary text-base font-bold">{t('消息操作条置底')}</div>
          <div className="text-tertiary text-sm leading-[1.6]">{t('启用后,用户消息与Ai消息的操作条显示在每轮消息主体底部;关闭后显示在顶部.')}</div>
        </div>
        <ToggleSwitchControl
          checked={messageActionBarAtBottom}
          onChange={() => onSaveGlobalAISettings?.({
            messageActionBarAtBottom: !messageActionBarAtBottom,
          })}
        />
      </div>
      <div className="bg-canvas p-3.5 rounded-xl border border-line flex justify-between items-center gap-4">
        <div className="min-w-0">
          <div className="text-primary text-base font-bold">{t('用户消息导航')}</div>
          <div className="text-tertiary text-sm leading-[1.6]">{t('启用后,对话区左侧显示用户消息导航圆点,悬停预览内容,点击跳转到对应消息.')}</div>
        </div>
        <ToggleSwitchControl
          checked={messageNavEnabled}
          onChange={() => onSaveGlobalAISettings?.({
            messageNavEnabled: !messageNavEnabled,
          })}
        />
      </div>
    </>
  );
}
