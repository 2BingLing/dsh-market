/**
 * 中文意图词典：把口语化查询扩展成可召回的关键词组。
 *
 * 解决的问题：用户搜「记事本」，插件叫 dsh-notes、简介写"笔记工具"——
 * Fuse 和子串都召回不到（字面不相交），后面的 LLM 精排再强也选不到池外的条目。
 * 这一层是**确定性的、零 token 的**，直接参与普通搜索（区别于默认关闭的 LLM 语义精排）。
 *
 * 设计约定：
 * - `words` 是**触发词**：用户查询里出现任一 → 命中该意图；
 * - `terms` 是**召回词**：对全库做子串扫描（名称/简介/标签），命中即进入候选；
 * - 词表只收「高频 + 映射明确」的意图，宁缺毋滥——错误的扩展比没有扩展更伤排序。
 */
export interface ZhIntent {
  /** 意图名（最典型的中文说法，UI 提示用） */
  key: string;
  /** 触发词：查询中出现任一即命中 */
  words: string[];
  /** 召回词：中英混合，参与全库子串/标签匹配 */
  terms: string[];
}

export const ZH_INTENTS: ZhIntent[] = [
  { key: "记事本", words: ["记事本", "便签", "笔记本", "记事", "笔记"], terms: ["notes", "note", "memo", "notepad", "便签", "笔记", "markdown"] },
  { key: "待办", words: ["待办", "任务管理", "清单", "todo"], terms: ["todo", "task", "checklist", "待办", "任务", "清单"] },
  { key: "翻译", words: ["翻译", "translate"], terms: ["translate", "translation", "翻译"] },
  { key: "截图", words: ["截图", "截屏", "录屏"], terms: ["screenshot", "capture", "screen", "截图", "录屏"] },
  { key: "下载", words: ["下载"], terms: ["download", "downloader", "下载"] },
  { key: "天气", words: ["天气"], terms: ["weather", "天气"] },
  { key: "日历日程", words: ["日历", "日程", "闹钟", "时钟"], terms: ["calendar", "schedule", "clock", "alarm", "日历", "日程", "时钟"] },
  { key: "提醒", words: ["提醒"], terms: ["remind", "reminder", "notification", "提醒"] },
  { key: "聊天", words: ["聊天", "对话", "陪聊"], terms: ["chat", "chatbot", "聊天", "对话"] },
  { key: "邮件", words: ["邮件", "邮箱"], terms: ["mail", "email", "smtp", "邮件"] },
  { key: "文件管理", words: ["文件管理", "资源管理"], terms: ["file", "files", "explorer", "文件"] },
  { key: "图片", words: ["图片", "相册", "壁纸"], terms: ["image", "images", "photo", "wallpaper", "图片", "壁纸", "相册"] },
  { key: "绘画", words: ["画图", "绘画", "生图", "文生图", "画"], terms: ["draw", "drawing", "stable-diffusion", "image", "绘画", "生图"] },
  { key: "音乐", words: ["音乐", "歌曲", "听歌"], terms: ["music", "audio", "音乐"] },
  { key: "视频", words: ["视频"], terms: ["video", "视频"] },
  { key: "播放器", words: ["播放器"], terms: ["player", "播放器"] },
  { key: "浏览器", words: ["浏览器", "网页", "上网"], terms: ["browser", "web", "浏览器", "网页"] },
  { key: "搜索引擎", words: ["搜索引擎"], terms: ["search", "search-engine", "搜索"] },
  { key: "代码开发", words: ["代码", "编程", "开发"], terms: ["code", "coding", "dev", "代码", "编程"] },
  { key: "Git", words: ["git", "github", "gitee", "提交"], terms: ["git", "github", "gitee", "commit"] },
  { key: "终端", words: ["终端", "命令行", "shell"], terms: ["terminal", "shell", "cli", "终端", "命令行"] },
  { key: "数据库", words: ["数据库", "sql"], terms: ["database", "sql", "sqlite", "mysql", "数据库"] },
  { key: "爬虫", words: ["爬虫", "抓取"], terms: ["crawler", "scraper", "spider", "爬虫", "抓取"] },
  { key: "自动化", words: ["自动化", "rpa"], terms: ["automation", "automate", "workflow", "自动化"] },
  { key: "剪贴板", words: ["剪贴板"], terms: ["clipboard", "剪贴板"] },
  { key: "压缩", words: ["压缩", "解压"], terms: ["zip", "compress", "archive", "压缩", "解压"] },
  { key: "PDF", words: ["pdf"], terms: ["pdf"] },
  { key: "办公文档", words: ["word", "excel", "ppt", "表格", "幻灯片", "演示"], terms: ["excel", "word", "office", "xlsx", "表格", "幻灯片", "ppt"] },
  { key: "网盘", words: ["网盘", "云盘"], terms: ["cloud", "drive", "网盘", "云盘"] },
  { key: "密码", words: ["密码"], terms: ["password", "密码"] },
  { key: "加密", words: ["加密", "解密"], terms: ["encrypt", "crypto", "加密"] },
  { key: "代理网络", words: ["代理", "梯子", "组网"], terms: ["proxy", "network", "代理", "网络"] },
  { key: "网络诊断", words: ["ip", "端口", "ping"], terms: ["ip", "port", "tcp", "udp", "ping", "端口"] },
  { key: "系统进程", words: ["系统", "进程", "任务管理"], terms: ["system", "process", "系统", "进程"] },
  { key: "清理", words: ["清理", "垃圾", "瘦身"], terms: ["clean", "cleanup", "清理", "垃圾"] },
  { key: "监控", words: ["监控"], terms: ["monitor", "监控"] },
  { key: "日志", words: ["日志"], terms: ["log", "logs", "日志"] },
  { key: "番茄钟", words: ["番茄钟", "专注", "计时"], terms: ["pomodoro", "focus", "timer", "番茄钟", "专注", "计时"] },
  { key: "计算换算", words: ["计算器", "换算", "单位"], terms: ["calculator", "convert", "计算器", "换算"] },
  { key: "汇率", words: ["汇率", "货币"], terms: ["exchange", "currency", "汇率"] },
  { key: "股票基金", words: ["股票", "基金", "a股", "行情", "炒股"], terms: ["stock", "finance", "股票", "基金", "行情"] },
  { key: "加密货币", words: ["比特币", "加密货币", "币圈"], terms: ["bitcoin", "crypto", "blockchain", "加密货币"] },
  { key: "AI大模型", words: ["大模型", "llm", "gpt", "智能体", "人工智能"], terms: ["ai", "llm", "gpt", "agent", "大模型", "人工智能"] },
  { key: "机器人", words: ["机器人"], terms: ["bot", "robot", "机器人"] },
  { key: "问卷投票", words: ["问卷", "投票", "抽奖"], terms: ["survey", "poll", "quiz", "问卷", "投票", "抽奖"] },
  { key: "游戏", words: ["游戏", "摸鱼"], terms: ["game", "games", "游戏"] },
  { key: "娱乐", words: ["娱乐", "段子", "笑话"], terms: ["fun", "joke", "meme", "娱乐", "段子"] },
  { key: "新闻资讯", words: ["新闻", "资讯", "头条", "热搜"], terms: ["news", "feed", "trending", "新闻", "资讯", "热搜"] },
  { key: "RSS订阅", words: ["rss", "订阅"], terms: ["rss", "feed", "订阅"] },
  { key: "阅读", words: ["阅读", "电子书", "小说"], terms: ["read", "reader", "ebook", "novel", "epub", "阅读", "小说"] },
  { key: "学习背词", words: ["学习", "背单词", "单词", "英语"], terms: ["learn", "study", "vocabulary", "english", "学习", "单词", "英语"] },
  { key: "论文文献", words: ["论文", "文献", "学术"], terms: ["paper", "arxiv", "scholar", "论文", "文献"] },
  { key: "知识库", words: ["知识库", "维基", "wiki"], terms: ["wiki", "knowledge", "知识库", "维基"] },
  { key: "白板", words: ["白板", "画布"], terms: ["whiteboard", "canvas", "白板", "画布"] },
  { key: "思维导图", words: ["思维导图"], terms: ["mindmap", "mind", "思维导图"] },
  { key: "流程图", words: ["流程图", "图表", "绘图"], terms: ["diagram", "flowchart", "mermaid", "流程图", "图表"] },
  { key: "OCR", words: ["ocr", "文字识别"], terms: ["ocr", "文字识别"] },
  { key: "语音合成", words: ["语音", "朗读", "tts", "配音"], terms: ["tts", "speech", "voice", "语音", "朗读"] },
  { key: "语音识别", words: ["语音识别", "听写", "whisper"], terms: ["whisper", "asr", "stt", "语音识别", "听写"] },
  { key: "字幕", words: ["字幕"], terms: ["subtitle", "字幕"] },
  { key: "视频下载", words: ["视频下载", "youtube", "油管", "b站", "bilibili", "哔哩"], terms: ["youtube", "bilibili", "yt-dlp", "b站"] },
  { key: "微博", words: ["微博"], terms: ["weibo", "微博"] },
  { key: "微信", words: ["微信", "公众号", "wechat"], terms: ["wechat", "weixin", "微信", "公众号"] },
  { key: "Twitter", words: ["twitter", "tweet", "推文"], terms: ["twitter", "tweet"] },
  { key: "Telegram", words: ["telegram"], terms: ["telegram"] },
  { key: "Discord", words: ["discord"], terms: ["discord"] },
  { key: "飞书钉钉", words: ["飞书", "钉钉", "lark"], terms: ["feishu", "lark", "dingtalk", "飞书", "钉钉"] },
  { key: "Notion", words: ["notion"], terms: ["notion"] },
  { key: "Obsidian", words: ["obsidian"], terms: ["obsidian"] },
  { key: "备份恢复", words: ["备份", "恢复"], terms: ["backup", "restore", "备份", "恢复"] },
  { key: "同步", words: ["同步"], terms: ["sync", "同步"] },
  { key: "主题美化", words: ["主题", "美化", "皮肤"], terms: ["theme", "themes", "主题", "美化"] },
  { key: "字体", words: ["字体"], terms: ["font", "fonts", "字体"] },
  { key: "颜色配色", words: ["颜色", "配色", "色板"], terms: ["color", "palette", "颜色", "配色"] },
  { key: "图标", words: ["图标"], terms: ["icon", "icons", "图标"] },
  { key: "二维码", words: ["二维码", "扫码"], terms: ["qrcode", "qr", "二维码"] },
  { key: "短链", words: ["短链", "短网址"], terms: ["shorten", "url-shortener", "短链"] },
  { key: "正则", words: ["正则"], terms: ["regex", "regexp", "正则"] },
  { key: "格式化", words: ["格式化", "美化代码"], terms: ["format", "formatter", "prettier", "格式化"] },
  { key: "JSON", words: ["json"], terms: ["json"] },
  { key: "CSV", words: ["csv"], terms: ["csv", "tsv"] },
  { key: "API调试", words: ["api", "接口", "mock"], terms: ["api", "mock", "rest", "接口"] },
  { key: "测试", words: ["测试"], terms: ["test", "testing", "测试"] },
  { key: "Docker", words: ["docker", "容器"], terms: ["docker", "container", "容器"] },
  { key: "服务器运维", words: ["服务器", "运维", "部署"], terms: ["server", "deploy", "ops", "服务器", "部署", "运维"] },
  { key: "SSH远程", words: ["ssh", "远程"], terms: ["ssh", "remote", "远程"] },
  { key: "图床上传", words: ["图床", "上传"], terms: ["upload", "image-hosting", "图床", "上传"] },
  { key: "磁力种子", words: ["磁力", "种子", "bt", "迅雷"], terms: ["torrent", "magnet", "bt", "种子", "磁力"] },
  { key: "总结摘要", words: ["总结", "摘要", "概要"], terms: ["summary", "summarize", "总结", "摘要"] },
  { key: "写作文案", words: ["写作", "文案", "改写"], terms: ["write", "writing", "写作", "文案"] },
  { key: "代码审查", words: ["审查", "评审", "review"], terms: ["review", "code-review", "审查"] },
  { key: "面试", words: ["面试"], terms: ["interview", "面试"] },
  { key: "简历", words: ["简历"], terms: ["resume", "cv", "简历"] },
  { key: "健康健身", words: ["健康", "健身", "体重"], terms: ["health", "fitness", "健康", "健身"] },
  { key: "记账", words: ["记账", "账单", "花销"], terms: ["expense", "billing", "记账", "账单"] },
  { key: "农历节日", words: ["农历", "节日", "假期"], terms: ["lunar", "holiday", "农历", "节日"] },
  { key: "随机抽签", words: ["随机", "抽签", "骰子"], terms: ["random", "dice", "随机"] },
];

