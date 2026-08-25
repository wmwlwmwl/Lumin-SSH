import type { Dispatch, SetStateAction } from 'react';
import type { PortForwardInitialMapping } from '../../hooks/usePortForwardDialog.ts';
import type { SessionAuthPrompt } from '../../hooks/useSessionConnections.ts';
import type { ToastAction, ToastItem } from '../../hooks/useToasts.ts';
import type { ExportOptions } from '../../hooks/useImportExport.ts';
import type { SessionLike } from '../../utils/sessionWorkspace.ts';
import type { TopbarSession } from '../AppTopbar.tsx';
import type { SerialFormConfig } from '../SerialConfigModal.tsx';
import type { SyncFailureState } from '../SyncFailureToast.tsx';

/** 标签栏右键菜单 */
export interface TabContextMenuState {
  sessionId: string;
  x: number;
  y: number;
}

/** 终端子标签右键菜单（type=group 时分屏组） */
export interface TerminalTabContextMenuState {
  sessionId: string;
  terminalId: string;
  x: number;
  y: number;
  type: 'terminal' | 'group';
  terminalIds?: string[];
}

/** 编辑飞行动画元素（shape 来自 App.tsx 的组装；beam/capsule 为历史遗留分支无生产者，字段统一声明为必填以简化类型） */
export interface EditFlyItem {
  id: string;
  type: string;
  field: string;
  from: { x: number; y: number };
  mid: { x: number; y: number };
  to: { x: number; y: number };
  at: { x: number; y: number };
  length: number;
  angle: number;
  delay: number;
  path: string;
  size: number;
  label: string;
  value?: string;
}

export interface AppOverlaysProps {
  dialogs: {
    activeAIDevilMode: boolean;
    closePortForwardDialog: () => void;
    connectSerial: (config: SerialFormConfig) => void;
    loadServers: () => Promise<void>;
    portForwardDialogSessionId: string | null;
    portForwardInitialMapping: PortForwardInitialMapping | null;
    portForwardInitialTab: string | null;
    probePanelPosition: 'left' | 'right';
    setProbePanelPosition: (pos: 'left' | 'right') => void;
    setSettingsInitialTab: (tab: string) => void;
    setShowCredentials: (v: boolean) => void;
    setShowSerialModal: (v: boolean) => void;
    setShowSettings: (v: boolean) => void;
    settingsInitialTab: string;
    showCredentials: boolean;
    showPortForwardDialog: boolean;
    showSerialModal: boolean;
    showSettings: boolean;
  };
  importExport: {
    exportSelectedIds: string[];
    handleDownloadTemplate: () => void;
    handleExport: (opts: ExportOptions) => void;
    handleExportSelected: (opts: ExportOptions) => void;
    handleImport: () => void;
    hasRecoveryPassword: boolean;
    ieBusy: boolean;
    setExportSelectedIds: (ids: string[]) => void;
    setShowExportSelectedDialog: (v: boolean) => void;
    setShowImportExportDialog: (v: boolean) => void;
    showExportSelectedDialog: boolean;
    showImportExportDialog: boolean;
  };
  notifications: {
    downloadProgress: number;
    handleApplyStartupUpdate: () => Promise<void>;
    handleToastAction: (id: number, action: ToastAction) => void;
    isUpdateModalVisible: boolean;
    removeToast: (id: number) => void;
    setIsUpdateModalVisible: (v: boolean) => void;
    setSyncFailed: Dispatch<SetStateAction<SyncFailureState | null>>;
    startupUpdateInfo: { version: string } | null;
    syncFailed: SyncFailureState | null;
    toasts: ToastItem[];
  };
  menus: {
    activeSessionId: string | null;
    canCopySessionPassword: (sessionId: string) => boolean;
    canMoveTerminalToDockTarget: (session: SessionLike, terminalId: string, target: string) => boolean;
    closeAllSessions: () => Promise<void>;
    closeSession: (sessionId: string, e?: React.MouseEvent) => Promise<void>;
    closeTerminal: (sessionId: string, terminalId: string, e?: React.MouseEvent) => void;
    closeTerminalGroup: (sessionId: string, layoutId: string, terminalIds: string[], e?: React.MouseEvent) => void;
    forceCloseSession: (sessionId: string) => void;
    handleCopySessionPassword: (sessionId: string) => Promise<void>;
    handleRenameTerminalTab: (sessionId: string, terminalId: string) => Promise<void>;
    handleTabClick: (sessionId: string) => void;
    isTerminalDockTargetOccupied: (session: SessionLike, terminalId: string, target: string) => boolean;
    moveTerminalToDockTarget: (session: SessionLike, terminalId: string, target: string) => void;
    sessionAuthPrompts: Record<string, SessionAuthPrompt>;
    sessionListPos: { x: number; y: number };
    sessionListQuery: string;
    sessionListRef: React.RefObject<HTMLDivElement | null>;
    sessions: TopbarSession[];
    setSessionListQuery: (q: string) => void;
    setShowSessionList: (v: boolean) => void;
    setTabContextMenu: (menu: TabContextMenuState | null) => void;
    setTerminalTabContextMenu: (menu: TerminalTabContextMenuState | null) => void;
    showSessionList: boolean;
    tabContextMenu: TabContextMenuState | null;
    terminalTabContextMenu: TerminalTabContextMenuState | null;
  };
  animation: {
    editFlyAnimation: { items: EditFlyItem[] } | null;
    editorModeBanner: { id: string; text: string } | null;
  };
  shared: {
    addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
    t: (key: string, vars?: Record<string, unknown>) => string;
  };
}
