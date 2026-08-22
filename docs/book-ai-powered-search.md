---
source: AI-Powered Search (Manning, Grainger·Turnbull·Irwin)
ocr: PaddleOCR-VL-1.6
extracted_at: 2026-08-22T21:07:58.979Z
---

## 搜索方法论提取(操作符/平台/工作流/架构要点,每条带行号引用 [L####])

# 第 8 章 Signals-boosting 模型(信号 boosting)

## 8.1 基础信号 boosting
- Signals-boosting 模型聚合每查询每文档上的用户行为信号(如点击),把点击数作为该文档在该查询下的 relevance boost。头部查询(head queries)贡献更多信号,可作更强推断。[L7566-7590]
- 基础模型:对某查询每个被点过的文档,boost = 该文档在该查询下的历史点击数。[L7600-7604]

## 8.2 信号归一化
- 用户查询任意文本,聚合信号天然嘈杂;不归一化时查询变体会被当作不同查询,稀释信号价值。[L7616-7628]
- 归一化手段:小写化(case-insensitive)、去空白/多余字符、词干化(stemming)、大小写与字母-数字边界切分。[L7632-7640]
- 例:LOWER(q.target) 后同查询聚合;小写后 "ipad" 从 1050 合并为 2939。[L7664-7700]
- 关键结论:同一查询被当作同一查询聚合得越充分,信号模型越强。[L7700-7704]

## 8.3 对抗信号 spam
- 众包信号(点击)可被操纵:恶意用户刷 5000 次查询+点击即可把垃圾文档推到首位。[L7735-7820]
- 反 spam 手段 1 — 用户级去重:每个用户对每个 query/doc 对只记一次投票,5000 次点击归 1。[L7836-7900]
- 去重键可为 user id / session id / browser id / IP / 浏览器指纹;也可只采用已认证用户信号。[L7900-7910]
- 反 spam 手段 2 — 区分易伪造信号(查询/点击)与难伪造信号(购买需登录/支付)。[L7910-7924]

## 8.4 组合多种信号类型
- 信号类型:query、click、add-to-cart、purchase。购买比加购强、加购比点击强。[L7959-7970]
- 加权和:signals_boost = (1*click) + (10*add_to_cart) + (25*purchase);权重可配置,依领域调整。[L7972-7990]
- 负向信号(负加权):skipped_doc(-0.025)、remove_from_cart(-20)、returned_item(-100)、负面评价(-50)。[L8026-8040]
- 权重调参可手工或交给 learning to rank(ch10/11)。[L8040-8045]

## 8.5 时间衰减与短生命周期信号
- 信号是滞后指标(lagging indicator),随时间老化价值下降。[L8080]
- 三种用例对比:电商(长期稳定文档,等权即可)、招聘(30天短命文档,等权但需快速处理)、新闻(信号价值随时间快速衰减)。[L8068-8090]
- 时间敏感信号用半衰期(decay)函数:weight = starting_weight * 0.5^(signal_age/half_life)。[L8094-8100]
- half-life 越长信号保持 boost 越久;30/60/120 天半衰期在 6-12 月内有效折损旧信号。[L8120-8130]
- target_date 参数:该日期的信号权重为满值 1,更早按半衰期衰减,更晚被过滤。支持季节模式(节日/季节性查询)。[L8140-8160]

## 8.6 Index-time vs query-time boosting(规模 vs 灵活性权衡)
- query-time:主索引与 signals_boosts 旁路集合分离;每次查询=两步(先查 boost 集合,再改查询)。[L8169-8178]
  - 优点:可按查询增量更新、易开关、可随时换算法、易接实时信号与实验。[L8180-8190]
  - 缺点:多一次查找(两次搜索+延迟);boost 数量与分页冲突(第2页需 20 boost,第10页 100 boost,越翻越慢甚至超时);结果并非严格按 boost 排序导致翻页重排/重复。[L8193-8260]
- index-time:把"热门查询"连同 boost 值写入每个文档的 signals_boosts 字段,查询时按字段匹配自动 boost。[L8267-8280]
  - 例(solr):signals_boosts = "ipad|2939,ipad 2|1104,...";DelimitedPayloadBoostFilter;查询翻译为 payload("signals_boosts","ipad",1,"first")。[L8285-8330]
  - 优点:单次关键词查询更快、boost 数量增大仍高效、分页无问题、所有匹配文档一致 boost。[L8330-8345]
  - 缺点:改一个关键词需重索引该关键词全部文档;改权重需重建新字段+全量重索引+切换查询。[L8345-8360]
