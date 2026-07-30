import { useState, useEffect } from 'react';
import { X, Cpu } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';

export default function SerialConfigModal({ onClose, onConnect }) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    port: '',
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  });

  useEffect(() => {
    let cancelled = false;
    AppGo.ListSerialPorts()
      .then((list) => {
        if (cancelled) return;
        setPorts(list || []);
        if (list && list.length > 0) {
          setForm((f) => ({ ...f, port: list[0] }));
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load serial ports:', err);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = (e) => {
    e.preventDefault();
    if (!form.port) return;
    onConnect(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            <Cpu size={16} />
            <span>{t('串口终端配置')}</span>
          </h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('关闭')}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleConnect}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">{t('串口设备')}</label>
              {loading ? (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('正在检索串口设备...')}</div>
              ) : ports.length === 0 ? (
                <div>
                  <input
                    className="input"
                    placeholder="e.g. COM3 or /dev/ttyUSB0"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    required
                  />
                  <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
                    {t('未检测到可用串口，您可以手动输入路径/设备名')}
                  </div>
                </div>
              ) : (
                <select
                  className="select"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  style={{ width: '100%' }}
                  required
                >
                  {ports.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">{t('波特率')}</label>
              <select
                className="select"
                value={form.baudRate}
                onChange={(e) => setForm({ ...form, baudRate: parseInt(e.target.value) })}
                style={{ width: '100%' }}
              >
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">{t('数据位')}</label>
                <select
                  className="select"
                  value={form.dataBits}
                  onChange={(e) => setForm({ ...form, dataBits: parseInt(e.target.value) })}
                  style={{ width: '100%' }}
                >
                  {[8, 7, 6, 5].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">{t('停止位')}</label>
                <select
                  className="select"
                  value={form.stopBits}
                  onChange={(e) => setForm({ ...form, stopBits: parseFloat(e.target.value) })}
                  style={{ width: '100%' }}
                >
                  <option value="1">1</option>
                  <option value="1.5">1.5</option>
                  <option value="2">2</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">{t('校验位')}</label>
              <select
                className="select"
                value={form.parity}
                onChange={(e) => setForm({ ...form, parity: e.target.value })}
                style={{ width: '100%' }}
              >
                <option value="none">None</option>
                <option value="odd">Odd</option>
                <option value="even">Even</option>
                <option value="mark">Mark</option>
                <option value="space">Space</option>
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('取消')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('连接')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
