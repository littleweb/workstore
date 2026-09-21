# APOS 本地界面演示

使用仓库已安装的 React 19、React DOM 19、Ant Design 6 与 Vite；不新增依赖。

```sh
# 在仓库根目录执行
npm run demo:apos
# 本地地址：http://127.0.0.1:4174

npm run demo:apos:build
npm run demo:apos:preview
# 生产构建预览：http://127.0.0.1:4175

node --test tests/apos-demo.test.mjs
```

- 独立入口和 Vite 配置，不进入 WorkStore 主应用、Tauri 页面或主应用构建。
- 保留顶部 APOS、三列作品卡、底部主题输入和风格/尺寸/集数；不包含分类标签、引用提示、附件加号或麦克风。
- 卡片打开 Ant Design Modal；可复用主题和参数、创建演示草稿。已有卡片点击不重排，新草稿加在最前。
- 下拉选项使用 Ant Design Select；输入使用 Input.TextArea；创建使用 Button，支持键盘与输入法的普通原生交互，不给按钮添加按下即执行逻辑。
- 封面由本地 HTML/CSS 绘制，示例数值为虚构，无外部图片或字体请求。
- 草稿只存在当前页面 React 内存，**刷新后清空**，不使用 localStorage、不读写用户文件、不请求模型。工作空间与权限是演示字段，不会变更实际目录或访问权限。
- 开发/预览服务器只监听本机回环地址，端口被占用时明确失败而不自动漂移。
- 构建目录 `demos/apos/dist/` 已被仓库现有 `dist/` 忽略规则覆盖。

生产接入本地文件存储、统一 AI 接口和主容器导航均不在本演示范围；确认视觉和交互后再单独实施。