- 分离关注点:高吞吐索引时,把 indexing servers 与 query servers 隔离。Elasticsearch/OpenSearch 用 follower index, Solr 用不同 replica 类型(NRT→TLOG/PULL);三者均有 shard(分区)+ replica(副本),每 shard 有 leader 转发更新。[L8360-8380]

## 第 8 章术语
- 头部查询 head queries;信号 boosting signals boosting;半衰期 half-life / decay function;index-time / query-time boosting;NRT/TLOG/PULL replica;follower index;shard/replica/leader

# 第 13 章 语义搜索(dense vector / 语义搜索)

## 13.2 用 dense vector 搜索
- KNN(向量最近邻搜索):把统一维度的数值向量索引进数据结构,用查询向量搜索最近的 k 个向量。相似度度量:cosine、dot product、欧氏距离等;本章统一用 cosine(unit-normalized 向量上的 dot product)。[L14200-14240]
- 稀疏向量搜索用倒排索引(inverted index):token 化+归一化,构建词→postings(文档id+位置)的稀疏向量。[L14208-14220]
- 稀疏模型的局限:query-term dependence——按字符串出现/计数检索,不按含义;相关性分仅相对可用,不可跨查询比较。[L14230-14240]
- dense 流程:文档→embedding 存索引;查询→embedding 检索最近文档。文档与查询 embedding 必须在同一向量空间(否则 apple 对 orange)。[L14250-14290]
- **chunking/embedding scope**:embedding 可表示词/句/段/整文档;通常把大文档按句/段/概念边界切块,可做重叠 chunk 避免切裂上下文。[L14300-14320]
  - 若引擎支持多值向量字段,可把多个 embedding 索引进单一文档按任一匹配;或每 chunk 独立文档并保存原文档 id 字段返回。[L14310-14320]
  - chunk 粒度权衡:太大难完整表示、太小缺上下文;选对粒度提升 recall。[L14320-14325]
- **unit-normalize 优化**:cos = (a·b)/(|a|×|b|);若向量长度归一为 1,则 cos = dot product。dot product 比 cos 快得多(无需算模长的平方根)。索引时 unit-normalize 文档向量,查询时 dot product——生产环境几乎总是这么做。[L14330-14395]
- 向量搜索性能/成本优化 4 招(预告):ANN 过滤 top-N;量化压缩向量;MRL 只索引/搜索部分维度;over-request + 更贵的相似度 rerank。[L14400-14420]

## 13.3 Transformer encoder 生成 embedding
- Transformer:一类深度网络,编码(把词/句编码为 dense 向量)+解码。文本 Transformer 用周围上下文(attention)表示词的稠密向量。[L14363-14400]
- 训练用 masked language modeling(Cloze test):随机去掉 15% token,模型用上下文预测,优化更高成功率。初始可用 word2vec/GloVe embedding。[L14420-14440]
- tokenizer→word pieces;BERT 词汇表 3 万 word pieces,特殊 piece [CLS]/[SEP] 表句首句尾;encoder 输出每 token 一个向量的 tensor。[L14440-14450]
- 预训练模型几百 MB~几百 GB,通常用预训练模型而非从零训练。[L14452-14460]

## 13.4 应用 Transformer 到搜索
- 架构:content→tokenizer→encoder→embeddings index;查询→tokenize→encode→向量→索引检索→最近邻结果。[L14490-14520]
- 用 Stack Exchange outdoors 数据集;文档分 question/answer,answer 经 parent_id 关联问题,accepted_answer_id 标记采纳答案;metadata(view_count 等)可混合 BM25 作相关性。[L14520-14590]
- 词法搜索局限:查询 "What is DEET?" 返回的都是 "What is ..." 的问题(仅字符串匹配,不理解含义)。[L14590-14630]
- 微调 fine-tuning:预训练模型一般未针对特定任务调优,需用任务数据(如 STS-B 语义文本相似度基准)微调。[L14630-14660]
- **SBERT (Sentence-BERT)**:把句子的全部 BERT embedding pooling(如 mean-tokens)成单个向量,针对句子间相似度训练。模型 roberta-base-nli-stsb-mean-tokens → 每句 768 维 embedding。[L14660-14700]
- 语义相似度排序:normalize 后 dot_score,复杂度 O(n²)(100 句→100×100)。[L14700-14760]
- 结果: "it's raining hard" 与 "it is wet outside" 最相似(0.669),cars/motorcycles 一组(0.59)——dense 表示捕获了含义。[L14760-14770]

