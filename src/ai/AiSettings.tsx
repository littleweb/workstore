import { useEffect, useState } from "react";
import { Alert, Button, Input, InputNumber, Select, Space } from "antd";
import { ai, type AiSettings as Settings } from "./client";
import { native } from "../workspace";
export default function AiSettings() {
  const [value, setValue] = useState<Settings>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (native) void ai.settings().then(setValue).catch(e => setError(String(e))); }, []);
  const change = (patch: Partial<Settings>) => { setValue(v => v && { ...v, ...patch }); setSaved(false); };
  return <div className="settings-content ai-settings">
    <p>各应用共用以下 AI 服务。本地 Codex 使用本机登录状态，推理仍需联网。</p>
    {!native && <Alert type="info" title="请在桌面版配置和使用 AI" />}
    {error && <Alert type="error" title={error} />}
    {value && <>
      <label>默认服务<Select value={value.provider} onChange={provider => change({ provider, model: "" })} options={[{ value: "codex", label: "本地 Codex（默认）" }, { value: "openai-compatible", label: "OpenAI 兼容 API" }]} /></label>
      {value.provider === "codex" ? <>
        <label>Codex 可执行文件<Input value={value.codexPath} placeholder="留空自动查找；也可填写绝对路径" onChange={e => change({ codexPath: e.target.value })} /></label>
        <p>应用启动时会自动检测本机 Codex、读取登录状态并保存配置，无需手动操作。若本机尚未安装或登录，首次使用时会提示。</p>
      </> : <>
        <label>API 地址<Input value={value.baseUrl} placeholder="https://api.openai.com/v1" onChange={e => change({ baseUrl: e.target.value })} /></label>
        <label>API Key<Input.Password autoComplete="new-password" value={value.apiKey ?? ""} placeholder={value.hasApiKey ? "已保存，留空不修改" : "输入 API Key"} onChange={e => change({ apiKey: e.target.value || undefined })} /></label>
        {value.hasApiKey && <Button size="small" onClick={() => change({ apiKey: "", hasApiKey: false })}>清除已保存的密钥</Button>}
        <p>支持 Chat Completions 协议；本地模型服务可使用 HTTP 本机地址。</p>
      </>}
      <label>模型<Input value={value.model} placeholder={value.provider === "codex" ? "留空使用 Codex 默认模型" : "填写服务商提供的模型名称"} onChange={e => change({ model: e.target.value })} /></label>
      <label>网络代理<Input value={value.proxyUrl} placeholder="留空自动读取系统代理，例如 http://127.0.0.1:7897" onChange={e => change({ proxyUrl: e.target.value })} /></label>
      <p>macOS 自动读取系统 HTTPS 代理；其他系统使用代理环境变量。输入 direct 可直接连接。</p>
      <label>响应超时（秒）<InputNumber min={10} max={600} value={value.timeoutSeconds} onChange={v => change({ timeoutSeconds: v ?? 180 })} /></label>
      <p>服务配置和密钥仅保存在当前设备；AI 回答记录存入工作目录，随 GitHub 数据同步。</p>
      <Space><Button type="primary" loading={busy} onClick={async () => { setBusy(true); setError(""); try { setValue(await ai.saveSettings(value)); setSaved(true); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>保存 AI 设置</Button>{saved && <span>已保存</span>}</Space>
    </>}
  </div>;
}
