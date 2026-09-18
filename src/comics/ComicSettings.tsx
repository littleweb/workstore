import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, Switch, Tag } from "antd";
import { EditOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import type { Entity, Page, Settings } from "./types";
import Picture from "./Picture";
const kinds = { character: "角色", scene: "场景", prop: "道具" };
export default function ComicSettings({
  value,
  pages,
  onChange,
  onSave,
  onCancel,
  onEditStory,
  preparing = false,
  activeAssetId,
  onContinue,
  canContinue = false,
}: {
  preparing?: boolean;
  activeAssetId?: string;
  onContinue: () => void;
  canContinue?: boolean;
  value: Settings;
  pages: Page[];
  onChange: (s: Settings) => void;
  onSave: () => void;
  onCancel: () => void;
  onEditStory: () => void;
}) {
  const [editing, setEditing] = useState<Entity>();
  const [preview, setPreview] = useState<Entity>();
  useEffect(() => {
    if (
      activeAssetId &&
      value.entities.some(
        (e) => e.id === activeAssetId && e.kind === "character"
      )
    )
      setCharacterId(activeAssetId);
  }, [activeAssetId]);
  const [characterId, setCharacterId] = useState<string>();
  const characters = value.entities.filter((e) => e.kind === "character");
  const character =
    characters.find((e) => e.id === characterId) ?? characters[0];
  const add = (kind: Entity["kind"]) =>
    setEditing({
      id: crypto.randomUUID(),
      kind,
      name: `新${kinds[kind]}`,
      description: "",
      locked: true,
    });
  const visual =
    value.entities.find((e) => e.kind === "character")?.reference ??
    pages.find((p) => p.image)?.image;
  const styles = ["暖色手绘", "清新水彩", "黑白线稿"];
  const assetCard = (e: Entity) => (
    <article className={`comic-asset-card ${e.kind}`} key={e.id}>
      <button
        className="comic-asset-preview"
        disabled={!e.reference}
        aria-label={`放大预览${e.name}`}
        onClick={() => setPreview(e)}
      >
        <Picture value={e.reference} alt={e.name} fit="contain" />
        {!e.reference && (
          <span className="comic-asset-stage">
            {activeAssetId === e.id ? "正在生成…" : "等待生成"}
          </span>
        )}
        {e.reference && <span className="comic-asset-zoom">放大预览</span>}
      </button>
      <div className="comic-asset-info">
        <h3>
          {e.name} <Tag>{kinds[e.kind]}</Tag>
        </h3>
        <p>{e.description}</p>
        <div className="comic-asset-actions">
          <Tag icon={<LockOutlined />}>
            {e.locked ? "外观已锁定" : "允许调整"}
          </Tag>
          <Button
            size="small"
            icon={<EditOutlined />}
            disabled={preparing}
            onClick={() => setEditing(structuredClone(e))}
          >
            编辑设定
          </Button>
        </div>
        {e.kind === "character" && (
          <small>角色参考图 · 绘制时保持外貌与服装一致</small>
        )}
      </div>
    </article>
  );
  return (
    <div className="comic-settings">
      <h2>制作故事</h2>
      <p>
        {preparing
          ? "正在制作故事与专属资产，完成后将自动开始绘制漫画。"
          : "先确定故事与角色，让每一张漫画保持连贯。"}
      </p>
      <div className="comic-settings-grid">
        <div className="comic-settings-column">
          <section>
            <h3>故事与画风</h3>
            <label>
              故事主题
              <Input.TextArea
                disabled={preparing}
                aria-label="故事主题设定"
                autoSize={{ minRows: 1, maxRows: 3 }}
                value={value.theme}
                onChange={(e) => onChange({ ...value, theme: e.target.value })}
              />
            </label>
            <div className="comic-setting-fields">
              <label>
                故事语气
                <Select
                  disabled={preparing}
                  value={value.tone}
                  onChange={(tone) => onChange({ ...value, tone })}
                  options={[
                    "跟随模板",
                    "日常反转",
                    "轻松搞笑",
                    "温暖治愈",
                    "简洁科普",
                  ].map((value) => ({ value, label: value }))}
                />
              </label>
              <label>
                作品张数
                <Select
                  disabled={preparing}
                  aria-label="设定张数"
                  value={value.count}
                  options={[4, 6, 8].map((value) => ({
                    value,
                    label: `${value} 张`,
                  }))}
                  onChange={(count) => onChange({ ...value, count })}
                />
              </label>
              <label>
                画面比例
                <Select
                  disabled={preparing}
                  aria-label="设定比例"
                  value={value.ratio}
                  options={["3:4", "9:16", "1:1", "4:3"].map((value) => ({
                    value,
                    label: value,
                  }))}
                  onChange={(ratio) => onChange({ ...value, ratio })}
                />
              </label>
            </div>
            <label>画风</label>
            <div className="comic-style-options">
              {styles.map((style, i) => (
                <button
                  key={style}
                  className={value.style === style ? "selected" : ""}
                  disabled={preparing}
                  onClick={() => onChange({ ...value, style })}
                >
                  <Picture
                    value={visual}
                    className={`style-${i}`}
                    alt={`${style}参考`}
                  />
                  <span>{style}</span>
                </button>
              ))}
            </div>
            <Input
              disabled={preparing}
              aria-label="画风设定"
              className="comic-custom-style"
              value={value.style}
              onChange={(e) => onChange({ ...value, style: e.target.value })}
              placeholder="补充你想要的画风"
            />
            <small className="comic-muted">
              缩略图仅示意色调，保存后重新绘制以应用画风。
            </small>
          </section>
          <section>
            <div className="comic-section-heading">
              <h3>故事走向</h3>
              <Button
                size="small"
                icon={<EditOutlined />}
                disabled={preparing}
                onClick={onEditStory}
              >
                修改故事
              </Button>
            </div>
            <ol className="comic-story-timeline">
              {pages.map((p, i) => (
                <li key={p.id}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{p.title}</strong>
                    <p>{p.action}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div className="comic-settings-column">
          <section>
            <div className="comic-section-heading">
              <h3>角色设定</h3>
              <Button
                size="small"
                icon={<PlusOutlined />}
                disabled={preparing}
                onClick={() => add("character")}
              >
                添加角色
              </Button>
            </div>
            {characters.length > 1 && (
              <div className="comic-character-tabs">
                {characters.map((e) => (
                  <Button
                    key={e.id}
                    size="small"
                    type={character?.id === e.id ? "primary" : "default"}
                    onClick={() => setCharacterId(e.id)}
                  >
                    {e.name}
                  </Button>
                ))}
              </div>
            )}
            {character && assetCard(character)}
            {!value.entities.some((e) => e.kind === "character") && (
              <p className="comic-muted">
                生成故事后，会根据你的主题设计专属角色。
              </p>
            )}
          </section>
          <section>
            <div className="comic-section-heading">
              <h3>场景与道具</h3>
              <Button
                size="small"
                icon={<PlusOutlined />}
                disabled={preparing}
                onClick={() => add("scene")}
              >
                添加资产
              </Button>
            </div>
            <div className="comic-scene-grid">
              {value.entities.filter((e) => e.kind === "scene").map(assetCard)}
            </div>
            <div className="comic-prop-grid">
              {value.entities.filter((e) => e.kind === "prop").map(assetCard)}
            </div>
            {!value.entities.some((e) => e.kind !== "character") && (
              <p className="comic-muted">场景与道具会随故事一起生成。</p>
            )}
          </section>
        </div>
      </div>
      <footer>
        {canContinue && (
          <Button type="primary" onClick={onContinue}>
            继续制作漫画
          </Button>
        )}
        <small>修改设定后，可在漫画编辑中重新绘制相关画面。</small>
        <Button disabled={preparing} onClick={onCancel}>
          取消
        </Button>
        <Button disabled={preparing} type="primary" onClick={onSave}>
          保存设定
        </Button>
      </footer>
      <Modal
        title={preview?.name}
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        footer={null}
        width={800}
      >
        {preview && (
          <div className="comic-asset-lightbox">
            <Picture
              value={preview.reference}
              alt={preview.name}
              fit="contain"
            />
            <p>{preview.description}</p>
          </div>
        )}
      </Modal>
      <Modal
        title={`编辑${editing ? kinds[editing.kind] : "资产"}设定`}
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        okText="应用设定"
        onOk={() => {
          if (!editing?.name.trim() || !editing.description.trim()) return;
          const old = value.entities.find((e) => e.id === editing.id);
          const updated = {
            ...editing,
            reference:
              old &&
              (old.description !== editing.description ||
                old.kind !== editing.kind)
                ? undefined
                : editing.reference,
          };
          onChange({
            ...value,
            entities: old
              ? value.entities.map((e) => (e.id === updated.id ? updated : e))
              : [...value.entities, updated],
          });
          setEditing(undefined);
        }}
        okButtonProps={{
          disabled: !editing?.name.trim() || !editing?.description.trim(),
        }}
      >
        {editing && (
          <div className="comic-asset-form">
            <Select
              disabled={preparing}
              aria-label="资产类型"
              value={editing.kind}
              onChange={(kind) => setEditing({ ...editing, kind })}
              options={Object.entries(kinds).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Input
              disabled={preparing}
              aria-label="资产名称"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input.TextArea
              disabled={preparing}
              aria-label="资产描述"
              rows={4}
              value={editing.description}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
            <div>
              <Switch
                checked={editing.locked}
                onChange={(locked) => setEditing({ ...editing, locked })}
              />{" "}
              保持外观一致
            </div>
            <p className="comic-muted">
              修改视觉描述后，下一次绘制会重新生成该资产参考图。
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
