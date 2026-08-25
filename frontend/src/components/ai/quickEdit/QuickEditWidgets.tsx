import { Check } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { Z } from '../../../constants/zIndex.ts';

export interface SelectMenuOption {
  value: string;
  label: string;
}

export interface SelectMenuProps {
  value: string;
  options: SelectMenuOption[];
  open: boolean;
  onToggle?: () => void;
  onSelect: (value: string) => void;
  menuRef?: React.Ref<HTMLDivElement>;
  menuWidth?: string;
  showSelectedIcon?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-labelledby'?: string;
  'aria-label'?: string;
}

export function SelectMenu({
  value,
  options,
  open,
  onToggle,
  onSelect,
  menuRef,
  menuWidth = '100%',
  showSelectedIcon = true,
  disabled = false,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-label': ariaLabel,
}: SelectMenuProps) {
  const currentOption = options.find((option) => option.value === value) || options[0];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          onToggle?.();
        }}
        className={`h-[34px] w-full box-border flex items-center justify-between px-3 rounded-[18px] border text-primary transition-[color,background-color,border-color,opacity] duration-[120ms] ${open ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)]' : 'border-line bg-canvas'} ${disabled ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}>
        <span className="min-w-0 truncate text-base font-medium">
          {currentOption?.label || value}
        </span>
        <span className={`text-tertiary text-xs ${open ? 'rotate-180' : 'rotate-0'}`}>▾</span>
      </button>

      {open && !disabled ? (
        <div
          style={{ width: menuWidth, zIndex: Z.COMPONENT_OVERLAY }}
          className="absolute left-0 top-[calc(100%_+_6px)] p-1 rounded-lg border border-line bg-overlay shadow-lg grid gap-0.5">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                className={`min-h-8 flex items-center justify-between gap-2 px-2.5 rounded-lg text-base text-left transition-colors duration-[120ms] cursor-pointer ${active ? 'bg-[rgba(var(--accent-rgb),0.12)] text-primary' : 'bg-transparent text-secondary'}`}>
                <span className="min-w-0 truncate">{option.label}</span>
                {active && showSelectedIcon ? <Check size={13} color="var(--accent)" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export interface StyledCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}

export function StyledCheckbox({ checked, onChange, children }: StyledCheckboxProps) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="inline-flex items-center gap-[7px] text-secondary text-sm leading-[1.2] cursor-pointer select-none">
      <span className="relative w-[18px] h-[18px] shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{ zIndex: Z.CONTENT }}
          className="absolute inset-0 w-[18px] h-[18px] m-0 opacity-0 cursor-pointer"
        />
        <span
          aria-hidden="true"
          className={`inline-flex items-center justify-center w-[18px] h-[18px] box-border rounded-sm text-white transition-colors duration-[80ms] ${checked ? 'border border-accent bg-accent' : 'border border-line bg-sunken'} ${focused ? 'shadow-[0_0_0_3px_var(--accent-dim)]' : ''}`}>
          {checked ? <Check size={12} strokeWidth={3} /> : null}
        </span>
      </span>
      <span>{children}</span>
    </label>
  );
}
