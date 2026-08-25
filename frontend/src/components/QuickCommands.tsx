import { forwardRef, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus, List, Pencil, Rocket, SquarePen, Trash2, X } from 'lucide-react';
import { Z } from '../constants/zIndex.ts';
import { Button, ContextMenu, Modal, type MenuItem } from './ui';
import { QuickCommandDetail } from './quickCommands/QuickCommandDetail.tsx';
import { QuickCommandDialog } from './quickCommands/QuickCommandDialog.tsx';
import { QuickCommandEditor } from './quickCommands/QuickCommandEditor.tsx';
import { TreeNode } from './quickCommands/QuickCommandTreeNode.tsx';
import {
  filterTree,
  inputClass,
  resolvePath,
  type QuickCommandsHandle,
  type QuickCommandsProps,
} from './quickCommands/quickCommandTypes.ts';
import { useQuickCommands } from './quickCommands/useQuickCommands.ts';
import Tiptop from './Tiptop.tsx';

export type { QuickCommandsHandle };

const QuickCommands = forwardRef<QuickCommandsHandle, QuickCommandsProps>(function QuickCommands(
  props: QuickCommandsProps,
  ref: Ref<QuickCommandsHandle>,
) {
  const { connectedSessions = [], onClose } = props;

  const {
    t,
    commands,
    selectedPath,
    setSelectedPath,
    selectedItem,
    contextMenu,
    sendTarget,
    setSendTarget,
    showCmdBar,
    setShowCmdBar,
    showCmdEditor,
    setShowCmdEditor,
    cmdEditorText,
    setCmdEditorText,
    cmdEditorAddCR,
    setCmdEditorAddCR,
    cmdEditorClearAfterSend,
    setCmdEditorClearAfterSend,
    cmdEditorShowOpts,
    setCmdEditorShowOpts,
    dialog,
    setDialog,
    dlgName,
    setDlgName,
    dlgCmd,
    setDlgCmd,
    dlgAddCR,
    setDlgAddCR,
    paramHistory,
    setParamHistory,
    paramValues,
    setParamValues,
    historyDropdown,
    setHistoryDropdown,
    historySearch,
    setHistorySearch,
    searchText,
    setSearchText,
    rootDragOver,
    setRootDragOver,
    dragVersion,
    dirty,
    confirmUnsaved,
    setConfirmUnsaved,
    editGroupName,
    setEditGroupName,
    editCmdName,
    editCmdText,
    handleDragStart,
    clearDrag,
    handleDropItem,
    handleDropToRoot,
    handleMove,
    handleSelect,
    handleConfirmSave,
    handleConfirmDiscard,
    handleContextMenu,
    closeContextMenu,
    doExecute,
    doContextAction,
    handleDlgSave,
    sendEditorCommand,
    save,
  } = useQuickCommands(props, ref);

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="flex flex-col h-full bg-overlay overflow-hidden font-sans"
    >
      {/* ── 工具栏 ── */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-line-subtle shrink-0">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            closeContextMenu();
            const list = structuredClone(commands);
            const sel = selectedPath ? resolvePath(list, selectedPath) : null;
            if (sel?.item?.type === 'group') {
              if (!sel.item.children) sel.item.children = [];
              setDialog({ type: 'add', targetChildren: sel.item.children, parentList: list, groupName: sel.item.name });
            } else {
              setDialog({ type: 'add', targetChildren: list, parentList: list, groupName: '' });
            }
            setDlgName(''); setDlgCmd(''); setDlgAddCR(true);
          }}
        >
          {t('＋ 添加命令')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            closeContextMenu();
            setDialog({ type: 'addGroup', contextPath: '', parentList: commands });
            setDlgName(''); setDlgCmd(''); setDlgAddCR(true);
          }}
        >
          <FolderPlus size={14} /> {t('添加分组')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={showCmdEditor}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            closeContextMenu();
            setCmdEditorShowOpts(false);
            setShowCmdEditor((v) => !v);
          }}
        >
          {t('命令编辑器')}
        </Button>
        <Tiptop text={showCmdBar ? t('取消在终端固定显示命令') : t('在终端固定显示命令, 点击后确认发送')}>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={showCmdBar}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              closeContextMenu();
              const next = !showCmdBar;
              setShowCmdBar(next);
              localStorage.setItem('terminalQuickCmdBar', String(next));
              window.dispatchEvent(new CustomEvent('quick-cmd-bar-changed', { detail: next }));
            }}
          >
            <List size={14} /> {t('固定到终端')}
          </Button>
        </Tiptop>
        <div className="flex-1" />
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            className="px-1.5"
            onClick={() => {
              if (dirty) {
                setConfirmUnsaved({ close: true });
                return;
              }
              onClose();
            }}
            aria-label={t('关闭')}
          >
            <X size={14} />
          </Button>
        )}
      </div>

      {/* ── 主体：左右分栏 / 命令编辑器 ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {showCmdEditor ? (
          <QuickCommandEditor
            cmdEditorText={cmdEditorText}
            setCmdEditorText={setCmdEditorText}
            cmdEditorAddCR={cmdEditorAddCR}
            setCmdEditorAddCR={setCmdEditorAddCR}
            cmdEditorClearAfterSend={cmdEditorClearAfterSend}
            setCmdEditorClearAfterSend={setCmdEditorClearAfterSend}
            cmdEditorShowOpts={cmdEditorShowOpts}
            setCmdEditorShowOpts={setCmdEditorShowOpts}
            setShowCmdEditor={setShowCmdEditor}
            sendEditorCommand={sendEditorCommand}
            sendTarget={sendTarget}
            setSendTarget={setSendTarget}
            connectedSessions={connectedSessions}
          />
        ) : (
          <>
            {/* ── 左侧树形列表 ── */}
            <div
              onClick={(e) => { if (e.target === e.currentTarget) { setSelectedPath(null); closeContextMenu(); } }}
              onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
              onDragEnter={(e) => { e.preventDefault(); setRootDragOver(true); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setRootDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); handleDropToRoot(); }}
              className={`w-[220px] shrink-0 border-r border-line-subtle overflow-y-auto px-1.5 py-1 flex flex-col transition-colors duration-100 ${
                rootDragOver ? 'bg-active outline outline-1 outline-dashed outline-accent' : 'bg-sunken'
              }`}
            >
              <div className="px-0.5 pt-0.5 pb-1.5 shrink-0">
                <input
                  type="text"
                  name="qc-search"
                  aria-label={t('搜索命令...')}
                  autoComplete="off"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={t('搜索命令...')}
                  className={`${inputClass} px-2 py-1 rounded-sm`}
                />
              </div>
              <div
                className="flex-1 overflow-y-auto"
                onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
                onDragEnter={(e) => { e.preventDefault(); setRootDragOver(true); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setRootDragOver(false); }}
                onDrop={(e) => { e.preventDefault(); handleDropToRoot(); }}
              >
                {(() => {
                  const displayed = filterTree(commands, searchText);
                  return displayed.length === 0 ? (
                    <div className="p-4 text-center text-muted text-sm">
                      {searchText ? t('无匹配结果') : t('点击上方按钮添加命令')}
                    </div>
                  ) : (
                    displayed.map((item, i) => (
                      <TreeNode
                        key={`${item.name}_${i}`}
                        item={item}
                        index={i}
                        path={String(i)}
                        selectedPath={selectedPath}
                        onSelect={handleSelect}
                        onExecute={doExecute}
                        contextMenu={contextMenu}
                        onContextMenu={handleContextMenu}
                        closeContextMenu={closeContextMenu}
                        onMove={handleMove}
                        onDragStart={handleDragStart}
                        onDropItem={handleDropItem}
                        onDragEnd={clearDrag}
                        dragVersion={dragVersion}
                      />
                    ))
                  );
                })()}
              </div>
            </div>

            {/* ── 右侧详情 ── */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
              <QuickCommandDetail
                selectedItem={selectedItem}
                editGroupName={editGroupName}
                setEditGroupName={setEditGroupName}
                saveGroupName={() => {
                  const list = structuredClone(commands);
                  const r = resolvePath(list, selectedPath || '');
                  r.parent[r.idx].name = editGroupName.trim() || selectedItem?.name || '';
                  save(list);
                }}
                openAddCmdToGroup={() => {
                  const list = structuredClone(commands);
                  const r = resolvePath(list, selectedPath || '');
                  if (r.item) {
                    if (!r.item.children) r.item.children = [];
                    setDialog({ type: 'add', targetChildren: r.item.children, parentList: list, groupName: r.item.name });
                  }
                  setDlgName(''); setDlgCmd(''); setDlgAddCR(true);
                }}
                editCmdName={editCmdName}
                editCmdText={editCmdText}
                openEditCmdDialog={() => {
                  setDialog({ type: 'edit' });
                  setDlgName(editCmdName || selectedItem?.name || '');
                  setDlgCmd(editCmdText || selectedItem?.command || '');
                  setDlgAddCR(selectedItem?.addCR !== false);
                }}
                paramValues={paramValues}
                setParamValues={setParamValues}
                paramHistory={paramHistory}
                setParamHistory={setParamHistory}
                historyDropdown={historyDropdown}
                setHistoryDropdown={setHistoryDropdown}
                historySearch={historySearch}
                setHistorySearch={setHistorySearch}
                doExecute={doExecute}
                sendTarget={sendTarget}
                setSendTarget={setSendTarget}
                connectedSessions={connectedSessions}
                toggleAddCR={(checked) => {
                  const list = structuredClone(commands);
                  const r = resolvePath(list, selectedPath || '');
                  r.parent[r.idx].addCR = checked;
                  save(list);
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* ── 右键上下文菜单 ── */}
      {contextMenu && createPortal(
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          minWidth={160}
          onClose={closeContextMenu}
          items={contextMenu.type === 'group' ? ([
            { label: t('＋ 添加命令'), onSelect: () => doContextAction('addCmd') },
            { label: t('添加子分组'), icon: <FolderPlus size={14} />, onSelect: () => doContextAction('addGroup') },
            'separator',
            { label: t('重命名分组'), icon: <Pencil size={14} />, onSelect: () => doContextAction('editGroup') },
            'separator',
            { label: t('删除分组'), icon: <Trash2 size={14} />, danger: true, onSelect: () => doContextAction('delete') },
          ] as MenuItem[]) : ([
            { label: t('执行'), icon: <Rocket size={14} />, onSelect: () => doContextAction('execute') },
            { label: t('编辑'), icon: <SquarePen size={14} />, onSelect: () => doContextAction('edit') },
            'separator',
            { label: t('删除'), icon: <Trash2 size={14} />, danger: true, onSelect: () => doContextAction('delete') },
          ] as MenuItem[])}
        />,
        document.body,
      )}

      {/* ── 未保存修改确认对话框 ── */}
      {confirmUnsaved && (
        <Modal
          open
          size="sm"
          zIndex={Z.DIALOG}
          onClose={() => setConfirmUnsaved(null)}
          title={t('未保存的修改')}
        >
          <div className="text-sm text-secondary">
            {t('当前命令有未保存的修改，是否保存？')}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmUnsaved(null)}>{t('取消')}</Button>
            <Button variant="danger" size="sm" onClick={handleConfirmDiscard}>{t('不保存')}</Button>
            <Button variant="primary" size="sm" onClick={handleConfirmSave}>{t('保存')}</Button>
          </div>
        </Modal>
      )}

      {/* ── 添加/编辑对话框 ── */}
      <QuickCommandDialog
        dialog={dialog}
        setDialog={setDialog}
        dlgName={dlgName}
        setDlgName={setDlgName}
        dlgCmd={dlgCmd}
        setDlgCmd={setDlgCmd}
        dlgAddCR={dlgAddCR}
        setDlgAddCR={setDlgAddCR}
        handleDlgSave={handleDlgSave}
        commands={commands}
      />
    </div>
  );
});

export default QuickCommands;
