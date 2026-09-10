import { describe, expect, it } from "vitest";
import {
  DATA_FIX_TITLE_RE,
  extractCorrections,
  extractRepoFromDataFixText,
  mergeCorrections,
} from "../src/sources/corrections.js";

describe("DATA_FIX_TITLE_RE", () => {
  it("识别 [数据修正] / [data fix] 标题", () => {
    expect(DATA_FIX_TITLE_RE.test("[数据修正] dsh-quote-followup 补写作者自述")).toBe(true);
    expect(DATA_FIX_TITLE_RE.test("[data fix] x")).toBe(true);
  });
  it("不误伤提交/普通标题", () => {
    expect(DATA_FIX_TITLE_RE.test("[提交插件] x")).toBe(false);
    expect(DATA_FIX_TITLE_RE.test("[提交工具] x")).toBe(false);
    expect(DATA_FIX_TITLE_RE.test("普通标题")).toBe(false);
  });
});

describe("extractCorrections · 作者自述", () => {
  it("自由书写的独立方括号（#135 真实风格：无字段名前缀）", () => {
    const body = `已收录插件 \`tr1v3r/dsh-quote-followup\` 补写「作者自述」，希望展示在市场详情页的「作者自述」专区：

---

[这个插件来自我自己的日常痒点：长对话里想针对模型前面说的某一段追问，只能整段复制粘贴，上下文糊成一团。所以我做了「划选 → 引用 → 追问」：选中文本弹出引用按钮，点击后以 DSH 原生的引用 chip（与 @文件 / @对话 同一套 ReferenceChipNode）追加进输入框，发送时 codec 再展开成模型可读的 Markdown 引用块——你看到的是原生体验，模型看到的是干净引用。几个刻意的设计：chip 只存文本不存消息引用，compaction 折叠与会话轮转后依然有效；可连续引用多段；引用自带对话轮次编号，模型能定位"第 3 轮说的内容"；旧版 DSH 缺 chip 能力时自动降级纯文本；按钮与引用框架跟随 DSH 中英文切换。仅支持 Web。欢迎试用反馈。]

---

其他数据（安装命令 \`dsh plugin --profile web add dsh-quote-followup\`、类型 cordis-plugin、MIT license）核对无误，无需调整。`;
    const c = extractCorrections(body);
    expect(c.introByAuthor).toMatch(/这个插件来自我自己的日常痒点/);
    expect(c.introByAuthor).toMatch(/欢迎试用反馈/);
    expect(c.descriptionZh).toBeUndefined();
  });

  it("带字段名的方括号（模板推荐写法）", () => {
    const body = [
      `**GitHub 仓库地址**：https://github.com/owner/repo`,
      `**作者自述简介**：[这是我自己的话，跨行\n第二行]`,
      `**一句话简介**：一个简洁介绍`,
    ].join("\n");
    const c = extractCorrections(body);
    expect(c.introByAuthor).toBe("这是我自己的话，跨行\n第二行");
  });

  it("裸写法单行", () => {
    expect(extractCorrections("作者自述：这是我的自述").introByAuthor).toBe("这是我的自述");
    expect(extractCorrections("**自定义简介**：另一个自述").introByAuthor).toBe("另一个自述");
  });

  it("显式清空（作者自述：无/删除）→ null", () => {
    expect(extractCorrections("作者自述：无").introByAuthor).toBeNull();
    expect(extractCorrections("作者自述：删除，不再展示").introByAuthor).toBeNull();
    expect(extractCorrections("作者自述：\n删除").introByAuthor).toBeNull();
  });

  it("无任何自述 → undefined", () => {
    expect(extractCorrections(null)).toEqual({});
    expect(extractCorrections("").introByAuthor).toBeUndefined();
    expect(extractCorrections("安装命令有误，请修复。").introByAuthor).toBeUndefined();
    // 太短的括号不当作自述（[1] / 补丁链接噪声）
    expect(extractCorrections("请修复 [1] 这个问题").introByAuthor).toBeUndefined();
  });
});

