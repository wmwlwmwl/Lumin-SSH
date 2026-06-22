<div align="center">

# Lumin

**一个轻量级、高性能的现代化 SSH 客户端**

基于 Go (Wails) + React 18 构建，采用中性蓝灰色调现代设计，追求极致响应速度与多端数据漫游。

[![Release](https://img.shields.io/github/v/release/wmwlwmwl/Lumin-SSH?style=flat-square&color=0078D6&label=RELEASE)](https://github.com/wmwlwmwl/Lumin-SSH/releases)
[![Platform](https://img.shields.io/badge/PLATFORM-WINDOWS-0078D6.svg?style=flat-square)](https://github.com/wmwlwmwl/Lumin-SSH/releases)
[![License](https://img.shields.io/badge/LICENSE-MIT-8CBA00.svg?style=flat-square)](LICENSE)

[English](./README_EN.md) · [简体中文](./README.md)

</div>

---

## 核心特性

- **原生级全异步 PTY 引擎**
  - 后端基于 Go 原生并发处理 I/O，前端采用 WebSocket 与 xterm.js 构建极低延迟通道。
  - 支持预测本地回显 (Predictive Local Echo)，即便在高延迟网络下也能提供丝滑输入体验。
- **中性蓝灰色调现代设计**
  - 深色/浅色双主题，支持跟随系统自动切换。
  - 自定义强调色，支持 10 种预设色彩选择。
  - 四套终端配色方案：Lumin Default、Tokyo Night、Catppuccin、Dracula。
  - 支持自定义终端底栏壁纸，可调节透明度。
  - 弹窗遮罩带有毛玻璃模糊效果，浮动层使用半透明玻璃质感。
  - 微动效过渡：模态框滑入动画、右键菜单缩放入场、连接成功波纹等。
- **快捷连接仪表盘 (Dashboard)**
  - 无需保存服务器即可通过表单快速输入主机、端口、用户名、密码/密钥直连。
  - 支持密钥认证，可浏览选择本地私钥文件。
  - 连接成功后自动保存服务器信息。
- **服务器管理**
  - 支持卡片/表格两种视图模式，适应不同管理习惯。
  - 搜索过滤，快速定位目标服务器。
  - 自动化操作系统图标识别：支持 Ubuntu、Debian、CentOS、Windows、macOS、Kali、AlmaLinux、Rocky Linux、Oracle Linux、Anolis、OpenCloudOS、openEuler、openSUSE、NixOS、Gentoo、AOSC、RHEL、Fedora、Arch Linux、Alpine Linux、FreeBSD、TencentOS、Alibaba Cloud Linux 等。
  - 智能延迟检测：支持 SSH Banner RTT 和 TCP Dial 两种协议，SSH Banner 模式可穿透 TUN 代理（Clash / V2Ray）测出真实延迟。
  - 可配置的 Ping 自动刷新间隔。
- **会话与多终端分屏**
  - 一个 SSH 会话支持打开多个终端标签页，独立管理。
  - 终端标签页支持重命名和关闭。
  - 会话标签页右键菜单：断开、关闭、重连。
- **灵活的分区布局**
  - 左侧分屏、底部分屏两种模式，可自由拖拽调整大小。
  - 探针面板宽度可拖拽调节。
  - 文件管理器支持标签页、右侧分屏、底部分屏三种位置。
  - 实时保存布局偏好到本地存储。
- **系统级资源探针**
  - 无需额外部署 Agent，直连后自动挂载监控面板。
  - 毫秒级刷新 CPU 曲线、内存饼图、网络吞吐、磁盘 I/O、分区用量、进程列表等指标。
  - 支持 GPU 和 RAID 信息查询。
  - 探针数据自动刷新间隔可在设置中调整。
- **远程文件管理器**
  - 支持文件浏览、上传、下载、删除、重命名、新建目录。
  - 内置代码编辑器，可直接编辑远程文件，支持语法高亮。
  - 支持压缩/解压（tar.gz / zip）。
  - 支持文件权限修改 (chmod)。
  - 支持拖拽上传覆盖层。
  - 文件传输进度提示。
- **命令历史与快捷指令**
  - 自动捕获远程 Shell 命令历史，支持搜索与回放。
  - 快捷指令片段库，支持分组管理，一键发送常用命令。
- **全时无缝云端漫游 (WebDAV / R2 / FTP / SFTP)**
  - 支持 WebDAV、Cloudflare R2、FTP、SFTP 四种云存储后端。
  - 每次配置变更自动 AES-256-GCM 加密快照，多端一键恢复。
  - 支持配置备份保留份数、远程路径等。
- **本地高强度加密**
  - 首次运行自动生成 32 字节随机密钥。
  - 所有密码、私钥、WebDAV 凭据均经 AES-GCM 加密后落盘。
- **自动更新**
  - 启动时自动检测 GitHub Release 最新版本（延迟 2.5 秒后检测，不阻塞启动）。
  - 设置页支持手动检查更新。
  - 下载过程实时显示进度，SHA256 校验确保文件完整性。
  - 校验通过后热替换可执行文件并自动重启。
- **系统托盘驻留**
  - 关闭窗口最小化至托盘，防止误关。
  - 单实例保护，重复启动自动唤起已有窗口。
- **可自定义快捷键**
  - 复制、粘贴、清屏、新建标签页、SIGINT、EOF 等均支持自由绑定。
- **SSH 连接安全**
  - 主机密钥变更检测，提示用户确认。
  - 连接进度可视化卡片动画。
  - 密码/密钥敏感信息可一键隐藏显示。
- **国际化**
  - 支持简体中文 / English 切换。
- **消息通知**
  - 操作结果通过非侵入式 Toast 消息提示。
  - 文件传输、更新下载、连接错误等均有实时反馈。

---

## 自动更新机制

Lumin 采用 GitHub Releases 作为更新分发渠道，全流程如下：

1. **版本检测** — 启动时及设置页中调用 `https://api.github.com/repos/wmwlwmwl/Lumin-SSH/releases/latest` 获取最新 Release 信息。
2. **语义化比较** — 通过 `compareVersions()` 对比本地版本与最新版本，自动识别是否需要更新。
3. **资源匹配** — 根据当前运行版本（便携版/安装版）自动匹配对应的 `.exe` 下载资源。
4. **安全下载** — 强制 HTTPS 连接，下载过程中实时推送进度到前端进度条。
5. **完整性校验** — 自动尝试获取 GitHub Release 附带的 `.sha256` 校验文件，验证下载文件完整性，防止篡改。
6. **热替换重启** — 校验通过后替换当前可执行文件并自动重启，完成更新。

> 版本号管理：`wails.json`（构建产物版本）、`frontend/src/config.js`（前端版本）、`frontend/package.json`（npm 版本）三者保持一致。

---

## 构建指南

环境要求：**Go 1.20+** 与 **Node.js 18+**

```bash
# 安装 Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 克隆仓库
git clone https://github.com/wmwlwmwl/Lumin-SSH.git
cd Lumin-SSH

# 开发模式（热重载）
wails dev

# 生产构建
wails build

# 构建 NSIS 安装包（需安装 NSIS）
wails build -nsis
```

---

## 赞助支持

如果你觉得 Lumin 对你有帮助，欢迎扫码赞助支持，你的每一份鼓励都是持续更新的动力。

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="assets/wx.png" alt="微信赞赏" width="200" />
        <br/>
        <strong>微信</strong>
      </td>
      <td align="center">
        <img src="assets/zfb.png" alt="支付宝赞赏" width="200" />
        <br/>
        <strong>支付宝</strong>
      </td>
      <td align="center">
        <img src="assets/qq.png" alt="QQ赞赏" width="200" />
        <br/>
        <strong>QQ</strong>
      </td>
    </tr>
  </table>
</div>

---

## 许可证

本项目遵循 [MIT License](LICENSE) 协议开源。