export interface ZhExpansion {
  /** 命中的意图（保持词典顺序，供 UI 提示与 via 标记） */
  intents: string[];
  /** 意图 → 召回词（已去重、已剔除会被主查询覆盖的词） */
  expansions: Array<{ intent: string; terms: string[] }>;
  /** 全部召回词的扁平集合（去重） */
  terms: string[];
}

/**
 * 对查询做意图扩展。查询里包含某意图的任一触发词 → 展开该意图的召回词。
 * 纯内存字符串操作，无网络无 LLM；查询不命中任何意图时返回空扩展（搜索行为不变）。
 */
export function expandZhQuery(query: string): ZhExpansion {
  const q = (query ?? "").toLowerCase().trim();
  if (!q) return { intents: [], expansions: [], terms: [] };
  const intents: string[] = [];
  const expansions: ZhExpansion["expansions"] = [];
  const terms = new Set<string>();
  for (const it of ZH_INTENTS) {
    if (!it.words.some((w) => q.includes(w))) continue;
    intents.push(it.key);
    // 召回词里剔除"本身是查询子串"的词——主查询的子串召回已覆盖它们
    const t = [...new Set(it.terms.map((x) => x.toLowerCase()))].filter(
      (x) => x && !q.includes(x) && !terms.has(x),
    );
    for (const x of t) terms.add(x);
    expansions.push({ intent: it.key, terms: t });
  }
  return { intents, expansions, terms: [...terms] };
}