## 13.5 自然语言自动补全 + ANN
- 自动补全:对术语构建 embedding 索引,查询 prefix 也过同一 encoder,取最近邻,相似度≥阈值才返回建议。[L14770-14800]
- **ANN(近似最近邻)**:避免查询时对全部文档算相似度。牺牲少量精度换取对数级计算复杂度+内存/空间效率。类似 dense 搜索的"倒排索引"。[L15273-15300]
- **HNSW(Hierarchical Navigable Small World)图**:分层的邻近图,把相似向量聚类,构建多层结构;查询时从最佳聚类入口搜索。recall/吞吐平衡好,当前最流行之一。[L15300-15320]
- 其他 ANN 方法:
  - **LSH(locality-sensitive hashing)**:把向量空间分 hash 桶,每向量哈希进一桶。recall 通常低于 HNSW;LSH 桶与数据无关(data-independent),利于分布式系统预先分片(sharding)。[L15320-15330]
  - 另见 13.7 的 product quantization、IVF(inverted file index)。[L15330-15340]
- HNSW 实现库:NMSLIB;Apache Lucene dense vector field 原生支持 HNSW(Solr/OpenSearch/Elasticsearch/MongoDB Atlas);Vespa.ai/Weaviate/Milvus 等也有。[L15340-15360]
- **相似度阈值选择**:依据 embedding 相似度分布(大部分 pair 不相似)选一个高阈值(如 0.6/0.75);用真实用户查询调优。例:min_similarity=0.75 返回高置信度建议。[L15345-15360, 15400]
- 语义自动补全:接受任意前缀(即使不在词典),过 encoder 得 embedding,再 ANN 检索;还可返回 hyponym(下位词)建议(如 bag 的 bag ratings/bag cover/tea bags)。[L15360-15390]

## 13.6 用 LLM embedding 做语义搜索
- 对文档标题批量生成 embedding→NMSLIB/引擎索引;查询→encode→检索最近邻标题。[L15440-15500]
- 引擎内置向量搜索(collection 接口):查询字段 title_embedding,quantization_size=FLOAT32;与 NMSLIB 手写结果一致。[L15500-15540]
- 生产建议:除非高度定制,否则用搜索引擎内置可扩展 dense vector 支持,而非本地 NMSLIB/FAISS/NumPy。[L15540-15550]
- **reranking**:把 min_similarity 调低(增 recall)、k 调大(如 250)作 rerank 窗口,再用 dot product 精确 rerank;或把 dense 相似度作为特征放进 learning-to-rank。[L15550-15570]
- dense 与词法互补,混合(hybrid)通常更好;dense 未来可能取代 BM25 成主流检索手段。[L15570-15580]

## 13.7 量化与表示学习(高效向量搜索)
- 量化:减少向量数值表示位数,压缩内存+加速,牺牲少量 recall。Float32(32bit/4字节/特征);1024 维≈4KB/向量。[L15589-15610]
- **标量量化 scalar quantization**:每维独立映射到低精度(Int8=8bit,可省 75% 内存;Float16/Int4 等)。常配 clamp 限值+按原值密度映射。[L15681-15720]
  - FAISS 基准(Int8):index 75% 缩小、搜索提速、recall 0.9289;top-50 over-request + 全精度 rerank → reranked recall 1.0。[L15788-15890]
