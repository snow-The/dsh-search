---
source: OSINT Techniques: Resources for Uncovering Online Information, 11th Edition (Michael Bazzell, Jason Edison)
ocr: PaddleOCR-VL-1.6
extracted_at: 2026-08-22T21:08:58.795Z
---
## 搜索方法论提取(操作符/平台/工作流/架构要点,每条带行号引用)

> 全书 30,763 行 / 47 章。本提取聚焦搜索相关章节:Ch17 搜索引擎(核心)、Ch18-22 社交网络搜索、Ch23-24 邮箱/用户名、Ch25 人搜、Ch45 方法论与工作流。OCR 转录:代码/引号/缩进可能有损,按语义还原。

# 第 17 章 搜索引擎(核心操作符)

## A. Google 高级搜索操作符(逐条原文写法)

### 1. 精确短语 / 引号匹配 [L12403][L12441]
- 引号 "..." 强制精确短语匹配。例:"Cisco" "PowerPoint" → 10,000,000+ 结果(内容含两词)[L12401-12402]。
- "Cisco Confidential" filetype:pptx → 恰好 1,080 个含该精确短语的 PPTX [L12410]。

### 2. filetype: 文件类型操作符 [L12403][L12406-12438]
- "Cisco" filetype:ppt → 15,200 个 PPT;"Cisco" filetype:pptx → 另加 12,700 个,合计 27,000+ [L12406-12409]。
- filetype:doc "resume" "target name" → 常挖出目标简历(手机号、地址、工作史、教育、推荐人等私密信息)[L12411]。
- filetype 可与 site 组合找单域名全部文件类型:site:irongeek.com filetype:pdf filetype:ppt filetype:pptx [L12412]。
- 无结果时加一个关键字常比纯操作符查询更多 [L12413]。
- 有效扩展名清单 [L12414-12438]:7Z 压缩、BMP、DOC/DOCX Word、DWF、GIF、HTM/HTML、KML/KMZ、JPEG/JPG/PNG、ODP/ODS/ODT、PDF、RAR、PPT/PPTX、RTF、TXT、XLS/XLSX、ZIP。

### 3. 连字符 - (排除操作符)[L12439-12450]
- 排除其后紧跟的词; - 与词之间不得有空格。
- 示例(对自身名字逐步收敛):"Michael Bazzell" 31,800 → -police 28,000 → -FBI 22,100 → -osint 6,010 → -books 4,320 → -open -source 604 → -"mr. robot" 92 [L12441-12450]。
- 工作流要点:结果过多时缓慢叠加排除词,收敛到可分析规模 [L12450]。

### 4. inurl: URL 操作符 [L12451-12460]
- 只匹配 URL 中的数据。最常用:FTP 匿名服务器搜索 inurl:ftp -inurl:(http|https) filetype:pdf "osint" [L12453]。拆解 [L12455-12458]:
- inurl:ftp 只要 URL 含 ftp;
- -inurl:(http|https) 排除 URL 含 http/https 的(管道符 | 表 OR,即反斜杠键上方符号);
- filetype:pdf 只要 PDF;
- "osint" 强制内容含精确词。
- 找 WordPress 博客目录:inurl:blog site:inteltechniques.com [L12460]。

### 5. intitle: / allintitle: 标题操作符 [L12461-12472]
- 只匹配页面 title(源码中,可不出现在正文)。intitle:"osint video training" 把 2,760 结果压到 5 [L12462-12463]。
- 引号强制整短语作标题;allintitle:training osint video 强制三词任意顺序全出现 [L12464-12465]。
- 在线文件夹搜索:intitle:index.of OSINT 定位公开目录索引(非网页,而是整目录/整服务器文件视图)[L12468-12472]。例:cyberwar.nl/d/、bitsavers.trailing-edge.com/pdf/。

### 6. OR 操作符 [L12473-12479]
- 大写 OR,返回含 A、含 B、或 A+B(适合拼写易错的姓氏)。例:"Michael Bazzell" OR "Mike Bazzell" OSINT 18,600 [L12477]。

### 7. 星号 * 通配符 [L12480-12481]
- 代表一个或多个词的占位符。"osint * training" 匹配 "osint video training"、"osint live classroom training" 等 [L12481]。

### 8. 范围 .. 操作符 [L12482-12484]
- 在两个标识符(数字/年份)之间搜索。OSINT Training 2015..2018 匹配含 2015-2018 任一数字的页面。
- 实用例:"bonnie woodward" "1..999 comments" 找含评论数的报道 [L12484]。

### 9. related: 相关域操作符 [L12485-12490]
- related:inteltechniques.com → 返回与该域关联的其它站点(作者的其它网站、X/Twitter、Black Hat 课程、Amazon 书)。架构要点:可把一个人的个人站翻译成多个社交网络与朋友网站 [L12487-12490]。

### 10. 日期/时间过滤与强制显示日期 [L12491-12524]
- Google Tools 链接 → Any time 下拉:Past hour / 24 hours / week / month / year / Custom range(精确日期范围)[L12492-12493]。
- 实战:失踪人口案,把搜索时间设为失踪日期之前,专注失踪前内容,常得更有价值的嫌疑人线索 [L12494]。
- 强制每个结果显示日期:在任意 Google 搜索 URL 末尾追加 &tbs=cdr:1,cd_min:1/1/0 [L12520-12523]。例:https://www.google.com/search?q="michael+bazzell"&tbs=cdr:1,cd_min:1/1/0
- "Verbatim" 选项:完全按输入搜索,常比标准搜索结果更多、更深入 [L12524]。

