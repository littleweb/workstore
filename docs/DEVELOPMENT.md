# 多设备开发与交接

## 新设备

安装 Git、Node.js 22+、Rust stable 和当前平台 Tauri 2 系统依赖。使用自己的 GitHub 身份认证，不复制他人的 Token。克隆仓库后运行 `npm ci`，读取根目录 `AGENTS.md` 和 `docs/context/CURRENT.md`，再启动 `npm run desktop`。

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

## 验证和发布

```bash
node --test tests/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run tauri -- build --debug
```

忽略的测试可能访问 GitHub 或调用模型，需显式运行。发布遵循 `docs/自动更新.md`，增加 package.json、package-lock.json、Cargo.toml、Cargo.lock 和 tauri.conf.json 的版本。已有发布标签不可重写。当前 0.1.1–0.1.4 发布在源码首次导入之前，历史标签没有对应的完整源码快照；以后版本必须从已提交、通过检查的源码提交创建标签。

签名私钥通过设备安全存储或 CI Secrets 单独传递，不放 Git。普通 CI 只验证构建与测试，不自动发布安装包。
