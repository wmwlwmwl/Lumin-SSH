import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FolderPlus, Zap, Save, Pencil, Trash2, Rocket, SquarePen, X } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';
import Tiptop from './Tiptop.jsx';
import { Z } from '../constants/zIndex';
import { getTerminalTheme } from '../utils/theme.js';

// ── 加载命令数据（从 Go 后端文件）────────────────────
async function loadCommands() {
  try {
    const raw = await AppGo.GetQuickCommands();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return [];
}

// ── 保存命令数据（到 Go 后端文件）────────────────────
async function saveCommands(list) {
  try {
    await AppGo.SaveQuickCommands(JSON.stringify(list));
  } catch (e) {
    console.error('[QuickCommands] saveCommands failed:', e);
  }
}

// ── 本地保存（不同步到云端）───────────────────────────
async function saveCommandsLocal(list) {
  try {
    await AppGo.SaveQuickCommandsLocal(JSON.stringify(list));
  } catch (_) {}
}

// ── 从命令字符串提取参数（含参数名） ──────────────────
// 返回 [{num:1, label:'IP地址'}, ...]
function extractParams(cmd) {
  const re = /\[p#(\d)(?:\s+([^\]]*))?\]/g;
  const map = new Map(); // num -> label
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const num = Number(m[1]);
    const label = (m[2] || '').trim();
    // 保留已有标签（不覆盖）
    if (!map.has(num) || label) map.set(num, label);
  }
  return [...map.entries()].map(([num, label]) => ({ num, label })).sort((a, b) => a.num - b.num);
}

// ── 替换参数占位符 ──────────────────────────────────────
function fillParams(cmd, values) {
  return cmd.replace(/\[p#(\d)(?:\s+([^\]]*))?\]/g, (match, n, _label) => values[Number(n)] || '');
}

// ── 搜索过滤树形数据（返回扁平化的匹配节点路径）─────────
function filterTree(items, keyword, parentPath = '') {
  if (!keyword) return items;
  const kw = keyword.toLowerCase();
  const result = [];
  items.forEach((item, i) => {
    const path = parentPath ? `${parentPath}/${i}` : String(i);
    if (item.type === 'group') {
      // 分组：检查自身名称或子项
      const nameMatch = (item.name || '').toLowerCase().includes(kw);
      if (item.children && item.children.length > 0) {
        const matchedChildren = filterTree(item.children, kw, path);
        if (nameMatch || matchedChildren.length > 0) {
          // 返回展开的分组 + 匹配的子项
          result.push({ ...item, expanded: true, _filteredChildren: matchedChildren, _isFilteredGroup: true });
        }
      } else if (nameMatch) {
        result.push(item);
      }
    } else {
      // 命令：匹配名称或命令内容
      if ((item.name || '').toLowerCase().includes(kw) ||
          (item.command || '').toLowerCase().includes(kw)) {
        result.push(item);
      }
    }
  });
  return result;
}

// ── 树形节点渲染组件 ────────────────────────────────────
function TreeNode({ item, index, path, selectedPath, onSelect, contextMenu, onContextMenu, closeContextMenu, onExecute, onMove, onDragStart, onDropItem, onDragEnd, dragVersion, theme }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const [dropPos, setDropPos] = useState(null); // 'before' | 'inside' | 'after'

  useEffect(() => { setDropPos(null); }, [dragVersion]);

  const arrowBtn = (dir) => (
    <Tiptop text={dir === -1 ? t('上移') : t('下移')}>
      <span
        onClick={(e) => { e.stopPropagation(); onMove && onMove(path, dir); }}
        style={{
          fontSize: 10, cursor: 'pointer', color: theme.mutedColor, padding: '0 3px',
          visibility: hover ? 'visible' : 'hidden', lineHeight: '14px',
          userSelect: 'none',
        }}
      >{dir === -1 ? '▲' : '▼'}</span>
    </Tiptop>
  );

  const commonDragProps = {
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', path);
      onDragStart && onDragStart(path);
    },
    onDragEnd: (e) => { e.stopPropagation(); onDragEnd && onDragEnd(); },
  };

  const calcDropPos = (e, allowInside) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (y < 0.25) return 'before';
    if (allowInside && y < 0.75) return 'inside';
    return 'after';
  };

  const dropIndicator = (pos) => {
    if (dropPos !== pos) return null;
    if (pos === 'inside') return null; // handled by background

    return (
      <div style={{
        position: 'absolute', left: 4, right: 4, height: 2,
        background: 'var(--success)', borderRadius: 1, zIndex: Z.SCROLLBAR,
        [pos === 'before' ? 'top' : 'bottom']: -1,
      }} />
    );
  };

  if (item.type === 'group') {
    const isExpanded = item.expanded !== false;
    const isSelected = selectedPath === path;
    return (
      <div style={{ position: 'relative' }}>
        {/* before indicator */}
        {dropIndicator('before')}
        {/* after indicator */}
        {dropIndicator('after')}
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, true)); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, true)); }}
          onDragLeave={(e) => { e.stopPropagation(); setDropPos(null); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const pos = dropPos; setDropPos(null); onDropItem && onDropItem(path, pos || 'inside'); }}
        >
          <div
            onClick={() => onSelect(path)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, path, 'group', index); }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            {...commonDragProps}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', cursor: 'pointer',
              borderRadius: 3, fontSize: 13, color: isSelected ? 'var(--text-primary)' : theme.inputColor,
              background: dropPos === 'inside' ? 'var(--surface-active)' : isSelected ? 'var(--surface-active)' : hover ? 'var(--surface-hover)' : 'transparent',
              outline: dropPos === 'inside' ? '1px dashed var(--accent)' : 'none',
              userSelect: 'none',
              transition: 'background 0.1s',
            }}
          >
            <span style={{ fontSize: 10, width: 14, textAlign: 'center', flexShrink: 0 }}>
              {isExpanded ? '▼' : '▶'}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
              <Folder size={14} style={{ flexShrink: 0 }} /> {item.name}
            </span>
            {arrowBtn(-1)}
            {arrowBtn(1)}
          </div>
          {isExpanded && (item._filteredChildren || item.children) && (item._filteredChildren || item.children).map((child, ci) => (
            <div key={ci} style={{ paddingLeft: 16 }}>
              <TreeNode
                item={child}
                index={ci}
                path={`${path}/${ci}`}
                selectedPath={selectedPath}
                onSelect={onSelect}
                contextMenu={contextMenu}
                onContextMenu={onContextMenu}
                closeContextMenu={closeContextMenu}
                onExecute={onExecute}
                onMove={onMove}
                onDragStart={onDragStart}
                onDropItem={onDropItem}
                onDragEnd={onDragEnd}
                dragVersion={dragVersion}
                theme={theme}
              />
            </div>
          ))}
          {isExpanded && (!item.children || item.children.length === 0) && (
            <div style={{ paddingLeft: 30, fontSize: 11, color: theme.mutedColor, padding: '4px 0 4px 30px', fontStyle: 'italic' }}>
              {t('(空分组，右键添加命令)')}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 普通命令节点
  const isSelected = selectedPath === path;
  return (
    <div style={{ position: 'relative' }}>
      {dropIndicator('before')}
      {dropIndicator('after')}
      <div
        onClick={() => onSelect(path)}
        onDoubleClick={(e) => { e.stopPropagation(); onExecute(item); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, path, 'command', index); }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, false)); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, false)); }}
        onDragLeave={(e) => { e.stopPropagation(); setDropPos(null); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const pos = calcDropPos(e, false); setDropPos(null); onDropItem && onDropItem(path, pos || 'after'); }}
        {...commonDragProps}
        style={{
          display: 'flex', alignItems: 'center', padding: '5px 8px', cursor: 'pointer',
          borderRadius: 3, fontSize: 12, color: isSelected ? 'var(--text-primary)' : theme.inputColor,
          background: isSelected ? 'var(--surface-active)' : hover ? 'var(--surface-hover)' : 'transparent',
          userSelect: 'none',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.name}
        </span>
        {arrowBtn(-1)}
        {arrowBtn(1)}
      </div>
    </div>
  );
}

