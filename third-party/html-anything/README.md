# HTML Anything attribution and integration

Source: https://github.com/nexu-io/html-anything

Pinned revision: `553ed98c283f9c0f489902d035416a972d6a9699`.

Apache-2.0; original authors retain their copyright. `vendor/html-anything/` contains the original Next app, CLI, tests, package metadata and documentation. Every imported file is recorded in `upstream-manifest.json`; a regression test verifies it remains byte-identical.

## Original-app integration

At the user's request, WorkStore embeds the original application before redesigning it. The upstream UI, template examples, prompts, CLI adapters, streaming responses, storage semantics, preview scripts, parsers, version history, marketplace, deploy settings and exports are not rewritten. The previous simplified implementation remains in `src/html/LegacyHtmlApp.tsx` for reference; its saved files are untouched.

`scripts/html-anything/build.mjs` copies sources into an ignored staging directory, enables Next standalone output, and adds the invisible `WorkStoreBridge` to the staged layout. The bridge integrates host save/stop and native file downloads without changing the upstream editor or generated artifacts. The packaging step makes traced symlinks relative, adds original template source assets, and bundles the build machine's Node executable (license in `NODE-LICENSE`). macOS builds thin the Node executable to the target architecture and ad-hoc sign it.

`preload.cjs` restricts the bundled server to the selected loopback host, rejects cross-origin API calls, authenticates host lifecycle endpoints, and tracks owned agent processes for app shutdown. It does not replace original generation arguments, prompts or export code. There is no required separately installed Node or user-managed server for the desktop package.

Development:

```sh
npm run html:install
npm run html:build
npm run html:start # browser preview only; desktop starts its own instance
npm run dev -- --port 1420
```

Native use retains a stable local origin so original browser data survives restarts. Browser-state/history snapshots and provider/skill configuration are private device files under the WorkStore application-config HTML directory. They are not added to source control or silently converted to WorkStore's earlier HTML file format. Unifying AI and workspace sync is deliberately deferred until the original application has been reviewed.

## Earlier static implementation

`src/html/templates.json` is the earlier extracted catalog. It is no longer the active HTML tool. Its Apache attribution remains here, and its old data/storage tests are retained so existing files are not discarded during the later migration.

打包依赖使用 `app.tar` 完整保留隐藏目录与相对符号链接，首次运行解包至按构建标识隔离的设备缓存。
