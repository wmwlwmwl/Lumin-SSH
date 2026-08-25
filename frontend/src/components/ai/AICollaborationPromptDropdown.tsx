import { Check, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n.ts'

/** 常用要求预设 */
interface CollabPreset {
  id: string
  title: string
  text: string
}

function normalizePresets(values: unknown): CollabPreset[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set<string>()
  const normalized: CollabPreset[] = []
  values.forEach((value, index) => {
    const raw = value as Record<string, unknown> | null | undefined
    const text = typeof raw?.text === 'string' ? raw.text.replace(/\r\n/g, '\n').trim() : ''
    if (!text) {
      return
    }
    const rawId = typeof raw?.id === 'string' ? raw.id.trim() : ''
    const id = rawId || `collab-preset-${index + 1}`
    if (seen.has(id)) {
      return
    }
    const rawTitle = typeof raw?.title === 'string' ? raw.title.trim() : ''
    seen.add(id)
    normalized.push({ id, title: rawTitle || text, text })
  })
  return normalized
}

function createPresetId() {
  return `collab-preset-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

interface IconButtonProps {
  title: string
  onClick?: () => void
  children: React.ReactNode
  danger?: boolean
}

function IconButton({ title, onClick, children, danger = false }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md border border-line bg-canvas transition-colors duration-100 cursor-pointer shrink-0 p-0 ${danger ? 'text-danger' : 'text-secondary'}`}>
      {children}
    </button>
  )
}

const PANEL_SHELL_CLASS = 'border border-line rounded-lg bg-overlay shadow-xl overflow-hidden overflow-x-hidden box-border'
const SECTION_HINT_CLASS = 'text-xs text-tertiary leading-[1.5]'

export interface AICollaborationPromptDropdownProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  extraPrompt?: string
  onExtraPromptChange?: (value: string) => void
  presets?: unknown
  onPresetsChange?: (presets: unknown) => void
  anchorRef?: React.RefObject<HTMLElement | null>
  disabled?: boolean
  scopeIsTask?: boolean
  dismissSignal?: number
}

