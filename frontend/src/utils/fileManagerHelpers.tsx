// FileManager 纯辅助函数集（列宽测量/格式化/图标/排序/并发限制/身份解析等），
// 从 FileManager.tsx 抽出，无 React 状态依赖。
// 按领域拆分为多个子模块，此文件作为统一出口（桶文件）保持既有导入路径不变：
//   - fileManagerFormat.ts        列宽测量、大小/日期/权限格式化、可编辑判定
//   - fileManagerIcons.tsx        文件类型图标映射
//   - fileManagerTabs.tsx         标签页形状比较/合并/标题渲染与布局/开关读取
//   - fileManagerItems.ts         文件条目/虚拟行构建、排序、目录条目工具
//   - fileManagerTransfer.ts      上传分块并发、下载冲突设置与 payload
//   - fileManagerChmodIdentity.ts chmod 八进制换算与属主/属组身份解析
//   - fileManagerOpeningFiles.ts  打开中文件的全局登记
export * from './fileManagerFormat.ts';
export * from './fileManagerIcons.tsx';
export * from './fileManagerTabs.tsx';
export * from './fileManagerItems.ts';
export * from './fileManagerTransfer.ts';
export * from './fileManagerChmodIdentity.ts';
export * from './fileManagerOpeningFiles.ts';
