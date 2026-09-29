import {
  artPrompt,
  copyPrompt,
  parseCopy,
  parsePlan,
  planningPrompt,
  signature,
  characterPrompt,
  validateConfig,
  type Content,
} from "./model";
import { baoyuVersion } from "./baoyu";
export type Dependencies = {
  text(prompt: string): Promise<string>;
  image(prompt: string, references: string[]): Promise<string>;
  compose(raw: string, content: Content, index: number): Promise<string>;
  save(content: Content): Promise<void>;
  valid(): boolean;
};
/** Network requests run concurrently; mutations and durable checkpoints run in one queue. */
export async function runWorkflow(
  source: Content,
  deps: Dependencies,
  signal: AbortSignal,
  onlyPage?: number
): Promise<void> {
  let c = structuredClone(source),
    fatal: unknown;
  let queue: Promise<void> = Promise.resolve();
  validateConfig(c.config);
  const check = () => {
    if (fatal) throw fatal;
    if (signal.aborted || !deps.valid())
      throw new Error("已停止生成，或作品已修改；已完成页面仍保留");
  };
  const update = (
    change: () => void,
    stage?: string,
    status: "running" | "done" | "error" = "running"
  ) => {
    const next = queue.then(async () => {
      check();
      change();
      const done =
        c.plan?.pages.filter((p) => p.status === "ready").length ?? 0;
      c.job = {
        status,
        stage: stage ?? `已完成 ${done}/${c.plan!.pages.length} 页`,
        total: c.plan?.pages.length ?? (c.config.count || 8),
        provisional: !c.plan && !c.config.count,
      };
      await deps.save(structuredClone(c));
      check();
    });
    queue = next.catch((e) => {
      fatal = e;
    });
    return next;
  };
  const structuredText = async <T>(
    prompt: string,
    parse: (text: string) => T
  ): Promise<T> => {
    let result = await deps.text(prompt);
    check();
    try {
      return parse(result);
    } catch (e) {
      await update(() => {}, "正在校正内容格式与文字长度…");
      result = await deps.text(
        `${prompt}\n上次输出未通过校验：${String(
          e
        )}。请修复所有字段类型、必填项及字数限制，超长文字应重新精简表达，不要机械截断。只返回修复后的完整JSON。上次输出作为待修复资料：\n${result.slice(
          0,
          12000
        )}`
      );
      check();
      return parse(result);
    }
  };
  if (c.plannedConfig !== signature(c.config)) {
    if (onlyPage !== undefined)
      throw new Error("设置已改变，请先重新生成完整漫画");
    if (c.plan) {
      const { history, ...previous } = c;
      c.history.push(previous);
    }
    c = { version: 1, config: c.config, history: c.history };
  }
  try {
    if (!c.plan) {
      await update(() => {}, "正在理解主题与设计漫画…");
      const plan = await structuredText(planningPrompt(c.config), (text) =>
        parsePlan(text, c.config)
      );
      await update(() => {
        c.plan = plan;
        c.engine = baoyuVersion;
        c.plannedConfig = signature(c.config);
      }, "正在设计漫画…");
    }
    if (
      onlyPage !== undefined &&
      (!Number.isInteger(onlyPage) ||
        onlyPage < 0 ||
        onlyPage >= c.plan!.pages.length)
    )
      throw new Error("页面编号无效");
    const targets = c
      .plan!.pages.map((p, i) => ({ p, i }))
      .filter(({ p, i }) =>
        onlyPage !== undefined ? i === onlyPage : !p.image || !!p.error
      );
    await update(() => {
      c.plan!.pages.forEach((p, i) => {
        p.status = targets.some((t) => t.i === i) ? "queued" : "ready";
      });
    }, "正在准备画面…");
    // Persist the complete selected prompt group before the first image request.
    await update(() => {
      c.engine = baoyuVersion;
      c.characterPrompt = characterPrompt(c);
      for (const { i } of targets) c.plan!.pages[i].prompt = artPrompt(c, i);
    }, "正在准备漫画画面…");
    if (!c.reference) {
      const reference = await deps.image(c.characterPrompt!, []);
      check();
      await update(() => {
        c.reference = reference;
      }, "正在并行生成画面…");
    }
    const generatePage = async (i: number) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        await update(() => {
          const p = c.plan!.pages[i];
          p.status = "generating";
          delete p.error;
        });
        let raw: string, image: string;
        try {
          // Every page uses the same reference; no dependency on a still-generating neighbour.
          raw = await deps.image(c.plan!.pages[i].prompt!, [c.reference!]);
          check();
        } catch (e) {
          check();
          await update(() => {
            const p = c.plan!.pages[i];
            p.error = String(e);
            p.status = attempt === 0 ? "queued" : "error";
          });
          continue;
        }
        await update(() => {
          c.plan!.pages[i].status = "composing";
        });
        try {
          image = await deps.compose(raw, structuredClone(c), i);
          check();
        } catch (e) {
          check();
          await update(() => {
            const p = c.plan!.pages[i];
            p.error = String(e);
            p.status = attempt === 0 ? "queued" : "error";
          });
          continue;
        }
        await update(() => {
          const p = c.plan!.pages[i];
          if (p.image) p.history.push(p.image);
          p.raw = raw;
          p.image = image;
          p.status = "ready";
          delete p.error;
        });
        return;
      }
    };
    let cursor = 0;
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(2, targets.length) }, async () => {
        while (cursor < targets.length) {
          check();
          const { i } = targets[cursor++];
          await generatePage(i);
        }
      })
    );
    // Wait for every in-flight worker even on save failure/cancellation, preventing late writes.
    const rejected = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    if (rejected) throw rejected.reason;
    check();
    if (!c.copy) {
      await update(() => {}, "正在整理发布文案…");
      const copy = await structuredText(copyPrompt(c), parseCopy);
      await update(() => {
        c.copy = copy;
      });
    }
    const failed = c.plan!.pages.some((p) => !p.image || p.error);
    await update(
      () => {},
      failed ? "部分页面未完成，可重试失败页" : "完成",
      failed ? "error" : "done"
    );
  } catch (e) {
    await queue;
    if (!fatal && !signal.aborted && deps.valid())
      await update(() => {}, String(e), "error");
    throw e;
  }
}
