import { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';
import { ClipboardList, Search, RefreshCw, XCircle, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

// ponytail: input is MB from Go backend (ps RSS KB → /1024 → MB)
const fmem = (mb) => {
  const v = Number(mb);
  if (v < 1) return (v * 1024).toFixed(0) + 'K';
  if (v < 1024) return v.toFixed(1) + 'M';
  return (v / 1024).toFixed(1) + 'G';
};

const sortFns = {
  pid: (a, b) => Number(a.pid) - Number(b.pid),
  cpu: (a, b) => (b.cpu || 0) - (a.cpu || 0),
  mem: (a, b) => (b.mem || 0) - (a.mem || 0),
  user: (a, b) => (a.user || '').localeCompare(b.user || ''),
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
};

export default function ProcessPage({ sessionId, addToast, active }) {
  const { t } = useTranslation();
  const [processes, setProcesses] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('cpu');
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPids, setSelectedPids] = useState(new Set());
  const [killing, setKilling] = useState(false);
  const [detailState, detailDispatch] = useReducer((state, action) => {
    switch (action.type) {
      case 'toggle': {
        const idx = state.processes.findIndex(p => p.pid === action.process.pid);
        if (idx >= 0) {
          if (state.activePid === action.process.pid) {
            const next = state.processes.filter(p => p.pid !== action.process.pid);
            const ni = next.length ? Math.min(idx, next.length - 1) : -1;
            return { processes: next, activePid: ni >= 0 ? next[ni].pid : null };
          }
          return { ...state, activePid: action.process.pid };
        }
        return { processes: [...state.processes, action.process], activePid: action.process.pid };
      }
      case 'close': {
        const next = state.processes.filter(p => p.pid !== action.pid);
        return {
          processes: next,
          activePid: state.activePid === action.pid
            ? (next.length ? next[Math.min(state.processes.findIndex(p => p.pid === action.pid), next.length - 1)].pid : null)
            : state.activePid,
        };
      }
      case 'closeAll': return { processes: [], activePid: null };
      default: return state;
    }
  }, { processes: [], activePid: null });
  const activeProcess = detailState.processes.find(p => p.pid === detailState.activePid) || null;
  const [detailHeight, setDetailHeight] = useState(() => {
    const saved = localStorage.getItem('processDetailHeight');
    return saved ? parseFloat(saved) : 200;
  });
  const [envVars, setEnvVars] = useState(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [showEnv, setShowEnv] = useState(false);
  const [colWidths, setColWidths] = useState(() => {
    const saved = localStorage.getItem('processColWidths');
    if (saved) try { return JSON.parse(saved); } catch {}
    return { pid: 70, cpu: 70, mem: 70, user: 100, name: 200 };
  });
  const mountedRef = useRef(true);
  const timerRef = useRef(null);
  const detailRef = useRef(null);
  const colDragging = useRef(false);
  const scrollRef = useRef(null);
  // ponytail: 可视区切片，避免数百进程全量渲染。行高固定 33px（6px*2 padding + ~21px 内容）
  // 上限约 300 行无虚拟化也无压力，超出靠此切片；O(n) 滚动计算在 60fps 内可接受
  const ROW_H = 33;
  const OVERSCAN = 5;
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await AppGo.GetFullProcessList(sessionId);
      if (mountedRef.current) {
        setProcesses(list || []);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e?.message || String(e));
        setProcesses([]);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    const scheduleNext = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const interval = parseInt(localStorage.getItem('probeInterval') || '3', 10);
      timerRef.current = setTimeout(async () => {
        await load();
        if (!stopped) scheduleNext();
      }, Math.max(interval, 1) * 1000);
    };

    const run = async () => {
      await load();
      if (!stopped) scheduleNext();
    };

    run();
    const onIntervalChange = () => scheduleNext();
    window.addEventListener('probeIntervalChanged', onIntervalChange);
    return () => {
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('probeIntervalChanged', onIntervalChange);
    };
  }, [load, active]);

  // 选中进程时加载环境变量
  useEffect(() => {
    if (!activeProcess) {
      setEnvVars(null);
      setShowEnv(false);
      return;
    }
    setEnvLoading(true);
    setEnvVars(null);
    setShowEnv(false);
    AppGo.GetProcessEnv(sessionId, activeProcess.pid)
      .then(vars => { if (mountedRef.current) { setEnvVars(vars || []); setEnvLoading(false); } })
      .catch(() => { if (mountedRef.current) { setEnvVars([]); setEnvLoading(false); } });
  }, [activeProcess, sessionId]);

  const sorted = !processes ? [] : [...processes].sort((a, b) => {
    const fn = sortFns[sortKey] || sortFns.cpu;
    return sortAsc ? fn(a, b) : fn(b, a);
  });

  const filtered = searchQuery
    ? sorted.filter(p =>
        String(p.pid).includes(searchQuery) ||
        (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.user || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.cmd || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sorted;

  const handleSort = (key) => {
    if (key === sortKey) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  // ponytail: 改为函数调用而非组件定义，避免每次 polling 渲染时 React 视为新组件类型导致表头 unmount/remount
  const renderSortIcon = (col) => {
    if (col !== sortKey) return <ArrowUpDown size={13} style={{ opacity: 0.7, marginLeft: 2, flexShrink: 0 }} />;
    return sortAsc
      ? <ArrowUp size={13} style={{ marginLeft: 2, flexShrink: 0, color: 'var(--accent)' }} />
      : <ArrowDown size={13} style={{ marginLeft: 2, flexShrink: 0, color: 'var(--accent)' }} />;
  };

  const toggleSelect = (pid) => {
    setSelectedPids(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedPids.size === filtered.length) {
      setSelectedPids(new Set());
    } else {
      setSelectedPids(new Set(filtered.map(p => p.pid)));
    }
  };

  const killSelected = async () => {
    if (selectedPids.size === 0) return;
    if (!await window.luminDialog?.confirm(
      t('确定要终止选中的 ') + selectedPids.size + t(' 个进程吗？')
    )) return;

    setKilling(true);
    let killed = 0;
    for (const pid of selectedPids) {
      try {
        await AppGo.KillProcess(sessionId, pid);
        killed++;
      } catch (_) {}
    }
    setKilling(false);
    if (killed > 0) {
      addToast?.(t('已终止 ') + killed + t(' 个进程'), 'success');
      setSelectedPids(new Set());
      load();
    } else {
      addToast?.(t('无法终止进程，请检查权限'), 'error');
    }
  };

  const handleRowClick = (p) => {
    detailDispatch({ type: 'toggle', process: p });
    setSelectedPids(new Set());
  };

  const startDetailDrag = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = detailHeight;
    const onMove = (ev) => {
      const dh = Math.max(100, Math.min(600, startH - (ev.clientY - startY)));
      setDetailHeight(dh);
      localStorage.setItem('processDetailHeight', String(dh));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [detailHeight]);

  const startColResize = useCallback((colKey, e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[colKey];
    colDragging.current = false;
    const onMove = (ev) => {
      colDragging.current = true;
      const w = Math.max(40, Math.min(500, startW + (ev.clientX - startX)));
      const next = { ...colWidths, [colKey]: w };
      setColWidths(next);
      localStorage.setItem('processColWidths', JSON.stringify(next));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(filtered.length, start + Math.ceil(el.clientHeight / ROW_H) + OVERSCAN * 2);
    setVisibleRange(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [filtered.length]);

  // 排序/搜索变化时回到顶部，避免可视区错位
  useEffect(() => {
    setVisibleRange({ start: 0, end: 50 });
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [sortKey, sortAsc, searchQuery]);

  return (
    <div style={{ padding: '24px 32px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-raised)' }}>
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}><ClipboardList size={18} /></span> {t('进程管理')}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedPids.size > 0 && (
            <button
              className="btn btn-sm"
              onClick={killSelected}
              disabled={killing}
              style={{ background: 'rgba(var(--danger-rgb), 0.12)', color: 'var(--danger)', border: '1px solid rgba(var(--danger-rgb), 0.2)' }}
            >
              <XCircle size={12} style={{ marginRight: 4 }} />
              {t('终止选中')} ({selectedPids.size})
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}
            style={{ color: 'var(--text-tertiary)' }}>
            <RefreshCw size={13} style={{ marginRight: 4, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {t('刷新')}
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexShrink: 0 }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('搜索 PID / 进程名 / 用户...')}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: 'var(--surface-base)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {processes ? `${filtered.length} / ${processes.length}` : '—'}
        </span>
      </div>

      {/* 表格区域 */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading && !processes ? (
          <div className="empty-state" style={{ marginTop: '10vh' }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>⟳</div>
            <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 14 }}>{t('正在加载进程列表...')}</p>
          </div>
        ) : error ? (
          <div className="empty-state" style={{ marginTop: '10vh' }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>✕</div>
            <p style={{ marginTop: 16, color: 'var(--danger)', fontSize: 14 }}>{t('加载失败')}</p>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 400, textAlign: 'center' }}>{error}</span>
            <button className="btn btn-sm" onClick={load} style={{ marginTop: 12 }}>{t('重试')}</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ marginTop: '10vh' }}>
            <div style={{ fontSize: 48, opacity: 0.3 }}><Search size={48} /></div>
            <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 15, fontWeight: 500 }}>
              {searchQuery ? t('未找到匹配的进程') : t('没有可显示的进程')}
            </p>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            {/* 表头 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `32px ${colWidths.pid}px ${colWidths.cpu}px ${colWidths.mem}px ${colWidths.user}px ${colWidths.name}px 1fr`,
              gap: 0,
              background: 'var(--surface-sunken)',
              borderBottom: '1px solid var(--border)',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text-tertiary)',
              userSelect: 'none',
            }}>
              <div style={{ padding: '8px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input type="checkbox" checked={selectedPids.size === filtered.length && filtered.length > 0}
                  onChange={selectAll} style={{ cursor: 'pointer' }} />
              </div>
              {[
                { key: 'pid', label: 'PID', align: 'right' },
                { key: 'cpu', label: 'CPU%', align: 'right' },
                { key: 'mem', label: t('内存'), align: 'right' },
                { key: 'user', label: t('用户'), align: 'left' },
                { key: 'name', label: t('名称/命令行'), align: 'left' },
                { key: 'loc', label: t('位置'), align: 'left' },
              ].map(({ key, label, align }) => (
                <div key={key} style={{
                  padding: '8px 6px',
                  textAlign: align,
                  cursor: key ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
                  gap: 2,
                  position: 'relative',
                  borderRight: key === 'loc' ? 'none' : '1px solid var(--border-light)',
                  background: key && sortKey === key ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent',
                  color: key && sortKey === key ? 'var(--accent)' : undefined,
                }} onClick={(e) => { if (colDragging.current) { colDragging.current = false; return; } key && handleSort(key); }}>
                  {label} {key && renderSortIcon(key)}
                  {key !== 'loc' && (
                  <div onMouseDown={e => { e.stopPropagation(); startColResize(key, e); }}
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 12, cursor: 'col-resize', zIndex: 2 }} />
                  )}
                </div>
              ))}
            </div>
            {/* 行 */}
            <div>
              <div style={{ height: visibleRange.start * ROW_H }} />
              {filtered.slice(visibleRange.start, visibleRange.end).map((p) => (
                <div key={p.pid} style={{
                  display: 'grid',
                  gridTemplateColumns: `32px ${colWidths.pid}px ${colWidths.cpu}px ${colWidths.mem}px ${colWidths.user}px ${colWidths.name}px 1fr`,
                  gap: 0,
                  borderBottom: '1px solid var(--border-light)',
                  fontSize: 12.5,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  background: selectedPids.has(p.pid) ? 'rgba(var(--accent-rgb), 0.06)' : detailState.activePid === p.pid ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent',
                }}>
                  <div style={{ padding: '6px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--border-light)' }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedPids.has(p.pid)}
                      onChange={() => toggleSelect(p.pid)} style={{ cursor: 'pointer' }} />
                  </div>
                  <div style={{ padding: '6px 6px', textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 11.5, borderRight: '1px solid var(--border-light)' }} onClick={() => handleRowClick(p)}>{p.pid}</div>
                  <div style={{ padding: '6px 6px', textAlign: 'right', color: p.cpu > 50 ? 'var(--danger)' : p.cpu > 10 ? 'var(--warning)' : 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }} onClick={() => handleRowClick(p)}>
                    {p.cpu?.toFixed(1)}%
                  </div>
                  <div style={{ padding: '6px 6px', textAlign: 'right', color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }} onClick={() => handleRowClick(p)}>{fmem(p.mem)}</div>
                  <div style={{ padding: '6px 6px', textAlign: 'left', color: 'var(--text-tertiary)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRight: '1px solid var(--border-light)' }} title={p.user} onClick={() => handleRowClick(p)}>{p.user}</div>
                  <div style={{ padding: '6px 6px', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRight: '1px solid var(--border-light)' }} title={`${p.name} ┊ ${p.cmd}`} onClick={() => handleRowClick(p)}>
                    <span style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>┊</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{(p.cmd || p.name)}</span>
                  </div>
                  <div style={{ padding: '6px 6px', textAlign: 'left', color: 'var(--text-tertiary)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.loc} onClick={() => handleRowClick(p)}>{p.loc}</div>
                </div>
              ))}
              <div style={{ height: Math.max(0, (filtered.length - visibleRange.end) * ROW_H) }} />
            </div>
          </div>
        )}
      </div>

      {/* 进程详情面板 */}
      {detailState.processes.length > 0 && (
        <>
          <div
            className="split-resizer-h"
            onMouseDown={startDetailDrag}
            style={{ flexShrink: 0, zIndex: 10 }}
          />
          <div ref={detailRef} style={{
            height: detailHeight,
            flexShrink: 0,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--surface-sunken)',
          }}>
            {/* 标签栏 */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 8px', borderBottom: '1px solid var(--border-light)',
              background: 'var(--surface-raised)', gap: 4,
            }}>
              <div style={{ display: 'flex', gap: 3, overflow: 'hidden', flex: 1 }}>
                {detailState.processes.map(p => (
                  <div key={p.pid}
                    onClick={() => detailDispatch({ type: 'toggle', process: p })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', userSelect: 'none', whiteSpace: 'nowrap',
                      border: '1px solid',
                      borderColor: detailState.activePid === p.pid ? 'var(--accent)' : 'var(--border)',
                      background: detailState.activePid === p.pid
                        ? 'linear-gradient(180deg, var(--surface-hover) 0%, var(--surface-sunken) 100%)'
                        : 'linear-gradient(180deg, var(--surface-sunken) 0%, var(--surface-base) 100%)',
                      color: detailState.activePid === p.pid ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: detailState.activePid === p.pid ? 500 : 400,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { if (detailState.activePid !== p.pid) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-hover) 0%, var(--surface-sunken) 100%)'; e.currentTarget.style.color = 'var(--text-primary)'; }}}
                    onMouseLeave={e => { if (detailState.activePid !== p.pid) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-sunken) 0%, var(--surface-base) 100%)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}}
                  >
                    <span>{p.pid}</span>
                    <span style={{
                      maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', color: detailState.activePid === p.pid ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}>{p.name}</span>
                    <span
                      onClick={e => { e.stopPropagation(); detailDispatch({ type: 'close', pid: p.pid }); }}
                      style={{ marginLeft: 2, opacity: 0.4, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                      title={t('关闭')}
                    >×</span>
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => detailDispatch({ type: 'closeAll' })}
                style={{ padding: 2, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                <X size={14} />
              </button>
            </div>
            {/* 面板内容 */}
            <div style={{ padding: 12, overflow: 'auto', flex: 1 }} key={activeProcess?.pid}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 13 }}>
                <DetailRow label="PID" value={<span style={{ fontFamily: 'var(--font-mono)' }}>{activeProcess?.pid}</span>} />
                <DetailRow label={t('状态')} value={activeProcess?.stat || '-'} />
                <DetailRow label={t('进程名')} value={activeProcess?.name} />
                <DetailRow label={t('线程数')} value={activeProcess?.nlwp != null ? String(activeProcess.nlwp) : '-'} />
                <DetailRow label="CPU" value={<><span style={{ color: activeProcess?.cpu > 50 ? 'var(--danger)' : activeProcess?.cpu > 10 ? 'var(--warning)' : 'inherit' }}>{activeProcess?.cpu?.toFixed(1)}%</span></>} />
                <DetailRow label={t('运行时间')} value={activeProcess?.etime || '-'} />
                <DetailRow label={t('内存')} value={fmem(activeProcess?.mem)} />
                <DetailRow label={t('用户')} value={activeProcess?.user} />
              </div>
              {activeProcess?.loc && <div style={{ marginTop: 6 }}><DetailRow label={t('位置')} value={activeProcess.loc} /></div>}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>{t('完整命令行')}:</div>
                <div style={{
                  fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
                  background: 'var(--surface-base)', padding: '8px 10px', borderRadius: 6, wordBreak: 'break-all',
                  border: '1px solid var(--border-light)',
                }}>
                  {activeProcess?.cmd || activeProcess?.name}
                </div>
              </div>

              {/* 环境变量 */}
              {envLoading ? (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {t('加载环境变量...')}
                </div>
              ) : envVars && envVars.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4,
                      cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4,
                    }}
                    onClick={() => setShowEnv(v => !v)}
                  >
                    <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: showEnv ? 'rotate(90deg)' : 'none' }}>▶</span>
                    {t('环境变量')} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({envVars.length})</span>
                  </div>
                  {showEnv && (
                    <div style={{
                      fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
                      background: 'var(--surface-base)', padding: '8px 10px', borderRadius: 6,
                      border: '1px solid var(--border-light)', maxHeight: 180, overflow: 'auto',
                      lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {envVars.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : envVars && envVars.length === 0 ? (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {t('无环境变量')}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const DetailRow = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
    <span style={{ color: 'var(--text-tertiary)', minWidth: 60, flexShrink: 0, fontSize: 12 }}>{label}</span>
    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
  </div>
);
