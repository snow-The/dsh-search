# Search Methodology(Books) — dsh-search

> 从 3 本专业书籍提取的搜索方法论,已融入 dsh-search 的工具设计。完整提取见各 book-*.md(带原书行号引用 [L####],OCR 转录)。

## 目录
- [book-osint-techniques.md](./book-osint-techniques.md) — OSINT Techniques 11th(操作符/平台/工作流,110+ 条)
- [book-ai-powered-search.md](./book-ai-powered-search.md) — AI-Powered Search(引擎架构/语义搜索/混合检索,138 条)
- [book-bellingcat.md](./book-bellingcat.md) — We Are Bellingcat(调查验证工作流,70+ 条)

## 1. 搜索操作符速查(OSINT 11th,Ch17/19)

### Google 高级操作符
| 操作符 | 含义 | 示例 |
|---|---|---|
| `"..."` | 精确短语 | `"Cisco Confidential" filetype:pptx` |
| `filetype:` | 限定文件类型 | `filetype:pdf site:example.com` |
| `-word` | 排除(与词间无空格) | `-police -FBI -osint`(逐步收敛) |
| `inurl:` | 只匹配 URL | `inurl:ftp -inurl:(http|https) filetype:pdf` |
| `intitle:`/`allintitle:` | 只匹配标题 | `intitle:index.of OSINT`(公开目录) |
| `OR`(大写) | 或 | `"Michael Bazzell" OR "Mike Bazzell"` |
| `*` | 通配符 | `osint * training` |
| `A..B` | 范围 | `2015..2018`、`"1..999 comments"` |
| `related:` | 相关站点 | `related:inteltechniques.com` |
| 日期过滤 | 时间范围 | URL 追加 `&tbs=cdr:1,cd_min:1/1/0` 强制显示日期 |

### X/Twitter 操作符
`from:` `to:` `@mention` `filter:replies|links` `min_faves:` `min_replies:` `since:` `until:` `geocode:` `url:` — 删推恢复:`site:twitter.com/user/status` + Wayback

### 工作流要点
- 结果过多 → 缓慢叠加排除词收敛到可分析规模
- 无结果时加一个关键字常比纯操作符查询更多
- 自定义引擎(Programmable Search Engine):按平台建 tab + `ext:` 细化文件类型
- 目标转化链:Email → Username → RealName → Phone → Domain → Location
- 20 分钟威胁评估 + intake→Triage→Knolling→采集→报告 工作流(Ch45)

## 2. 引擎架构(AI-Powered Search)

### 信号 boosting(Ch8)
- 信号类型强弱:click(1) < add-to-cart(10) < purchase(25);负信号:skip/remove/return/负面评价
- 归一化:小写/去空白/词干 — 同查询聚合越充分信号越强(ipad 1050→2939)
- 反 spam:用户级去重(user/session/browser/IP/指纹),易伪造信号(点击)vs 难伪造(支付)
- 时间衰减:半衰期 `w * 0.5^(age/half_life)`;`target_date` 支持季节模式
- index-time vs query-time:query-time 灵活但翻页慢+两次查询;index-time 快但改权重需重索引

### 语义搜索(Ch13)
- chunking 三张力:查询粒度 / 语义单元 / 索引成本;embedding scope 决定查询语义
- ANN:HNSW / LSH / IVF 三类;相似度阈值需按分布选,过低召回噪声过高漏
- 量化:saclar → binary → product;MRL(Matryoshka)降维保留层级语义
- cross-encoder 精度高但贵 → 用作二阶段重排;bi-encoder 快 → 一阶段召回

### 混合搜索与 RAG(Ch15)
- **RRF(Reciprocal Rank Fusion)**:score = Σ 1/(k + rank_i),k 常用 60;多路结果按排名融合,无需分数归一
- retriever-reader 模式(Ch14):检索器召回 → reader 推理 span → 重排 → 合并返回
- RAG:检索 + 生成,chunking 是质量关键;agent-based search 可编排多步检索

## 3. 开源调查工作流(Bellingcat)
- 箴言:Identify → Verify → Amplify;"人们想展示的并非他们透露的全部"
- 验证三件套:地理定位(地标匹配→多图拼接→阴影测时 SunCalc→Google Earth 时间滑块)、时间线(时区陷阱:YouTube 时间戳按服务器所在地)、来源交叉(多站独立核实)
- 武器/装备识别:特征匹配 + 排除法 + 尺寸测量反推型号
- 反侦察:钓鱼攻击、SIM 换卡;反信息:网络图分析、deepfake 信息脉络验证

## 4. 与 dsh-search 工具的对应
| 方法论 | dsh-search 工具 |
|---|---|
| GitHub 内部搜索(repo/code/issue/commit + qualifiers) | `search_github` |
| 页面正文提取(去导航/去噪) | `search_fetch` |
| 本地语料语义检索(chunking/embedding/向量) | `search_corpus_*` |
| 多路结果排名融合(未来) | RRF 算法可直接落 corpus search |