describe("extractCorrections · 简介/文案", () => {
  it("简介：[多行] → descriptionZh", () => {
    expect(extractCorrections("简介：[这是修正后的\n中文简介]").descriptionZh).toBe(
      "这是修正后的\n中文简介"
    );
  });
  it("一句话简介/描述/文案 单行 → descriptionZh", () => {
    expect(extractCorrections("一句话简介：简短的中文介绍").descriptionZh).toBe("简短的中文介绍");
    expect(extractCorrections("描述：新的描述文案").descriptionZh).toBe("新的描述文案");
    expect(extractCorrections("文案：统一入口文案").descriptionZh).toBe("统一入口文案");
  });
  it("作者自述简介：xxx 里的「简介」不被误判为简介修正", () => {
    const c = extractCorrections("**作者自述简介**：[这是作者自述]");
    expect(c.introByAuthor).toBe("这是作者自述");
    expect(c.descriptionZh).toBeUndefined();
  });
});

describe("mergeCorrections", () => {
  it("后到 issue 覆盖先到（含 null 清空）", () => {
    const m = mergeCorrections({ introByAuthor: "旧自述" }, { introByAuthor: null });
    expect(m?.introByAuthor).toBeNull();
    expect(
      mergeCorrections({ introByAuthor: "旧自述" }, { descriptionZh: "新简介" })?.descriptionZh
    ).toBe("新简介");
  });
  it("安装命令后到覆盖先到", () => {
    const m = mergeCorrections(
      { installCommands: ["dsh plugin --profile web add a"] },
      { installCommands: ["dsh plugin --profile web add -w https://x/y/z.tgz"] }
    );
    expect(m?.installCommands).toEqual(["dsh plugin --profile web add -w https://x/y/z.tgz"]);
  });
  it("空修正不覆盖", () => {
    expect(mergeCorrections({ introByAuthor: "旧" }, {})?.introByAuthor).toBe("旧");
    expect(mergeCorrections(undefined, {})).toBeUndefined();
  });
});

describe("extractCorrections · 安装命令", () => {
  it("```sh 代码块 → installCommands", () => {
    const c = extractCorrections([
      "安装命令过时，应更新为：",
      "```sh",
      "dsh plugin --profile web add -w https://github.com/LiPu-jpg/Openwrite/releases/download/v0.2.8/dsh-openwrite-0.2.8.tgz",
      "```",
    ].join("\n"));
    expect(c.installCommands).toEqual([
      "dsh plugin --profile web add -w https://github.com/LiPu-jpg/Openwrite/releases/download/v0.2.8/dsh-openwrite-0.2.8.tgz",
    ]);
  });
  it("`安装命令：` 单行 → installCommands", () => {
    const c = extractCorrections("安装命令：npm install dsh-foo");
    expect(c.installCommands).toEqual(["npm install dsh-foo"]);
    expect(extractCorrections("安装：dsh plugin --profile web add dsh-bar")?.installCommands).toEqual([
      "dsh plugin --profile web add dsh-bar",
    ]);
  });
  it("非安装指令文本不当作命令", () => {
    const c = extractCorrections("这个插件需要在 Web 端使用，配置见 README。");
    expect(c.installCommands).toBeUndefined();
  });
});

describe("extractRepoFromDataFixText · 裸 owner/repo", () => {
  it("#135 正文风格：反引号裸 owner/repo → 命中目标仓库", () => {
    const body = `已收录插件 \`tr1v3r/dsh-quote-followup\` 补写「作者自述」...
[这个插件来自我自己的日常痒点：长对话里想针对模型前面说的某一段追问，只能整段复制粘贴。]`;
    expect(extractRepoFromDataFixText(body)).toEqual(["tr1v3r/dsh-quote-followup"]);
  });
  it("过滤纯数字/日期/文件路径噪声", () => {
    expect(extractRepoFromDataFixText("2026/09/10 更新，见 docs/README.md")).toEqual([]);
  });
  it("有完整 URL 时不走裸写法（交给 extractRepoFromText）", () => {
    const body = "仓库：https://github.com/LiPu-jpg/Openwrite 请修正安装命令";
    expect(extractRepoFromDataFixText(body)).toEqual([]);
  });
});