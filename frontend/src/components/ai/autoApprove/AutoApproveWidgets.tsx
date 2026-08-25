import { CheckCheck, X, type LucideIcon } from 'lucide-react';

export interface OptionButtonProps {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export function OptionButton({ active, icon: Icon, label, onClick }: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 flex items-center justify-between gap-2.5 px-2.5 rounded-lg border text-sm transition-colors duration-100 ${
        active
          ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.14)] text-primary font-bold'
          : 'border-line bg-canvas text-secondary font-medium'
      }`}>
      <span className="inline-flex items-center gap-2 min-w-0">
        <Icon size={13} />
        <span>{label}</span>
      </span>
      {active ? <CheckCheck size={13} color="var(--accent)" /> : null}
    </button>
  );
}

export interface CommandChipProps {
  text: string;
  onRemove: () => void;
}

export function CommandChip({ text, onRemove }: CommandChipProps) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="min-h-[30px] inline-flex items-center gap-1.5 px-2.5 rounded-full border border-line bg-canvas text-primary text-sm transition-colors duration-100 cursor-pointer">
      <span>{text}</span>
      <X size={12} />
    </button>
  );
}
