# 多设备开发与交接

## 新设备

安装 Git、Node.js 22+、Rust stable 和当前平台 Tauri 2 系统依赖。使用自己的 GitHub 身份认证，不复制他人的 Token。克隆仓库后运行 `npm ci` 和 `npm run html:install`，读取根目录 `AGENTS.md` 和 `docs/context/CURRENT.md`，再启动 `npm run desktop`。

本机 Codex 或 API 凭据需单独配置；源码开发不需要发布签名私钥。用户工作内容由应用自身的数据同步机制管理，与这里的 Git 流程独立。

## 每次开始

```bash
git status
git switch main
git pull --ff-only
git switch -c fix/describe-the-change
```

如果有未提交修改，先提交到原分支或明确保存，不能覆盖它们。接续另一台设备的分支时使用 `git fetch origin` 和 `git switch --track origin/分支名`；本地已有该分支则切换后 `git pull --ff-only`。

## 每次结束

1. 完成相关测试和桌面重构建。
2. 更新 `docs/context/CURRENT.md` 的当前结果、未完成问题、验证和下一步。长期约束写入架构文档。
3. `git diff` 检查代码和上下文，确认没有真实数据、密钥或机器路径。
4. `git add` 明确选择文件，commit 后 `git push -u origin 当前分支`。
5. 通过 PR 合并到 main。另一台设备 pull 后继续。

不要在两台电脑同时往同一分支直接写入；若发生分叉，先 fetch，显式 merge/rebase 并解决冲突，再测试，不能 force push 覆盖另一台设备的工作。

## 共享记忆的边界

仓库中的文档就是可审阅、可版本化的共享记忆。只记录项目事实、决定、待办和验证结果，不放完整私人对话。AI 助手开始时读取这些文档，结束时更新它们。没有读取仓库文档的客户端不会凭空获得上下文。

交接至少包括：目标与当前进度、变更文件、测试/构建结果、已知限制、下一步。Git 提交是代码事实来源；不要在 CURRENT 中填写会在提交后失效的“当前提交 SHA”。

## 交互问题经验与验收

修改文档列表、编辑器焦点、输入法或相关事件处理前，阅读[文档首击经验](lessons/document-first-click.md)，运行其中列出的回归；尤其不能只测试 `button.click()`，遗漏原生仅有按下、没有后续 click 的路径。

将“观察到的事件”“应用层处理方案”“底层原因推测”“实际验收结果”分开记录。测试和打包成功不等于原生交互已恢复；用户或获授权的目标平台实测确认后，才在 CURRENT 中将问题标为解决。诊断自身应有独立自检与读取反馈，不用无变化的面板反推用户未操作。

## 验证和发布

```bash
node --test tests/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run tauri -- build --debug
```

忽略的测试可能访问 GitHub 或调用模型，需显式运行。发布遵循 `docs/自动更新.md`，增加 package.json、package-lock.json、Cargo.toml、Cargo.lock 和 tauri.conf.json 的版本。已有发布标签不可重写。当前 0.1.1–0.1.4 发布在源码首次导入之前，历史标签没有对应的完整源码快照；以后版本必须从已提交、通过检查的源码提交创建标签。

签名私钥通过设备安全存储或 CI Secrets 单独传递，不放 Git。普通 CI 只验证构建与测试，不自动发布安装包。

## 同步历史维护

新版本启动和正常同步会自动整理可唯一归属的旧冲突副本。仅在应用正常退出后，需要立即离线整理时，可运行构建后的 `workstore --maintain-sync-history <workspace>`。该命令验证数据并取得同一个工作区锁；锁被占用时失败退出，不终止应用、不联网。

整理保持主文档不变，副本原字节写入用户工作区 `.workstore-history/sync/` 的内容哈希 JSON 中，字段 `sourcePath`、`primaryPath`、`contentBase64` 记录来源和完整内容。恢复时先将 Base64 解码至独立导出位置，核对内容后再导入，不能直接覆盖正在编辑的主文档。历史不是加密存储；它属于用户内容，不能复制进本源码仓库或日志。

本地整理不会声称远端已更新；后续正常同步才通过 Git 传播历史和副本移除。其他设备应更新客户端，旧客户端仍可能生成新副本。
