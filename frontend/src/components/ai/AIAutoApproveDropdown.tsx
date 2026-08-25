import { CheckCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../i18n.ts';
import {
  buildTriggerLabel,
  normalizeAutoApprovalSettings,
  PANEL_SHELL_CLASS,
  SECTION_HINT_CLASS,
  VISIBLE_OPTIONS,
  type AutoApprovalSettings,
  type ExecuteApprovalMode,
} from './autoApprove/autoApproveTypes.ts';
import { OptionButton } from './autoApprove/AutoApproveWidgets.tsx';
import AIAutoApproveExecuteSection from './autoApprove/AIAutoApproveExecuteSection.tsx';

export type { AutoApprovalSettings, ExecuteApprovalMode } from './autoApprove/autoApproveTypes.ts';

export interface AIAutoApproveDropdownProps {
  settings?: unknown;
  onPatchSettings?: (settings: Partial<AutoApprovalSettings>) => Promise<unknown> | void;
  disabled?: boolean;
  dismissSignal?: number;
}

export default function AIAutoApproveDropdown({ settings, onPatchSettings, disabled = false, dismissSignal = 0 }: AIAutoApproveDropdownProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const patchTimerRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [expandLeft, setExpandLeft] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [panelBounds, setPanelBounds] = useState<{ left: number; width: number } | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [deniedCommandInput, setDeniedCommandInput] = useState('');
  const [localSettings, setLocalSettings] = useState<AutoApprovalSettings>(() => normalizeAutoApprovalSettings(settings));
  const normalizedSettings = useMemo(() => normalizeAutoApprovalSettings(localSettings), [localSettings]);
  const enabledCount = useMemo(
    () => VISIBLE_OPTIONS.filter((option) => normalizedSettings[option.key]).length,
    [normalizedSettings],
  );

  useEffect(() => {
    if (!open) {
      setTriggerRect(null);
      setPanelBounds(null);
      return undefined;
    }
    const measure = () => {
      const el = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const root = el.closest('[data-ai-panel-root="true"]');
        const rootRect = root?.getBoundingClientRect();
        setExpandLeft(rect.left + 320 > window.innerWidth - 16);
        setTriggerRect(rect);
        if (rootRect && rootRect.width > 0) {
          setPanelBounds({
            left: rootRect.left,
            width: rootRect.width,
          });
        } else {
          setPanelBounds(null);
        }
      }
    };
    measure();
    const handleResize = () => measure();
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setExpandLeft(false);
    setTriggerRect(null);
    setPanelBounds(null);
  }, [dismissSignal]);

  useEffect(() => {
    setLocalSettings(normalizeAutoApprovalSettings(settings));
  }, [settings]);

  useEffect(() => () => {
    if (patchTimerRef.current) {
      window.clearTimeout(patchTimerRef.current);
    }
  }, []);

  const persistSettings = async (nextSettings: AutoApprovalSettings) => {
    if (typeof onPatchSettings !== 'function') {
      return;
    }
    await onPatchSettings({
      alwaysAllowReadOnly: nextSettings.alwaysAllowReadOnly,
      alwaysAllowWrite: nextSettings.alwaysAllowWrite,
      alwaysAllowExecute: nextSettings.alwaysAllowExecute,
      executeApprovalMode: nextSettings.executeApprovalMode,
      allowedCommands: nextSettings.allowedCommands,
      deniedCommands: nextSettings.deniedCommands,
      autoApprovalEnabled: nextSettings.autoApprovalEnabled,
    });
  };

  const schedulePersist = (nextSettings: AutoApprovalSettings) => {
    if (patchTimerRef.current) {
      window.clearTimeout(patchTimerRef.current);
    }
    patchTimerRef.current = window.setTimeout(() => {
      patchTimerRef.current = 0;
      void persistSettings(nextSettings);
    }, 180);
  };

  const patchSettings = (patch: Partial<AutoApprovalSettings>) => {
    setLocalSettings((previous) => {
      const nextSettings = normalizeAutoApprovalSettings({
        ...previous,
        ...patch,
      });
      schedulePersist(nextSettings);
      return nextSettings;
    });
  };

  const handleOptionToggle = (key: keyof AutoApprovalSettings) => {
    if (key === 'alwaysAllowExecute') {
      patchSettings({
        alwaysAllowExecute: !normalizedSettings.alwaysAllowExecute,
      });
      return;
    }
    patchSettings({
      [key]: !normalizedSettings[key],
    } as Partial<AutoApprovalSettings>);
  };

  const handleExecuteApprovalModeChange = (executeApprovalMode: ExecuteApprovalMode) => {
    if (normalizedSettings.executeApprovalMode === executeApprovalMode) {
      return;
    }
    patchSettings({ executeApprovalMode });
  };

  const handleAddAllowedCommand = () => {
    const nextValue = commandInput.trim();
    if (!nextValue || nextValue === '*' || normalizedSettings.allowedCommands.includes(nextValue)) {
      return;
    }
    patchSettings({
      allowedCommands: [...normalizedSettings.allowedCommands, nextValue],
    });
    setCommandInput('');
  };

  const handleAddDeniedCommand = () => {
    const nextValue = deniedCommandInput.trim();
    if (!nextValue || nextValue === '*' || normalizedSettings.deniedCommands.includes(nextValue)) {
      return;
    }
    patchSettings({
      deniedCommands: [...normalizedSettings.deniedCommands, nextValue],
    });
    setDeniedCommandInput('');
  };

  const handleRemoveAllowedCommand = (command: string) => {
    patchSettings({
      allowedCommands: normalizedSettings.allowedCommands.filter((item) => item !== command),
    });
  };

  const handleRemoveDeniedCommand = (command: string) => {
    patchSettings({
      deniedCommands: normalizedSettings.deniedCommands.filter((item) => item !== command),
    });
  };

  return (
    <div ref={containerRef} className="relative shrink-0 overflow-visible" style={{ zIndex: open ? 40 : 'auto' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg border text-sm font-medium transition-colors duration-100 whitespace-nowrap ${
          open ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.12)]' : 'border-line bg-transparent'
        } ${normalizedSettings.autoApprovalEnabled ? 'text-primary' : 'text-secondary'} ${
          disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
        }`}>
        {normalizedSettings.autoApprovalEnabled ? <CheckCheck size={12} /> : <X size={12} />}
        <span>{buildTriggerLabel(t, normalizedSettings, enabledCount)}</span>
      </button>
      {open && triggerRect ? (
        <div
          className={`fixed ${PANEL_SHELL_CLASS}`}
          style={{
            ...(panelBounds
              ? { left: panelBounds.left }
              : (expandLeft
                ? { right: window.innerWidth - triggerRect.right }
                : { left: triggerRect.left })),
            bottom: window.innerHeight - triggerRect.top + 8,
            width: panelBounds?.width ?? 320,
            maxWidth: panelBounds?.width ? `${panelBounds.width}px` : 'min(320px, calc(100vw - 32px))',
            zIndex: 10000,
          }}>
          <div className="px-3 py-2.5 border-b border-line-subtle grid gap-2">
            <div className="flex items-center gap-2.5">
              <div className="text-sm font-bold text-primary">{t('自动批准')}</div>
            </div>
            <div className={SECTION_HINT_CLASS}>
              {t('当前阶段仅展示并生效读取,写入,执行.')}
            </div>
          </div>
          <div className="p-3 grid gap-2 overflow-x-hidden">
            {VISIBLE_OPTIONS.map((option) => (
              <OptionButton
                key={option.key}
                active={normalizedSettings[option.key]}
                icon={option.icon}
                label={t(option.labelKey)}
                onClick={() => void handleOptionToggle(option.key)}
              />
            ))}
          </div>
          <AIAutoApproveExecuteSection
            normalizedSettings={normalizedSettings}
            commandInput={commandInput}
            deniedCommandInput={deniedCommandInput}
            setCommandInput={setCommandInput}
            setDeniedCommandInput={setDeniedCommandInput}
            handleExecuteApprovalModeChange={handleExecuteApprovalModeChange}
            handleAddAllowedCommand={handleAddAllowedCommand}
            handleAddDeniedCommand={handleAddDeniedCommand}
            handleRemoveAllowedCommand={handleRemoveAllowedCommand}
            handleRemoveDeniedCommand={handleRemoveDeniedCommand}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}