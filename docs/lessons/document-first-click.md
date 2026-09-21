# 经验：文档列表必须点两次才切换

**状态：2026-09-20 用户确认“解决了”。** 适用范围为本次 macOS / Tauri WebView 中的文档列表；不能据此宣称其他平台或所有按钮都已验收。

## 1. 证据与结论

现象是第一次点击后，列表绿色高亮与右侧正文都不变化，第二次才切换。仅凭这个现象无法区分“没收到 click”和“停在保存/载入”。

最后取得的实际事件记录显示：

- 前一次 `click → 选择请求 → 保存 → 载入 → 提交选中状态 → 视图提交` 全部完成。
- 随后的一次列表操作只有 `pointerdown → mousedown → 正文失焦`，未记录对应 `mouseup/click`；按住标记直到下一次无按键的鼠标移动才解除。
- 此次失败发生在选择处理入口之前，并非目标文档加载失败。此前仅依赖 `onClick` 的列表会错过这次选择。

**已证实的是事件序列与有效的应用层修复；尚未独立证明 WebView 丢失后续事件的底层原因。** 不将推测写成“已确认的浏览器缺陷”。

## 2. 必须保留的修复边界

实现位置：[`DocumentApp.tsx`](../../src/documents/DocumentApp.tsx)。

- 文档名称及行空白区域：无修饰键的主鼠标左键，在捕获阶段 `pointerdown` 接受选择；非输入法组合期间阻止默认焦点转移，不再等待可能缺失的 click。
- 仍然先保存当前文档，再载入并激活目标。保存失败保持原文档；较早请求不得覆盖最新选择。
- 正常出现的尾随鼠标 click 去重，不能执行两次，也不能在保存失败后意外重试。不要合成或重放用户点击。
- 触控/笔输入继续使用 click，避免滚动时选中文档。保留图标拖拽、右/中键、修饰键行为，以及键盘/辅助技术 click。
- 输入法组合未结束时暂存最新选择，等 `compositionend` 后最终输入进入保存队列再切换。新组合开始或组件卸载时取消过期任务。

**这是列表选择语义的定向修复，不是所有按钮改成按下执行的通用方案。** 删除、提交、付款等按钮不得照搬；它们通常需要松开确认和取消操作的机会。

## 3. 这次排查中不能重犯的错误

| 误区 | 后续做法 |
| --- | --- |
| 多轮猜测修复后，凭测试/构建成功就称“已解决” | 先获取实际事件证据；用户或获授权的原生 UI 验收确认后才闭环。 |
| `button.click()` 或编辑器替身测试通过，等于原生首击正常 | 这些测试绕过命中、按下、失焦、松开和 WebView 行为；必须加“只有按下、不补 mouseup/click”的回归。真实编辑器 DOM 测试也不等于原生验收。 |
| 同时修好了窗口首击、同步保护、列表 disabled 或 flex 告警，就认为解释了同一个现象 | 分别记录每个问题的证据与验证范围；它们是真实风险，但此前并未解决用户最终反馈的路径。 |
| 空诊断面板说明用户没点或事件没进网页 | 先验证诊断通道本身；缺失 mouseup 可能让显示永远被按住标记压住，快捷键也可能未触发。 |
| 捕获监听中的 `queueMicrotask` 能判定冒泡是否被截断 | 原生事件可能在各监听器之间执行微任务。应在下一任务检查传播，关闭诊断时清理待检查任务。 |
| 持续要求用户换包、复述或录屏，却不验证诊断工具 | 自检、读取按钮响应、快照计数分开验证；一张包含这些状态的截图也能获得证据。 |

诊断工具当前位于 [`clickDiagnostics.ts`](../../src/documents/clickDiagnostics.ts) 与 [`DocumentClickDiagnostics.tsx`](../../src/documents/DocumentClickDiagnostics.tsx)。默认关闭，只在内存保留有界记录；不记录文档 ID、名称、内容、路径、键入文字或异常详情，不写日志/网络。读取按钮的事件不混入问题文档的证据，诊断不能重绘编辑器或改变选择。

## 4. 回归门槛

修改文档导航、焦点、输入法、保存队列或相关 CSS 时，至少检查：

| 场景 | 对应测试 |
| --- | --- |
| 只有 pointerdown、没有 mouseup/click 也能选择 | `document-navigation.test.mjs`：`observed down-only mouse sequence…` |
| 普通 click 不重复执行，失败不自动重试 | 同文件：`a normal mouse click following…`、`a failed pointerdown save…` |
| 保存中保留最新选择，晚返回请求不抢回页面 | 同文件的保存/载入竞态测试 |
| 触控/笔滚动、拖拽图标、键盘/辅助技术不退化 | 同文件的 touch/pen、drag、keyboard 测试 |
| 中文组合最终文字先保存，新组合/卸载取消旧任务 | 同文件的 IME composition 三组测试 |
| 缓存不覆盖新编辑，焦点父容器不回退为 flex | `document-store.test.mjs`、`document-focus.test.mjs` |
| 诊断自检、隐私、读取、传播判定可信 | `document-click-diagnostics.test.mjs` |

从仓库根目录运行：

```bash
node --test tests/document-navigation.test.mjs tests/document-store.test.mjs tests/document-focus.test.mjs tests/document-click-diagnostics.test.mjs
node --test tests/*.test.mjs
npm run desktop:build -- --ci --bundles app --verbose
```

涉及 Rust 时运行单线程回归；联网/模型测试仍需显式授权。最后在目标平台用实际编辑器，检查正文编辑后单击名称、快速切换、保存失败、中文输入法、触控/拖拽及键盘路径；未实测的项目明确标为未验证。

## 5. 本次验收记录

- 修复轮次：88 项 Node 测试、39 项 Rust 单线程测试通过，5 项外部联网/模型测试按约定忽略；macOS ARM64 `.app` / `.dmg` 构建及校验完成。
- 用户随后明确确认问题已解决。这是本次原生现象闭环的依据，不是推断自测试数量。
- 本经验已接入根 `AGENTS.md`、架构与开发说明；跨设备需要同步这些仓库文件，不依赖私人聊天记忆。
