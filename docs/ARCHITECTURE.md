# 架构与稳定决定

## 分层

React / Ant Design 提供容器和子应用 UI；`src/workspace.ts` 协调保存、后台同步与刷新；Tauri 命令进入 Rust 文件存储和系统能力。

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| 主容器 | `src/main.tsx`、`src/navigation.ts` | 导航、工具入口、设置、稳定的最近顺序 |
| 文件存储 | `src-tauri/src/storage.rs` | 原子写入、工作区锁、备份、外部改动检测、目录迁移 |
| 生命周期 | `src/documentLifecycle.ts` | 文档保存注册，退出、切换、同步前刷新保存队列 |
| 数据同步 | `src/workspace.ts`、`src-tauri/src/sync.rs` | 后台 Git 传输、三方合并、激活、列表刷新 |
| 文档/白板/漫画 | `src/documents/`、`src/whiteboard/`、`src/comics/` | 独立文件、缓存、版本 token、延迟保存 |
| AI | `src/ai/`、`src-tauri/src/ai.rs`、`ai_images.rs` | provider 路由、设备配置、取消/超时和图像能力 |
| 更新 | `src/updateService.ts`、`scripts/*update*.mjs` | 签名清单、下载、安装与重启 |
| 模板目录 | `content/comics/`、`schemas/` | 版本化公开模板与校验，不是用户漫画数据 |

## Git 数据同步

工作目录文件是源数据；私有 checkout 只用于 Git 网络传输。应用定时及在启动、窗口恢复、联网、本地保存后检查远端。网络阶段允许编辑，激活阶段短暂串行化写入和刷新。

- 使用共同基线做三方合并，导航成员按工具 ID 合并；不能随意把编辑器数组拆开合并。
- 冲突保留副本，新设备合并已有本地内容，不用空的初始化数据覆盖远端。
- 网络期间保存的本地改动保持优先，后续循环再同步。
- 刷新一个工具失败不得阻止其他工具；未变化的拉取也补刷列表，保留待重试路径。
- `.workstore/` 不参与传输。残留 Git 锁时选择新的缓存代次，保留旧缓存和工作区基线，不盲目删锁。
- Git 网络操作自动读取系统代理；当前 macOS 从系统 HTTPS 代理读取，其他平台继承代理环境变量。fetch/push 总限时 300 秒，ls-remote 60 秒；低速连接会退出重试。超时终止整个 Git 进程组（Windows 使用进程树清理）。

## AI 与凭据

子应用依赖统一消息接口。默认 Codex 在后台自动发现、检查登录并保存设备配置；执行文本任务时使用隔离临时目录、只读限制，取消/超时应终止任务。文本助手只有用户勾选时才附带当前内容。API Key 和 GitHub Token 属于设备配置，不随源码或用户内容共享。

数据文件受到本地文件权限保护，不应宣称已通过系统 Keychain 加密。图像和远程 API 的支持范围见实际适配器与 AI 文档。

## 三种仓库用途

1. `littleweb/workstore`：公开源码、团队上下文、GitHub Releases。
2. 每位用户自行配置的数据仓库：个人工作区同步，建议私有。
3. 应用 `.workstore/` 内的 Git checkout：可替换的本地传输缓存。

三者不能混用。跨设备开发通过标准 Git 分支和项目上下文文件；应用内同步不会自动提交代码或同步 AI 工具的私有聊天历史。