export default function AICollaborationPromptDropdown({
  open = false,
  onOpenChange,
  extraPrompt = '',
  onExtraPromptChange,
  presets = [],
  onPresetsChange,
  anchorRef,
  disabled = false,
  scopeIsTask = false,
  dismissSignal = 0,
}: AICollaborationPromptDropdownProps) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)
  const [panelBounds, setPanelBounds] = useState<{ left: number; width: number } | null>(null)
  const [editingPresetId, setEditingPresetId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftText, setDraftText] = useState('')
  const normalizedPresets = useMemo(() => normalizePresets(presets), [presets])
  const isEditing = Boolean(editingPresetId)

  useEffect(() => {
    if (!open) {
      setTriggerRect(null)
      setPanelBounds(null)
      return undefined
    }
    const measure = () => {
      const el = anchorRef?.current
      if (!el) {
        return
      }
      const rect = el.getBoundingClientRect()
      const root = el.closest('[data-ai-panel-root="true"]')
      const rootRect = root?.getBoundingClientRect()
      setTriggerRect(rect)
      if (rootRect && rootRect.width > 0) {
        setPanelBounds({ left: rootRect.left, width: rootRect.width })
      } else {
        setPanelBounds(null)
      }
    }
    measure()
    const handleResize = () => measure()
    const handlePointerDown = (event: PointerEvent) => {
      const anchorEl = anchorRef?.current
      if (panelRef.current?.contains(event.target as Node)) {
        return
      }
      if (anchorEl?.contains(event.target as Node)) {
        return
      }
      onOpenChange?.(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange?.(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
    }
  }, [anchorRef, onOpenChange, open])

  useEffect(() => {
    onOpenChange?.(false)
  }, [dismissSignal])

  useEffect(() => {
    if (!open) {
      setEditingPresetId('')
      setDraftTitle('')
      setDraftText('')
    }
  }, [open])

  const persistPresets = (nextPresets: unknown) => {
    onPresetsChange?.(normalizePresets(nextPresets))
  }

  const handleStartCreate = () => {
    setEditingPresetId('new')
    setDraftTitle('')
    setDraftText('')
  }

  const handleStartEdit = (preset: CollabPreset) => {
    setEditingPresetId(preset.id)
    setDraftTitle(preset.title)
    setDraftText(preset.text)
  }

  const handleCancelEdit = () => {
    setEditingPresetId('')
    setDraftTitle('')
    setDraftText('')
  }

  const handleSubmitEdit = () => {
    const nextText = draftText.replace(/\r\n/g, '\n').trim()
    if (!nextText) {
      return
    }
    const nextTitle = draftTitle.trim() || nextText
    if (editingPresetId === 'new') {
      persistPresets([...normalizedPresets, { id: createPresetId(), title: nextTitle, text: nextText }])
    } else {
      persistPresets(normalizedPresets.map((preset) => (
        preset.id === editingPresetId ? { ...preset, title: nextTitle, text: nextText } : preset
      )))
    }
    handleCancelEdit()
  }

  const handleDeletePreset = (presetId: string) => {
    persistPresets(normalizedPresets.filter((preset) => preset.id !== presetId))
    if (editingPresetId === presetId) {
      handleCancelEdit()
    }
  }

  const handleApplyPreset = (preset: CollabPreset) => {
    const currentValue = typeof extraPrompt === 'string' ? extraPrompt : ''
    const nextValue = currentValue.trim()
      ? `${currentValue.replace(/\s+$/u, '')}\n${preset.text}`
      : preset.text
    onExtraPromptChange?.(nextValue)
  }

  if (!open || !triggerRect || disabled) {
    return null
  }

  return (
    <div
      ref={panelRef}
      className={`fixed ${PANEL_SHELL_CLASS}`}
      style={{
        ...(panelBounds ? { left: panelBounds.left } : { left: triggerRect.left }),
        bottom: window.innerHeight - triggerRect.top + 8,
        width: panelBounds?.width ?? 320,
        maxWidth: panelBounds?.width ? `${panelBounds.width}px` : 'min(320px, calc(100vw - 32px))',
        zIndex: 10000,
      }}>
      <div className="px-3 py-2.5 border-b border-line-subtle grid gap-2">
        <div className="flex items-center justify-between gap-2.5">
          <div className="text-sm font-bold text-primary">{t('助理协同')}</div>
          <IconButton title={t('关闭')} onClick={() => onOpenChange?.(false)}>
            <X size={12} />
          </IconButton>
        </div>
        <div className={SECTION_HINT_CLASS}>
          {t('开启后,主助手想要问你问题或想要结束或完成任务时,将先由助理协助为您做出进一步的决定.')}
        </div>
        <div className={SECTION_HINT_CLASS}>
          {t('你可以在下面写几句要求,告诉助理替你协助时要注意什么.')}
        </div>
        <div className={SECTION_HINT_CLASS}>
          {scopeIsTask ? t('下面的要求只对当前这个任务生效') : t('下面的要求会作为以后新建任务的默认值')}
        </div>
      </div>
      <div className="p-3 grid gap-2.5 overflow-x-hidden">
        <div className="grid gap-1.5">
          <div className="text-primary text-sm font-semibold">{t('你的要求')}</div>
          <textarea
            id="ai-collab-extra-prompt"
            name="ai-collab-extra-prompt"
            value={typeof extraPrompt === 'string' ? extraPrompt : ''}
            onChange={(event) => onExtraPromptChange?.(event.target.value)}
            placeholder={t('例如: 能自己判断的就别问我,遇到删文件这种事一定要先问我')}
            spellCheck={false}
            className="w-full min-h-[84px] resize-y rounded-lg border border-line bg-sunken text-primary px-2.5 py-2 box-border outline-none text-sm leading-[1.5] [font-family:inherit]"
          />
        </div>
        <div className="p-3 rounded-lg border border-line bg-canvas grid gap-2.5 overflow-x-hidden">
          <div className="flex items-center justify-between gap-2.5">
            <div className="text-primary text-sm font-bold">{t('常用要求')}</div>
            <IconButton title={t('新增一条')} onClick={handleStartCreate}>
              <Plus size={12} />
            </IconButton>
          </div>
          {isEditing ? (
            <div className="grid gap-2">
              <input
                id="ai-collab-draft-title"
                name="ai-collab-draft-title"
                autoComplete="off"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder={t('起个短名字,留空就用下面的内容')}
                className="w-full h-8 rounded-lg border border-line bg-sunken text-primary px-2.5 box-border outline-none text-sm"
              />
              <textarea
                id="ai-collab-draft-text"
                name="ai-collab-draft-text"
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                placeholder={t('这条要求的具体内容')}
                spellCheck={false}
                className="w-full min-h-16 resize-y rounded-lg border border-line bg-sunken text-primary px-2.5 py-2 box-border outline-none text-sm leading-[1.5] [font-family:inherit]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmitEdit}
                  disabled={!draftText.trim()}
                  className={`flex-1 h-[30px] rounded-lg border border-accent-border bg-[rgba(var(--accent-rgb),0.14)] text-accent text-sm font-semibold transition-colors duration-100 ${
                    draftText.trim() ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'
                  }`}>
                  {t('保存')}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="flex-1 h-[30px] rounded-lg border border-line bg-transparent text-secondary text-sm font-semibold transition-colors duration-100 cursor-pointer">
                  {t('取消')}
                </button>
              </div>
            </div>
          ) : null}
          {normalizedPresets.length === 0 && !isEditing ? (
            <div className={SECTION_HINT_CLASS}>
              {t('还没有保存过要求,点右上角加号新建一条')}
            </div>
          ) : null}
          {normalizedPresets.length > 0 ? (
            <div className="grid gap-1.5 max-h-[200px] overflow-y-auto overflow-x-hidden">
              {normalizedPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-lg border border-line-subtle bg-sunken">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    title={preset.text}
                    className="flex-1 min-w-0 inline-flex items-center gap-1.5 border-none bg-transparent text-primary text-sm font-medium text-left cursor-pointer p-0">
                    <Check size={12} color="var(--accent)" />
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{preset.title}</span>
                  </button>
                  <IconButton title={t('编辑')} onClick={() => handleStartEdit(preset)}>
                    <Pencil size={11} />
                  </IconButton>
                  <IconButton title={t('删除')} danger={true} onClick={() => handleDeletePreset(preset.id)}>
                    <X size={11} />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