### 11. Google Programmable Search Engines(自定义搜索引擎)[L12543-12579]
- 建只搜特定网站的引擎;支持 Refinements(细化)把结果分 tab。例:一个引擎搜 Facebook/X/Instagram/LinkedIn/YouTube/TikTok,各网络一个 refinement tab [L12551-12557]。
- 用 Rewrite query words 加文件类型细化:ext:pdf、ext:doc OR ext:docx、ext:xls OR ext:xlsx OR ext:csv、ext:ppt OR ext:pptx、ext:txt OR ext:rtf、ext:wpd、ext:odt OR ext:ods OR ext:odp、ext:zip OR ext:rar OR ext:7z [L12569-12578]。

## B. 搜索平台清单 [L12761-13333]

### 主搜索引擎
- Google / Bing / Yandex(俄):基础三板斧,初始搜索必用 [L13255]。
- DuckDuckGo(duckduckgo.com):不追踪、无历史;用 Wikipedia/Wolfram Alpha 众包增强;结果更少更准 [L13183-13184]。
- Start Page(startpage.com):隐私引擎,只用 Google 结果(保留日期/图片/视频过滤),每结果有 Visit in Anonymous View 代理链接保护 IP。敏感搜索策略首选 [L13185-13189]。
- Qwant(qwant.com):多列 All/News/Images/Videos/Shopping,能挖社交网络同名者 [L13190-13191]。
- Searx(baresearch.org):元搜索聚合 Google/Bing,去重;每结果 cached 走 Wayback、proxied 走代理;自托管更佳 [L13180-13182]。
- Million Short(millionshort.com):可移除最热门 100万/10万/1万/1千/10 网站,聚焦小众站 [L13192-13193]。

### 其它语言/区域引擎 [L12586-12699]
- Google 按国家变化(google.fr 等)。2Lingual(2lingual.com):一次跨两国搜索并自动翻译 [L12688-12689]。
- 翻译:Google Translate(translate.google.com,可整站翻译含 X/Instagram)、Bing Translator、DeepL(deepl.com/translator,最准)、PROMOT/Libre Translate/Lingva/MyMemory [L12690-12697]。
- Google Input Tools(google.com/inputtools/try):用键盘打任意语言(如俄文西里尔),定位外文用户名 [L12698-12699]。

### 新闻/档案
- Google News Archive(news.google.com):历史报纸/数字内容,查前住址、讣告、亲属、关联人 [L12705-12706]。
- Google Newspaper Archive(news.google.com/newspapers):印刷报纸高清扫描 [L12707-12708]。
- Newspaper Archive(newspaperarchive.com):世界最大报纸档案。免费访问技巧:site:newspaperarchive.com "This archive is hosted by" "create free account" 找到已付费公共图书馆馆藏,注册免费账号访问 [L12709-12719]。
- 其它:Old Fulton(5700万美/加扫描报)、Library of Congress Chronicling America(1756-1963)、Small Town Newspapers(stparchive.com,1890起)[L12720-12727]。

### 专业引擎
- Google Patents(google.com/?tbm=pts):专利全文搜索 [L12737-12738]。
- Google Scholar(scholar.google.com):学术文献 + 判例法/法庭记录搜索(免费获得本需付费的法院记录)[L12739-12740]。
- Keyword Tool(keywordtool.io):Google/Bing/YouTube/App Store 自动补全(各 10 条,Google 仅 5 条);可找错拼词。实战:产品召回调查中靠错拼发现被遗漏的投诉 [L12741-12756]。
- Search Engine Colossus(searchenginecolossus.com):按国家索引全球引擎 [L13212-13213]。
- Fagan Finder(faganfinder.com):把查询填充到数百种搜索服务 [L13214-13215]。

### 缓存 / 网页存档 [L12647-12668]
- Google Cache:https://webcache.googleusercontent.com/search?q=cache:<URL>(Google 已移除 cache: 操作符,此 URL 仍可访问)[L12651-12652]。
- Bing Cache:结果旁绿色下箭头 → Cached [L12653-12654]。
- Yandex Cache:三点菜单 → Saved copy;有时比 Google/Bing 更旧,旧缓存对调查有利 [L12655-12556]。
- The Wayback Machine(web.archive.org):最多历史快照;关键词搜索 https://web.archive.org/web/*/<term> [L12657-12665]。
- 工作流要点:找到任何感兴趣网站/资料,立刻查缓存找变更内容(被删除的信息往往在旧缓存中)[L12668]。

### FTP 搜索 [L13216-13240]
- Google FTP 搜索:inurl:ftp -inurl:(http|https) "confidential"(107,000);inurl:ftp -inurl:(http|https) "cisco" filetype:pdf(20,000)[L13218-13223]。
- Napalm FTP(searchftps.net):内容最新,显示最后确认日期 [L13230-13231]。
- Mamoht(mmnt.ru):俄 FTP 引擎,可按国家隔离,有 Search in found(在结果内再搜)功能 [L13233-13235]。
- FreewareWeb(freewareweb.com/ftpsearch.shtml):弱但偶有独特扩展名文件 [L13237-13238]。

### 源码/代码搜索 [L13241-13252]
- NerdyData(nerdydata.com/reports/new):搜索网站编程代码(HTML/JS/CSS,用户不可见)。可搜 Google Analytics 跟踪号(如 UA-8231004-3)定位同主站所有站点;可搜被窃代码/克隆站;查询限 35 字符,多用 AND 拼接 [L13241-13252]。

