import { useMemo } from 'react';
import { t as $t, type I18nKey } from '../../../i18n.ts';
import { Trash2, Copy } from 'lucide-react';
import { cn } from '../../../utils/cn.ts';
import { Button } from '../../ui';
import type { SettingsDefinitionNode } from '../SharedComponents';
import type { ThemePackage, ThemePackagePreview } from '../../../utils/theme.ts';

export interface ThemePackagePaletteProps {
  definition?: SettingsDefinitionNode;
  title: string;
  description: string;
  packages: ThemePackage[];
  selectedThemePackageId?: string;
  onSelectThemePackage: (id: string) => void;
  onDeleteThemePackage?: (themePackage: ThemePackage) => void;
  onCopyThemePackageToMode?: (themePackage: ThemePackage, targetMode: string) => void;
  copyTargetMode: string;
  themePackageBusy: boolean;
}

export default function ThemePackagePalette({
  definition,
  title,
  description,
  packages,
  selectedThemePackageId,
  onSelectThemePackage,
  onDeleteThemePackage,
  onCopyThemePackageToMode,
  copyTargetMode,
  themePackageBusy,
}: ThemePackagePaletteProps) {
  const normalizedPackages = Array.isArray(packages) ? packages : [];
  const palettePackages = useMemo(() => normalizedPackages.map((themePackage) => ({
    ...themePackage,
    preview: themePackage?.preview || ({} as ThemePackagePreview),
  })), [normalizedPackages]);
  const copyLabel = copyTargetMode === 'light' ? $t('复制到浅色') : $t('复制到深色');

  return (
    <div data-settings-field-id={definition?.id} className="flex flex-col gap-2.5 min-w-0">
      <div className="min-w-0">
        <div className="text-base text-primary font-semibold">{title}</div>
        <div className="text-xs text-tertiary">{description}</div>
      </div>
      {palettePackages.length === 0 ? (
        <div className="p-3 rounded-md border border-dashed border-line text-tertiary text-sm">
          {$t('当前没有可用的主题包')}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {palettePackages.map((themePackage) => {
            const isActive = selectedThemePackageId === themePackage.id;
            const canDelete = themePackage.source === 'user';
            return (
              <div
                key={themePackage.id}
                onClick={() => onSelectThemePackage(themePackage.id)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer min-w-0 transition-colors duration-[80ms] border',
                  isActive
                    ? 'border-accent bg-[rgba(var(--accent-rgb),0.08)] shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.18)]'
                    : 'border-line bg-canvas',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn('w-2 h-2 rounded-full shrink-0', isActive ? 'bg-accent' : 'bg-tertiary')}
                />
                <div className="flex-1 min-w-0">
                  <div className={cn('text-base text-primary truncate', isActive ? 'font-bold' : 'font-semibold')}>
                    {/* themePackage.name 为动态显示名（内置主题为 i18n 键），t() 内部有兜底 */}
                    {$t(themePackage.name as I18nKey)}
                  </div>
                  {themePackage.description ? (
                    <div className="text-xs text-tertiary leading-[1.5] mt-0.5 truncate">
                      {/* 同 name：动态描述，t() 内部有兜底 */}
                      {$t(themePackage.description as I18nKey)}
                    </div>
                  ) : null}
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-line text-tertiary shrink-0">
                  {themePackage.source === 'builtin' ? $t('内置') : $t('用户')}
                </span>
                {copyTargetMode ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={copyLabel}
                    title={copyLabel}
                    disabled={themePackageBusy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onCopyThemePackageToMode?.(themePackage, copyTargetMode);
                    }}
                    className="w-6 h-6 min-w-6 text-secondary shrink-0"
                  >
                    <Copy size={12} />
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={$t('删除主题包')}
                    title={$t('删除主题包')}
                    disabled={themePackageBusy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteThemePackage?.(themePackage);
                    }}
                    className="w-6 h-6 min-w-6 text-danger shrink-0"
                  >
                    <Trash2 size={12} />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
