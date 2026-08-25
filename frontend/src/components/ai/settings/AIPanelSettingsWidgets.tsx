import { ArrowRightLeft } from 'lucide-react';
import Tiptop from '../../Tiptop.tsx';

export function formatTokenCountInMillions(value: number) {
  return `${(value / 1000000).toFixed(6)}M`;
}

export interface PreviewPillProps {
  label: string;
  primary?: boolean;
}

export function PreviewPill({ label, primary = false }: PreviewPillProps) {
  return (
    <div
      className={`min-h-[34px] w-full px-3 rounded-lg border text-base font-semibold inline-flex items-center justify-center box-border ${
        primary
          ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.14)] text-accent'
          : 'border-line bg-transparent text-secondary'
      }`}
    >
      {label}
    </div>
  );
}

export interface PositionItem {
  key: string;
  label: string;
  primary?: boolean;
}

export interface PositionSelectorCardProps {
  title: string;
  description: string;
  items: PositionItem[];
  onToggle: () => void;
  toggleLabel: string;
}

export function PositionSelectorCard({ title, description, items, onToggle, toggleLabel }: PositionSelectorCardProps) {
  return (
    <div className="p-3.5 rounded-xl bg-canvas border border-line grid gap-3">
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 text-base font-bold text-primary">{title}</div>
          <Tiptop text={toggleLabel}>
            <button
              type="button"
              onClick={onToggle}
              aria-label={toggleLabel}
              className="w-[34px] h-[34px] rounded-lg border border-line bg-transparent text-secondary inline-flex items-center justify-center transition-colors duration-100 shrink-0 cursor-pointer"
            >
              <ArrowRightLeft size={14} />
            </button>
          </Tiptop>
        </div>
        <div className="text-sm text-tertiary leading-[1.6]">{description}</div>
      </div>
      <div
        className="min-h-[58px] p-3 rounded-xl bg-overlay border border-line grid gap-2.5 items-center"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <PreviewPill key={item.key} label={item.label} primary={item.primary} />
        ))}
      </div>
    </div>
  );
}

export interface ToggleSwitchControlProps {
  checked: boolean;
  onChange: () => void;
}

export function ToggleSwitchControl({ checked, onChange }: ToggleSwitchControlProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`w-[42px] h-6 rounded-full border border-line p-0.5 flex items-center transition-colors duration-100 shrink-0 ${checked ? 'justify-end bg-success' : 'justify-start bg-hover'}`}
    >
      <span className="w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]" />
    </button>
  );
}
