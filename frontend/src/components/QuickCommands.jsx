import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';

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
  } catch (_) {}
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
function TreeNode({ item, index, path, selectedPath, onSelect, onDelete, onAddCmd, onAddGroup, contextMenu, onContextMenu, closeContextMenu, onExecute, onMove, onDragStart, onDropItem, onDragEnd, dragVersion }) {
  const [hover, setHover] = useState(false);
  const [dropPos, setDropPos] = useState(null); // 'before' | 'inside' | 'after'

  useEffect(() => { setDropPos(null); }, [dragVersion]);

  const arrowBtn = (dir) => (
    <span
      onClick={(e) => { e.stopPropagation(); onMove && onMove(path, dir); }}
      style={{
        fontSize: 10, cursor: 'pointer', color: '#6e7681', padding: '0 3px',
        visibility: hover ? 'visible' : 'hidden', lineHeight: '14px',
        userSelect: 'none',
      }}
      title={dir === -1 ? '上移' : '下移'}
    >{dir === -1 ? '▲' : '▼'}</span>
  );

  const commonDragProps = {
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); onDragStart && onDragStart(path); },
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
        background: '#22c55e', borderRadius: 1, zIndex: 5,
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
              borderRadius: 3, fontSize: 13, color: isSelected ? '#58a6ff' : '#cdd9e5',
              background: dropPos === 'inside' ? 'rgba(34,197,94,0.15)' : isSelected ? 'rgba(88,166,255,0.1)' : hover ? 'rgba(255,255,255,0.03)' : 'transparent',
              outline: dropPos === 'inside' ? '1px dashed #22c55e' : 'none',
              userSelect: 'none',
              transition: 'background 0.1s',
            }}
          >
            <span style={{ fontSize: 10, width: 14, textAlign: 'center', flexShrink: 0 }}>
              {isExpanded ? '▼' : '▶'}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
              📁 {item.name}
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
                onDelete={onDelete}
                onAddCmd={onAddCmd}
                onAddGroup={onAddGroup}
                contextMenu={contextMenu}
                onContextMenu={onContextMenu}
                closeContextMenu={closeContextMenu}
                onExecute={onExecute}
                onMove={onMove}
                onDragStart={onDragStart}
                onDropItem={onDropItem}
                onDragEnd={onDragEnd}
                dragVersion={dragVersion}
              />
            </div>
          ))}
          {isExpanded && (!item.children || item.children.length === 0) && (
            <div style={{ paddingLeft: 30, fontSize: 11, color: '#6e7681', padding: '4px 0 4px 30px', fontStyle: 'italic' }}>
              (空分组，右键添加命令)
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
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const pos = dropPos; setDropPos(null); onDropItem && onDropItem(path, pos || 'after'); }}
        {...commonDragProps}
        style={{
          display: 'flex', alignItems: 'center', padding: '5px 8px', cursor: 'pointer',
          borderRadius: 3, fontSize: 12, color: isSelected ? '#22c55e' : '#b1bac4',
          background: isSelected ? 'rgba(34,197,94,0.08)' : hover ? 'rgba(255,255,255,0.03)' : 'transparent',
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
  const [quickCmd, setQuickCmd] = useState('');
  const [quickAddCR, setQuickAddCR] = useState(true);

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

  // ── 统一处理所有拖放（before / inside / after / root）─
  const handleDropItem = (targetPath, pos) => {
    const srcPath = dragSourceRef.current;
    if (!srcPath || srcPath === targetPath) { clearDrag(); return; }
    if (targetPath.startsWith(srcPath + '/')) { clearDrag(); return; }

    const list = structuredClone(commands);
    const src = resolvePath(list, srcPath);
    const tgt = resolvePath(list, targetPath);

    if (!src.item) { clearDrag(); return; }

    // 移出源节点
    const [moved] = src.parent.splice(src.idx, 1);

    if (pos === 'inside' && tgt.item?.type === 'group') {
      // 放入分组内（作为最后一个子项）
      if (!tgt.item.children) tgt.item.children = [];
      tgt.item.children.push(moved);
      tgt.item.expanded = true;
    } else {
      // before / after：插入到目标位置前后
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

  // 选中分组时同步本地编辑名称
  useEffect(() => {
    if (selectedItem?.type === 'group') {
      setEditGroupName(selectedItem.name || '');
    }
  }, [selectedPath]);

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
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [historyDropdown]);

  // ── 持久化到文件（保存 + 重新加载，确保双向一致）──
  const save = async (list) => {
    await saveCommands(list);
    const data = await loadCommands();
    if (data.length > 0) setCommands(data);
  };

  // ── 上移/下移 ──────────────────────────────────────
  const handleMove = (path, direction) => {
    const list = structuredClone(commands);
    const { parent, idx } = resolvePath(list, path);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= parent.length) return;
    [parent[idx], parent[newIdx]] = [parent[newIdx], parent[idx]];
    save(list);
    setSelectedPath(path.replace(/\/\d+$/, '/' + newIdx));
    closeContextMenu();
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
      const list = structuredClone(commands);
      const r = resolvePath(list, path);
      r.item.expanded = !r.item.expanded;
      save(list);
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
    save(commands);
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
        if (addToast) addToast('已删除', 'success', 1500);
      } catch {
        // 删除失败，重新从文件加载以确保状态一致
        const data = await loadCommands();
        if (data.length > 0) setCommands(data);
        if (addToast) addToast('删除失败', 'error', 2000);
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
          list[parts[0]].children = [...(list[parts[0]].children || []), { type: 'group', name: dlgName.trim(), expanded: true, children: [] }];
        } else if (dialog.contextPath) {
          let cur = list;
          for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]].children || [];
          cur.splice(parts[parts.length - 1] + 1, 0, { type: 'group', name: dlgName.trim(), expanded: true, children: [] });
        } else {
          list.push({ type: 'group', name: dlgName.trim(), expanded: true, children: [] });
        }
        save(list);
      } else if (dialog.type === 'editGroup') {
        const list = structuredClone(commands);
        const r = resolvePath(list, dialog.contextPath);
        r.parent[r.idx].name = dlgName.trim();
        save(list);
      }
      setDialog(null);
      return;
    }

    // 命令：需要名称和命令内容
    if (!dlgCmd.trim()) return;
    const newItem = { name: dlgName.trim(), command: dlgCmd.trim(), addCR: dlgAddCR };

    if (dialog.type === 'add') {
      dialog.targetChildren.push(newItem);
      save(dialog.parentList);
    } else if (dialog.type === 'edit') {
      const list = structuredClone(commands);
      const r = resolvePath(list, selectedPath);
      r.parent[r.idx] = { ...r.parent[r.idx], ...newItem };
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
      if (addToast) addToast('已发送到 '+connectedSessions.length+' 个会话', 'info', 2000);
    } else {
      AppGo.WriteTerminal(sessionId, finalCmd).catch((err) => {
        console.error('WriteTerminal failed:', err);
      });
      if (addToast) addToast('已发送指令到终端', 'info', 2000);
    }
  };

  // ── 发送临时命令（不保存） ──────────────────────────
  const sendQuick = () => {
    const cmd = quickCmd.trim();
    if (!cmd) return;
    const finalCmd = quickAddCR ? cmd + '\r' : cmd;
    if (sendTarget === 'all' && connectedSessions.length > 0) {
      connectedSessions.forEach(s => AppGo.WriteTerminal(s.id, finalCmd).catch((err) => {
        console.error('WriteTerminal failed:', err);
      }));
      if (addToast) addToast('已发送到 '+connectedSessions.length+' 个会话', 'info', 2000);
    } else {
      AppGo.WriteTerminal(sessionId, finalCmd).catch((err) => {
        console.error('WriteTerminal failed:', err);
      });
      if (addToast) addToast('已发送', 'info', 1500);
    }
    setQuickCmd('');
  };

  // ── 插入参数按钮 ────────────────────────────────────
  const insertParam = (n) => {
    const tag = `[p#${n} 参数${n}]`;
    setDlgCmd(prev => prev + tag);
  };

  // ── 通用样式 ──────────────────────────────────────
  const inputStyle = {
    padding: '5px 8px', fontSize: 12, borderRadius: 3,
    background: '#0d1117', border: '1px solid #30363d',
    color: '#cdd9e5', outline: 'none', fontFamily: 'inherit',
    width: '100%', boxSizing: 'border-box',
  };

  const selectedItem = getSelectedItem();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#161b22', fontFamily: 'var(--font-ui)' }}>
      {/* ── 工具栏 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
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
          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e', borderRadius: 3, padding: '3px 8px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
        >＋ 添加命令</button>
        <button
          onClick={() => { closeContextMenu(); setDialog({ type: 'addGroup', contextPath: '', parentList: commands }); setDlgName(''); setDlgCmd(''); setDlgAddCR(true); }}
          style={{ background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.25)', color: '#58a6ff', borderRadius: 3, padding: '3px 8px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
        >📁 添加分组</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#6e7681' }}>Ctrl+S 保存</span>
      </div>

      {/* ── 主体：左右分栏 ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* ── 左侧树形列表 ── */}
        <div
          ref={treeRef}
          onClick={(e) => { if (e.target === e.currentTarget) { setSelectedPath(null); closeContextMenu(); } }}
          onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
          onDragEnter={(e) => { e.preventDefault(); setRootDragOver(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setRootDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); handleDropToRoot(); }}
          style={{
            width: 220, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)',
            overflowY: 'auto', padding: '4px 6px',
            background: rootDragOver ? 'rgba(34,197,94,0.08)' : '#0d1117',
            outline: rootDragOver ? '1px dashed #22c55e' : 'none',
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
              placeholder="搜索命令..."
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
                <div style={{ padding: 16, textAlign: 'center', color: '#6e7681', fontSize: 12 }}>
                  {searchText ? '无匹配结果' : '点击上方按钮添加命令'}
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
                    onDelete={() => {}}
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

        {/* ── 右侧编辑器 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* 选中了分组 → 显示分组信息 */}
          {selectedItem && selectedItem.type === 'group' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>分组名称</label>
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
                  style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e', borderRadius: 3, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                >💾 保存名称</button>
                <button
                  onClick={() => {
                    const list = structuredClone(commands);
                    const r = resolvePath(list, selectedPath);
                    if (!r.item.children) r.item.children = [];
                    setDialog({ type: 'add', targetChildren: r.item.children, parentList: list, groupName: r.item.name });
                    setDlgName(''); setDlgCmd(''); setDlgAddCR(true);
                  }}
                  style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e', borderRadius: 3, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                >＋ 添加命令</button>
              </div>
              <div style={{ fontSize: 12, color: '#6e7681', marginTop: 8 }}>
                {selectedItem.children?.length || 0} 个命令/子分组
              </div>
            </div>
          ) : selectedItem ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', gap: 10 }}>
              {/* 选中了命令 → 显示编辑器 */}
              {/* 名称 */}
              <div>
                <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>名称</label>
                <input
                  type="text"
                  value={selectedItem.name}
                  onChange={(e) => {
                    const list = structuredClone(commands);
                    const r = resolvePath(list, selectedPath);
                    r.parent[r.idx].name = e.target.value;
                    setCommands(list);
                    setDirty(true);
                  }}
                  style={inputStyle}
                />
              </div>

              {/* 命令 */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: 11, color: '#8b949e' }}>命令</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[1,2,3,4,5].map(n => (
                      <button
                        key={n}
                        onClick={() => {
                          const list = structuredClone(commands);
                          const r = resolvePath(list, selectedPath);
                          r.parent[r.idx].command = (r.parent[r.idx].command || '') + `[p#${n} 参数${n}]`;
                          setCommands(list);
                          setDirty(true);
                        }}
                        title={`插入参数 p#${n}`}
                        style={{
                          background: 'transparent', border: '1px solid #30363d', borderRadius: 3,
                          color: '#8b949e', fontSize: 10, cursor: 'pointer', padding: '1px 5px',
                        }}
                      >参数{n}</button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={selectedItem.command}
                  onChange={(e) => {
                    const list = structuredClone(commands);
                    const r = resolvePath(list, selectedPath);
                    r.parent[r.idx].command = e.target.value;
                    setCommands(list);
                    setDirty(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.ctrlKey && e.key === 's') {
                      e.preventDefault();
                      save(commands);
                      setDirty(false);
                      if (addToast) addToast('已保存', 'success', 1500);
                    }
                  }}
                  style={{
                    ...inputStyle, resize: 'none', height: 72,
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                    lineHeight: 1.5, minHeight: 60,
                  }}
                />

                {/* 参数预览 */}
                {extractParams(selectedItem.command).length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#d29922', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>⚡</span>
                    含 {extractParams(selectedItem.command).length} 个动态参数：{extractParams(selectedItem.command).map(p => `[p#${p.num}${p.label ? ' ' + p.label : ''}]`).join(', ')}
                  </div>
                )}
              </div>

              {/* 底部工具栏（FinalShell 风格：命令预览 + 参数区 + 发送） */}
              <div style={{
                display: 'flex', flexDirection: 'column',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: 8, marginTop: 'auto',
                flexShrink: 0,
              }}>
                {/* 第一行：命令名 + 命令预览 + 编辑按钮 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: 11, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                    {selectedItem.name}
                  </span>
                  <span style={{ flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b1bac4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedItem.command || ''}
                  </span>
                  <button
                    onClick={() => { save(commands); setDirty(false); if (addToast) addToast('已保存', 'success', 1500); }}
                    style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', borderRadius: 3, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}
                  >保存</button>
                  <button
                    onClick={() => {
                      const item = selectedItem;
                      setDialog({ type: 'edit' });
                      setDlgName(item.name || '');
                      setDlgCmd(item.command || '');
                      setDlgAddCR(item.addCR !== false);
                    }}
                    style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', borderRadius: 3, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}
                  >编辑</button>
                </div>

                {/* 第二行：参数输入区（有参数时才显示） */}
                {(() => {
                  const params = extractParams(selectedItem.command || '');
                  if (params.length === 0) return null;
                  const cmdKey = selectedItem.command;
                  return (
                    <div style={{ marginBottom: 6, overflowX: 'auto', overflowY: 'visible' }}>
                      {/* 参数行：标签名在外面，输入框 + 历史按钮 */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap' }}>
                        {params.map(p => {
                          const isOpen = historyDropdown?.cmdKey === cmdKey && historyDropdown.paramNum === p.num;
                          const histList = (paramHistory[cmdKey]?.[p.num]) || [];
                          return (
                            <div key={p.num} style={{ position: 'relative' }}>
                              {/* 标签名（FinalShell 风格：在框外面） */}
                              <span style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 2 }}>
                                {p.label || `p#${p.num}`}
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input
                                  type="text"
                                  value={paramValues[p.num] || ''}
                                  onChange={e => setParamValues(prev => ({ ...prev, [p.num]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') doExecute(selectedItem); }}
                                  title={`参数 ${p.label || '#' + p.num}`}
                                  style={{
                                    ...inputStyle, width: 100,
                                    fontSize: 11, padding: '3px 6px',
                                    fontFamily: "'JetBrains Mono', monospace",
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    if (isOpen) { setHistoryDropdown(null); setHistorySearch(''); }
                                    else setHistoryDropdown({ cmdKey, paramNum: p.num });
                                  }}
                                  data-history-dropdown="true"
                                  style={{
                                    background: 'transparent', border: '1px solid #30363d',
                                    color: '#58a6ff', borderRadius: 2,
                                    fontSize: 10, cursor: 'pointer', padding: '1px 7px',
                                    whiteSpace: 'nowrap',
                                  }}
                                >历史</button>
                              </div>
                              {/* 历史下拉列表（向上弹出） */}
                              {isOpen && (
                                <div
                                  data-history-dropdown="true"
                                  onMouseDown={e => e.stopPropagation()}
                                  style={{
                                    position: 'absolute', bottom: '100%', left: 0, zIndex: 100,
                                    minWidth: 180, maxHeight: 200, display: 'flex', flexDirection: 'column',
                                    background: '#161b22', border: '1px solid #30363d',
                                    borderRadius: 4, boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
                                    marginBottom: 2,
                                  }}
                                >
                                  {/* 搜索框 */}
                                  <div style={{ padding: 4, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <input
                                      type="text"
                                      autoFocus
                                      value={historySearch}
                                      onChange={e => setHistorySearch(e.target.value)}
                                      placeholder="搜索历史..."
                                      style={{
                                        ...inputStyle, width: '100%', boxSizing: 'border-box',
                                        fontSize: 10, padding: '3px 6px',
                                        borderRadius: 3,
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Escape') { setHistoryDropdown(null); setHistorySearch(''); }
                                      }}
                                    />
                                  </div>
                                  {/* 清空列表 */}
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
                                      padding: '4px 10px', fontSize: 11, color: '#f85149',
                                      cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)',
                                      flexShrink: 0,
                                    }}
                                  >清空列表</div>
                                  {/* 历史值列表（带搜索过滤） */}
                                  <div style={{ flex: 1, overflowY: 'auto' }}>
                                    {(() => {
                                      const filtered = historySearch
                                        ? histList.filter(v => v.toLowerCase().includes(historySearch.toLowerCase()))
                                        : histList;
                                      return filtered.length === 0 ? (
                                        <div style={{ padding: '6px 10px', fontSize: 11, color: '#484f58' }}>
                                          {historySearch ? '无匹配结果' : '暂无历史'}
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
                                            padding: '4px 10px', fontSize: 11,
                                            color: '#cdd9e5', cursor: 'pointer',
                                            fontFamily: "'JetBrains Mono', monospace",
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                          }}
                                          onMouseEnter={e => e.target.style.background = 'rgba(88,166,255,0.08)'}
                                          onMouseLeave={e => e.target.style.background = 'transparent'}
                                        >{val}</div>
                                      ));
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* 第三行：CR选项 + 发送 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <label style={{ fontSize: 11, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedItem.addCR !== false}
                      onChange={(e) => {
                        const list = structuredClone(commands);
                        const r = resolvePath(list, selectedPath);
                        r.parent[r.idx].addCR = e.target.checked;
                        save(list);
                      }}
                      style={{ accentColor: '#22c55e' }}
                    />
                    末尾添加回车符CR
                  </label>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#6e7681' }}>发送到</span>
                    <select
                      value={sendTarget}
                      onChange={(e) => setSendTarget(e.target.value)}
                      style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 3,
                        background: '#0d1117', border: '1px solid #30363d',
                        color: '#cdd9e5', outline: 'none', cursor: 'pointer',
                      }}
                    >
                      <option value="current">当前会话</option>
                      {connectedSessions.length > 1 && (
                        <option value="all">全部会话 ({connectedSessions.length})</option>
                      )}
                    </select>
                  </div>
                  <button
                    onClick={() => doExecute(selectedItem)}
                    style={{
                      background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)',
                      color: '#22c55e', borderRadius: 3, padding: '4px 14px', fontSize: 12, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >🚀 发送</button>
                </div>
              </div>
            </div>
          ) : (
            /* 未选中任何项 */
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 13, flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 36, opacity: 0.2 }}>⚡</div>
              <div>选择左侧命令或添加新命令</div>
            </div>
          )}
        </div>
      </div>

      {/* ── 底部快速命令栏（不保存，直接发送） ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '5px 10px', background: '#0d1117', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: '#8b949e', whiteSpace: 'nowrap' }}>快速命令</span>
        <input
          type="text"
          value={quickCmd}
          onChange={e => setQuickCmd(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendQuick(); }}
          placeholder="输入临时命令直接发送（不保存）..."
          style={{ flex: 1, ...inputStyle, fontSize: 11, padding: '4px 8px' }}
        />
        <label style={{ fontSize: 11, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={quickAddCR} onChange={e => setQuickAddCR(e.target.checked)} style={{ margin: 0, cursor: 'pointer' }} />
          回车
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#6e7681' }}>→</span>
          <select
            value={sendTarget}
            onChange={(e) => setSendTarget(e.target.value)}
            style={{
              fontSize: 11, padding: '2px 6px', borderRadius: 3,
              background: '#0d1117', border: '1px solid #30363d',
              color: '#cdd9e5', outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="current">当前</option>
            {connectedSessions.length > 1 && (
              <option value="all">全部 ({connectedSessions.length})</option>
            )}
          </select>
        </div>
        <button
          onClick={sendQuick}
          disabled={!quickCmd.trim()}
          style={{
            background: quickCmd.trim() ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
            border: '1px solid ' + (quickCmd.trim() ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.1)'),
            color: quickCmd.trim() ? '#22c55e' : '#484f58',
            borderRadius: 3, padding: '3px 12px', fontSize: 11, cursor: quickCmd.trim() ? 'pointer' : 'default',
            transition: 'all 0.15s',
          }}
        >🚀 发送</button>
      </div>

      {/* ── 右键上下文菜单 ── */}
      {contextMenu && (
        <>
          <div onClick={closeContextMenu} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'transparent' }} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 200,
            background: '#1c2128', border: '1px solid #30363d', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '4px 0', minWidth: 160,
            fontSize: 12,
          }}>
            {contextMenu.type === 'group' ? (
              <>
                <div onClick={() => doContextAction('addCmd')} style={menuItemStyle}>＋ 添加命令</div>
                <div onClick={() => doContextAction('addGroup')} style={menuItemStyle}>📁 添加子分组</div>
                <div style={menuSepStyle} />
                <div onClick={() => doContextAction('editGroup')} style={menuItemStyle}>✏️ 重命名分组</div>
                <div style={menuSepStyle} />
                <div onClick={() => doContextAction('delete')} style={{ ...menuItemStyle, color: '#ff7b72' }}>🗑️ 删除分组</div>
              </>
            ) : (
              <>
                <div onClick={() => doContextAction('execute')} style={menuItemStyle}>🚀 执行</div>
                <div onClick={() => doContextAction('edit')} style={menuItemStyle}>✏️ 编辑</div>
                <div style={menuSepStyle} />
                <div onClick={() => doContextAction('delete')} style={{ ...menuItemStyle, color: '#ff7b72' }}>🗑️ 删除</div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── 未保存修改确认对话框 ── */}
      {confirmUnsaved && (
        <>
          <div onClick={handleConfirmCancel} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,0.4)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300,
            width: 360, background: '#1c2128', border: '1px solid #30363d', borderRadius: 8,
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)', padding: '16px 20px',
          }}>
            <div style={{ fontSize: 14, color: '#cdd9e5', marginBottom: 14, fontWeight: 600 }}>
              未保存的修改
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 16 }}>
              当前命令有未保存的修改，是否保存？
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={handleConfirmCancel}
                style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', borderRadius: 4, padding: '5px 16px', fontSize: 12, cursor: 'pointer' }}
              >取消</button>
              <button
                onClick={handleConfirmDiscard}
                style={{ background: 'transparent', border: '1px solid #f85149', color: '#f85149', borderRadius: 4, padding: '5px 16px', fontSize: 12, cursor: 'pointer' }}
              >不保存</button>
              <button
                onClick={handleConfirmSave}
                style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', borderRadius: 4, padding: '5px 16px', fontSize: 12, cursor: 'pointer' }}
              >保存</button>
            </div>
          </div>
        </>
      )}

      {/* ── 添加/编辑对话框（覆盖层） ── */}
      {dialog && (
        <>
          <div onClick={() => { setShowGroupPicker(false); setDialog(null); }} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,0.4)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300,
            width: 480, background: '#1c2128', border: '1px solid #30363d', borderRadius: 8,
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)', padding: '16px 20px',
          }}>
            <div style={{ fontSize: 14, color: '#cdd9e5', marginBottom: 14, fontWeight: 600 }}>
              {dialog.type === 'addGroup' ? '添加分组' : dialog.type === 'editGroup' ? '重命名分组' : dialog.type === 'add' ? '添加命令' : '编辑命令'}
            </div>

            {/* 添加到提示（仅添加命令时显示） */}
            {dialog.type === 'add' && (
              <div style={{ fontSize: 12, color: '#6e7681', marginBottom: 12, userSelect: 'none' }}>
                <span style={{ marginRight: 6 }}>添加到:</span>
                <span
                  ref={groupPickerRef}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setGroupPickerPos({ x: rect.left, y: rect.bottom + 4 });
                    setShowGroupPicker(prev => !prev);
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '2px 10px', borderRadius: 4,
                    background: 'rgba(88,166,255,0.1)',
                    border: '1px solid rgba(88,166,255,0.25)',
                    color: '#58a6ff', fontWeight: 500, fontSize: 12,
                    cursor: 'pointer', userSelect: 'none',
                    transition: 'all 0.15s',
                    lineHeight: '20px',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(88,166,255,0.2)';
                    e.currentTarget.style.borderColor = 'rgba(88,166,255,0.4)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(88,166,255,0.1)';
                    e.currentTarget.style.borderColor = 'rgba(88,166,255,0.25)';
                  }}
                >
                  {dialog.groupName || '根目录'}
                  <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
                </span>
              </div>
            )}

            {/* 名称 */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>名称</label>
              <input
                type="text"
                value={dlgName}
                onChange={e => setDlgName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleDlgSave(); } }}
                autoFocus
                style={inputStyle}
                placeholder={dialog.type === 'addGroup' || dialog.type === 'editGroup' ? '如：系统监控' : '如：查看内存'}
              />
            </div>

            {/* 命令区域（仅命令类型显示） */}
            {dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && (
              <>
              <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={labelStyle}>命令</label>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      onClick={() => insertParam(n)}
                      title={`插入参数 p#${n}`}
                      style={{
                        background: 'transparent', border: '1px solid #30363d', borderRadius: 3,
                        color: '#8b949e', fontSize: 10, cursor: 'pointer', padding: '1px 6px',
                        fontFamily: 'monospace',
                      }}
                    >参数{n}</button>
                  ))}
                </div>
              </div>
              <textarea
                value={dlgCmd}
                onChange={e => setDlgCmd(e.target.value)}
                onKeyDown={e => {
                  if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleDlgSave(); }
                }}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.5, minHeight: 70 }}
                placeholder="如：free -m"
              />

              {/* 参数预览 */}
              {extractParams(dlgCmd).length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#d29922' }}>
                  含 {extractParams(dlgCmd).length} 个动态参数：{extractParams(dlgCmd).map(p => `[p#${p.num}${p.label ? ' ' + p.label : ''}]`).join(', ')}
                </div>
              )}
            </div>
            </>
            )}

            {/* 末尾添加回车符 */}
            {dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, cursor: 'pointer', fontSize: 12, color: '#8b949e' }}>
              <input
                type="checkbox"
                checked={dlgAddCR}
                onChange={e => setDlgAddCR(e.target.checked)}
                style={{ accentColor: '#22c55e' }}
              />
              末尾添加回车符CR
            </label>
            )}

            {/* 按钮 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => { setShowGroupPicker(false); setDialog(null); }}
                style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', borderRadius: 4, padding: '5px 16px', fontSize: 12, cursor: 'pointer' }}
              >取消</button>
              <button
                onClick={handleDlgSave}
                disabled={!dlgName.trim() || (dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && !dlgCmd.trim())}
                style={{
                  background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)',
                  color: '#22c55e', borderRadius: 4, padding: '5px 16px', fontSize: 12,
                  cursor: (!dlgName.trim() || (dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && !dlgCmd.trim())) ? 'not-allowed' : 'pointer',
                  opacity: (!dlgName.trim() || (dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && !dlgCmd.trim())) ? 0.5 : 1,
                }}
              >保存</button>
            </div>
          </div>

          {/* ── 分组选择器下拉菜单 ── */}
          {showGroupPicker && (
            <>
              {/* 点击外部关闭 */}
              <div
                onClick={() => setShowGroupPicker(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 301, background: 'transparent' }}
              />
              {/* 下拉列表 */}
              <div style={{
                position: 'fixed', left: groupPickerPos.x, top: groupPickerPos.y, zIndex: 302,
                minWidth: 160, maxHeight: 220, overflowY: 'auto',
                background: '#1c2128', border: '1px solid #30363d', borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '4px 0',
              }}>
                {/* 根目录 */}
                <div
                  onClick={() => {
                    setDialog(prev => ({ ...prev, targetChildren: prev.parentList, groupName: '' }));
                    setShowGroupPicker(false);
                  }}
                  style={{
                    padding: '5px 14px', fontSize: 12, color: '#cdd9e5', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(88,166,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >📁 根目录</div>
                {/* 所有分组 */}
                {(() => {
                  const groups = collectGroups(commands);
                  return groups.length === 0 ? (
                    <div style={{ padding: '6px 14px', fontSize: 11, color: '#484f58' }}>暂无分组</div>
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
                        padding: '5px 14px', fontSize: 12, color: '#cdd9e5', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(88,166,255,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >📁 {g.name}</div>
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

// ── 通用样式对象 ──────────────────────────────────
const menuItemStyle = {
  padding: '6px 14px', cursor: 'pointer', color: '#cdd9e5',
  display: 'flex', alignItems: 'center', gap: 6,
  transition: 'background 0.1s',
  _hover: { background: 'rgba(88,166,255,0.1)' },
};

const menuSepStyle = {
  height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0',
};

const labelStyle = {
  fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4,
};