- **二值量化 binary quantization**:每维 1 bit(0/1),类似黑白图。简单阈值(feature>0→1)或非均匀/中值阈值或模型学到的二值表示(考虑全局上下文,最佳)。[L15888-15990]
- **乘积量化 product quantization (PQ)**:控制索引大小与 recall 权衡,尤其需大幅压缩时。基于聚类/哈希。(细节在 spill 文件)[L15993-16080]
- **MRL (Matryoshka Representation Learning)**:在单一 embedding 内编码多层精度,靠不同维数范围表示;截断后半维即可得低精度近似(如 1/2→recall 0.70,1/4→0.48,1/8→0.25)。无需特殊索引,可直接截断 dense 向量字段维数。[L16082-16180]
- **组合优化**(listing 13.27):ANN(IVF)+binary 量化+MRL(1/2 维)+rerank(2×):搜索快 ~99%、index 小 ~98%、rerank 后 recall 0.7244。[L16227-16290]
- 引擎内量化:collection 接口支持 quantization_size 参数(FLOAT32/INT8/BINARY),rerank_query 段配置初检+rerank_count。例:BINARY 初检 top50 → FLOAT32 rerank 返回 top25。[L16290-16320]

## 13.8 Cross-encoder vs bi-encoder
- **bi-encoder**:分别编码 query 和 doc 为 embedding,再比较(cosine)。查询时只需编码 query 一次,支持高吞吐匹配/排序。[L16310-16330]
- **cross-encoder**:把 query+doc 拼接一起编码,直接输出相似度分数;通过 attention 捕获 query 与 doc 的共享上下文(如区分 "mountain hike" 与 "first time snow hiking")。更准但查询时更贵(每对都要重算)。[L16330-16360]
- 选择:bi-encoder 用于高容量初检/排序;cross-encoder 用于对 bi-encoder 或词法搜索的 top 少量结果 rerank。cross-encoder 本质是 ranking classifier(同 learning-to-rank)。[L16360-16390]
- **推荐组合流程**:①ANN+量化+MRL 快速初检;②对 top 数百/千用磁盘高精度向量 rerank;③对 top 一两页用 cross-encoder 最终精排。[L16390-16410]
- cross-encoder 是最常见的 LTR 模型类型(专注内容),无需显式特征,可微调也可直接用预训练。[L16410-16420]

## 第 13 章术语
- 稀疏向量 sparse vector / 倒排索引 inverted index / postings;BM25;KNN / 最近邻;embedding;chunking;unit-normalize;Transformer / BERT / RoBERTa / SBERT;fine-tuning;STS-B;ANN;HNSW;LSH;NMSLIB;FAISS;IVF;标量/二值/乘积量化;MRL;bi-encoder / cross-encoder;rerank

# 第 14 章 Retriever-Reader 模式(抽取式问答)

## 14.1 问答概述
- 问答两种类型:**extractive(抽取式)**——从文档中找出答案的精确片段(本章重点);**abstractive(生成式)**——生成式总结多文档或直接从 LLM 生成(ch15)。[L16489-16500]
- 支持单从句 who/what/when/where/why/how 问题。[L16500-16510]
- **抽取式机制**:模型对每个 token 学习两个概率质量函数(PMF)——一个表示 token 是答案起点的概率、一个表示 token 是答案终点的概率。起点 PMF 最高的 token 与终点 PMF 最高的 token 之间的连续片段即答案 span。[L16530-16590]
  - 例:模型 deepset/roberta-base-squad2(question+context 一起 tokenize/encode,输出 start_logits 与 end_logits,各与 token 数相同)。[L16590-16660]
  - 答案提取:设定最小/最大 span 大小,对每个 span 算概率,取概率最高者为答案。[L16660-16670]

## 14.1.2 Retriever-reader 模式
- 核心思想:不需要对全语料逐 span 算概率。用已有的快速检索(搜索引擎)拿到可能含答案的文档,再让 reader 读这些文档找出答案——像一个"自动参考图书管理员/高亮器"。[L16673-16700]
- **两个组件**:
  - **Retriever(检索器)**:对查询跑搜索引擎,检索并排序候选文档(高召回)。可用 BM25 词法引擎,也可换成 dense vector 索引(ch13)。[L16700-16740]
  - **Reader(阅读器)**:读最相关文档的 spans,抽取最可能答案;输出 start/end 概率,提取答案 span 及其分数。[L16740-16760]
