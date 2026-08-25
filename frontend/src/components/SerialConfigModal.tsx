import { useState, useEffect } from 'react';
import { X, Cpu } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/wailsapp/App.js';
import { useTranslation } from '../i18n.ts';
import { Button } from './ui';

/** 串口连接配置（与 App.ConnectSerial 的参数对应） */
export interface SerialFormConfig {
  port: string;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
}

interface SerialConfigModalProps {
  onClose: () => void;
  onConnect: (form: SerialFormConfig) => void;
}

export default function SerialConfigModal({ onClose, onConnect }: SerialConfigModalProps) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<SerialFormConfig>({
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

  const handleConnect = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.port) return;
    onConnect(form);
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            <Cpu size={16} />
            <span>{t('串口终端配置')}</span>
          </h3>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t('关闭')}>
            <X size={16} />
          </Button>
        </div>

        <form onSubmit={handleConnect}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label" htmlFor="serial-config-port">{t('串口设备')}</label>
              {loading ? (
                <div className="text-sm text-tertiary">{t('正在检索串口设备...')}</div>
              ) : (ports.length === 0 ? (
                <div>
                  <input
                    id="serial-config-port"
                    name="serial-config-port"
                    autoComplete="off"
                    className="input"
                    placeholder={t('例如：COM3 或 /dev/ttyUSB0')}
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    required
                  />
                  <div className="text-xs text-warning mt-1">
                    {t('未检测到可用串口，您可以手动输入路径/设备名')}
                  </div>
                </div>
              ) : (
                <select
                  id="serial-config-port"
                  name="serial-config-port"
                  className="select w-full"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  required
                >
                  {ports.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ))}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="serial-config-baud-rate">{t('波特率')}</label>
              <select
                id="serial-config-baud-rate"
                name="serial-config-baud-rate"
                className="select w-full"
                value={form.baudRate}
                onChange={(e) => setForm({ ...form, baudRate: parseInt(e.target.value) })}
              >
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="form-label" htmlFor="serial-config-data-bits">{t('数据位')}</label>
                <select
                  id="serial-config-data-bits"
                  name="serial-config-data-bits"
                  className="select w-full"
                  value={form.dataBits}
                  onChange={(e) => setForm({ ...form, dataBits: parseInt(e.target.value) })}
                >
                  {[8, 7, 6, 5].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="serial-config-stop-bits">{t('停止位')}</label>
                <select
                  id="serial-config-stop-bits"
                  name="serial-config-stop-bits"
                  className="select w-full"
                  value={form.stopBits}
                  onChange={(e) => setForm({ ...form, stopBits: parseFloat(e.target.value) })}
                >
                  <option value="1">1</option>
                  <option value="1.5">1.5</option>
                  <option value="2">2</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="serial-config-parity">{t('校验位')}</label>
              <select
                id="serial-config-parity"
                name="serial-config-parity"
                className="select w-full"
                value={form.parity}
                onChange={(e) => setForm({ ...form, parity: e.target.value })}
              >
                <option value="none">{t('无校验')}</option>
                <option value="odd">{t('奇校验')}</option>
                <option value="even">{t('偶校验')}</option>
                <option value="mark">{t('标记校验')}</option>
                <option value="space">{t('空格校验')}</option>
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('取消')}
            </Button>
            <Button type="submit" variant="primary">
              {t('连接')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
