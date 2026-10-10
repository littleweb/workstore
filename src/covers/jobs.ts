import { useSyncExternalStore } from "react";
import { ai, trackAiExecution } from "../ai/client";
import { beginTask, updateTask } from "../tasks/store";
import * as store from "./store";
import { readContent, selectedVersion, stylePolicy, generationPrompt } from "./model";
import { copyPrompt, fillCopy } from "./copy";
import { recommendationPrompt, parseRecommendation } from "./recommendation";
import { pngReference } from "./images";

type CoverJob = { controller: AbortController; running: boolean; stage: string; error?: string };
const jobs = new Map<string, CoverJob>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export const coverJob = (id: string | null) => id ? jobs.get(id) : undefined;
export function useCoverJob(id: string | null) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => coverJob(id));
}
export function cancelCoverJob(id: string | null) {
  const job = coverJob(id);
  if (!job?.running) return;
  job.controller.abort();
  jobs.set(id!, { ...job, running: false, stage: "已取消" });
  emit();
}
/** A submitted pipeline belongs to its document, never to the current editor. */
export function startCoverJob(id: string) {
  if (coverJob(id)?.running) return;
  const doc = store.currentDocument(id);
  if (!doc) throw Error("封面不存在");
  const controller = new AbortController();
  let snapshot = doc.content, captured = readContent(snapshot);
  const remote = store.remoteVersion(id);
  const job: CoverJob = { controller, running: true, stage: "正在准备画风与参考图片…" };
  jobs.set(id, job);
  const card = beginTask(controller, { toolId: "app.cover", title: doc.title, stage: job.stage });
  emit();
  const valid = () => !controller.signal.aborted && coverJob(id)?.controller === controller;
  const unchanged = () => store.currentDocument(id)?.content === snapshot && store.remoteVersion(id) === remote;
  const check = () => { if (!unchanged()) throw Error("生成期间封面已修改或同步，结果未覆盖当前编辑，请重试"); };
  const stage = (value: string) => {
    if (!valid()) return;
    jobs.set(id, { controller, running: true, stage: value });
    updateTask(controller.signal, { stage: value }); emit();
  };
  const save = async () => {
    check();
    snapshot = JSON.stringify(captured);
    store.stageDocument(id, { content: snapshot });
    await store.flushDocument(id);
    check();
  };
  return trackAiExecution(controller, (async () => {
    let failure: unknown;
    try {
      await store.flushDocument(id);
      if (!valid()) return;
      const caps = await ai.capabilities();
      if (!valid()) return;
      if (!caps.imageGenerate) throw Error("当前 AI 服务不支持图片生成，请在设置中选择 Codex");
      if (captured.needsRecommendation) {
        stage("正在匹配风格、版式与配色…");
        const result = await ai.generate({ toolId: "app.cover", record: false,
          messages: [{ role: "user", content: recommendationPrompt(captured.config.topic) }],
        }, controller.signal);
        if (!valid()) return;
        check();
        if (result.saveError) throw Error(result.saveError);
        captured = { ...captured, config: parseRecommendation(result.text, captured.config.topic), needsRecommendation: false };
        await save();
        if (!valid()) return;
      }
      if (!captured.config.title.trim() || !captured.config.subtitle.trim()) {
        stage("正在拟写主标题与副文案…");
        const copy = await ai.generate({ toolId: "app.cover", record: false,
          messages: [{ role: "user", content: copyPrompt(captured.config) }],
        }, controller.signal);
        if (!valid()) return;
        check();
        if (copy.saveError) throw Error(copy.saveError);
        captured = { ...captured, config: fillCopy(copy.text, captured.config) };
        await save();
        if (!valid()) return;
      }
      const policy = stylePolicy(captured.config.style), current = selectedVersion(captured);
      const withCurrent = !!current && captured.config.preserve;
      if ((policy.reference || withCurrent) && !caps.referenceImages) throw Error("当前 AI 服务不支持参考图");
      const references: string[] = [];
      if (policy.reference) references.push(await pngReference(policy.style.image));
      if (withCurrent) references.push(await pngReference(current.image));
      if (!valid()) return;
      check();
      if (references.length > caps.maxReferences) throw Error("参考图片数量超过当前服务限制");
      const prompt = generationPrompt(captured.config, withCurrent);
      stage("正在生成封面…");
      const result = await ai.generate({ toolId: "app.cover", image: true, record: false, references,
        messages: [{ role: "user", content: prompt }],
      }, controller.signal);
      if (!valid()) return;
      check();
      if (result.saveError) throw Error("图片保存失败：" + result.saveError);
      const image = result.images?.[0];
      if (!image || !/^workstore-image:[0-9a-f]{64}$/.test(image)) throw Error("AI 未返回已保存的图片，请重试");
      const next = { id: crypto.randomUUID(), image, createdAt: Date.now(), config: captured.config, prompt };
      captured = { ...captured, versions: [...captured.versions, next], selectedVersion: next.id };
      stage("正在保存封面…");
      await save();
      if (valid() && doc.title === "未命名封面" && store.currentDocument(id)?.title === doc.title) {
        store.stageDocument(id, { title: captured.config.title.trim() || captured.config.topic.trim().slice(0, 40) || "未命名封面" });
        await store.flushDocument(id);
      }
    } catch (error) { failure = error; }
    finally {
      card.finish(failure);
      if (coverJob(id)?.controller === controller) {
        jobs.set(id, { controller, running: false, stage: controller.signal.aborted ? "已取消" : failure ? "生成失败" : "封面已生成",
          error: !controller.signal.aborted && failure ? String(failure) : undefined });
        // Keep recent errors available when returning to a document; never evict running work.
        let finished = 0;
        for (const [key, value] of [...jobs].reverse()) if (!value.running && ++finished > 100) jobs.delete(key);
        emit();
      }
    }
  })());
}
