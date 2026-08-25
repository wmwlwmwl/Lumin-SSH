export const DIALOG_PRIORITY: Record<string, number> = {
  default: 0,
  settings: 1,
  system: 2,
};

export const getDialogPriority = (options?: { priority?: string }): number => {
  const priority = options?.priority;
  const resolved = priority ? DIALOG_PRIORITY[priority] : undefined;
  return resolved !== undefined ? resolved : DIALOG_PRIORITY.default;
};

/** 队列中的弹窗条目（type 为宽松字符串，字段按需可选） */
export interface QueuedDialog {
  id: number;
  type: string;
  priority: number;
  title: string;
  message: string;
  copyable?: boolean;
  defaultValue?: string;
  inputType?: 'password' | 'text';
  validate?: ((value: string) => string | null | undefined | Promise<string | null | undefined>) | null;
  checkboxLabel?: string;
  buttons?: Array<{ label: string; value: unknown; shortcut?: string; primary?: boolean; secondary?: boolean }>;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm?: (val: unknown, checked: boolean) => void;
  onChoice?: (val: unknown, checked: boolean) => void;
}

export const insertDialogByPriority = <T extends { priority: number }>(dialogs: T[], dialog: T): T[] => {
  const insertAt = dialogs.findIndex((queued) => queued.priority < dialog.priority);
  return insertAt === -1
    ? [...dialogs, dialog]
    : [...dialogs.slice(0, insertAt), dialog, ...dialogs.slice(insertAt)];
};

if (import.meta.env.DEV) {
  const ordered = [0, 2, 1, 1].reduce(
    (dialogs, priority) => insertDialogByPriority(dialogs, { priority }),
    [] as Array<{ priority: number }>,
  );
  console.assert(ordered.map(({ priority }) => priority).join(',') === '2,1,1,0', '弹窗优先级排序自检失败');
}
