import React from 'react';
import { t as $t } from '../../../i18n.ts';
import { cn } from '../../../utils/cn.ts';
import { Button } from '../../ui';
import { SettingsDivider } from '../SharedComponents';

export interface BackgroundPanelProps {
  termBgImage: string;
  globalBgImage: string;
  bgTargetMode: 'global' | 'terminal';
  onBgTargetModeChange: (mode: 'global' | 'terminal') => void;
  onBgUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBgReset: () => void;
  termBgOpacity: number;
  globalBgOpacity: number;
  onBgOpacityChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  globalIconOpacity: number;
  onGlobalIconOpacityChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function BackgroundPanel({
  termBgImage,
  globalBgImage,
  bgTargetMode,
  onBgTargetModeChange,
  onBgUpload,
  onBgReset,
  termBgOpacity,
  globalBgOpacity,
  onBgOpacityChange,
  globalIconOpacity,
  onGlobalIconOpacityChange,
}: BackgroundPanelProps) {
  return (
    <>
      {/* 背景类型切换：全局 / 终端 */}
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0">
          <div className="text-base text-primary">{$t('全局背景图')}</div>
          <div className="text-xs text-tertiary">{$t('设置全局背景后不可设置终端壁纸')}</div>
        </div>
        <div className="inline-flex border border-line rounded-sm overflow-hidden shrink-0">
          {(['global', 'terminal'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onBgTargetModeChange(mode)}
              className={cn(
                'px-3 py-1 text-sm cursor-pointer border-none',
                bgTargetMode === mode ? 'bg-accent text-white' : 'bg-transparent text-secondary',
              )}
            >
              {mode === 'global' ? $t('全局背景图') : $t('终端背景')}
            </button>
          ))}
        </div>
      </div>
      <SettingsDivider />
      {/* 上传 / 恢复（作用于当前选中的类型） */}
      <div className="flex justify-end items-center gap-3">
        {(bgTargetMode === 'global' ? globalBgImage : termBgImage) && (
          <Button variant="ghost" size="sm" onClick={onBgReset}>{$t('恢复默认')}</Button>
        )}
        <label htmlFor="appearance-bg-upload" className="inline-flex items-center justify-center gap-1 min-h-6 py-[3px] px-[7px] rounded-sm text-sm font-medium leading-none whitespace-nowrap border select-none cursor-pointer outline-none transition-colors duration-100 bg-raised text-secondary border-line hover:bg-hover hover:text-primary hover:border-focus active:bg-active">
          {$t('上传图片')}
          <input id="appearance-bg-upload" type="file" accept="image/*" className="hidden" onChange={onBgUpload} />
        </label>
      </div>
      <SettingsDivider />
      {/* 可见度（随类型切换范围与标签） */}
      <div className="flex justify-between items-center">
        <div className="text-base text-primary">
          {bgTargetMode === 'global' ? $t('全局背景可见度') : $t('壁纸可见度')}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max={bgTargetMode === 'global' ? 0.5 : 1}
            step={bgTargetMode === 'global' ? 0.02 : 0.05}
            value={bgTargetMode === 'global' ? globalBgOpacity : termBgOpacity}
            onChange={onBgOpacityChange}
          />
          <span className="text-base w-8 text-right text-primary">
            {Math.round((bgTargetMode === 'global' ? globalBgOpacity : termBgOpacity) * 100)}%
          </span>
        </div>
      </div>
      {/* 图标透明度仅全局模式有效 */}
      {bgTargetMode === 'global' && (
        <>
          <SettingsDivider />
          <div className="flex justify-between items-center">
            <div className="text-base text-primary">{$t('图标透明度')}</div>
            <div className="flex items-center gap-3">
              <input type="range" min="0.4" max="1" step="0.05" value={globalIconOpacity} onChange={onGlobalIconOpacityChange} />
              <span className="text-base w-8 text-right text-primary">{Math.round(globalIconOpacity * 100)}%</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
