import React from 'react';
import type { I18nKey } from '../../../i18n.ts';

/** 同步提供方描述（来自 SettingsModal，宽松形状） */
export interface SyncProviderDef {
  accent: string;
  titleKey: I18nKey;
  subtitleKey: I18nKey;
  successMsgKey: I18nKey;
  summaryFields: (form: Record<string, string | number>) => Array<{ label: string; value: string; primary?: boolean; fullWidth?: boolean }>;
}

/** 提供方表单（字段由 SettingsModal 定义，宽松键值） */
export type ProviderForm = Record<string, string | number>;

export type FieldSetter = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;

export interface SyncTabProps {
  syncProvider: string;
  onSyncProviderChange: (id: string) => void;
  syncMode: string;
  onSyncModeChange: (mode: string) => void;
  autoSyncEnabled: boolean;
  onAutoSyncEnabledChange: (v: boolean) => void;
  providers: Record<string, SyncProviderDef>;
  providerList: Array<{ id: string; label: React.ReactNode }>;
  webdavForm: ProviderForm;
  setWebdavField: FieldSetter;
  webdavConfigured: boolean;
  webdavEditing: boolean;
  setWebdavEditing: (v: boolean) => void;
  webdavLoading: boolean;
  webdavTesting: boolean;
  webdavTestResult: string | null;
  onWebdavTest: () => void;
  onWebdavSave: () => void;
  r2Form: ProviderForm;
  setR2Field: FieldSetter;
  r2Configured: boolean;
  r2Editing: boolean;
  setR2Editing: (v: boolean) => void;
  r2Loading: boolean;
  r2Testing: boolean;
  r2TestResult: string | null;
  onR2Test: () => void;
  onR2Save: () => void;
  ftpForm: ProviderForm;
  setFTPField: FieldSetter;
  ftpConfigured: boolean;
  ftpEditing: boolean;
  setFtpEditing: (v: boolean) => void;
  ftpLoading: boolean;
  ftpTesting: boolean;
  ftpTestResult: string | null;
  onTestFTP: () => void;
  onSaveFTP: () => void;
  sftpForm: ProviderForm;
  setSFTPField: FieldSetter;
  sftpConfigured: boolean;
  sftpEditing: boolean;
  setSftpEditing: (v: boolean) => void;
  sftpLoading: boolean;
  sftpTesting: boolean;
  sftpTestResult: string | null;
  onTestSFTP: () => void;
  onSaveSFTP: () => void;
  setSftpForm: React.Dispatch<React.SetStateAction<ProviderForm>>;
  lastSyncTime: number | null;
  syncTombstoneStats: { connections?: number; credentials?: number } | null;
  onPruneSyncTombstones?: (days: number) => void;
  pruningTombstones: boolean;
  syncing: boolean;
  onSync: () => void;
  loadingBackups: boolean;
  restoring: boolean;
  onRestore: () => void;
  isAnyConfigured: boolean;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  hasRecoveryPassword: boolean;
  recoveryPasswordEditing: boolean;
  setRecoveryPasswordEditing: (v: boolean) => void;
  recoveryPasswordInput: string;
  setRecoveryPasswordInput: (v: string) => void;
  recoveryPasswordChanging: boolean;
  onSaveRecoveryPassword: () => void;
  onClearRecoveryPassword: () => void;
}
