// FileManager 控制器类型：全部领域 hook 返回值的并集。
// 渲染辅助函数（Toolbar/TabBar/Content/Overlays/Rows）以它为依赖入参，
// 保证被搬移 JSX 内引用的闭包变量同名可用。
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { useFileManagerTabScroll } from './useFileManagerTabScroll.ts';
import type { useFileManagerWorkspaceSync } from './useFileManagerWorkspaceSync.ts';
import type { useFileManagerPaneView } from './useFileManagerPaneView.ts';
import type { useFileManagerClipboard } from './useFileManagerClipboard.ts';
import type { useFileManagerEditorState } from './useFileManagerEditorState.ts';
import type { useFileManagerUploadPanel } from './useFileManagerUploadPanel.ts';
import type { useFileManagerDirectoryLoader } from './useFileManagerDirectoryLoader.ts';
import type { useFileManagerTransfers } from './useFileManagerTransfers.ts';
import type { useFileManagerLocator } from './useFileManagerLocator.ts';
import type { useFileManagerEditors } from './useFileManagerEditors.ts';
import type { useFileManagerTabs } from './useFileManagerTabs.ts';
import type { useFileManagerItemOps } from './useFileManagerItemOps.ts';
import type { useFileManagerScrollSync } from './useFileManagerScrollSync.ts';
import type { useFileManagerDragDrop } from './useFileManagerDragDrop.ts';
import type { useFileManagerPaneScroller } from './useFileManagerPaneScroller.ts';

export type FileManagerController =
  ReturnType<typeof useFileManagerCore>
  & ReturnType<typeof useFileManagerTabScroll>
  & ReturnType<typeof useFileManagerWorkspaceSync>
  & ReturnType<typeof useFileManagerPaneView>
  & ReturnType<typeof useFileManagerClipboard>
  & ReturnType<typeof useFileManagerEditorState>
  & ReturnType<typeof useFileManagerUploadPanel>
  & ReturnType<typeof useFileManagerDirectoryLoader>
  & ReturnType<typeof useFileManagerTransfers>
  & ReturnType<typeof useFileManagerLocator>
  & ReturnType<typeof useFileManagerEditors>
  & ReturnType<typeof useFileManagerTabs>
  & ReturnType<typeof useFileManagerItemOps>
  & ReturnType<typeof useFileManagerScrollSync>
  & ReturnType<typeof useFileManagerDragDrop>
  & ReturnType<typeof useFileManagerPaneScroller>;