### Tor / 暗网搜索引擎 [L13194-13209]
- Ahmia(ahmia.fi):最全 Tor 引擎,首选;需 Tor Browser [L13196-13197]。
- Tor Link(tor.link,2022):结果常含 Ahmia 没有的站点 [L13198-13199]。
- Onionland Search(onionlandsearchengine.net):依赖 Google 对带代理链接的 Tor 站索引 [L13200-13201]。
- Torch(仅 Tor 网络):http://torchdeedp3i2jigzjdmfpn5ttjhthh5wbmda2rr3jvqjg5p77c54dqd.onion;替代:Haystack、Tor66 [L13205-13208]。站点出现/消失频繁 [L13209]。

### 通用搜索工具 / AI
- IntelTechniques Search Engines Tool(inteltechniques.com/tools):一键对 Google/Bing/Yahoo/Searx/Yandex 全部搜索,Submit All 逐项开新 tab,支持操作符与引号 [L13254-13256]。
- 作者对 AI 引擎的立场:不推荐在 OSINT 调查中用在线 AI(会收集输入训练模型、信息常错)。如确需,用离线 LLM(Jan + Mistral Instruct 7B Q4),可用于整理数据/生成脚本,但绝不用于调查结论 [L13261-13269]。

## C. 高级搜索页(操作符的 GUI 版)[L12728-12734]
- Google Advanced Search(google.com/advanced_search):把操作符变成表单;filetype 下拉限常见类型,操作符支持更多扩展名 [L12729]。
- Bing Advanced Search:用 Yahoo 高级页(search.yahoo.com/web/advanced,因 Yahoo 用 Bing 引擎)过滤词/短语/排除/域名/格式/语言 [L12730-12734]。

# 第 19 章 社交网络: X(Twitter)搜索

