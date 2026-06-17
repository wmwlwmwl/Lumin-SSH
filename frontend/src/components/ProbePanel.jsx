import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import {
  formatCapacity,
  formatPartitionCapacity,
  formatRate,
  formatTransferTotal,
} from './probeFormatting.js';

// ── Sparkline SVG ──────────────────────────────────────────────────────────
function Sparkline({ data, color = '#22c55e', fill = true, height = 36, width = '100%' }) {
  const pts = data || [];
  const { points, fillPts } = useMemo(() => {
    if (pts.length < 2) return { points: '', fillPts: '' };
    const max = Math.max(...pts, 1);
    const W = 200; const H = height;
    const p = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - (v / max) * (H - 2)}`).join(' ');
    return { points: p, fillPts: `0,${H} ` + p + ` ${W},${H}` };
  }, [pts, height]);
  if (pts.length < 2) return <div style={{ height }} />;
  return (
    <svg viewBox={`0 0 200 ${height}`} preserveAspectRatio="none" style={{ width, height, display: 'block' }}>
      {fill && <polygon points={fillPts} fill={color} opacity={0.12} />}
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Memory Donut ──────────────────────────────────────────────────────────
function MemDonut({ used, cache, total }) {
  const r = 27; const cx = 35; const cy = 35;
  const circ = 2 * Math.PI * r;
  const f1 = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;
  const f2 = total > 0 ? Math.min(Math.max(cache / total, 0), 1 - f1) : 0;
  const f3 = Math.max(1 - f1 - f2, 0);
  const seg = (frac, color, start) => frac > 0.005 ? (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={8}
      strokeDasharray={`${frac * circ} ${circ}`}
      strokeLinecap="butt"
      transform={`rotate(${-90 + start * 360} ${cx} ${cy})`} />
  ) : null;
  return (
    <svg width={70} height={70} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
      {seg(f1, '#ef4444', 0)}
      {seg(f2, 'var(--text-4)', f1)}
      {seg(f3, '#22c55e', f1 + f2)}
    </svg>
  );
}

// ── CPU Bar ────────────────────────────────────────────────────────────────
function CpuBar({ val = 0 }) {
  const pct = Math.min(Math.max(val, 0), 100);
  const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
    </div>
  );
}

// ── Disk Partition Row ─────────────────────────────────────────────────────
function PartRow({ mount, size, avail, usedPct }) {
  const pct = Math.min(Math.max(usedPct, 0), 100);
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
  return (
    <div className="probe-partition-row">
      <span className="probe-partition-mount" title={mount}>{mount}</span>
      <div className="probe-partition-bar">
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span className="probe-partition-value" title={String(size)}>{formatPartitionCapacity(size)}</span>
      <span className="probe-partition-value" title={String(avail)}>{formatPartitionCapacity(avail)}</span>
      <span className="probe-partition-percent" style={{ color }}>{pct}%</span>
    </div>
  );
}

// ── Section Card ───────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────
function SectionHeader({ icon, title, badge, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>{title}</span>
      {badge && (
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
          color: '#22c55e', background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.3)',
          padding: '2px 7px', borderRadius: 4,
        }}>{badge}</span>
      )}
      {right}
    </div>
  );
}

// ── Format helpers ─────────────────────────────────────────────────────────
const fmem = (mb) => {
  return formatCapacity(mb, 1);
};
const fspeed = (kb) => {
  return formatRate(kb);
};
const ftotal = (mb) => {
  return formatTransferTotal(mb);
};

// ══════════════════════════════════════════════════════════════════════════
export default function ProbePanel({ sessionId, host, addToast, enabled, onEnable }) {
  const [info, setInfo] = useState(null);
  const [uploadHist, setUploadHist] = useState(Array(30).fill(0));
  const [downloadHist, setDownloadHist] = useState(Array(30).fill(0));
  const [cpuHist, setCpuHist] = useState(Array(30).fill(0));
  const [showConfirm, setShowConfirm] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [hideIP, setHideIP] = useState(false);
  const staticInfoRef = useRef(null);

  // 切换服务器时立即清空旧数据和静态缓存
  useEffect(() => {
    setInfo(null);
    staticInfoRef.current = null;
    setCpuHist(Array(30).fill(0));
    setUploadHist(Array(30).fill(0));
    setDownloadHist(Array(30).fill(0));
  }, [sessionId]);

  // 启用监控时获取一次静态信息（OS/时区/主机名/CPU 型号）
  useEffect(() => {
    if (!enabled || !sessionId) return;
    (async () => {
      try {
        const data = await AppGo.GetServerStaticInfo(sessionId);
        staticInfoRef.current = {
          os: data.os || 'Linux',
          timezone: data.timezone || 'UTC',
          hostname: data.hostname || '',
          cpuModel: data.cpu?.model || '',
          ip: data.ip || '',
        };
      } catch (_) {
        staticInfoRef.current = { os: 'Linux', timezone: 'UTC', hostname: '', cpuModel: '', ip: '' };
      }
    })();
  }, [enabled, sessionId]);

  const fetchInfo = useCallback(async () => {
    if (!sessionId || !enabled) return;
    try {
      const data = await AppGo.SystemInfo(sessionId);
      const si = staticInfoRef.current || { os: 'Linux', timezone: 'UTC', hostname: '', cpuModel: '' };
      const ni = {
        ...si,
        uptime: data.uptime || '--',
        cpuUsage: data.cpu?.usage || 0,
        cpuCores: data.cpu?.cores || [],
        memUsed: data.memory?.used || 0,
        memTotal: data.memory?.total || 0,
        memCache: data.memory?.cache || 0,
        memFree: data.memory?.free || 0,
        swapTotal: data.memory?.swapTotal || 0,
        swapUsed: data.memory?.swapUsed || 0,
        swapFree: data.memory?.swapFree || 0,
        diskDevice: data.disk?.device || 'disk',
        diskType: data.disk?.type || 'ext4',
        diskTotal: data.disk?.total || 0,
        diskUsed: data.disk?.used || 0,
        diskPercent: data.disk?.usage || 0,
        diskReadSpeed: data.disk?.readSpeed || 0,
        diskWriteSpeed: data.disk?.writeSpeed || 0,
        diskPartitions: data.disk?.partitions || [],
        netUp: data.network?.uploadSpeed || 0,
        netDown: data.network?.downloadSpeed || 0,
        netUpTotal: data.network?.uploadTotal || 0,
        netDownTotal: data.network?.downloadTotal || 0,
        processes: data.processes || [],
      };
      setInfo(ni);
      setCpuHist(prev => [...prev, ni.cpuUsage].slice(-30));
      setUploadHist(prev => [...prev, ni.netUp].slice(-30));
      setDownloadHist(prev => [...prev, ni.netDown].slice(-30));
    } catch (_) {}
  }, [sessionId, enabled]);

  const probeTimerRef = useRef(null);

  // ── 读取探针刷新间隔（localStorage，默认 5s）────────────
  const getProbeInterval = () => {
    const v = parseInt(localStorage.getItem('probeInterval') || '5', 10);
    return v >= 1 ? v : 5;
  };

  useEffect(() => {
    if (!enabled) return;
    fetchInfo();
    const startInterval = (intervalSec) => {
      if (probeTimerRef.current) clearInterval(probeTimerRef.current);
      probeTimerRef.current = setInterval(fetchInfo, intervalSec * 1000);
    };
    startInterval(getProbeInterval());
    const onIntervalChange = () => startInterval(getProbeInterval());
    window.addEventListener('probeIntervalChanged', onIntervalChange);
    return () => {
      if (probeTimerRef.current) clearInterval(probeTimerRef.current);
      window.removeEventListener('probeIntervalChanged', onIntervalChange);
    };
  }, [fetchInfo, enabled]);

  const handleConfirm = async () => {
    setShowConfirm(false);
    setEnabling(true);
    try {
      await onEnable();
    } catch (err) {
      console.error('Probe enable failed:', err);
    } finally {
      setEnabling(false);
    }
  };

  // ── Not enabled: show welcome panel ──────────────────────────────────
  if (!enabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-0)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 35%, rgba(34,197,94,0.06) 0%, transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 16px', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>📊</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 6 }}>系统监控</div>
            <div style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.6, maxWidth: 220 }}>实时查看服务器 CPU、内存、网络和磁盘使用情况</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 220 }}>
            {[['⚡', 'CPU 每核心实时占用'], ['💾', '内存甜甜圈图分析'], ['🌐', '网络速率折线图'], ['🗄', '磁盘分区挂载表'], ['📋', '进程热点排行']].map(([icon, text]) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 11px', borderRadius: 6, background: 'var(--bg-1)', border: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 13 }}>{icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{text}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setShowConfirm(true)} style={{ marginTop: 8, padding: '9px 26px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.5px' }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.2)'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.12)'; }}>
            开启监控
          </button>
        </div>
        {showConfirm && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, zIndex: 50 }}>
            <div style={{ background: 'var(--bg-1)', border: '1px solid rgba(34,197,94,0.22)', borderRadius: 14, padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 64px rgba(0,0,0,0.65)', maxWidth: 260 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🔍</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>注入监控脚本</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>LuminSSH Probe v2</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7 }}>
                将在服务器写入 <code style={{ color: '#4ade80', background: 'rgba(34,197,94,0.08)', padding: '2px 5px', borderRadius: 3, fontSize: 11 }}>~/.lumin/probe.sh</code>，轻量监控脚本。
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {['✅ 纯 Shell，读取 /proc 文件系统', '✅ 无需安装任何软件或依赖', '✅ 不修改系统配置，不常驻后台', '✅ 断开连接后自动停止采集'].map(t => (
                  <div key={t} style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{t}</div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: '8.5px 0', borderRadius: 7, border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-4)', fontSize: 12.5, cursor: 'pointer' }}>取消</button>
                <button onClick={handleConfirm} disabled={enabling} style={{ flex: 1, padding: '8.5px 0', borderRadius: 7, border: '1px solid rgba(34,197,94,0.5)', background: enabling ? 'rgba(34,197,94,0.05)' : 'rgba(34,197,94,0.15)', color: enabling ? 'var(--text-4)' : '#22c55e', fontSize: 12.5, fontWeight: 700, cursor: enabling ? 'default' : 'pointer' }}>
                  {enabling ? '注入中...' : '确认开启'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────
  if (!info) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: '#4ade80', opacity: 0.5 }}>
        <div style={{ fontSize: 22, animation: 'spin 1.2s linear infinite' }}>⟳</div>
        <div style={{ fontSize: 11 }}>正在采集系统信息...</div>
      </div>
    );
  }

  const memPct = info.memTotal > 0 ? Math.round((info.memUsed / info.memTotal) * 100) : 0;
  const cores = info.cpuCores?.length > 0 ? info.cpuCores : [info.cpuUsage];
  const cpuAvg = Math.round(cores.reduce((a, b) => a + b, 0) / cores.length);
  const osParts = info.os?.split(' ') || ['Linux'];

  const isInternalIP = (ip) => {
    if (!ip) return true;
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return true;
    if (parts[0] === '10') return true;
    if (parts[0] === '127') return true;
    if (parts[0] === '172' && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return true;
    if (parts[0] === '192' && parts[1] === '168') return true;
    return false;
  };

  const displayIP = info.ip && !isInternalIP(info.ip) ? info.ip : host;

  return (
    <div className="probe-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 8px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* ── 系统 ── */}
      <Card>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>🖥</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>系统</span>
          </div>
          {displayIP && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
              <span title={hideIP ? '' : displayIP} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#fbbf24', fontWeight: 700, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', padding: '1px 6px', borderRadius: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
                {hideIP ? '***.***.***.***' : displayIP}
              </span>
              <button onClick={() => { navigator.clipboard.writeText(displayIP); addToast?.('已复制 ' + displayIP, 'success'); }} title="复制 IP"
                style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: '2px 4px', fontSize: 13, lineHeight: 1, borderRadius: 3 }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--text-1)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--text-4)'}>📋</button>
              <button onClick={() => setHideIP(p => !p)} title={hideIP ? '显示 IP' : '隐藏 IP'}
                style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: '2px 4px', fontSize: 13, lineHeight: 1, borderRadius: 3 }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--text-1)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--text-4)'}>{hideIP ? '👁' : '🙈'}</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
          <span style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontWeight: 700 }}>{osParts[0]}</span>
          <span style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 4, background: 'var(--border)', color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.os?.replace(osParts[0], '').trim()}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>时区 <span style={{ color: '#22c55e', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{info.timezone}</span></div>
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>运行 <span style={{ color: '#4ade80', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12 }}>{info.uptime}</span></div>
        </div>
      </Card>

      {/* ── CPU ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 14 }}>⚡</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>CPU {cores.length > 0 ? `${cores.length}核` : ''}</span>
          <div style={{ width: 76, height: 24 }}>
            <Sparkline data={cpuHist} color="#6366f1" height={24} />
          </div>
          <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: '#6366f1', fontWeight: 700, width: 34, textAlign: 'right' }}>{cpuAvg}%</span>
        </div>
        {info.cpuModel && <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginBottom: 6, wordBreak: 'break-all' }}>{info.cpuModel}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {cores.map((val, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#4ade80', fontFamily: 'var(--font-mono)', width: 12, textAlign: 'right', flexShrink: 0 }}>{i}</span>
              <CpuBar val={val} />
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', width: 38, textAlign: 'right', flexShrink: 0 }}>{val.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── 内存 ── */}
      <Card>
        <SectionHeader icon="💾" title="内存" badge={fmem(info.memTotal)} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MemDonut used={info.memUsed} cache={info.memCache} total={info.memTotal} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { dot: '#ef4444', label: '已用', val: fmem(info.memUsed) },
              { dot: 'var(--text-4)', label: '缓存', val: fmem(info.memCache) },
              { dot: '#22c55e', label: '空闲', val: fmem(info.memFree) },
            ].map(({ dot, label, val }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', borderRadius: 6, padding: '4px 8px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--text-4)', flex: 1 }}>{label}</span>
                <span style={{ fontSize: 13.5, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', fontWeight: 600 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-4)', textAlign: 'right', marginTop: 4 }}>
          使用率 <span style={{ color: memPct >= 80 ? '#ef4444' : '#4ade80', fontWeight: 700 }}>{memPct}%</span>
        </div>
        {info.swapTotal > 0 && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>🔄 SWAP</span>
              <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{fmem(info.swapTotal)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(info.swapUsed / info.swapTotal * 100, 100)}%`, height: '100%', background: '#a855f7', borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#a855f7', fontWeight: 600, minWidth: 50, textAlign: 'right' }}>{fmem(info.swapUsed)}</span>
              <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', minWidth: 36, textAlign: 'right' }}>{Math.round(info.swapUsed / info.swapTotal * 100)}%</span>
            </div>
          </div>
        )}
      </Card>

      {/* ── 网络 ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 14 }}>🌐</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>网络</span>
        </div>
        <div style={{ marginBottom: 6 }}>
          <Sparkline data={downloadHist} color="#3b82f6" height={36} />
        </div>
        {/* Table */}
        <div style={{ display: 'grid', gridTemplateColumns: '62px 1fr 1fr', gap: '5px 0' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-4)' }} />
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', textAlign: 'center' }}>速度</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', textAlign: 'center' }}>已用流量</div>
          {[
            { dot: '#22c55e', label: '上传', speed: fspeed(info.netUp), total: ftotal(info.netUpTotal) },
            { dot: '#3b82f6', label: '下载', speed: fspeed(info.netDown), total: ftotal(info.netDownTotal) },
          ].map(({ dot, label, speed, total }) => (
            <Fragment key={label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, padding: '3px 0' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
                <span style={{ color: 'var(--text-3)' }}>{label}</span>
              </div>
              <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', fontWeight: 600, textAlign: 'center', alignSelf: 'center' }}>{speed}</div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', textAlign: 'center', alignSelf: 'center' }}>{total}</div>
            </Fragment>
          ))}
        </div>
      </Card>

      {/* ── 磁盘 ── */}
      <Card>
        <SectionHeader icon="🗄" title="磁盘" badge={`${formatCapacity(info.diskUsed, 1)} / ${formatCapacity(info.diskTotal, 1)}`} />
        {/* Root partition info */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 5 }} />
          <span style={{ fontSize: 12.5, color: 'var(--text-3)', flex: 1, fontFamily: 'var(--font-mono)' }}>/ ({info.diskDevice})</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)', marginRight: 4 }}>类型</span>
          <span style={{ fontSize: 11, background: '#ca8a04', color: '#fef9c3', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{info.diskType}</span>
        </div>
        {/* IO speeds */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 7 }}>
          {[
            { label: '读/s', val: fspeed(info.diskReadSpeed), color: '#22c55e' },
            { label: '写/s', val: fspeed(info.diskWriteSpeed), color: '#f97316' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '5px 8px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 13.5, fontFamily: 'var(--font-mono)', color, fontWeight: 700 }}>{val}</div>
            </div>
          ))}
        </div>
        {/* Partition table header */}
        <div className="probe-partition-header">
          <span>挂载</span>
          <span></span>
          <span>大小</span>
          <span>可用</span>
          <span>已用%</span>
        </div>
        {(info.diskPartitions?.length > 0
          ? info.diskPartitions.slice(0, 4)
          : [{ mount: '/', size: `${info.diskTotal?.toFixed(0)}G`, avail: `${(info.diskTotal - info.diskUsed)?.toFixed(1)}G`, usedPct: Math.round(info.diskPercent) }]
        ).map((p, i) => (
          <PartRow key={i} mount={p.mount} size={p.size} avail={p.avail} usedPct={p.usedPct} />
        ))}
      </Card>

      {/* ── 进程管理 ── */}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 13 }}>📋</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>进程管理</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>TOP CPU</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '44px 56px 1fr', gap: '4px 8px' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)', fontWeight: 700 }}>CPU</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)', fontWeight: 700 }}>内存</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)', fontWeight: 700 }}>进程</span>
          {info.processes?.length > 0 ? info.processes.slice(0, 5).map((p, i) => (
            <Fragment key={i}>
              <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: p.cpu > 5 ? '#f59e0b' : 'var(--text-3)' }}>{p.cpu?.toFixed(1)}%</span>
              <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>{fmem(p.mem)}</span>
              <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cmd}</span>
            </Fragment>
          )) : (
            <div style={{ gridColumn: '1/-1', fontSize: 11.5, color: 'var(--text-4)', textAlign: 'center', padding: '8px 0' }}>暂无热点进程</div>
          )}
        </div>
      </Card>
    </div>
  );
}
