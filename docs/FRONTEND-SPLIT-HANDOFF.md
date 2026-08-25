# 前端组件拆分交接文档

> 分支：`refactor/frontend-split-component`（基于上游 `refactor/frontend-ui-tailwind` @ `e87308df`）
> 目标：单个 `.tsx` ≤ 400 行，纯结构重构，不改任何行为/逻辑/样式/i18n key。
> 状态：**已完成 4 个域（FileManager / AIPanel / Terminal / Settings），剩余 3 组文件待拆。**

---

## 一、分支背景

| 项 | 值 |
|---|---|
| 基线 | 上游 `wmwlwmwl/Lumin-SSH` 的 `refactor/frontend-ui-tailwind`（Tailwind v4 UI 重构） |
| 本分支 | `refactor/frontend-split-component`，HEAD = `51b4afcb` |
| 首个提交 | `82486280 chore(frontend): 同步 package-lock.json（安装 tailwind 相关依赖）` |
| 技术栈 | Wails + React 19 + TS(strict) + Tailwind v4 + Vite 8 |

**重要**：上游 tailwind 提交把全部组件的内联样式改写为 Tailwind 工具类，因此旧分支
`refactor/split-large-components` 的拆分提交**不能 cherry-pick**（样式上下文完全不同）。
本分支的拆分是在 tailwind 代码上**重新执行**的，仅沿用旧分支的命名习惯。

---

## 二、已完成的工作（4 个域，25 个提交）

| 域 | 关键文件 | 行数变化 |
|---|---|---|
| FileManager | `FileManager.tsx` | 7120 → **121**（hook 编排层） |
| | `utils/fileManagerHelpers.tsx` | 992 → **17**（桶文件 + 7 个纯函数子模块） |
| | `FileUploadQueuePanel.tsx` | 558 → **149** |
| AIPanel | `AIPanel.tsx` | 5963 → **64**（组合层） |
| Terminal | `Terminal.tsx` | 4233 → **339** |
| Settings | `SettingsModal.tsx` | 2708 → **361** |
| | `AppTab.tsx` | 427 → **301** |
| | `FileManagerTab.tsx` | 553 → **17**（组合层） |
| | `AppearanceTab.tsx` | 685 → **367** |
| | `SyncTab.tsx` | 555 → **280** |

### 新增目录结构（示例）

```
frontend/src/components/
├── filemanager/           # FileManager 域：11 个组件 + 类型 + 16 个 hook
│   ├── FileManagerToolbar.tsx / TabBar / Content / Overlays / VirtualRow / Panes …
│   ├── fileManagerTypes.ts、fileManagerController.ts
│   └── useFileManagerCore.ts、useFileManagerTransfers.ts、useFileManagerTabs.ts …
├── terminal/              # Terminal 域：9 个组件 + 13 个 hook/工厂/类型
│   ├── TerminalInputBar / TerminalSearchBar / TerminalHistoryPopup / TerminalMenus …
│   └── useTerminalSession.ts、terminalTypes.ts …
├── ai/                    # AIPanel 域：17 个新文件（组件 + 11 个 hook）
│   ├── AIHomeView.tsx、AIConversationTabPanel.tsx、AIWorkspaceTabBar.tsx …
│   └── useAIChatStreamEvents.ts、useAIChatRequests.ts、useAIConversationHome.ts …
└── settings/
    ├── SettingsSidebar.tsx、useSettingsGeneralState.ts、useSettingsSearch.ts、useSettingsShortcuts.ts
    ├── appearance/        # FontManagerPanel / BackgroundPanel / ThemePackagePalette + 4 个 hook
    ├── fileManager/       # FileManagerTabPane + 3 个 Section 组件 + useFileManagerSettings + 类型
    └── sync/              # SyncTabPane / SyncProviderCard / SyncProviderForms / syncTabTypes + 4 个 hook
```

---

## 三、拆分方法论（接手者必须遵循）

1. **纯结构重构**：JSX 逐字搬移，不重写、不美化样式；不增删任何 i18n key；不调 effect 依赖数组。
2. **props 同名传递**：闭包变量 `foo` 传给子组件时用 `foo={foo}`，搬移的 JSX 内部引用不用改名。
3. **hook 返回值同名解构**：`const { foo, handleBar } = useXxx(...)`，调用点代码不用改。
4. **类型集中**：共享类型放 `<域>/xxxTypes.ts`；props 接口随组件或类型文件（如 `fileManagerTabTypes.ts`）。
5. **纯函数下沉**：不依赖闭包的辅助函数 → `utils/` 或域内 `.ts` 模块（参考 `fileManagerHelpers.tsx` 桶文件保旧导入路径）。
6. **内聚状态簇 → hook**：一个 hook 管一件事（参考 `useFileManagerTransfers`、`useAIChatRequests`）。
7. **组合层模式**：主文件收敛为「hooks 编排 + 子组件组装」（参考 `FileManager.tsx` 121 行、`AIPanel.tsx` 64 行）。
8. **命名**：沿用旧分支 `refactor/split-large-components` 的既有命名（如 TerminalSearchBar 等）；新命名用域前缀 + PascalCase。
9. **顺序敏感**：hook 调用顺序即 React 状态顺序，移动 hook 调用点时确认其依赖的值已在前面声明（TS 会报 `used before declaration`）。
10. **样式铁律**（docs/UI-GUIDELINES.md）：不新增内联 hex/数字字号/zIndex 魔数/`<style>` 注入；条件类用 `cn()`；基础控件用 `components/ui/`。

---

## 四、剩余待拆文件（23 个，按建议顺序）

### 第 1 组：App 域（最复杂，先做）