- **Reader 作为 reranker**:用 reader 的置信度(概率质量值)做重排;若检索阶段不确定哪篇最可能,让 reader 看一批文档(重排窗口,如 3-5 篇)挑最佳答案。[L16720-16740]
- 限制 reader 窗口(3/5)避免实时分析太慢;因此检索器必须非常准——top-5 窗口内没有相关候选,reader 无从工作。[L16740-16750]
- 完整流程(figure 14.4):①用问题查询检索器;②引擎匹配排序取 top-k 文档;③问题与每个 top-k context 配对进 QA pipeline;④tokenize/encode,reader 预测 top-n 最可能答案 span 及概率;⑤reranker 按概率降序排序;⑥最高分 span 作为答案展示。[L16740-16800]
- 构建问答应用 5 步:设检索器→整理标注数据(silver set 自动+golden set 人工校正)→理解数据结构→微调模型→查询时用模型作 reader。[L16750-16780]
- retriever/reader 两个关注点分离,可独立替换。[L16730]

## 14.5 整合 retriever 到搜索引擎(reranking 流程)
- 4 步:①查询高召回检索集合;②问题+top-K 文档配对,用 QA 推理 pipeline 推断答案与分数;③按分数降序重排答案;④返回答案与 top 结果。[L18121-18140]
- **14.5.1 检索器(recall 优先)**:用 spaCy 词性标注去掉 stop words/标点(who/what/where 等噪音),把问题转成查询词;查询 body 字段,filter post_type=answer,limit=5,返回候选文档。[L18140-18200]
- **14.5.2 reader**:对每个 context 用微调 QA pipeline(qa_nlp(question, context))抽答案,附加 id/url/score。[L18200-18220]
- **14.5.3 reranker**:按 score(reader 的 PMF 输出)降序排序,取 top 为答案;可展示单个或多个答案;多 context 返回相同答案是正确答案的强信号,可整合进重排。[L18220-18250]
- **14.5.4 组装 ask()**:retriever→reader→reranker。示例答案带置信度(如 "1116 DEET (0.606)")。[L18250-18290]
- 术语:extractive/abstractive QA;span;PMF(概率质量函数);logits;retriever-reader pattern;rerank window;silver set / golden set;reader 置信度作 rerank score

## 第 14 章术语
- extractive / abstractive QA;retriever / reader / reranker;answer span;start/end token probabilities;PMF;silver set(自动标注)/ golden set(人工校正);fine-tune;SQuAD

# 第 15 章 混合搜索 / RAG / agent-based 搜索

## 15.2.1 Retrieval Augmented Generation (RAG)
- **RAG 定义**:用搜索引擎或向量数据库找到相关文档,作为 context 提供给 LLM 的工作流。搜索是 RAG 的"检索"部分,生成式模型是"生成"部分。[L18481-18490]
- 动机:LLM 训练是对训练数据的 lossy compression(有损压缩),无法忠实存全部数据;且知识停留在训练时点,需持续更新的外部数据源。[L18490-18500]
- **RAG 流程**:文档→切成 sections(chunks)→每 section 索引进搜索引擎/向量库;生成时,应用为 LLM 创建查询找补充信息→生成查询 embedding→dense vector 搜索(cosine/dot product)找最高分 sections→把排序后的 sections+prompt 传给生成式模型。[L18500-18520]
- **chunking 的三方张力**:
  1. 向量库限制——很多向量库单向量索引,整文档一个向量会丢失细节/上下文(变成模糊 summary embedding)。[L18520-18530]
  2. 独立 chunk 间上下文丢失——切成多文档会丢跨 chunk 共享上下文。[L18530-18540]
  3. 大量 chunk 的计算复杂度——chunk 越多向量越多,索引/搜索越贵越慢;跨 chunk 匹配权重难以管理。[L18540-18550]
  - 用 ANN 可缓解计算复杂度;但跨 chunk 上下文丢失仍存问题,无界重叠 chunk 反而浪费。支持多值向量字段的引擎(Vespa/Qdrant)可做重叠 chunk 保留上下文;未来多向量支持将成标准(支撑 ColBERT 类 late interaction)。[L18550-18570]
