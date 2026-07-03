import React from 'react';
import { t as $t } from '../../i18n.js';
import { Lightbulb } from 'lucide-react';
import { RadioOption } from './SharedComponents';

export default function NetworkTab({ pingProtocol, onPingProtocolChange, probeInterval, onProbeIntervalChange, pingInterval, onPingIntervalChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* 延迟检测协议 */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{$t('延迟检测协议')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{$t('选择如何测量服务器网络延迟，不同协议适用于不同的网络环境。')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { id: 'ssh', label: <>{$t('SSH Banner RTT')} <span style={{ fontSize: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{$t('推荐')}</span></>, desc: $t('通过读取 SSH 握手包测速，穿透 TUN 代理测出真实网络延迟，推荐') },
            { id: 'tcp', label: $t('TCP Dial'), desc: $t('通过 TCP 连接建立测速，适用于局域网/私有网络或未开代理的环境') },
          ].map(opt => (
            <RadioOption key={opt.id} selected={pingProtocol === opt.id} label={opt.label} description={opt.desc} onClick={() => onPingProtocolChange(opt.id)} />
          ))}
        </div>
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface-overlay)', borderRadius: 8, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.7, border: '1px solid var(--border-light)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginRight: 4 }}><Lightbulb size={14} /></span> <strong style={{ color: 'var(--text-secondary)' }}>{$t('提示：')}</strong>{$t('如果您使用 TUN 模式代理（Clash/V2Ray），推荐使用 SSH Banner RTT 模式，可以穿透代理测出真实延迟。')}
        </div>
      </div>

      {/* 监控刷新频率 */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{$t('监控刷新频率')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{$t('设置探针数据和延迟测试的自动刷新间隔。越高的频率越实时，但资源占用越大。')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{$t('探针刷新间隔')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {[1, 3, 5, 10, 30].map(s => (
                <button
                  key={s}
                  onClick={() => onProbeIntervalChange(s)}
                  style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                    borderColor: probeInterval === s ? 'var(--success)' : 'var(--border)',
                    background: probeInterval === s ? 'rgba(34,197,94,0.1)' : 'var(--surface-sunken)',
                    color: probeInterval === s ? 'var(--success)' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >{s}s</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{$t('延迟检测间隔')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {[2, 5, 10, 30].map(s => (
                <button
                  key={s}
                  onClick={() => onPingIntervalChange(s)}
                  style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                    borderColor: pingInterval === s ? 'var(--success)' : 'var(--border)',
                    background: pingInterval === s ? 'rgba(34,197,94,0.1)' : 'var(--surface-sunken)',
                    color: pingInterval === s ? 'var(--success)' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >{s}s</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