## A. Twitter 搜索界面 [L14207-14224]
- Twitter 已改名为 X,URL 用 x.com,文中称 Twitter [L14205]。最佳 OSINT 数据需登录账号 [L14205]。
- 搜索入口:x.com/explore(标准搜索栏);x.com/search-advanced(高级页)[L14207-14210]。
- 高级页各字段 [L14211-14222]:All of these words(全含,序无关)、This exact phrase(精确短语,同引号)、Any of these words(任一词)、None of these words(排除)、These Hashtags(话题标签 #)、Language(语言)、From these accounts(来自某用户)、To these accounts(发给某用户)、Mentioning these accounts(@提及)、Dates(日期范围)。
- 作者观点:不用高级页,用手动操作符(可监控实时数据、便于法庭举证)[L14223]。
- 搜索 tab 菜单 [L14227-14234]:Top(热门,通常避开)、Latest(逆时间序)、People(按真人名/用户名找人,最佳)、Media(图片/视频)、Lists(他人创建的主题列表,反映目标兴趣圈)。
- 邮箱反查:Twitter 不支持邮箱搜用户名;可在虚拟安卓机的 Twitter app 里同步通讯录,经 Suggested Followers 暴露匹配账号(该技巧 2022 后渐失效)[L14236-14239]。

## B. Twitter 搜索操作符(逐条)[L14240-14337]
- from:<username> 只看该用户发出的推文 [L14242] (例:from:IntelTechniques)。
- to:<username> 只看公开发给该用户的推文(用户无法控制/屏蔽)——失踪/凶杀案更看重incoming [L14244-14246]。
- 组合:to:IntelTechniques from:protonprivacy 隔离双条件推文 [L14247]。
- from:IntelTechniques filter:replies 只看回复别人的;from:IntelTechniques -filter:replies 只看非回复(作者更偏好)[L14249-14251]。
- 媒体过滤(无操作符,用 URL):https://x.com/<user>/media/ [L14253-14254]。
- 高亮(置顶):/highlights/;目标建的列表:/lists/;目标被加入的列表:/lists/memberships(目标无法控制)[L14256-14260]。
- 列表成员/关注者:https://x.com/i/lists/<listid>/members 与 /followers [L14262-14265]。
- 话题:/topics(暴露目标关注兴趣,页面上不可见)[L14267-14268]。
- from:IntelTechniques filter:links 只看含外链的推文 [L14270]。
- from:IntelTechniques min_faves:150 至少150赞;min_replies:100 至少100回复 [L14272-14274]。
- 关注者/关注:/followers 与 /following [L14275-14277]。
- **组合查询**:to:IntelTechniques from:zerotrafficking since:2022-10-01 until:2022-10-31 filter:links filter:replies [L14278-14279]。

## C. 位置/地理搜索 [L14281-14290]
- geocode:<lat>,<lon>,<radius>:例 geocode:43.430242,-89.736459,1km;半径 1/5/10/25 可靠,可改 mi(英里)。URL 版:https://x.com/search?q=geocode:...&f=live [L14283-14285]。
- 加关键词:geocode:43.430242,-89.736459,2mi"fight" [L14289]。
- 注意:Twitter 默认不共享位置,位置推文极少,无结果不代表该地无活动 [L14290]。

## D. 必选/可选词 + 链接 + 日期范围 [L14291-14337]
- 强制词引号 + 可选词 OR(大写):"Michael Parker" kill OR stab OR fight OR beat OR punch OR death OR die [L14293]。
- 链接外链搜索:url:mega.nz breach(过滤含 mega.nz 链接的推文);comb breach filter:links [L14296-14298]。
- 日期范围:since:2015-01-01 until:2015-01-05 "bomb threat" [L14305]。
- **按年归档大账号**:from:humanhacker since:YYYY-01-01 until:YYYY-12-31 逐年(2006-2024),可换成 to: 看incoming,或引号含提及 [L14306-14331]。
- **挖旧邮箱**:from:humanhacker email since:2006-01-01 until:2009-12-31(旧推常含邮箱)[L14335]。
- 精确到天:from:humanhacker email since:2017-10-02 until:2017-10-03 [L14337]。

## E. 已删/停用推文恢复 [L14345-14359]
- 用户删推/停用后仍可恢复:先 cache 搜索其资料页 [L14346-14348]。
- Google Cache URL:https://webcache.googleusercontent.com/search?q=cache:https://twitter.com/<user> [L14349]。
- Bing/Yandex 缓存常含更旧/独特内容 [L14352]。
- site:twitter.com/<user>/status 强制 Google 只给实际推文直链,再开缓存看已删推 [L14353-14354]。
- Wayback Machine:http://web.archive.org/web/*/twitter.com/<user> 与 /likes(看已删的赞)[L14355-14358]。
- 要点:目标删了内容但没删历史,务必查所有来源 [L14359]。

# 第 45 章 方法论与工作流

## A. 完整侦察流程(intake → 报告)[L28824-28855]
- 侦察流程从接单(intake)开始:威胁评估(个人/事件)、目标画像(个人/组织)、订阅者识别/账号归属、漏洞评估 [L28828-28835]。
- Triage(分诊):行动前先明确目标问题(30秒~30分钟)。第一条是 articulating the question——把调查目标写清楚(书面优先)。例:确认要查 ramit@iwillteachyoutoberich.com 背后的真实姓名与地址 [L28836-28845]。
- 核实请求者给的标识符(邮箱/姓名/电话/IP),避免把受害者和嫌疑人的邮箱搞混 [L28842]。
- 问清线索来源:信息无上下文就不是情报;多了解目标地点/职业/关联人/文化,便于后续定位页面与账号 [L28845]。
- 法律保全信:若涉及 Gmail 等平台,发 preservation letter 让服务商保留数据;ISP 联系清单 https://www.search.org/resources/isp-list/ [L28846-28847]。
- 冲突消解(Deconfliction):与其它机构确认不踩线、不浪费精力 [L28848-28849]。
- 笔记:纸笔 + 数字笔记本(OneNote);按日期/案件命名 section;拷入往来邮件。行动前自问 OSINT 是否恰当工具(有时一个电话更快)[L28852-28854]。

## B. Knolling(工作区准备)[L28855-28863]
- 验证 VPN(考虑连目标区域节点)、启动 OSINT VM 并更新、开笔记/模板、登录秘密账号(如社媒)、打开 https://inteltechniques.com/tools/ 工具面板、建调查目录 [L28856-28862]。

## C. 付费/私有数据先行 [L28864-28882]
- 先跑商用聚合器:Accurint(LexisNexis)、TLO、Clear;付费产品 BeenVerified、Intelius、Spokeo、Pipl、WhitepagesPro [L28866-28867]。
- 政府/执法库:驾照局、犯罪记录、矫正部门、机构记录系统(可获目标照片用于核验社媒账号)[L28870][L28881]。
- 这些付费源长于:住址史、座机、雇主、室友、家人(来自信贷/水电数据);对邮箱/用户名/社媒账号效果差 [L28871]。
- 付费人搜站($15-300/月)内容其实免费都能查到,只是省时间 [L28872]。

## D. 开源研究 & 采集(核心搜索循环)[L28883-28917]
- 用自定义 OSINT 工具按已知标识符(邮箱/搜索引擎)开查;补充工具集外的站点 [L28885-28888]。
- Tab 纪律:逐 tab 完全处理后再开新 tab;不 rabbit holing(跳来跳去是新手最大错误);关掉误报 tab [L28889-28894]。
- 流程:审 Google 第一页→右键 promising 链接在新标签打开→也开图片结果 tab(快速扫目标头像/照片)→确认看完后进下一 tab [L28890-28892]。
- 快捷键:Ctrl+Tab(Windows)/Cmd+Tab(Mac)切下一 tab;+Shift 反向 [L28893]。
- 强线索(需独立整套查询的)开新窗口而非新 tab,并在笔记各建一页 [L28895-28899]。
- OneTab 标签管理:Send all tabs to OneTab→命名(如 Google Target Name)→Ctrl+F 搜索→Export/Import URLs 拷到笔记。替代:Toby、Tabs-Outliner、Workona、Graphitabs [L28908-28916]。
- 右键上下文搜索:ContextSearch 扩展(可自定义查询 URL,末尾加 {SEARCHTERMS})[L28918-28925]。

## E. 采集(证据保存)[L28990-29015]
- 按 案例→类别(如 Email Addresses)→标识符(如 ramit@...) 建文件夹层级 [L28994-28997]。
- 存图/视频时同时存所在页整页截图,证明上下文 [L29001]。
- 被动采集:Hunchly 记录源码级页面+图片,可生成取证级报告 [L29005-29015]。
- 多媒体分析:最高分辨率逐帧查看照片找意外情报(背景招牌等);链接分析(Link analysis)用图表(Draw.io)展示实体关联 [L29016-29032]。

## F. 结案 & 20分钟 vs 20天 [L29034-29050]
- 结案:转移纸笔记→归档目录→(可选)导出 VM 快照→准备新账号/换坏工具 [L29035-29038]。
- 时间压缩时流程不变但每步缩短;威胁评估(如 4chan 自杀威胁)精简版:分诊→Knoll 工具→协作(OneNote 各建页)→付费/政府库→OSINT→只开最有希望链接、快速目扫→截止前给简报 [L29040-29050]。

## G. 目标流程图(Target Flowcharts)——按标识符的深挖路径 [L29051-29054]
- 六类视图:Email / Username / Real Name / Telephone Number / Domain Name / Location。目标=拿到下一个标识符 [L29052]。
- 转化链 [L29053]:
  - Email → 找用户名和真实姓名;
  - Username → 找社交网络并验证邮箱;
  - Real Name → 找邮箱、用户名、电话;
  - Telephone → 验证姓名、找住址和亲属;
  - Domain Name → 找真实姓名和住址;
  - 每发现一条新信息,循环继续。
- 流程图下载:https://inteltechniques.com/data/osintbook11/flowcharts.zip(Draw.io 格式,可改)[L29054]。

## H. 20分钟威胁评估速查(搜索工作流示例)[L29040-29050]
- 分诊:口头确认已知标识符与期望情报。例:4chan 上用户 D1ckTraC 发帖威胁自杀,要查他真名/住址/是否可能实施 [L29042]。
- OSINT 先搜:site:4chan.org <username>(site: 操作符限定平台),再用自定义工具查已知标识符 [L29046]。
- 只开极有希望的链接,快速目扫;图片结果因大脑处理快,时间敏感评估尤其有用 [L29047]。
- 截止先给简报(如已定位并保存原始帖,该用户有类似自杀威胁史,但尚不知其身份),危机过后再补全采集/分析/报告 [L29049-29050]。

# 第 24 章 用户名搜索

## A. 用户名关联逻辑 [L17286-17287]
- 活跃网民常跨站用同一用户名(如 amanda62002 在 Myspace/Twitter 同号)[L17287]。
- 邮箱前缀常即用户名:mpulido007@gmail.com → mpulido007 做多个站点昵称;还要试 mpulido007@yahoo.com / @hotmail / @aol(老邮箱)[L17287]。

## B. 用户名批量查询服务(直接 URL 替换 inteltechniques)[L17288-17306]
- idcrawl.com/u/<user>、instantusername.com/?q=<user>、namechecker.org/#<user>、namechk.com、namevine.com、profilediscover.com、social-searcher.com、checkistan.com、usersearch.org(含 normal/advanced/advanced1/2/4/6/7/dating/forums/crypto 变体)[L17289-17306]。
- 若服务显示 taken / exists / unavailable,说明该用户名在某服务被占用,应手动深挖 [L17288]。

## C. 常见平台手动直查(URL 模板)[L17307-17320]
- x.com/<u>、facebook.com/<u>、instagram.com/<u>、tiktok.com/@<u>、tinder.com/@<u>、<u>.tumblr.com、snapchat.com/s/<u>、medium.com/@<u>、youtube.com/<u>、reddit.com/user/<u> [L17309-17320]。

## D. 搜索引擎直查用户名(URL)[L17321-17325]
- 引号强制精确:https://www.google.com/search?q=%22<user>%22、bing.com/search?q=...、yandex.com/search/?text=... [L17323-17325]。

## E. 泄露数据中的用户名(受破账号)[L17326-17333]
- Dehashed 查用户名:https://dehashed.com/search?query="<user>"(需 burner 账号)[L17328]。
- 手动查:hivebeenpwned.com、leakpeek.com、breachdirectory.org、psbdmp.ws [L17330-17333]。

## F. Gravatar & Link Tree [L17334-17339]
- Gravatar 按用户名查邮箱头像:https://en.gravatar.com/<user> [L17336]。
- Linktr.ee 聚合所有网络:https://linktr.ee/<user> [L17339]。

## G. 邮箱假设(Username→Email 猜测)[L17342-17353]
- 用用户名拼 @gmail/@yahoo/@hotmail/@protonmail/@live/@icloud/@yandex/@gmx/@mail/@mac/@me 到 HIBP/Dehashed 查(工具自动逐 tab 查询,带 setTimeout 防封)[L17344-17349]。
- 搜索引擎版(引号+OR):"IntelTechniques@gmail.com" OR "...@yahoo.com" OR ... [L17352]。

## H. Skype 用户名提取 [L17354-17355]
- 在 Skype 内按姓名/邮箱搜用户目录→结果图片→右键打开新标签→**URL 中暴露 Skype 用户名**[L17355]。

## I. 大学主页 / 个人空间(未挖掘资源)[L17356-17383]
- 大学邮箱命名规范常为 lastname.firstname@university.edu;首页用户名通常是邮箱前缀 [L17357-17359]。
- site:<大学域> <名> 找个人页;例 site:siue.edu laura → www.siue.edu/~lswanso/(~ + 首字母 + 姓前6字母)[L17360-17362]。
- 推断:Scott Golike → ~sgolike/ 与 sgolike@siue.edu [L17362-17363]。
- 毕业后学校会删内容,但 Wayback Machine 保留旧版(图例到 1997 年)[L17366-17367]。实战:靠已删学生个人页(含朋友/室友/家人/兴趣)数小时内定位嫌疑人 [L17368]。
- ISP 个人空间:home.comcast.net/<user> 等;历史主页地址:360.yahoo.com、<u>.webs.com、<u>.weebly.com、webpages.charter.net、sites.google.com、about.me、angelfire.com、geocities.com、reocities.com、<u>.tripod.com、home.earthlink.net/~<u>、home.comcast.net/~<u> [L17370-17383]。

## J. Ghunt Gmail 验证 [L17420-17422]
- gmail-osint.activetk.jp/<user> 确认 Gmail 账号,暴露资料图、最后编辑日期、Gaia ID、账号类型、游戏/地图关联 [L17421-17422]。

## K. IntelTechniques Usernames Tool [L17423-17424]
- https://inteltechniques.com/tools/Username.html,自动化上述多数技巧,需允许弹窗 [L17424]。

# 第 23 章 邮箱地址搜索

## A. 邮箱为首选搜索标识符 [L16856-16864]
- 通用姓名难搜,邮箱唯一(john.wilson.77089@yahoo.com 唯一 vs 上千 John Wilson)[L16857]。
- 先引号精确搜邮箱,再单独搜邮箱前缀(用户名部分,可能用于 Gmail/Hotmail/Twitter/LinkedIn)[L16857]。
- 直接 URL [L16858-16863]:google.com/search?q="<email>"、...q="<username>"(Bing/Yandex 同)。

## B. 邮箱验证 Emailrep.io(emailrep.io)[L16865-16872]
- 顶级免费验证,返回 JSON:reputation、suspicious、references、blacklisted、malicious_activity、credentials_leaked(是否在泄露中有密码)、data_breach、first_seen/last_seen、domain_*、free_provider、disposable(一次性)、deliverable、accept_all、valid_mx、spf_strict、dmarc_enforced、**profiles**(关联的 youtube/google/github/twitter 档案)[L16867]。
- 若查无历史 → 可能是 burner 邮箱(威胁/勒索信常用),应预期有限后续结果 [L16872]。
- Email Hippo(tools.verifyemailaddress.io):OK/BAD 快速验证,可导出,按 IP/cookie 限每日 [L16873]。

## C. 邮箱假设(Email Assumptions)[L16874-16880]
- 已知一个地址 → 猜同前缀其它域:jay112003@yahoo.com → jay112003@gmail/hotmail/live.com [L16875]。
- 已知雇主域名(如 medicaldistrict.org)且知姓名,猜:jstewart@、jay.stewart@、j.stewart@、stewartj@medicaldistrict.org [L16876-16879]。

## D. Email Format(email-format.com)[L16883-16884]
- 输入域名识别员工邮箱结构(如首字母+姓);从 Facebook/Twitter 收集姓名→生成候选邮箱→用验证器核对 [L16884]。

## E. Gravatar [L16885-16887]
- 邮箱关联头像:https://en.gravatar.com/site/check/<email>;图片可再做反向图搜 [L16887]。

## F. 受破账号查询(泄露数据)[L16888-16918]
- 泄露数据是最有效技巧(过去5年)。确认地址有效+活跃+年龄,并指出需调查的受影响服务(如 Dropbox/LinkedIn)[L16890]。
- Have I Been Pwned(haveibeenpwned.com):邮箱最可靠,列出含该邮箱的公开泄露与描述 [L16891-16892]。
- Dehashed(dehashed.com):更激进,收集自研泄露库,常有 HIBP 未见的新泄露;与 HIBP 互补,**两者应同查**;需登录免费账号,密码需付费 [L16896-16898]。
- Spycloud(spycloud.com):只显示你拥有的账号明细,勿手动查目标(会给目标发信);用 API:https://portal.spycloud.com/endpoint/enriched-stats/<email> 返回 JSON 验证 [L16899-16902]。
- Hudson Rock(hudsonrock.com):查 stealer log(窃密日志)中是否出现邮箱(说明电脑被病毒攻破):https://cavalier.hudsonrock.com/api/json/v2/preview/search-by-login/osint-tools?email=<email> [L16913-16915]。
- Cybernews(cybernews.com/personal-data-leak-check):true/false 验证:https://check.cybernews.com/chk/?lang=en_US&e=<email> [L16916-16918]。

## G. 密码查看(谨慎)[L16919-16932]
- Leak Peek(leakpeek.com):80亿凭据,显示部分密码(55Ji*****);可查邮箱/用户名/密码/关键词/域名 [L16921-16925]。
- Breach Directory(breachdirectory.org):SHA-1 哈希密码,可经 md5decrypt.net/en/Sha1 解密得明文(例 Ex7layer)[L16926-16932]。

## H. PSBDMP(监控 Pastebin)[L16935-16966]
- 监视 Pastebin 上含邮箱/密码的帖子:https://psbdmp.ws/api/search/<email> 返回 JSON(id= Pastebin 标识,可拼 https://pastebin.com/<id> 看全文)[L16936-16944]。
- 可搜密码:https://psbdmp.ws/api/search/password1234 [L16953]。
- 经 Google 搜:site:psbdmp.ws "test@gmail.com"(索引到已删 Pastebin 内容)[L16960]。
- 已被 Pastebin 删除的数据,psbdmp.ws API 仍保留存档 [L16963]。

## I. IntelligenceX / LeakIX(intelx.io / leakix.net)[L16967-16969]
- IntelligenceX 免费/试用可用,不推荐付费(本书工具可免费复现)[L16967-16968]。

# 第 18-22 章 社交网络搜索(site: 操作符与平台方法)

## 通用原则:site: 操作符搜封闭平台 [L15756][L16798 等]
- 平台内搜索受限时,用搜索引擎的 site: 操作符搜其档案/内容。例:site:linkedin.com "Account Executive at Uber"、site:facebook.com <name>、site:amazon.com <name>(搜用户资料+产品评价)[L16800 段]。
- 该方法可应用于几乎所有禁止档案搜索的网站:site:targetwebsite.com John Doe [L16798]。

## 各平台 site: 查询速查
- **X/Twitter**:site:twitter.com/<user>/status(强制只给实际推文直链,配缓存看已删推)[L14353]。
- **多平台同时**:site:threads.net OR site:bsky.app OR site:mastodon.social OR site:instagram.com "techpod"(用 OR 跨平台)[L14406 附近]。
- **Instagram**:site:instagram.com "OSINT";site:instagram.com "<user>" "<keyword>"(精确词追单帖);site:instagram.com "hak5darren" "pager" [L14901][L15195 附近]。
- **跨平台关联(Instagram→Twitter)**:site:x.com "<user>" "instagram.com/p"(找转播的推+Instagram 图片 URL)[L15256 附近]。
- **Threads**:site:threads.net/@"accountname"、site:threads.net/"keyword" [L15349 附近]。
- **TikTok**:site:tiktok.com osint [L15365 后]。
- **LinkedIn**:site:linkedin.com <name> <公司> <职位> <地点>;site:linkedin.com john smith.microsoft(内部域).微软任职示例:site:www.linkedin.com john smith microsoft manager Oklahoma [L15752-15862]。
- **LinkedIn 图片/视频限定 URL**:https://www.google.com/search?q=site:linkedin.com+john+smith&tbm=isch(图片)与 &tbm=vid(视频)[L15842 附近]。
- **Snapchat**:site:snapchat.com "<term>" [L15888]。
- **Tumblr**:site:tumblr.com "osint";https://www.tumblr.com/tagged/osint;https://<user>.tumblr.com/search/osint [L15947-15969]。
- **Telegram**:site:telegram.me "osint"(2620)、site:t.me "osint"(22)、site:telegra.ph "osint"(255)、site:t.me/joinchat "osint"(群组)[L15989 附近]。
- **VK/Odnoklassniki(俄)**:site:ok.ru michael smith;OK 档案右上方显示最后登录日期,多数资料公开 [L16031 附近]。
- **Qzone(中)**:site:user.qzone.qq.com <name>;也可用百度;密码恢复页 accounts.qq.com/psw/find 可查邮箱(会通知账号持有者)[L16039 附近]。
- **Parler**:site:parler.com "keyword" [L16442 前]。
- **Gab**:site:gab.com osint;点 Google 结果的 About the source → More about this page → See previous versions on Wayback Machine 恢复旧帖/删帖 [L16442 前]。
- **GETTR**:site:gettr.com "osint" [L16442 前]。
- **Reddit**:reddit.com/search?q=site:inteltechniques.com;site:reddit.com "surveillance";site:reddit.com/r/osint "surveillance";site:reddit.com/user/<user> "surveillance";第三方 API:https://api.pullpush.io/reddit/search/comment/?author=<user> [L16198-16268]。
- **4chan**:site:4chan.org OSINT(URL:https://www.google.com/search?q=site:4chan.org%20OSINT)[L16442 附近]。
- **Hacker News**:site:news.ycombinator.com OSINT [L16454 附近]。
- **Meetup**:site:meetup.com "michael.smith";事件:site:meetup.com inurl:events Protest;讨论:site:meetup.com inurl:discussions Protest;site:meetup.com OSINT [L16484 附近]。
- **Craigslist(含已删帖)**:site:craigslist.org laptop Edwardsville(572 结果,含已删帖);区域限定:site:stlouis.craigslist.org laptop Edwardsville [L16772 附近]。
- **Pinterest**:site:pinterest.com CRAFTS(URL:https://www.google.com/search?q=site:pinterest.com+CRAFTS)[L16824 附近]。
- **亚马逊**:site:amazon.com <name>(用户资料+产品评价)[L16800 附近]。
- **Discord**:disboard.org/server/join/<id>(服务器邀请)[L16586 附近]。
- **Dating 站**:dating 站用 site: 操作符+姓名搜(如 site:okcupid.com <name>)[L16502 附近]。

## 平台内搜索补充
- **Instagram**:平台内搜索极有限,Google 是最佳补充;发布者常在 Twitter 转播,故检查 Twitter [L15255 附近]。
- **Reddit Old View**:reddit.com/search?q=<term> 后可切回旧视图改善结果 [L16242]。
- **论坛/评论**:"osint" "disqus" "comments"(跨站评论搜索)[L16720]。

# 第 18 章 社交网络: Facebook 搜索

## 背景 [L13419-13428]
- 2019-2022 许多 FB Graph 搜索技巧失效/回归/再失效;本章部分技巧可能已过时,但仍有稳定搜索 [L13419-13427]。

## A. 官方搜索:关键字 + 过滤器 [L13429-13435]
- 两段式:KEYWORD(通用词/姓名/地点/实体)+ FILTER(排除无关)。FB 用户用真名,按姓名搜会有一堆同名 [L13430-13433]。
- 用左栏过滤器收窄:朋友/地点/高中/雇主等。例:搜 Tom Johnson 芝加哥+Vashon High+Foot Locker → 只剩1个 [L13434-13435]。

## B. 直链 URL(用户名/档案页)[L13452-13489]
- 档案页 https://www.facebook.com/<username> 的子页(例 /mike/):/about、/about?section=work|education|living|contact-info|basic-info|relationship|family|bio|year-overviews、/friends、/following、/photos、/photos_albums、/videos、/reels、/places_visited、/map、/places_recent、/sports、/music、/movies、/tv、/books、/games、/likes、/events、/did_you_know、/reviews、/reviews_given、/reviews_written、/place_reviews_written [L13457-13489]。

## C. 搜索类型直链(关键字 osint 示例)[L13494-13506]
- 全类 /search/top/?q=<term>;Posts /search/posts/?q=;People /search/people/?q=;Photos /search/photos/?q=;Videos /search/videos/?q=;Marketplace /marketplace/category/search/?query=;Pages /search/pages/?q=;Places /search/places/?q=;Groups /search/groups/?q=;Events /search/events/?q=;Links /search/links/?q=;Watch /watch/search/?q= [L13495-13506]。
- 长页用空格键连续加载到底(避免自动化脚本触发 FB 封号)[L13533]。

## D. 用户 ID 提取(进阶)[L13535-13544]
- 右键档案页→View Page Source→搜 "userID"(如 Zuck 的 "userID":"4")。注意自己账号 ID 也会出现,需先记自己的 [L13537-13539]。
- 2019 前 Graph API(graph.代替www)已失效;findidfb.com 可尝试自动转换(不可依赖)[L13536][L13541]。

## E. Base64 编码查询 [L13544-13551]
- 部分 FB 查询(尤其用用户 ID 时)需 Base64 编码参数。URL 结构:https://www.facebook.com/search/posts/?q=<type>&epa=FILTERS&filters=[L13546]。
- 数据格式 {"rp_author":"{"name":"author","args":"[USERID]"}"} 转 Base64(codebeautify.org/base64-encode)[L13549-13551]。

# 附录A: 操作符速查表(全书汇总)

## 通用搜索引擎操作符(Google/Bing/DDG/Startpage)
- 引号 "..." :精确短语。例:"Cisco Confidential" filetype:pptx [L12410]
- 连字符 - :排除词(-后无空格)。例:"Michael Bazzell" -police -FBI -osint [L12442-12444]
- filetype: :限文件类型。例:"Cisco" filetype:ppt / filetype:pptx [L12403]
- ext: :自定义搜索引擎里同义。例:ext:pdf、ext:doc OR ext:docx [L12569]
- site: :限域名。例:site:linkedin.com "Account Executive at Uber" [L12412][L15756]
- inurl: :限 URL。例:inurl:ftp -inurl:(http|https) "confidential" [L12453][L13218]
- intitle: :限页面标题。例:intitle:"osint video training";intitle:index.of OSINT(在线文件夹)[L12463][L12468]
- allintitle: :标题含所有词任意顺序。例:allintitle:training osint video [L12465]
- OR(大写):A 或 B。例:"Michael Bazzell" OR "Mike Bazzell" [L12477]
- *(星号):通配一个或多个词。例:"osint * training" [L12481]
- ..(范围):数字/年份区间。例:2015..2018;"1..999 comments" [L12484]
- related: :找相关域/关联站点。例:related:inteltechniques.com [L12487]
- cache: :已由 Google 移除;改用 webcache.googleusercontent.com/search?q=cache:<URL> [L12652]
- &tbs=cdr:1,cd_min:1/1/0 :Google URL 追加,强制结果显示日期 [L12523]

## Twitter/X 操作符
- from:<user> 发出的;to:<user> 发给的;@mention 提及 [L14242][L14244][L14221]
- filter:replies 回复;-filter:replies 非回复;filter:links 含链接 [L14249-14251][L14270]
- min_faves:<n> 至少n赞;min_replies:<n> 至少n回复 [L14272-14274]
- since:<date> until:<date> 日期范围(YYYY-MM-DD)[L14305]
- geocode:<lat>,<lon>,<radius> 地理搜索(km/mi)[L14283]
- url:<domain> 含指定域名链接 [L14296]
- 组合例:to:X from:Y since:2022-10-01 until:2022-10-31 filter:links filter:replies [L14279]

## 搜索工作流核心循环(从标识符出发)
- 转换链:Email→用户名/真名;用户名→社媒+验证邮箱;真名→邮箱/用户名/电话;电话→姓名/地址/亲属;域名→真名/地址;每步产出新标识符继续 [L29053]。
- 标准顺序:付费/政府库先行→Google 关键词→site: 限定平台→自定义工具按标识符批量查→缓存/Wayback 查变更与删帖→泄露数据验证。

# 附录B: 人搜引擎清单(Ch25,据章节树)[L17568-18022]
- True People Search(truepeoplesearch.com)、Fast People Search、Open Data USA(usa-official.com)、Spytox、Search People Free、Spokeo、Advanced Background Checks、People Search Now、White Pages、Official USA(officialusa.com)、Addresses(addresses.com)、ID Crawl(idcrawl.com)、Classmates、Ripoff Report、Find a Grave、Google、Skopenow(付费)[L17574-18012]。

# 覆盖章节索引
- Ch16 自定义搜索工具(Custom Search Tools)[L11875]
- Ch17 搜索引擎(SEARCH ENGINES)——操作符+平台核心 [L12380]
- Ch18 Facebook [L13418]
- Ch19 X/Twitter [L14204]
- Ch20 Instagram [L14893]
- Ch21 TikTok [L15365]
- Ch22 在线社区 [L15572]
- Ch23 邮箱地址 [L16856]
- Ch24 用户名 [L17286]
- Ch25 人搜引擎 [L17568]
- Ch45 方法论与工作流 [L28824]