| 文件 | 行数 | 建议方向 |
|---|---|---|
| `src/App.tsx` | 2092 | 状态簇 → hooks（useToasts/useUpdateChecker 已存在可复用）；弹层/顶层渲染区 → 子组件；参考 AIPanel 的拆分路径 |
| `src/components/SessionWorkspace.tsx` | 1432 | 工作区标签/面板停靠状态已有 hooks（useWorkspacePanelDocking 等），继续抽面板渲染区 |
| `src/components/AppOverlays.tsx` | 553 | 每个弹层一个子组件 |
| `src/components/GlobalDialog.tsx` | 579 | 全局确认/输入框；类型 + 渲染函数拆出 |
| `src/components/GlobalContextMenu.tsx` | 416 | 接近达标，抽菜单项构造纯函数即可 |

### 第 2 组：ai 域剩余

| 文件 | 行数 | 建议方向 |
|---|---|---|
| `src/components/ai/AIComposer.tsx` | 1890 | 输入框/附件/提及/拖拽 → 分区组件；状态簇 → hook |
| `src/components/ai/AIProviderSelector.tsx` | 1600 | 提供方卡片/编辑浮层/测试结果 → 子组件（AIProviderListRow 已有，可参照） |
| `src/components/ai/AIProviderQuickEditOverlay.tsx` | 1578 | 表单分区 → 子组件/字段组 |
| `src/components/ai/AIPanelSettingsOverlay.tsx` | 718 | 按设置分区拆子组件 |
| `src/components/ai/AIAutoApproveDropdown.tsx` | 478 | 规则行/触发器编辑器 → 子组件 |
| `src/components/ai/AIDiffViewerPair.tsx` | 417 | 接近达标，抽纯函数 |
| `src/components/ai/chat/AIChatToolCard.tsx` | 747 | 工具结果渲染分支 → 子卡片 |
| `src/components/ai/chat/AIChatConversation.tsx` | 710 | 会话头/空状态/渲染分区 |
| `src/components/ai/chat/AIChatFollowUpCard.tsx` | 586 | 建议条目/反馈区 → 子组件 |

### 第 3 组：页面类

| 文件 | 行数 | 建议方向 |
|---|---|---|
| `src/components/QuickCommands.tsx` | 1693 | 命令列表/编辑器/导入导出 → 分区组件 + hooks |
| `src/components/ProbePanel.tsx` | 1235 | 图表/详情表 → 子组件；采样逻辑 → hook |
| `src/components/FileEditor.tsx` | 1025 | Monaco 封装与对话框 → 子组件（fileManager 域已拆过类似弹层，可参照） |
| `src/components/ServerList.tsx` | 979 | 卡片/分组/归档 → 子组件；已有 useServerCatalog/useServerPing hooks 可复用 |
| `src/components/Dashboard.tsx` | 793 | 卡片渲染 → 子组件 |
| `src/components/AddServerModal.tsx` | 728 | 表单步骤 → 分区组件 |
| `src/components/ProcessPage.tsx` | 718 | 进程表/详情 → 子组件 |
| `src/components/NetworkPage.tsx` | 504 | 接近达标，抽纯函数 |
| `src/components/PortForwardDialog.tsx` | 445 | 抽类型 + 表单块 |

> 每完成一个域立即跑全量验证 + commit（见下节），保持提交粒度「一个关注点一个 commit」。

---

## 五、验证与提交规范

### 每个 commit 前必须全部通过

```bash
cd frontend
npx tsc --noEmit          # 0 错误
npm run build             # 成功
npm run styles:check      # 通过（不得超出基线；若存量违规随代码迁入 .ts 而减少，
                          # 脚本会按内置机制自动下调 frontend/scripts/style-baseline.json，
                          # 属正常现象，如 Terminal 域 hexColor 36→34）
npm run i18n:check        # exit 0
```

### 提交信息格式（中文，勿 push）

```
refactor(<域>): 拆出 <内容列表>

- 新增 components/<域>/：Xxx（职责一句话）
- <原文件>.tsx NNNN -> MMM 行
```

---

## 六、注意事项（踩过的坑）

1. **hook 调用顺序**：TS 报 `Block-scoped variable used before its declaration` 时，把提供值的 hook 调用点移到使用点之前（SettingsModal 遇到过）。
2. **类型不匹配**：搬移 JSX 后若子组件 props 类型对不上，优先导出原推导类型（`ReturnType<typeof useXxx>['foo'][number]`），别手写字段清单。
3. **参数解构默认值**：子组件搬移 JSX 时，原组件参数解构里的默认值（`fileManagerLayoutMode = 'classic'` 等）必须随 props 解构一起搬，否则行为改变。
4. **`.tsx` vs `.ts`**：只有 `.tsx` 有 400 行硬限制；styles:check 只扫 `.tsx`（故样式常量迁到 `.ts` 后基线会降，属预期）。
5. **SettingsDivider 等共享组件**：搬移 JSX 时保持原组件调用（含 margin 参数），不要替换成裸 div。
6. **半成品状态**：本分支历史中 settings 域有一次子代理中断（3 个提交 + 未提交半成品），已被后续提交补齐并验证——接手者若发现工作区有未提交变更，先验证（tsc/build 全绿）再继续，不要盲目丢弃。
7. **大 .ts hook 不再硬拆**：`useFileManagerTransfers`(1159)、`useAIChatStreamEvents`(1354)、`useAIChatRequests`(1222) 等单关注点 hook 保持单文件，硬拆会切断共享闭包、增加回归风险；硬指标只限 `.tsx`。

---

## 七、完成判据

```bash
cd frontend && find src -name "*.tsx" | xargs wc -l | awk '$1>400 && $2!="total"'
# 输出为空即达标
```

全部完成后：跑一次全量验证 → 如需要可 `git push -u origin refactor/frontend-split-component`（先与用户确认远端）。
