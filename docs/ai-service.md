# WorkStore 全局 AI 能力

## 使用

设置 → AI 默认选择本地 Codex。设备需安装支持 `exec --ignore-user-config` 的 Codex 并执行 `codex login`。可自动查找安装位置，也可指定可执行文件的绝对路径；每次启动都会在后台自动查找 Codex、检查登录并保存检测结果，不阻塞窗口、不弹窗，也不产生模型请求。已有 API 服务选择、模型和密钥保持不变。本地 Codex 是调用入口，推理仍需连接其模型服务。

网络代理留空时，macOS 自动使用系统 HTTPS 代理（环境变量优先）；其他系统使用代理环境变量。也可显式设置 HTTP/HTTPS 代理 URL，或输入 `direct` 直连。自动配置脚本 PAC 尚未支持。本机模型 API 始终直连。

可切换为 OpenAI 兼容 API：填写 base URL（例如 `https://api.openai.com/v1`）、模型名称和 API Key。地址不要带 `/chat/completions`，适配器会追加。HTTPS 是默认要求；本机 HTTP 服务也可使用。只支持文本 Chat Completions，不包含图像输入、工具调用和流式显示。

AI 对话、文档和白板均可使用。工具助手默认只发送输入问题；勾选“附带当前内容”才发送当前文档纯文本或白板文字元素。不会自动上传图片、附件或整个工作目录。对话历史中附带过的上下文仍属于该对话，开始新对话可清空。

## 子应用接口

```ts
import { ai } from '../ai/client';
const controller = new AbortController();
const response = await ai.generate({
  toolId: 'app.example',
  messages: [
    { role: 'system', content: '请帮助用户整理想法。' },
    { role: 'user', content: '用户明确提交的内容' },
  ],
  record: true,
}, controller.signal);
// response.text；response.saveError 非空时回答已生成，但保存失败，应提示复制保存。
// controller.abort() 可停止调用。
```

工具也可复用 `AiAssistantButton`，并通过惰性的 `context()` 提供当前选中内容。纯功能调用可省略 `record`，由工具自行保存结果。生成结果不自动覆盖用户文稿。

## 存储和同步

- AI 配置位于应用配置目录 `ai-settings.json`，包含设备路径、provider、model、timeout 和 API Key。Unix 上权限为 0600；Key 不返回前端，不进入工作目录和 GitHub 同步。这是本机受文件权限保护的存储，不是 Keychain 加密。
- 开启记录的每次完整回答保存为工作目录 `data/app.ai/<UUID>.ai.json`。记录包含最后问题（以及明确附带的上下文）、回答、工具标识、服务名称和时间；它是独立回答记录，并非完整会话文件。
- UUID 文件不会因不同设备同时使用而互相覆盖。沿用现有后台同步和刷新机制；界面按工具显示最近 30 条，其余文件仍保留。
- 首次接入的新设备可以拉取已有回答，但需要自己的 Codex 登录或 API Key。

## 后台和扩展

React → 统一 client → Tauri 命令 → Rust provider 路由。Codex 通过参数数组和标准输入调用，在空临时目录、只读沙箱下运行，禁用 shell、补丁与搜索工具，并忽略用户 agent/MCP 配置。没有 shell 字符串插值。兼容 API 使用 Rust HTTPS 请求，禁止重定向携带密钥。

每个请求最多 128 KB 消息、最多 80 条消息；最多同时 2 个请求。默认超时 180 秒，可配置 10–600 秒。取消和超时会终止本次 Codex 子进程或释放 HTTP 请求。调用期间不持有工作空间锁；退出、更新或迁移工作目录前，统一生命周期会停止并等待未完成请求。

新协议可在 Rust `generate` 路由下添加适配器，继续返回统一文本结果，子应用不依赖供应商 SDK。当前兼容接口已用本机模拟服务器验证协议，实际第三方服务需使用用户提供的 Key 验证。

参考：[Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

## 图像生成（小漫画）

沿用 `ai.generate`、全局设置、登录、代理、并发和取消机制，传入 `image: true` 与可选 `references: string[]`（最多 8 张 PNG data URL，每张最多 6 MB）。默认 Codex 调用内置图像工具，响应新增 `images` 数组，值为 `workstore-image:<sha256>`。文本请求保持原行为；OpenAI-compatible 文本适配器不假定支持图像接口。

CLI 当前不会把图片作为专用 JSON 事件输出。网关只接受 `thread.started` 的 UUID，在该任务自己的 `generated_images/<UUID>` 目录读取普通 PNG 文件，不读取回答里任意路径。图片存入工作区 `data/ai-images/<sha256>.png`，通过 `ai_read_image` 读取，随工作区同步。历史版本仅保留图片 ID，不重复复制图像。取消/超时由现有 kill-on-drop 机制终止 CLI；已经完成并保存的漫画页不会丢失。

真实服务验证（会调用本机默认登录）：
`cargo test --manifest-path src-tauri/Cargo.toml local_codex_image_smoke -- --ignored --nocapture`
