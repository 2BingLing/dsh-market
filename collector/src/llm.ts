/**
 * M3 中文化：用 DeepSeek API 为插件生成中文简介 + 中文功能标签
 * 只处理 descriptionZh 为空的插件（增量，控制成本）；失败跳过可重试
 */

export interface ZhResult {
  descriptionZh: string;
  tagsZh: string[];
}

interface Input {
  name: string;
  description: string;
  readmeSummary: string | null;
  topics: string[];
  /** 已存在的细分标签清单（约束生成：优先复用，抑制同义异名） */
  knownTags?: string[];
}

const MAX_DESC = 220;

function buildPrompt(input: Input): string {
  const known = input.knownTags?.length
    ? `已存在的细分标签（优先从中选用，只有确实无法表达时才创建新标签）：\n${input.knownTags.slice(0, 40).join("、")}\n`
    : "";
  return `你是 DeepSeek Harness 插件市场的编辑。为下面这个 DSH 插件生成中文简介和中文功能标签。

插件名：${input.name}
英文描述：${(input.description || "").slice(0, 200) || "（无）"}
README 摘要：${(input.readmeSummary || "").slice(0, MAX_DESC) || "（无）"}
GitHub topics：${input.topics.join(", ") || "（无）"}
${known}
要求：
1. descriptionZh：一句话中文简介（不超过 60 字），突出「能做什么、有什么用」，口语化自然，不要翻译腔
2. tagsZh：3-5 个中文功能标签，用于分类筛选${known ? "，**优先复用上面已存在的标签**（用词一致），只有新功能类型才创建新标签" : ""}

只输出 JSON，不要任何其他文字：
{"descriptionZh": "...", "tagsZh": ["...", "..."]}`;
}

/** 从 LLM 输出中容错提取 JSON */
export function extractJson(raw: string): ZhResult | null {
  try {
    const cleaned = raw
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const descriptionZh = String(parsed.descriptionZh ?? "").trim();
    const tagsZh = Array.isArray(parsed.tagsZh)
      ? parsed.tagsZh.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 6)
      : [];
    if (!descriptionZh && tagsZh.length === 0) return null;
    return { descriptionZh, tagsZh };
  } catch {
    return null;
  }
}

export async function translateWithDeepSeek(
  input: Input,
  opts: { apiKey: string; baseURL: string; model: string }
): Promise<ZhResult | null> {
  const body = {
    model: opts.model,
    messages: [{ role: "user", content: buildPrompt(input) }],
    temperature: 0.3,
    max_tokens: 300,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${opts.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.text()).slice(0, 200);
        // 429/5xx 重试；4xx 其他不重试
        if (res.status !== 429 && res.status < 500) {
          console.warn(`    [llm] HTTP ${res.status}: ${err}`);
          return null;
        }
        throw new Error(`HTTP ${res.status}: ${err}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      const result = extractJson(content);
      if (!result) {
        console.warn(`    [llm] bad JSON for ${input.name}: ${content.slice(0, 120)}`);
        return null;
      }
      return result;
    } catch (err) {
      if (attempt === 3) {
        console.warn(`    [llm] ${input.name} failed after retries: ${(err as Error).message.slice(0, 100)}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}
