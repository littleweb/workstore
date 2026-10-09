# 多设备开发与交接

## 新设备

安装 Git、Node.js 22+、Rust stable 和当前平台 Tauri 2 系统依赖。使用自己的 GitHub 身份认证，不复制他人的 Token。克隆仓库后运行 `npm ci`、`npm run html:install` 和 `npm ci --prefix vendor/course-animation-runtime --omit=dev`，读取根目录 `AGENTS.md` 和 `docs/context/CURRENT.md`，再启动 `npm run desktop`。

本机 Codex 或 API 凭据需单独配置；源码开发不需要发布签名私钥。用户工作内容由应用自身的数据同步机制管理，与这里的 Git 流程独立。

## 每次开始

当前发布开发线为 `main`，代码和共享上下文统一提交到该分支；首次克隆后先 `git fetch origin` 并切换 `main`。

```bash
git status
git switch main
git pull --ff-only
git switch -c codex/describe-the-change
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


### 动画教程运行组件

做课程的动画教程采用 Remotion 4.0.534；官方技能原文件及固定提交记录在 `vendor/remotion-skills/UPSTREAM.json`。开发前安装上述精简渲染依赖；`predev/prebuild` 会打包固定教程 composition、renderer 和官方 Chrome Headless Shell，首次构建需要联网下载浏览器。桌面使用随应用分发的 Node 和渲染组件，用户仅提交主题与结构化分镜，不执行模型生成的任意代码。

动画教程使用本地Kokoro中文神经TTS的固定zf_007柔和女声，经统一ai_speech模块复用打包Python环境。scripts/ai/install-speech.mjs按vendor/course-tts/UPSTREAM.json校验模型/音色/词表，speech-requirements.txt锁定依赖；构建时获取，运行时无需网络或单独装依赖。只有macOS ARM64已验证，其他平台未验证。字幕按句长与语音时长分配时间，并非逐字强制对齐。内置参考位于 `public/course/animations`，更新参考可运行 `scripts/course-animation/examples.mjs`；它会实际生成十个 MP4，耗时且占用 CPU，不作为常规测试。已有参考换声运行scripts/course-animation/refresh-voices.mjs，旧资源保存在忽略的.course-tts-build/prior-references；该流程按新的配音/字幕时序重新渲染。媒体审计结果在 `docs/course-animation-reference-videos.json`。常规验证：`node --test tests/course-animation*.test.mjs`；完整 Rust 测试保持单线程。


### 白板沙画运行组件

`predev/prebuild` 自动执行 `scripts/course-whiteboard/build-runtime.mjs`，需要时由install-runtime.mjs下载固定的python-build-standalone 3.12.15（20261003发行版）并核验官方SHA-256，再安装固定版本opencv-python-headless、numpy、av、Pillow。组件、依赖和字体随桌面包分发，设备运行时无需额外安装。独立缓存目录.course-whiteboard-build及src-tauri/whiteboard-runtime不入Git。

原技能及MIT许可在vendor/srt-whiteboard-animation，上游文件不得改写；开发核查执行原prepare_env.py --check，缺失时建立技能自己的隔离.venv。产品运行使用独立打包解释器隔离依赖。Noto中文字体及许可在vendor/course-whiteboard-font；手部素材的去字版本位于src/course-whiteboard/assets。

参考的原创教学内容与构图在scripts/course-whiteboard/reference-content.json；实际imagegen原始/修正提示词记录于docs/course-whiteboard-image-prompts.json。检查源图后生成.reviewed标记，examples.mjs以实际像素边界建立标注并渲染十条真实教程；此任务消耗CPU与时间，不作为常规测试。原图、标注、SRT、旁白及成片在public/course/whiteboard。成片核验：python3 scripts/course-whiteboard/audit-examples.py（检查十条视频、音轨、帧数、SRT并生成联系表）。常规回归：node --test tests/course-whiteboard*.test.mjs tests/course-ui.test.mjs；完整Rust回归保持--test-threads=1。

课程内置视频换声时运行scripts/course-animation/refresh-voices.mjs与scripts/course-whiteboard/refresh-voices.mjs；先构建共享运行环境，两者只替换内置参考，旧字节备份于忽略目录。每类十条完成后分别运行audit-examples.py，校验音色版本、无首尾标点字幕、SRT、时长/帧数/音轨和首中末画面，再构建最终桌面包。

仅调整动画字幕排版时，可在构建渲染运行环境后运行scripts/course-animation/refresh-captions.mjs，复用已验证WAV与字幕时间并重新渲染十条参考，不重复合成或调用AI。

## 发布封面预览素材

`npm run covers:publish`使用开发者已有的GitHub CLI授权，将`public/handraw-style/covers`的277张公开PNG及清单发布到`littleweb/workstore`的`assets/covers`分支，生成`src/covers/remote-previews.json`。相同清单复用已发布提交，内容改变时非force追加素材提交；引用已有Git blob避免重复上传，新增图片才上传。执行前应确认图片属于公开内置素材，不能放用户作品或私有图片。

`npm run desktop:release:build`自动执行素材发布和远端树/大小/对象校验，再构建去掉大预览的正式包。无需新建服务，也无需客户端登录。开发者发布需要GitHub写权限；客户端通过公共raw下载，失败回退官方匿名API并接受其频率限制。索引与相关代码一起维护在main，素材分支用于读取与发布，不能用force覆盖。原始PNG暂留源码用于校验、测试和再次发布；原生缓存放应用cache目录，不参与用户工作区Git同步。

更新过PNG后，先发布素材再构建（普通production构建也校验本地PNG与索引一致）；已有安装包引用固定素材提交，所以后续素材分支更新不会改变旧包的预览。发布脚本本身只推素材，不创建软件Release或改写已有安装附件。
