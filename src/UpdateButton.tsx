import { useEffect, useSyncExternalStore } from "react";
import { Tooltip } from "antd";
import { CloudDownloadOutlined, SyncOutlined } from "@ant-design/icons";
import { checkUpdates, installUpdate, subscribeUpdates, updateState } from "./updateService";
export default function UpdateButton({ ready }: { ready: boolean }) {
  const state = useSyncExternalStore(subscribeUpdates, updateState);
  useEffect(() => {
    if (!ready) return;
    const startup = setTimeout(() => void checkUpdates(), 10_000);
    const interval = setInterval(() => void checkUpdates(), 6 * 60 * 60 * 1000);
    return () => { clearTimeout(startup); clearInterval(interval); };
  }, [ready]);
  const busy = ["checking", "downloading", "installing"].includes(state.phase);
  return <Tooltip title={state.message}>
    <button className={`icon-button update-toggle ${state.phase}`} aria-label={state.message}
      disabled={!ready || busy} onClick={() => void installUpdate()}>
      {busy ? <SyncOutlined spin /> : <CloudDownloadOutlined />}
      {state.phase === "available" && <span className="update-dot" />}
      {state.phase === "error" && <span className="update-dot error" />}
      {state.phase === "downloading" && state.progress !== undefined && <span className="update-percent">{state.progress}%</span>}
    </button>
  </Tooltip>;
}
