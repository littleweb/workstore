# WorkStore

一个本地优先的桌面工作平台，将文档、白板、AI 和轻量工具放在同一个窗口中。用户数据保存在自己的电脑，可选用自己的 GitHub 仓库在设备间同步，无需自建服务端。

技术栈：Tauri 2 · Rust · React 19 · TypeScript · Ant Design 6。

## 下载与当前状态

从 [GitHub Releases](https://github.com/littleweb/workstore/releases) 下载。当前稳定版为 **0.1.4**，已发布 macOS Apple Silicon（M 系列）安装更新包。Windows、Linux 和 Intel Mac 尚未完成实机验收，也未提供正式安装包。当前 macOS 包使用 ad-hoc 签名，尚未完成 Apple Developer ID 签名和公证。

- **文档**：本地富文本编辑、自动保存、重命名、导出；右侧 AI 助手生成草稿后可追加、替换正文或新建文档。
- **白板**：基于 Excalidraw 的绘图文档；右侧常规 AI 对话可直接生成、分步绘制或修改内容；支持选中矩形/Frame 内补充手绘原型控件、可选选区限定、停止与逐步撤销。
- **小漫画**：模板、故事与分镜编辑、版本记录和导出；AI 相关功能依赖所配置的服务。
- **全局 AI**：默认调用本地 Codex，启动时自动检测；支持兼容 OpenAI 的 API、模型和代理配置。Codex 需预先安装并登录，模型推理仍可能联网。
- **常用与最近**：统一工具入口；切换已有条目保持顺序，新条目排在前面。
- **工具**：JSON 校验与格式化、颜色拾取、时间戳转换。
- **GitHub 数据同步**：后台拉取、合并、推送；冲突版本在 Git 跟踪的后台历史中保全，不再增加可见副本，支持新设备初始化及同步缓存锁文件恢复。
- **应用内更新**：下载签名更新包，保存数据后安装并重启。

项目管理应用仍在开发中；账号体系、插件市场和移动客户端尚未实现。

## 本地开发

准备 Node.js 22 或更新的兼容版本、npm、Rust stable，以及目标平台的 Tauri 2 系统构建依赖。macOS 需要 Xcode Command Line Tools；Windows 需要 MSVC 构建工具和 WebView2；Linux 需要 WebKitGTK 4.1 等系统开发库。

```bash
git clone https://github.com/littleweb/workstore.git
cd workstore
npm ci
npm run desktop
```

`.npmrc` 固定使用 legacy peer dependency 解析，以适配当前编辑器依赖；提交并使用两个锁文件，不要在新设备随意更新依赖版本。

```bash
npm run dev -- --port 5173                      # 浏览器预览
npm run build                                   # 类型检查与前端构建
node --test tests/*.test.mjs                     # 前端及模型逻辑测试
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run tauri -- build --debug                   # 本机调试桌面包
npm run desktop:build                           # 本机正式构建
```

桌面开发端口为 1420。浏览器预览的数据位于浏览器存储，与桌面文件独立；GitHub 同步、原生 AI 等功能需要桌面版。首次安装依赖后，构建脚本会准备 Excalidraw 字体等资源，不需要提交生成目录。

## 多设备接续开发

**源码仓库与用户数据仓库是两套独立的 Git 流程。** 本仓库维护代码、测试、设计决定和开发上下文；应用内配置的仓库同步用户文档，不用于自动上传源码或聊天记录。

换电脑后拉取代码，再依次阅读：

1. [AGENTS.md](AGENTS.md)：开发约定和 AI 助手入口。
2. [当前上下文](docs/context/CURRENT.md)：当前状态、验证范围和下一步。
3. [架构与决定](docs/ARCHITECTURE.md)：必须保持的行为和数据边界。
4. [多设备开发流程](docs/DEVELOPMENT.md)：分支、提交、同步与交接。

开发前 `git pull --ff-only`；完成后同步更新上下文文档，与代码一起 commit、push。另一台设备 pull 后即可接续。AI 助手应读取这些仓库文档；这不是对任何聊天软件私有记忆的自动同步。

## 数据与隐私

默认数据目录为系统应用数据目录下的 `com.workstore.desktop/workspace`；macOS 为 `~/Library/Application Support/com.workstore.desktop/workspace`。可在设置中选择其他工作目录。

- `state.json` 保存导航结构、小工具状态等。
- `data/app.doc/`、`data/app.whiteboard/`、`data/app.comic/` 保存独立 JSON 文档。
- `.workstore/` 保存本地锁、备份和同步缓存，不进入用户数据远端。
- `.workstore-history/sync/` 保存可恢复的并发版本历史，随用户数据 Git 仓库同步，不出现在工具列表。
- GitHub Token、AI Key、设备路径及设备偏好存于应用配置目录，不应进入源码仓库。

公开仓库只放可公开的开发上下文；不要提交真实用户作品、访问令牌、私钥、个人聊天记录或机器专属配置。

## 维护文档

- [参与开发](CONTRIBUTING.md)
- [架构](docs/ARCHITECTURE.md) · [开发与多设备交接](docs/DEVELOPMENT.md)
- [AI 接入](docs/ai-service.md) · [发布和自动更新](docs/自动更新.md)
- [历史方案与设计规范](docs/方案与设计规范.md) · [小漫画开发交付](docs/小漫画开发交付.md)

历史设计稿描述的是当时的方案，实际状态以代码与 `docs/context/CURRENT.md` 为准。依赖库和字体等第三方内容保留其原有许可证；项目采用 [MIT 许可证](LICENSE)，另见 [第三方内容说明](THIRD_PARTY_NOTICES.md)。
