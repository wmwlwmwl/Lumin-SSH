# 删除程序字体设计

## 目标
在设置 → 外观 → 字体管理器中，允许用户删除已导入到程序 `fonts/` 目录的字体文件。

## 行为
- 字体列表每项提供删除入口（小按钮，不干扰拖拽）。
- 删除目标：`{programDirectory}/fonts/{fileName}`（拷贝进软件的副本，不是源路径）。
- 若该字体正被界面文本 / 终端输出 / AI 面板任一处使用：清空对应 localStorage 分配，并立即 `applyProgramFontPreferences` 恢复默认字体。
- 无二次确认；成功 / 失败用 toast 反馈。

## 后端
- `deleteProgramFontFile(fileName)`：sanitize 文件名、校验支持的扩展名、仅删除 `fonts/` 目录内文件。
- `App.DeleteProgramFont(fileName string) error` 暴露给前端。

## 前端
- `programFonts.js`：`deleteProgramFont(fileName)` 调 Go API，invalidate 缓存，清理占用该字体的分配，再 apply。
- `SettingsModal`：删除 handler + 刷新列表。
- `AppearanceTab`：列表项旁删除按钮。
- i18n：`删除字体` / `字体已删除` / `字体删除失败`（至少 zh-CN、en-US）。

## 不做
- 批量删除
- 阻止删除正在使用的字体
- 二次确认弹窗
