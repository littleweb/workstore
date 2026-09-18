// Produce append-only public packages. No network writes or credentials.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import Ajv from "ajv";
const root = resolve(import.meta.dirname, "../..");
const input = resolve(
  process.argv[2] ?? `${root}/public/comics/templates.json`
);
const templates = JSON.parse(readFileSync(input, "utf8"));
const check = new Ajv({ allErrors: true }).compile(
  JSON.parse(readFileSync(`${root}/schemas/comic-template.schema.json`, "utf8"))
);
const path = `${root}/content/comics/catalog.json`;
const manifest = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { schemaVersion: 1, templates: [] };
for (const original of Array.isArray(templates) ? templates : [templates]) {
  if (!check(original)) throw new Error(JSON.stringify(check.errors));
  if (
    original.example.length !== original.defaultPages ||
    original.beats.length !== original.defaultPages
  )
    throw new Error("分镜张数不匹配");
  const ids = new Set(original.entities.map((e) => e.id));
  if (
    ids.size !== original.entities.length ||
    original.example.some((p) => p.entityIds.some((id) => !ids.has(id)))
  )
    throw new Error("资产编号无效");
  const t = structuredClone(original);
  const assets = {};
  const embed = (p) => {
    if (!p) return;
    let data;
    if (p.src.startsWith("/comics/"))
      data =
        "data:image/png;base64," +
        readFileSync(`${root}/public${p.src}`).toString("base64");
    else if (p.src.startsWith("data:image/png;base64,")) data = p.src;
    else throw new Error("公开包不能引用私人工作区图片");
    const hash = createHash("sha256")
      .update(Buffer.from(data.split(",")[1], "base64"))
      .digest("hex");
    assets[hash] = data;
    p.src = "template-asset:" + hash;
  };
  embed(t.cover);
  t.example.forEach((p) => embed(p.image));
  t.entities.forEach((e) => embed(e.reference));
  const bytes = Buffer.from(
    JSON.stringify({ schemaVersion: 1, template: t, assets })
  );
  if (bytes.length > 32_000_000) throw new Error("模板包超过 32 MB");
  const packagePath = `content/comics/templates/${t.templateId}/${t.revision}.json`;
  const target = `${root}/${packagePath}`;
  mkdirSync(dirname(target), { recursive: true });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    existsSync(target) &&
    createHash("sha256").update(readFileSync(target)).digest("hex") !== sha256
  )
    throw new Error(`已发布版本不可改写，请递增 revision：${t.templateId}`);
  const old = manifest.templates.find((e) => e.templateId === t.templateId);
  if (old && old.revision > t.revision) throw new Error("不允许降低模板版本");
  writeFileSync(target, bytes);
  const entry = {
    templateId: t.templateId,
    revision: t.revision,
    path: packagePath,
    sha256,
  };
  const index = manifest.templates.findIndex(
    (e) => e.templateId === t.templateId
  );
  if (index < 0) manifest.templates.push(entry);
  else manifest.templates[index] = entry;
}
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log(`已打包 ${manifest.templates.length} 个模板；未向公共仓库上传。`);