const QuickCommands = forwardRef(function QuickCommands({ sessionId, addToast, connectedSessions = [], onClose }, ref) {
  const { t } = useTranslation();
  const [commands, setCommands] = useState([]);
  const [selectedPath, setSelectedPath] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [sendTarget, setSendTarget] = useState('current'); // 'current' | 'all'
  // 命令编辑器（悬浮页，替代原底部快速命令栏）
  const [showCmdEditor, setShowCmdEditor] = useState(false);
  const [cmdEditorText, setCmdEditorText] = useState('');
  const [cmdEditorAddCR, setCmdEditorAddCR] = useState(true);
  const [cmdEditorShowOpts, setCmdEditorShowOpts] = useState(false);

  // 编辑/添加对话框
  const [dialog, setDialog] = useState(null); // { type:'add'|'edit', groupPath?, item? }
  const [dlgName, setDlgName] = useState('');
  const [dlgCmd, setDlgCmd] = useState('');
  const [dlgAddCR, setDlgAddCR] = useState(true);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [groupPickerPos, setGroupPickerPos] = useState({ x: 0, y: 0 });

  // 参数历史（按命令缓存，存到文件）
  const [paramHistory, setParamHistory] = useState({});
  // 当前选中命令的参数值（底部内联填写）
  const [paramValues, setParamValues] = useState({});
  // 历史下拉：{ cmdKey, paramNum } — 控制哪个参数的下拉展开
  const [historyDropdown, setHistoryDropdown] = useState(null);
  // 历史下拉内的搜索关键词
  const [historySearch, setHistorySearch] = useState('');
  // 搜索关键词
  const [searchText, setSearchText] = useState('');
  const [rootDragOver, setRootDragOver] = useState(false);
  const [dragVersion, setDragVersion] = useState(0);
  // 是否有未保存的编辑
  const [dirty, setDirty] = useState(false);
  // 切换确认：{ pendingPath } 或 null
  const [confirmUnsaved, setConfirmUnsaved] = useState(null);
  // 分组名称编辑（本地缓存，手动保存）
  const [editGroupName, setEditGroupName] = useState('');
  // 命令编辑（本地缓存，保存时才同步到树，避免每个按键都 cloneAlongPath）
  const [editCmdName, setEditCmdName] = useState('');
  const [editCmdText, setEditCmdText] = useState('');

  const treeRef = useRef(null);
  const groupPickerRef = useRef(null);
  const dragSourceRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 暴露 dirty 状态给父组件（关闭确认）
  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    showCloseConfirm: () => setConfirmUnsaved({ close: true }),
  }));

  // ── 拖拽 ─────────────────────────────────────────────
  const handleDragStart = (path) => {
    dragSourceRef.current = path;
  };

  const clearDrag = () => {
    dragSourceRef.current = null;
    setRootDragOver(false);
    setDragVersion(v => v + 1);
  };

  const parsePath = (path) => path.split('/').map(Number);

  const hasPathPrefix = (parts, prefix) => prefix.every((value, index) => parts[index] === value);

  const adjustPathAfterRemoval = (targetParts, srcParts) => {
    const srcParentParts = srcParts.slice(0, -1);
    const srcIdx = srcParts[srcParts.length - 1];
    if (!hasPathPrefix(targetParts, srcParentParts)) return targetParts;
    const affectedIndex = srcParentParts.length;
    if (targetParts[affectedIndex] > srcIdx) {
      const adjusted = [...targetParts];
      adjusted[affectedIndex] -= 1;
      return adjusted;
    }
    return targetParts;
  };

  // ── 统一处理所有拖放（before / inside / after / root）─
  const handleDropItem = (targetPath, pos) => {
    const srcPath = dragSourceRef.current;
    if (!srcPath || srcPath === targetPath) { clearDrag(); return; }
    if (targetPath.startsWith(srcPath + '/')) { clearDrag(); return; }

    const srcParts = parsePath(srcPath);
    const targetParts = parsePath(targetPath);
    const list = structuredClone(commands);
    const src = resolvePath(list, srcPath);
    if (!src.item) { clearDrag(); return; }

    const [moved] = src.parent.splice(src.idx, 1);
    moved.last_modified = Date.now();

    const adjustedTargetPath = adjustPathAfterRemoval(targetParts, srcParts).join('/');
    const tgt = resolvePath(list, adjustedTargetPath);
    if (!tgt.item) { clearDrag(); return; }

    if (pos === 'inside' && tgt.item.type === 'group') {
      if (!tgt.item.children) tgt.item.children = [];
      tgt.item.children.push(moved);
      tgt.item.expanded = true;
    } else {
      const insertIdx = tgt.idx + (pos === 'after' ? 1 : 0);
      tgt.parent.splice(insertIdx, 0, moved);
    }

    save(list);
    setSelectedPath(null);
    clearDrag();
  };

  const handleDropToRoot = () => {
    const srcPath = dragSourceRef.current;
    if (!srcPath) { clearDrag(); return; }
    const list = structuredClone(commands);
    const src = resolvePath(list, srcPath);
    if (!src.item) { clearDrag(); return; }
    const [moved] = src.parent.splice(src.idx, 1);
    moved.last_modified = Date.now();
    list.push(moved);
    save(list);
    setSelectedPath(null);
    clearDrag();
  };

  // ── 初始化：从文件加载命令和参数历史 ───────────────
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadCommands(),
      (async () => {
        try {
          const raw = await AppGo.GetParamHistory();
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (_) {}
        return {};
      })(),
    ]).then(([data, hist]) => {
      if (cancelled) return;
      if (data.length > 0) setCommands(data);
      setParamHistory(hist);
    });
    return () => { cancelled = true; };
  }, []);

  // 选中项变化时同步本地编辑状态
  useEffect(() => {
    if (!selectedPath) return;
    const { item } = resolvePath(commands, selectedPath);
    if (!item) return;
    if (item.type === 'group') {
      setEditGroupName(item.name || '');
    } else if (!item.children) {
      setEditCmdName(item.name || '');
      setEditCmdText(item.command || '');
    }
  }, [selectedPath, commands]);

  // 组件卸载时自动保存未持久化的编辑
  const commandsRef = useRef(commands);
  const dirtyRef = useRef(dirty);
  commandsRef.current = commands;
  dirtyRef.current = dirty;
  useEffect(() => {
    return () => {
      if (dirtyRef.current && commandsRef.current.length > 0) {
        saveCommands(commandsRef.current);
      }
    };
  }, []);

  // ── 点击外部关闭历史下拉 ───────────────────────────
  useEffect(() => {
    if (!historyDropdown) return;
    const handler = (e) => {
      // 如果点击的是历史按钮或下拉内部，不关闭
      if (e.target.closest('[data-history-dropdown]')) return;
      setHistoryDropdown(null);
      setHistorySearch('');
    };
    // 用 click 捕获，避免 mousedown 阶段干扰面板内其它控件
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [historyDropdown]);

  // ── 持久化到文件（保存 + 重新加载，确保双向一致）──
  const save = async (list) => {
    await saveCommands(list);
    const data = await loadCommands();
    if (data.length > 0) setCommands(data);
  };

  // ── 将本地编辑的命令名/内容写回树 ────────────────────
  // 返回修改后的列表（若无修改返回 null）
  const commitCmdEdit = useCallback(() => {
    if (!selectedPath || dirty === false) return null;
    const sel = resolvePath(commands, selectedPath);
    if (!sel || sel.item.children) return null; // 不是命令节点
    if (sel.item.name === editCmdName && sel.item.command === editCmdText) return null;
    const list = cloneAlongPath(commands, selectedPath);
    const r = resolvePath(list, selectedPath);
    r.parent[r.idx].name = editCmdName;
    r.parent[r.idx].command = editCmdText;
    r.parent[r.idx].last_modified = Date.now();
    setCommands(list);
    return list;
  }, [commands, selectedPath, editCmdName, editCmdText, dirty]);

  // ── 上移/下移 ──────────────────────────────────────
  const handleMove = (path, direction) => {
    const list = structuredClone(commands);
    const { parent, idx } = resolvePath(list, path);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= parent.length) return;
    [parent[idx], parent[newIdx]] = [parent[newIdx], parent[idx]];
    parent[idx].last_modified = Date.now();
    parent[newIdx].last_modified = Date.now();
    save(list);
    setSelectedPath(path.replace(/\/\d+$/, '/' + newIdx));
    closeContextMenu();
  };

  // ── 沿路径浅拷贝各层数组 + 目标节点（避免全树深拷贝）──
  // 用于只修改单一字段的场景：返回新树，路径上各层均为新数组/对象引用
  const cloneAlongPath = (list, path) => {
    const parts = path.split('/').map(Number);
    const newList = [...list];
    let cur = newList;
    for (let i = 0; i < parts.length; i++) {
      const idx = parts[i];
      cur[idx] = { ...cur[idx] };
      if (i < parts.length - 1) {
        cur[idx].children = [...(cur[idx].children || [])];
        cur = cur[idx].children;
      }
    }
    return newList;
  };

  // ── 从 path 定位节点 ─────────────────────────────────
  const resolvePath = (list, path) => {
    const parts = path.split('/').map(Number);
    let cur = list;
    let parent = null;
    let idx = -1;
    for (let i = 0; i < parts.length; i++) {
      parent = cur;
      idx = parts[i];
      if (i === parts.length - 1) return { parent, idx, item: cur[idx] };
      cur = cur[idx].children || [];
    }
    return { parent: null, idx: -1, item: null };
  };

  // ── 递归收集所有分组 ──────────────────────────────────
  const collectGroups = (list, basePath = '') => {
    const groups = [];
    if (!Array.isArray(list)) return groups;
    list.forEach((item, i) => {
      const path = basePath ? `${basePath}/${i}` : String(i);
      if (item.type === 'group') {
        groups.push({ name: item.name, path, children: item.children || [] });
        if (item.children) {
          groups.push(...collectGroups(item.children, path));
        }
      }
    });
    return groups;
  };

  // ── 选中处理 ────────────────────────────────────────
  const handleSelect = (path) => {
    // 先将当前命令编辑写回树
    commitCmdEdit();
    // 切换选中时如果有未保存修改，弹出确认框
    if (selectedPath && selectedPath !== path && dirty) {
      setConfirmUnsaved({ pendingPath: path });
      return;
    }
    setSelectedPath(path);
    setContextMenu(null);
    const { item } = resolvePath(commands, path);
    // 点击分组：切换展开/折叠，并在右侧显示分组详情
    if (item?.type === 'group') {
      const list = cloneAlongPath(commands, path);
      const r = resolvePath(list, path);
      r.item.expanded = !r.item.expanded;
      setCommands(list);
      saveCommandsLocal(list);
      // 保留选中状态以便右侧显示分组详情
      setParamValues({});
      setDirty(false);
      return;
    }
    // 点击命令：加载历史参数值
    if (item?.command) {
      const params = extractParams(item.command);
      const hist = paramHistory[item.command] || {};
      const initial = {};
      params.forEach(p => { initial[p.num] = (hist[p.num]?.[0]) || ''; });
      setParamValues(initial);
    } else {
      setParamValues({});
    }
    setDirty(false);
  };

  // ── 切换确认：保存 ──────────────────────────────────
  const handleConfirmSave = () => {
    if (!confirmUnsaved) return;
    const isClose = confirmUnsaved.close;
    const path = confirmUnsaved.pendingPath;
    const committed = commitCmdEdit();
    save(committed || commands);
    setDirty(false);
    dirtyRef.current = false;
    setConfirmUnsaved(null);
    if (isClose) {
      onClose?.();
    } else if (path) {
      // 判断目标是否为分组
      const { item } = resolvePath(commands, path);
      if (item?.type === 'group') {
        // 分组：切换展开/折叠，并在右侧显示分组详情
        const list = structuredClone(commands);
        const r = resolvePath(list, path);
        r.item.expanded = !r.item.expanded;
        setCommands(list);
        saveCommandsLocal(list);
        // 保留选中状态以便右侧显示分组详情
        setParamValues({});
        return;
      }
      // 继续跳转到目标
      setSelectedPath(path);
      setContextMenu(null);
      if (item?.command) {
        const params = extractParams(item.command);
        const hist = paramHistory[item.command] || {};
        const initial = {};
        params.forEach(p => { initial[p.num] = (hist[p.num]?.[0]) || ''; });
        setParamValues(initial);
      } else {
        setParamValues({});
      }
    }
  };

  // ── 切换确认：不保存 ────────────────────────────────
  const handleConfirmDiscard = async () => {
    if (!confirmUnsaved) return;
    const isClose = confirmUnsaved.close;
    const path = confirmUnsaved.pendingPath;
    setConfirmUnsaved(null);
    setDirty(false);
    dirtyRef.current = false;
    if (isClose) {
      onClose?.();
    } else if (path) {
      // 判断目标是否为分组
      const { item: currentItem } = resolvePath(commands, path);
      const data = await loadCommands();
      // 组件可能已卸载，避免 setState 内存泄漏
      if (!mountedRef.current) return;
      setCommands(data);
      if (currentItem?.type === 'group') {
        // 分组：切换展开/折叠，并在右侧显示分组详情
        const list = structuredClone(data);
        const r = resolvePath(list, path);
        if (r.item) r.item.expanded = !r.item.expanded;
        setCommands(list);
        saveCommandsLocal(list);
        // 保留选中状态以便右侧显示分组详情
        setParamValues({});
        return;
      }
      // 继续跳转到目标
      setSelectedPath(path);
      setContextMenu(null);
      const { item } = resolvePath(data, path);
      if (item?.command) {
        const params = extractParams(item.command);
        const hist = paramHistory[item.command] || {};
        const initial = {};
        params.forEach(p => { initial[p.num] = (hist[p.num]?.[0]) || ''; });
        setParamValues(initial);
      } else {
        setParamValues({});
      }
    }
  };

  // ── 切换确认：取消 ──────────────────────────────────
  const handleConfirmCancel = () => {
    setConfirmUnsaved(null);
  };

  const getSelectedItem = () => {
    if (!selectedPath) return null;
    const { item } = resolvePath(commands, selectedPath);
    return item;
  };

  // ── 右键菜单 ────────────────────────────────────────
  const handleContextMenu = (e, path, type, index) => {
    const rect = treeRef.current?.getBoundingClientRect?.() || { left: 0, top: 0 };
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path,
      type,
      index,
    });
    setSelectedPath(path);
  };

  const closeContextMenu = () => setContextMenu(null);

  const doContextAction = async (action) => {
    if (!contextMenu) return;
    const { path, type, index } = contextMenu;
    const parts = path.split('/').map(Number);
    closeContextMenu();

    if (action === 'addGroup') {
      setDialog({ type: 'addGroup', contextPath: path, parentList: commands });
      setDlgName('');
      setDlgCmd('');
      setDlgAddCR(true);
      return;
    }

    if (action === 'addCmd') {
      const list = structuredClone(commands);
      // 用 resolvePath 找到目标分组
      const r = resolvePath(list, path);
      let targetChildren = list;
      if (r?.item?.type === 'group') {
        if (!r.item.children) r.item.children = [];
        targetChildren = r.item.children;
      }
      setDialog({ type: 'add', targetChildren, parentList: list, groupName: r?.item?.name || '' });
      setDlgName('');
      setDlgCmd('');
      setDlgAddCR(true);
      return;
    }

    if (action === 'edit' && type === 'command') {
      const { parent, idx } = resolvePath(commands, path);
      const item = parent[idx];
      setDialog({ type: 'edit', parent, idx });
      setDlgName(item.name || '');
      setDlgCmd(item.command || '');
      setDlgAddCR(item.addCR !== false);
      return;
    }

    if (action === 'editGroup' && type === 'group') {
      const { parent, idx } = resolvePath(commands, path);
      setDialog({ type: 'editGroup', contextPath: path });
      setDlgName(parent[idx].name || '');
      setDlgCmd('');
      setDlgAddCR(true);
      return;
    }

    if (action === 'delete') {
      try {
        const list = structuredClone(commands);
        const r = resolvePath(list, path);
        r.parent.splice(r.idx, 1);
        await AppGo.SaveQuickCommands(JSON.stringify(list));
        setCommands(list);
        setSelectedPath(null);
        if (addToast) addToast(t('已删除'), 'success', 1500);
      } catch {
        // 删除失败，重新从文件加载以确保状态一致
        const data = await loadCommands();
        if (data.length > 0) setCommands(data);
        if (addToast) addToast(t('删除失败'), 'error', 2000);
      }
      return;
    }

    if (action === 'execute') {
      const { item } = resolvePath(commands, path);
      if (item && item.command) doExecute(item);
      return;
    }
  };

  // ── 对话框保存 ──────────────────────────────────────
  const handleDlgSave = () => {
    if (!dlgName.trim()) return;
    const isGroup = dialog.type === 'addGroup' || dialog.type === 'editGroup';

    if (isGroup) {
      // 添加/编辑分组：只需要名称
      if (dialog.type === 'addGroup') {
        const list = structuredClone(dialog.parentList || commands);
        const parts = (dialog.contextPath || '').split('/').map(Number);
        if (dialog.contextPath && parts.length === 1 && list[parts[0]]?.type === 'group') {
          list[parts[0]].children = [...(list[parts[0]].children || []), { type: 'group', name: dlgName.trim(), expanded: true, children: [], last_modified: Date.now() }];
        } else if (dialog.contextPath) {
          let cur = list;
          for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]].children || [];
          cur.splice(parts[parts.length - 1] + 1, 0, { type: 'group', name: dlgName.trim(), expanded: true, children: [], last_modified: Date.now() });
        } else {
          list.push({ type: 'group', name: dlgName.trim(), expanded: true, children: [], last_modified: Date.now() });
        }
        save(list);
      } else if (dialog.type === 'editGroup') {
        const list = cloneAlongPath(commands, dialog.contextPath);
        const r = resolvePath(list, dialog.contextPath);
        r.parent[r.idx].name = dlgName.trim();
        r.parent[r.idx].last_modified = Date.now();
        save(list);
      }
      setDialog(null);
      return;
    }

    // 命令：需要名称和命令内容
    if (!dlgCmd.trim()) return;
    const newItem = { name: dlgName.trim(), command: dlgCmd.trim(), addCR: dlgAddCR, last_modified: Date.now() };

    if (dialog.type === 'add') {
      dialog.targetChildren.push(newItem);
      save(dialog.parentList);
    } else if (dialog.type === 'edit') {
      const list = cloneAlongPath(commands, selectedPath);
      const r = resolvePath(list, selectedPath);
      r.parent[r.idx] = { ...r.parent[r.idx], ...newItem };
      setEditCmdName(newItem.name);
      setEditCmdText(newItem.command);
      setDirty(false);
      save(list);
    }
    setDialog(null);
  };

  // ── 执行命令（使用底部内联参数值）────────────────────
  const doExecute = (item) => {
    if (!item?.command) return;
    sendCommand(item.command, paramValues, item.addCR !== false);
  };

  const sendCommand = (cmd, values, addCR) => {
    const filled = fillParams(cmd, values);
    const finalCmd = addCR !== false ? filled + '\r' : filled;

    // 保存参数历史（每个参数存为数组，用于下拉列表）
    if (Object.keys(values).length > 0) {
      const pHist = { ...paramHistory, [cmd]: { ...(paramHistory[cmd] || {}) } };
      Object.entries(values).forEach(([num, val]) => {
        if (!val) return;
        const arr = pHist[cmd][num] || [];
        // 去重：移除相同值，再插入到最前面
        const filtered = arr.filter(v => v !== val);
        filtered.unshift(val);
        // 最多保留 20 条
        pHist[cmd][num] = filtered.slice(0, 20);
      });
      setParamHistory(pHist);
      AppGo.SaveParamHistory(JSON.stringify(pHist)).catch(() => {});
    }

    window.dispatchEvent(new CustomEvent('ssh-command-history', {
      detail: { sessionId, command: filled, time: new Date().toISOString(), source: 'input' }
    }));

    if (sendTarget === 'all' && connectedSessions.length > 0) {
      connectedSessions.forEach(s => {
        AppGo.WriteTerminal(s.id, finalCmd).catch((err) => {
          console.error('WriteTerminal failed:', err);
        });
      });
      if (addToast) addToast(t('已发送到 ') + connectedSessions.length + t(' 个会话'), 'info', 2000);
    } else {
      AppGo.WriteTerminal(sessionId, finalCmd).catch((err) => {
        console.error('WriteTerminal failed:', err);
      });
      if (addToast) addToast(t('已发送指令到终端'), 'info', 2000);
    }
  };

  // ── 命令编辑器：发送临时命令（不保存） ────────────────
  const sendEditorCommand = () => {
    const cmd = cmdEditorText.replace(/\r\n?/g, '\n');
    const text = cmd.trim();
    if (!text) return;
    const finalCmd = cmdEditorAddCR ? (text + '\r') : text;
    if (sendTarget === 'all' && connectedSessions.length > 0) {
      connectedSessions.forEach(s => AppGo.WriteTerminal(s.id, finalCmd).catch((err) => {
        console.error('WriteTerminal failed:', err);
      }));
      if (addToast) addToast(t('已发送到 ') + connectedSessions.length + t(' 个会话'), 'info', 2000);
    } else {
      AppGo.WriteTerminal(sessionId, finalCmd).catch((err) => {
        console.error('WriteTerminal failed:', err);
      });
      if (addToast) addToast(t('已发送'), 'info', 1500);
    }
  };

  // ── 插入参数按钮 ────────────────────────────────────
  const insertParam = (n) => {
    const tag = `[p#${n} ${t('参数')}${n}]`;
    setDlgCmd(prev => prev + tag);
  };

  // ── 通用样式 ──────────────────────────────────────
  const C = getTerminalTheme().container;
  const inputStyle = {
    padding: '5px 8px', fontSize: 12, borderRadius: 3,
    background: C.inputBg, border: '1px solid ' + C.btnBorder,
    color: C.inputColor, outline: 'none', fontFamily: 'inherit',
    width: '100%', boxSizing: 'border-box',
  };

  const selectedItem = useMemo(() => getSelectedItem(), [selectedPath, commands]);

  // ── 内联样式常量（使用主题色）──
  const _menuItemStyle = {
    padding: '6px 14px', cursor: 'pointer', color: C.inputColor,
    display: 'flex', alignItems: 'center', gap: 6,
    transition: 'background 0.1s',
    _hover: { background: 'var(--surface-hover)' },
  };

  const _menuSepStyle = {
    height: 1, background: C.separator, margin: '4px 0',
  };

  const _labelStyle = {
    fontSize: 11, color: C.statusBarColor, display: 'block', marginBottom: 4,
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.popupBg, fontFamily: 'var(--font-ui)', overflow: 'hidden' }}
    >
      {/* ── 工具栏 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        <button
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
          className="btn btn-primary btn-sm"
        >{t('＋ 添加命令')}</button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => { closeContextMenu(); setDialog({ type: 'addGroup', contextPath: '', parentList: commands }); setDlgName(''); setDlgCmd(''); setDlgAddCR(true); }}
        ><FolderPlus size={14} /> {t('添加分组')}</button>
        <button
          type="button"
          className={`btn btn-secondary btn-sm${showCmdEditor ? ' active' : ''}`}
          aria-pressed={showCmdEditor}
          onClick={() => {
            closeContextMenu();
            setShowCmdEditor((v) => !v);
            setCmdEditorShowOpts(false);
          }}
          style={showCmdEditor ? {
            color: 'var(--text-primary)',
            background: 'var(--surface-active)',
            borderColor: 'var(--accent)',
          } : undefined}
        >{t('命令编辑器')}</button>
        <div style={{ flex: 1 }} />
        {onClose && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (dirty) {
                setConfirmUnsaved({ close: true });
                return;
              }
              onClose();
            }}
            aria-label={t('关闭')}
            style={{ padding: '2px 6px' }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── 主体：左右分栏 / 命令编辑器 ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {showCmdEditor ? (
          /* 内嵌命令编辑器（占满面板，不居中弹窗） */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            <div style={{ padding: 12, flex: 1, minHeight: 0, display: 'flex' }}>
              <textarea
                value={cmdEditorText}
                onChange={(e) => setCmdEditorText(e.target.value)}
                autoFocus
                spellCheck={false}
                placeholder={t('在此输入要发送的命令…')}
                style={{
                  ...inputStyle,
                  flex: 1,
                  width: '100%',
                  minHeight: 0,
                  resize: 'none',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowCmdEditor(false);
                    setCmdEditorShowOpts(false);
                  }
                }}
              />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px',
              borderTop: '1px solid var(--border-subtle)',
              flexShrink: 0,
              position: 'relative',
            }}>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCmdEditorShowOpts((v) => !v)}
                >{t('选项')}</button>
                {cmdEditorShowOpts && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: 0,
                      bottom: 'calc(100% + 6px)',
                      zIndex: 2,
                      minWidth: 180,
                      padding: '8px 10px',
                      background: C.popupBg,
                      border: '1px solid ' + C.btnBorder,
                      borderRadius: 6,
                      boxShadow: 'var(--shadow-md)',
                    }}
                  >
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 12, color: C.inputColor, cursor: 'pointer',
                    }}>
                      <input
                        type="checkbox"
                        checked={cmdEditorAddCR}
                        onChange={(e) => setCmdEditorAddCR(e.target.checked)}
                        style={{ accentColor: 'var(--success)' }}
                      />
                      {t('末尾添加回车符CR')}
                    </label>
                  </div>
                )}
              </div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: C.mutedColor }}>{t('发送到')}</span>
              <select
                value={sendTarget}
                onChange={(e) => setSendTarget(e.target.value)}
                style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 4,
                  background: C.inputBg, border: '1px solid ' + C.btnBorder,
                  color: C.inputColor, outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="current">{t('当前会话')}</option>
                {connectedSessions.length > 1 && (
                  <option value="all">{t('全部会话')} ({connectedSessions.length})</option>
                )}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={sendEditorCommand}
                disabled={!cmdEditorText.trim()}
              ><Rocket size={14} /> {t('发送')}</button>
            </div>
          </div>
        ) : (
          <>
        {/* ── 左侧树形列表 ── */}
        <div
          ref={treeRef}
          onClick={(e) => { if (e.target === e.currentTarget) { setSelectedPath(null); closeContextMenu(); } }}
          onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
          onDragEnter={(e) => { e.preventDefault(); setRootDragOver(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setRootDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); handleDropToRoot(); }}
          style={{
            width: 220, flexShrink: 0, borderRight: '1px solid var(--border-subtle)',
            overflowY: 'auto', padding: '4px 6px',
            background: rootDragOver ? 'var(--surface-active)' : C.inputBg,
            outline: rootDragOver ? '1px dashed var(--accent)' : 'none',
            display: 'flex', flexDirection: 'column',
            transition: 'background 0.1s',
          }}
        >
          {/* 搜索框 */}
          <div style={{ padding: '2px 2px 6px', flexShrink: 0 }}>
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('搜索命令...')}
              style={{
                ...inputStyle,
                width: '100%', boxSizing: 'border-box',
                fontSize: 11, padding: '4px 8px',
                borderRadius: 4,
              }}
            />
          </div>
          {/* 命令树（带搜索过滤） */}
          <div
            style={{ flex: 1, overflowY: 'auto' }}
            onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); setRootDragOver(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setRootDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); handleDropToRoot(); }}
          >
            {(() => {
              const displayed = filterTree(commands, searchText);
              return displayed.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: C.mutedColor, fontSize: 12 }}>
                  {searchText ? t('无匹配结果') : t('点击上方按钮添加命令')}
                </div>
              ) : (
                displayed.map((item, i) => (
                  <TreeNode
                    key={item.name + '_' + i}
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
                    theme={C}
                  />
                ))
              );
            })()}
          </div>
        </div>

        {/* ── 右侧编辑器 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {/* 选中了分组 → 显示分组信息 */}
          {selectedItem && selectedItem.type === 'group' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', gap: 10, minHeight: 0, overflow: 'auto' }}>
              <div>
                <label style={{ fontSize: 11, color: C.statusBarColor, display: 'block', marginBottom: 4 }}>{t('分组名称')}</label>
                <input
                  type="text"
                  value={editGroupName}
                  onChange={e => setEditGroupName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  onClick={() => {
                    const list = structuredClone(commands);
                    const r = resolvePath(list, selectedPath);
                    r.parent[r.idx].name = editGroupName.trim() || selectedItem.name;
                    save(list);
                  }}
                  className="btn btn-primary btn-sm"
                ><Save size={13} /> {t('保存名称')}</button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const list = structuredClone(commands);
                    const r = resolvePath(list, selectedPath);
                    if (!r.item.children) r.item.children = [];
                    setDialog({ type: 'add', targetChildren: r.item.children, parentList: list, groupName: r.item.name });
                    setDlgName(''); setDlgCmd(''); setDlgAddCR(true);
                  }}
                >{t('＋ 添加命令')}</button>
              </div>
              <div style={{ fontSize: 12, color: C.mutedColor, marginTop: 8 }}>
                {selectedItem.children?.length || 0} {t('个命令/子分组')}
              </div>
            </div>
          ) : selectedItem ? (
            /* 选中命令：内容可滚，发送栏固定在底部（不随滚动悬浮） */
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              minHeight: 0, overflow: 'hidden',
            }}>
              <div style={{
                flex: 1, minHeight: 0, overflow: 'auto',
                padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
              }}>
              {/* 第一行：命令名徽章 + 命令预览 + 编辑 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                padding: '8px 10px',
                background: C.inputBg,
                border: '1px solid ' + C.btnBorder,
                borderRadius: 6,
              }}>
                <span className="badge" style={{ flexShrink: 0 }}>
                  {editCmdName || selectedItem.name || t('未命名命令')}
                </span>
                <span
                  style={{
                    flex: 1, minWidth: 0,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    color: C.inputColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={editCmdText || selectedItem.command || ''}
                >
                  {editCmdText || selectedItem.command || ''}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    setDialog({ type: 'edit' });
                    setDlgName(editCmdName || selectedItem.name || '');
                    setDlgCmd(editCmdText || selectedItem.command || '');
                    setDlgAddCR(selectedItem.addCR !== false);
                  }}
                ><SquarePen size={13} /> {t('编辑')}</button>
              </div>

              {/* 第二行：参数输入（标签在框外，输入框 + 历史） */}
              {(() => {
                const params = extractParams(editCmdText || selectedItem.command || '');
                if (params.length === 0) {
                  return (
                    <div style={{ flex: 1, minHeight: 12 }} />
                  );
                }
                const cmdKey = editCmdText || selectedItem.command || '';
                return (
                  <div style={{ overflowX: 'auto', overflowY: 'visible', flexShrink: 0, paddingBottom: 4 }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      {params.map(p => {
                        const isOpen = historyDropdown?.cmdKey === cmdKey && historyDropdown.paramNum === p.num;
                        const histList = (paramHistory[cmdKey]?.[p.num]) || [];
                        return (
                          <div key={p.num} style={{ position: 'relative', flexShrink: 0 }}>
                            <span style={{
                              fontSize: 12, fontWeight: 600,
                              color: 'var(--text-primary, ' + C.inputColor + ')',
                              display: 'block', marginBottom: 4,
                            }}>
                              {p.label || `${t('参数')}${p.num}`}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="text"
                                value={paramValues[p.num] || ''}
                                onChange={e => setParamValues(prev => ({ ...prev, [p.num]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') doExecute(selectedItem); }}
                                placeholder={p.label || `p#${p.num}`}
                                style={{
                                  ...inputStyle, width: 120,
                                  fontSize: 12, padding: '5px 8px',
                                  fontFamily: "'JetBrains Mono', monospace",
                                  color: 'var(--text-primary, ' + C.inputColor + ')',
                                  border: '1px solid var(--border, ' + C.btnBorder + ')',
                                  background: 'var(--surface-raised, ' + C.inputBg + ')',
                                }}
                              />
                              <button
                                type="button"
                                data-history-dropdown="true"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (isOpen) {
                                    setHistoryDropdown(null);
                                    setHistorySearch('');
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setHistoryDropdown({
                                      cmdKey,
                                      paramNum: p.num,
                                      left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
                                      top: Math.min(rect.bottom + 4, window.innerHeight - 240),
                                    });
                                    setHistorySearch('');
                                  }
                                }}
                                style={{
                                  background: isOpen ? 'var(--surface-active)' : 'var(--surface-raised)',
                                  border: '1px solid var(--border, ' + C.btnBorder + ')',
                                  color: 'var(--accent)',
                                  borderRadius: 4,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: '5px 10px',
                                  whiteSpace: 'nowrap',
                                  lineHeight: 1.2,
                                  position: 'relative',
                                  zIndex: 2,
                                }}
                              >{t('历史')}</button>
                            </div>
                            {isOpen && createPortal(
                              <div
                                data-history-dropdown="true"
                                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                                onClick={e => e.stopPropagation()}
                                style={{
                                  position: 'fixed',
                                  left: historyDropdown.left ?? 0,
                                  top: historyDropdown.top ?? 0,
                                  zIndex: Z.MENU,
                                  minWidth: 200, maxHeight: 220, display: 'flex', flexDirection: 'column',
                                  background: 'var(--surface-raised, ' + C.popupBg + ')',
                                  border: '1px solid var(--border, ' + C.btnBorder + ')',
                                  borderRadius: 6,
                                  boxShadow: 'var(--shadow-md)',
                                }}
                              >
                                <div style={{ padding: 6, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
                                  <input
                                    type="text"
                                    autoFocus
                                    value={historySearch}
                                    onChange={e => setHistorySearch(e.target.value)}
                                    placeholder={t('搜索历史...')}
                                    style={{
                                      ...inputStyle, width: '100%', boxSizing: 'border-box',
                                      fontSize: 12, padding: '5px 8px',
                                      borderRadius: 4,
                                      color: C.inputColor,
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') { setHistoryDropdown(null); setHistorySearch(''); }
                                    }}
                                  />
                                </div>
                                <div
                                  onClick={() => {
                                    const pHist = { ...paramHistory, [cmdKey]: { ...(paramHistory[cmdKey] || {}) } };
                                    if (pHist[cmdKey][p.num]) {
                                      pHist[cmdKey][p.num] = [];
                                      setParamHistory(pHist);
                                      AppGo.SaveParamHistory(JSON.stringify(pHist)).catch(() => {});
                                    }
                                    setHistoryDropdown(null);
                                    setHistorySearch('');
                                  }}
                                  style={{
                                    padding: '6px 12px', fontSize: 12, color: 'var(--danger)',
                                    cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
                                    flexShrink: 0, fontWeight: 600,
                                  }}
                                >{t('清空列表')}</div>
                                <div style={{ flex: 1, overflowY: 'auto' }}>
                                  {(() => {
                                    const filtered = historySearch
                                      ? histList.filter(v => v.toLowerCase().includes(historySearch.toLowerCase()))
                                      : histList;
                                    return filtered.length === 0 ? (
                                      <div style={{ padding: '8px 12px', fontSize: 12, color: C.mutedColor }}>
                                        {historySearch ? t('无匹配结果') : t('暂无历史')}
                                      </div>
                                    ) : filtered.map((val, i) => (
                                      <div
                                        key={i}
                                        onClick={() => {
                                          setParamValues(prev => ({ ...prev, [p.num]: val }));
                                          setHistoryDropdown(null);
                                          setHistorySearch('');
                                        }}
                                        style={{
                                          padding: '7px 12px', fontSize: 12,
                                          color: C.inputColor, cursor: 'pointer',
                                          fontFamily: "'JetBrains Mono', monospace",
                                          borderBottom: '1px solid var(--border-subtle)',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                      >{val}</div>
                                    ));
                                  })()}
                                </div>
                              </div>,
                              document.body
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              </div>

              {/* 第三行：CR + 发送目标 + 发送（固定在右侧底部，不随内容滚动） */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                padding: '8px 12px',
                borderTop: '1px solid var(--border-subtle)',
                background: C.popupBg,
              }}>
                <label style={{ fontSize: 11, color: C.statusBarColor, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedItem.addCR !== false}
                    onChange={(e) => {
                      const list = structuredClone(commands);
                      const r = resolvePath(list, selectedPath);
                      r.parent[r.idx].addCR = e.target.checked;
                      save(list);
                    }}
                    style={{ accentColor: 'var(--success)' }}
                  />
                  {t('末尾添加回车符CR')}
                </label>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: C.mutedColor }}>{t('发送到')}</span>
                  <select
                    value={sendTarget}
                    onChange={(e) => setSendTarget(e.target.value)}
                    style={{
                      fontSize: 11, padding: '2px 6px', borderRadius: 3,
                      background: C.inputBg, border: '1px solid ' + C.btnBorder,
                      color: C.inputColor, outline: 'none', cursor: 'pointer',
                    }}
                  >
                    <option value="current">{t('当前会话')}</option>
                    {connectedSessions.length > 1 && (
                      <option value="all">{t('全部会话')} ({connectedSessions.length})</option>
                    )}
                  </select>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => doExecute(selectedItem)}
                ><Rocket size={14} /> {t('发送')}</button>
              </div>
            </div>
          ) : (
            /* 未选中任何项 */
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mutedColor, fontSize: 13, flexDirection: 'column', gap: 8 }}>
              <div style={{ opacity: 0.2 }}><Zap size={40} /></div>
              <div>{t('选择左侧命令或添加新命令')}</div>
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {/* ── 右键上下文菜单 ── */}
      {contextMenu && (
        <>
          <div onClick={closeContextMenu} style={{ position: 'fixed', inset: 0, zIndex: Z.MENU_BACKDROP, background: 'transparent' }} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: Z.MENU,
            background: C.popupBg, border: '1px solid ' + C.btnBorder, borderRadius: 6,
            boxShadow: 'var(--shadow-md)', padding: '4px 0', minWidth: 160,
            fontSize: 12,
          }}>
            {contextMenu.type === 'group' ? (
              <>
                <div onClick={() => doContextAction('addCmd')} style={_menuItemStyle}>{t('＋ 添加命令')}</div>
                <div onClick={() => doContextAction('addGroup')} style={_menuItemStyle}><FolderPlus size={14} /> {t('添加子分组')}</div>
                <div style={_menuSepStyle} />
                <div onClick={() => doContextAction('editGroup')} style={_menuItemStyle}><Pencil size={14} /> {t('重命名分组')}</div>
                <div style={_menuSepStyle} />
                <div onClick={() => doContextAction('delete')} style={{ ..._menuItemStyle, color: 'var(--danger)' }}><Trash2 size={14} /> {t('删除分组')}</div>
              </>
            ) : (
              <>
                <div onClick={() => doContextAction('execute')} style={_menuItemStyle}><Rocket size={14} /> {t('执行')}</div>
                <div onClick={() => doContextAction('edit')} style={_menuItemStyle}><SquarePen size={14} /> {t('编辑')}</div>
                <div style={_menuSepStyle} />
                <div onClick={() => doContextAction('delete')} style={{ ..._menuItemStyle, color: 'var(--danger)' }}><Trash2 size={14} /> {t('删除')}</div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── 未保存修改确认对话框 ── */}
      {confirmUnsaved && (
        <>
          <div onClick={handleConfirmCancel} style={{ position: 'fixed', inset: 0, zIndex: Z.DIALOG_BACKDROP, background: 'rgba(0,0,0,0.4)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: Z.DIALOG,
            width: 360, background: C.popupBg, border: '1px solid ' + C.btnBorder, borderRadius: 8,
            boxShadow: 'var(--shadow-md)', padding: '16px 20px',
          }}>
            <div style={{ fontSize: 14, color: C.inputColor, marginBottom: 14, fontWeight: 600 }}>
              {t('未保存的修改')}
            </div>
            <div style={{ fontSize: 12, color: C.statusBarColor, marginBottom: 16 }}>
              {t('当前命令有未保存的修改，是否保存？')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={handleConfirmCancel}>{t('取消')}</button>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmDiscard}>{t('不保存')}</button>
              <button className="btn btn-primary btn-sm" onClick={handleConfirmSave}>{t('保存')}</button>
            </div>
          </div>
        </>
      )}

      {/* ── 添加/编辑对话框（覆盖层） ── */}
      {dialog && (
        <>
          <div onClick={() => setShowGroupPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: Z.DIALOG_BACKDROP, background: 'rgba(0,0,0,0.4)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: Z.DIALOG,
            width: 480, background: C.popupBg, border: '1px solid ' + C.btnBorder, borderRadius: 8,
            boxShadow: 'var(--shadow-md)', padding: '16px 20px',
          }}>
            <div style={{ fontSize: 14, color: C.inputColor, marginBottom: 14, fontWeight: 600 }}>
              {dialog.type === 'addGroup' ? t('添加分组') : dialog.type === 'editGroup' ? t('重命名分组') : dialog.type === 'add' ? t('添加命令') : t('编辑命令')}
            </div>

            {/* 添加到提示（仅添加命令时显示） */}
            {dialog.type === 'add' && (
              <div style={{ fontSize: 12, color: C.mutedColor, marginBottom: 12, userSelect: 'none' }}>
                <span style={{ marginRight: 6 }}>{t('添加到:')}</span>
                <span
                  ref={groupPickerRef}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setGroupPickerPos({ x: rect.left, y: rect.bottom + 4 });
                    setShowGroupPicker(prev => !prev);
                  }}
                  className="badge"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  {dialog.groupName || t('根目录')}
                  <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
                </span>
              </div>
            )}

            {/* 名称 */}
            <div style={{ marginBottom: 12 }}>
              <label style={_labelStyle}>{t('名称')}</label>
              <input
                type="text"
                value={dlgName}
                onChange={e => setDlgName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleDlgSave(); } }}
                autoFocus
                style={inputStyle}
                placeholder={dialog.type === 'addGroup' || dialog.type === 'editGroup' ? t('如：系统监控') : t('如：查看内存')}
              />
            </div>

            {/* 命令区域（仅命令类型显示） */}
            {dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && (
              <>
              <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={_labelStyle}>{t('命令')}</label>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[1,2,3,4,5].map(n => (
                    <Tiptop key={n} text={t('插入参数 p#') + n}>
                      <button
                        onClick={() => insertParam(n)}
                        aria-label={t('插入参数 p#') + n}
                        style={{
                          background: 'transparent', border: '1px solid ' + C.btnBorder, borderRadius: 3,
                          color: C.statusBarColor, fontSize: 10, cursor: 'pointer', padding: '1px 6px',
                          fontFamily: 'monospace',
                        }}
                      >{t('参数')}{n}</button>
                    </Tiptop>
                  ))}
                </div>
              </div>
              <textarea
                value={dlgCmd}
                onChange={e => setDlgCmd(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.5, minHeight: 70 }}
                placeholder={t('如：free -m')}
              />

              {/* 参数预览 */}
              {extractParams(dlgCmd).length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--warning)' }}>
                  {t('含')} {extractParams(dlgCmd).length} {t('个动态参数：')}{extractParams(dlgCmd).map(p => `[p#${p.num}${p.label ? ' ' + p.label : ''}]`).join(', ')}
                </div>
              )}
            </div>
            </>
            )}

            {/* 末尾添加回车符 */}
            {dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, cursor: 'pointer', fontSize: 12, color: C.statusBarColor }}>
              <input
                type="checkbox"
                checked={dlgAddCR}
                onChange={e => setDlgAddCR(e.target.checked)}
                style={{ accentColor: 'var(--success)' }}
              />
              {t('末尾添加回车符CR')}
            </label>
            )}

            {/* 按钮 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setShowGroupPicker(false); setDialog(null); }}
              >{t('取消')}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleDlgSave}
                disabled={!dlgName.trim() || (dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && !dlgCmd.trim())}
              >{t('保存')}</button>
            </div>
          </div>

          {/* ── 分组选择器下拉菜单 ── */}
          {showGroupPicker && (
            <>
              {/* 点击外部关闭 */}
              <div
                onClick={() => setShowGroupPicker(false)}
                style={{ position: 'fixed', inset: 0, zIndex: Z.SUBMENU_BACKDROP, background: 'transparent' }}
              />
              {/* 下拉列表 */}
              <div style={{
                position: 'fixed', left: groupPickerPos.x, top: groupPickerPos.y, zIndex: Z.SUBMENU,
                minWidth: 160, maxHeight: 220, overflowY: 'auto',
                background: C.popupBg, border: '1px solid ' + C.btnBorder, borderRadius: 6,
                boxShadow: 'var(--shadow-md)', padding: '4px 0',
              }}>
                {/* 根目录 */}
                <div
                  onClick={() => {
                    setDialog(prev => ({ ...prev, targetChildren: prev.parentList, groupName: '' }));
                    setShowGroupPicker(false);
                  }}
                  style={{
                    padding: '5px 14px', fontSize: 12, color: C.inputColor, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                ><Folder size={14} /> {t('根目录')}</div>
                {/* 所有分组 */}
                {(() => {
                  const groups = collectGroups(commands);
                  return groups.length === 0 ? (
                    <div style={{ padding: '6px 14px', fontSize: 11, color: C.btnMuted }}>{t('暂无分组')}</div>
                  ) : groups.map((g, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        setDialog(prev => {
                          const list = structuredClone(prev.parentList);
                          const r = resolvePath(list, g.path);
                          if (r?.item?.type === 'group') {
                            if (!r.item.children) r.item.children = [];
                            return { ...prev, parentList: list, targetChildren: r.item.children, groupName: g.name };
                          }
                          return prev;
                        });
                        setShowGroupPicker(false);
                      }}
                      style={{
                        padding: '5px 14px', fontSize: 12, color: C.inputColor, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    ><Folder size={14} /> {g.name}</div>
                  ));
                })()}
              </div>
            </>
          )}
        </>
      )}

    </div>
  );
});

export default QuickCommands;