- **RAG 现状/未来**:当前 RAG 实现过度依赖 LLM+向量相似度,忽略本书其它检索技术;对 user intent 三维:content context 处理较好(非逐关键词)、domain context 取决于微调、**user context 通常完全忽略**。[L18570-18590]
- 有前景方向:**contextualized late interaction**(每 token 一个 embedding,且 token embedding 用整个文档上下文)——如 ColBERT/ColBERTv2/ColPali,避免跨 chunk 上下文丢失、免去无界 chunk 索引。预计显著提升 recall。[L18590-18620]
- 结果摘要(RAG 应用):搜索引擎+基础模型结合,先检索再让模型总结+引用;可用 "Be concise" 等指令调质量。幻觉(hallucination)问题——模型输出可能捏造事实,须可验证来源。[L18600-18650]

## 15.4.2 Agent-based search
- **agent-based search**:给搜索引擎/AI 接口一个 prompt,它能生成新 prompt/任务并把它们链起来达成目标。解决问题需多步:生成新任务("去找这个话题的顶级网站")、推理数据("合并各网站拉取的列表"/"总结结果")、功能步骤("返回搜索结果")。[L19255-19275]
- 未来大量 web 流量将来自 AI agent 检索信息;搜索引擎天然是 agent 的启动点(常已缓存大部分 web)。Bing 等已上线多步搜索(迭代任务跟随)。[L19275-19295]
- pipeline(第 7 章)是多步问题求解的核心组件。[L19255-19260]

## 15.5 Hybrid search(混合搜索)
- **hybrid search**:组合多个搜索范式结果,通常词法(sparse/BM25)+dense vector,不限于二者。两种搜索通常互补,组合常更优。[L19263-19300]
- 实现方式:①引擎原生支持把词法语法与向量语法同一查询组合,任意组合 BM25/向量/函数分数;②引擎不支持同查询但支持融合算法合并分开的查询结果;③向量库与词法引擎分离,用融合算法在引擎外合并。[L19300-19320]

### 15.5.1 Reciprocal Rank Fusion (RRF)
- **RRF 算法**(listing 15.17):对每个文档,累加它在各结果集中的排名的倒数,再按总和排序。核心代码:
  ```
  for ranked_docs in search_results:
      for rank, doc in enumerate(ranked_docs, 1):
          scores[doc["id"]] += 1.0 / (k + rank)
  ```
  文档在多结果集出现且排名越高,RRF 分越高;两集都排名高时最高。OCR 转录。[L19310-19350]
- **k 参数**:常数(默认 60,基于 Cormack SIGIR09 研究)。k 越大越偏向出现在多个列表中的文档,而非在单列表排名高者;可防止单个结果集中的 outlier 权重过大。[L19350-19360]
- 用法:collection.hybrid_search([lexical_search, vector_search], limit=10, algorithm="rrf", algorithm_params={"k": 60});可传 >2 个搜索。[L19370-19420]
- RRF 效果:词法得精确 title 匹配,向量得概念相关(如图片 embedding 含雨/伞/音乐剧);混合把两者 best-of-both。文档在多集同时出现时融合算法提升其分数,能滤掉单集的噪音/无关文档。[L19440-19490]
- 例 "the hobbit":词法前 6 有 5 相关但第 5 有坏结果且第 6 后全坏;向量缺一个相关文档但多一个相关;RRF 混合后前 5 全相关、前 7 有 6 相关——消除各自缺失与噪音。[L19490-19580]

### 15.5.2 其他混合算法
- **RSF (relative score fusion)**:类似 RRF,但用各结果集中文档的相对分数。因不同算法分数不可比,先按每 modality 的 min/max 缩放到同范围(常 0-1),再用加权平均合并,权重常按各 modality 在验证集上的相对表现设定。[L19611-19630]
- **单 modality 初检 + 另一 modality rerank**:如先词法检索,再用向量对结果 rerank。例 algorithm="lexical_vector_rerank":词法负责返回哪些文档,向量负责结果排序。若想强调精确词法匹配可用 default_operator=AND 或 min_match 阈值。[L19630-19690]
- RRF/RSF 提供更"混合"的方式,确保各 modality 的最佳结果都被呈现;选择取决于用例与各 modality 强弱。[L19690-19700]

## 第 15 章术语
- RAG;chunking;hallucination;in-context learning;results summarization;agent-based search;hybrid search;RRF(reciprocal rank fusion);RSF(relative score fusion);lexical_vector_rerank;foundation model;multimodal search;conversational/contextual search

# 全书术语表(取自书末 INDEX,按提取目标相关项整理;页码为书中页码)

## 检索/索引架构
- 倒排索引 inverted index — 10,15,33-38,54,95,106,113-117,152,163-164,184-185,344,354,366,395,448,456
- 前向索引 forward index (uninverted index) — 115
- postings lists — 33
- 文档值 doc values — 115
- 分片 shards / 副本 replicas / 主分片 leader — 214
- 跟随者索引 follower indexes(ES/OpenSearch)— 214
- replica 类型 NRT/TLOG/PULL(Solr)— 214
- sidecar collections(信号旁路集合)— 91
- engine interface / 支持的引擎 / 换引擎 — 474-477

## 词法检索与排序
- BM25 — 62-76;TF / IDF / TF-IDF — 55-62;dot product / Euclidean distance — 56;cosine similarity — 50-62
- edismax query parser — 68,71,74;field/phrase/popularity/geospatial boosting — 67-69;multiplicative boosting — 71
- filtering vs. scoring(过滤 vs 打分)— 74-76;filters parameter — 75;query parameter — 74-76

## 信号 boosting(ch8)
- signals / signals boosting — 17,89-93,193-215;signal spam — 197-202;user-based filtering — 200-202;negative signals boosts — 203;index-time / query-time boosting — 208-214;head queries 194,304 / torso queries 304 / tail queries 304;time decays — 204-208

## 语义搜索 / dense vector(ch13)
- embeddings — 8,35-40,48;vector space 36;document/sentence/paragraph/word embeddings — 37,40;distributional semantics — 35-40
- dense vector search — 343-348;KNN(k-nearest neighbor)— 343;nearest-neighbor search — 343;unit-normalizing — 346
- ANN / HNSW — 365-367;LSH(locality-sensitive hashing)— 366;NMSLIB — 367;FAISS — 377
- 量化 quantization — 339,341,366,374-391;scalar quantization — 374,376-381;binary quantization — 381-383;product quantization — 383-386;FLOAT32/INT8 quantization format — 391
- MRL(Matryoshka Representation Learning)— 348,374,386-389;dimensionality reduction — 362
- Transformer encoder — 348-351;masked language modeling — 350;word pieces — 350;SBERT — 355-358;STS(semantic textual similarity)— 354-355
- bi-encoder / cross-encoder — 392-395;cross-encoders 也是 ranking classifiers — 393

## 问答 / retriever-reader(ch14)
- question answering — 396-425;extractive question answering — 21,396-397,432;retriever-reader pattern — 402-405;spans — 398;logits — 401;PMF(probability mass function)— 398
- reader / retriever / reranker — 419-424;inferring answers from reader 422-423;querying retriever 421-422;reranking answers 423
- fine-tuning — 413-419;SQuAD / silver set / golden set(见 14.2)

## 生成式 / 混合(ch15)
- RAG(retrieval augmented generation)— 5,20-21,395,427,433-435;chunking 433-434
- results summarization — 21,431,435-437;generative search — 21,431-447;foundation models — 8,20,426-467
- hybrid search — 456-464;RRF(reciprocal rank fusion)— 457-463;RSF(relative score fusion)— 463-464
- multimodal search — 447-454;SPLADE(sparse lexical expansion)— 121;DSPy — 446-447

## 学习排序 / 个性化(相关上下文)
- LTR(learning to rank)— 17-18,96-97,285,314;judgments 287;position bias / presentation bias / confidence — 294-311;SDBN — 297-302;NDCG / ERR — 319;SVMrank — 265-267
- collaborative filtering / matrix factorization — 224-238;content-based embeddings — 238-251;personalized search — 216-253
- reflected intelligence — 16,87-99

## 引擎/库
- Solr / Elasticsearch / OpenSearch / Vespa / Qdrant / MongoDB Atlas — 22,58,62,64,74,115,153,187,214,257,261,367,402,434,469-477

## 附录:索引中未单独列出的术语(正文提取)
- chunking/embedding scope(13.2);相似度阈值选择(13.5);MRL 截断维数(13.7);cross-encoder 精排(13.8);agent-based search(15.4.2);RSF 缩放权重(15.5.2);lexical_vector_rerank(15.5.2)
