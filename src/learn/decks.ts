/** Built-in flashcard decks (zh + en) plus user / AI-generated decks stored in <data>/decks. */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../paths.js';
import { ensureDir, parseJson, writeJsonAtomic } from '../fsutil.js';

export type Text = string | { zh: string; en: string };

export interface Flashcard {
  id: string;
  q: Text;
  a: Text;
}

export interface Deck {
  id: string;
  title: Text;
  cards: Flashcard[];
  generated?: boolean;
  createdAt?: number;
}

export function tx(t: Text, lang: 'zh' | 'en'): string {
  return typeof t === 'string' ? t : t[lang];
}

type Raw = [string, string, string, string]; // q zh, a zh, q en, a en

function deck(id: string, zh: string, en: string, rows: Raw[]): Deck {
  return {
    id,
    title: { zh, en },
    cards: rows.map(([qz, az, qe, ae], i) => ({ id: `${id}.${i + 1}`, q: { zh: qz, en: qe }, a: { zh: az, en: ae } })),
  };
}

export const BUILTIN_DECKS: Deck[] = [
  deck('git', 'Git 进阶', 'Git beyond the basics', [
    [
      'git merge 和 git rebase 的核心区别？',
      'merge 生成一个合并提交，保留两条分支真实的历史；rebase 把你的提交逐个“重放”到目标分支顶端，历史变成一条直线，但会改写提交哈希。已经推送到共享分支的提交不要 rebase。',
      'Core difference between git merge and git rebase?',
      'merge creates a merge commit and keeps both branches’ real history; rebase replays your commits one by one on top of the target, giving a linear history but rewriting commit hashes. Never rebase commits already pushed to a shared branch.',
    ],
    [
      'git reset 的 --soft / --mixed / --hard 分别做什么？',
      '都把当前分支指到指定提交。--soft 保留暂存区和工作区；--mixed（默认）清空暂存区，保留工作区改动；--hard 连工作区改动一起丢弃。',
      'What do git reset --soft / --mixed / --hard each do?',
      'All move the current branch to the given commit. --soft keeps the index and working tree; --mixed (default) resets the index but keeps working-tree changes; --hard discards working-tree changes too.',
    ],
    [
      '不小心 reset --hard 丢了提交，怎么找回？',
      '用 git reflog 找到之前 HEAD 指向的提交哈希，再 git branch rescue <hash>（或 git reset --hard <hash>）。reflog 条目默认会保留几十天。',
      'You lost commits with reset --hard. How do you get them back?',
      'Run git reflog to find the hash HEAD pointed to before, then git branch rescue <hash> (or git reset --hard <hash>). Reflog entries are kept for weeks by default.',
    ],
    [
      'git revert 和 git reset 的区别？',
      'revert 新建一个“反向”提交来撤销某次改动，不改写历史，适合已推送的分支；reset 移动分支指针，会改写历史。',
      'git revert vs git reset?',
      'revert adds a new commit that undoes a change without rewriting history — safe on pushed branches; reset moves the branch pointer and rewrites history.',
    ],
    [
      'git cherry-pick 用来做什么？',
      '把某个（或几个）提交的改动复制到当前分支，生成内容相同但哈希不同的新提交。常用于把修复补丁移植到发布分支。',
      'What is git cherry-pick for?',
      'Copies the changes of one or more commits onto the current branch as new commits (same diff, new hashes). Typical use: porting a fix to a release branch.',
    ],
    [
      'git bisect 如何定位引入 bug 的提交？',
      '标记一个好的提交和一个坏的提交，git 每次检出中间的提交让你测试，一次排除一半，大约 log2(N) 步就能找到第一个坏提交；配合 git bisect run <脚本> 可以全自动。',
      'How does git bisect find the commit that introduced a bug?',
      'Mark one good and one bad commit; git checks out the midpoint for you to test, halving the range each time, so it finds the first bad commit in about log2(N) steps. git bisect run <script> automates it.',
    ],
    [
      'git stash 的作用？',
      '把未提交的改动（工作区和暂存区）存到一个栈里，让工作区回到干净状态；之后用 git stash pop 恢复。加 -u 可以把未跟踪的文件也一起存起来。',
      'What does git stash do?',
      'Saves uncommitted changes (working tree and index) on a stack and leaves a clean working tree; git stash pop brings them back. -u also stashes untracked files.',
    ],
    [
      'git fetch 和 git pull 的区别？',
      'fetch 只下载远端的新提交、更新远程跟踪分支，不动你的本地分支；pull = fetch + merge（也可以配置成 rebase）。',
      'git fetch vs git pull?',
      'fetch only downloads new remote commits and updates remote-tracking branches, leaving your branches alone; pull = fetch + merge (or rebase, if configured).',
    ],
    [
      '什么是 detached HEAD？',
      'HEAD 直接指向某个提交而不是某个分支。这时新建的提交不属于任何分支，切走后很容易“丢”；想保留就 git switch -c <新分支名>。',
      'What is a detached HEAD?',
      'HEAD points at a commit instead of a branch. New commits made there belong to no branch and are easy to lose once you switch away; keep them with git switch -c <new-branch>.',
    ],
    [
      '.gitignore 对已经被跟踪的文件有效吗？',
      '无效。.gitignore 只影响未被跟踪的文件；要停止跟踪已提交的文件，用 git rm --cached <文件> 再提交。',
      'Does .gitignore affect files that are already tracked?',
      'No. It only applies to untracked files; to stop tracking a committed file, run git rm --cached <file> and commit.',
    ],
  ]),
  deck('net', '网络与 HTTP', 'Networking & HTTP', [
    [
      'TCP 三次握手的过程和目的？',
      '客户端发 SYN → 服务端回 SYN-ACK → 客户端回 ACK。目的是让双方都确认对方能收也能发，并同步各自的初始序列号。',
      'What is the TCP three-way handshake and why three steps?',
      'Client sends SYN → server replies SYN-ACK → client sends ACK. It confirms both sides can send and receive and synchronises their initial sequence numbers.',
    ],
    [
      'TCP 和 UDP 的主要区别？',
      'TCP 面向连接，提供可靠、有序的传输和拥塞控制；UDP 无连接，不保证送达和顺序，但开销小、延迟低，适合实时音视频、DNS 查询等场景。',
      'Main differences between TCP and UDP?',
      'TCP is connection-oriented with reliable, ordered delivery and congestion control; UDP is connectionless with no delivery or ordering guarantees but lower overhead and latency — good for real-time media and DNS.',
    ],
    [
      '在浏览器地址栏输入 URL 回车后，大致发生了什么？',
      'DNS 解析域名 → 建立 TCP 连接（HTTPS 还要做 TLS 握手）→ 发送 HTTP 请求 → 服务器返回响应 → 浏览器解析 HTML、加载子资源、渲染页面。',
      'What roughly happens after you type a URL and press Enter?',
      'DNS resolves the host → TCP connection (plus a TLS handshake for HTTPS) → HTTP request → server response → the browser parses HTML, fetches sub-resources and renders.',
    ],
    [
      'HTTP 状态码 301、302、304 分别表示什么？',
      '301 永久重定向；302 临时重定向；304 Not Modified：资源没有变化，客户端直接用本地缓存。',
      'What do HTTP 301, 302 and 304 mean?',
      '301: moved permanently; 302: temporary redirect; 304: Not Modified — the client should use its cached copy.',
    ],
    [
      '401 和 403 有什么区别？',
      '401 是未认证：服务器不知道你是谁，需要登录或提供凭证；403 是已认证但没有权限访问这个资源。',
      '401 vs 403?',
      '401 means unauthenticated — the server does not know who you are; 403 means you are known but not allowed to access the resource.',
    ],
    [
      '什么是幂等？哪些 HTTP 方法是幂等的？',
      '同一个请求执行一次和执行多次，对服务器状态的影响相同。GET、HEAD、PUT、DELETE、OPTIONS 是幂等的；POST 不是，PATCH 一般也不保证。',
      'What is idempotency, and which HTTP methods are idempotent?',
      'Running a request once or many times leaves the server in the same state. GET, HEAD, PUT, DELETE and OPTIONS are idempotent; POST is not, and PATCH is not guaranteed to be.',
    ],
    [
      'GET 和 POST 的语义区别？',
      'GET 用于获取资源，应当安全且幂等，参数一般放在 URL 里；POST 用于提交数据、产生副作用，不保证幂等，数据放在请求体里。',
      'Semantic difference between GET and POST?',
      'GET retrieves a resource, should be safe and idempotent, and usually carries parameters in the URL; POST submits data with side effects, is not idempotent, and carries data in the body.',
    ],
    [
      'HTTPS 比 HTTP 多了什么？',
      '在 TCP 之上加了一层 TLS：用证书验证服务器身份，通过握手协商出对称密钥，之后的通信都被加密并防篡改。',
      'What does HTTPS add over HTTP?',
      'A TLS layer on top of TCP: certificates authenticate the server, the handshake negotiates symmetric keys, and all traffic is then encrypted and tamper-evident.',
    ],
    [
      'CORS 解决什么问题？',
      '浏览器的同源策略默认不让网页脚本读取跨源响应；CORS 让服务器用 Access-Control-Allow-Origin 等响应头声明允许哪些源访问。非简单请求会先发一个 OPTIONS 预检。',
      'What problem does CORS solve?',
      'The same-origin policy stops page scripts from reading cross-origin responses; CORS lets a server declare allowed origins via headers like Access-Control-Allow-Origin. Non-simple requests send an OPTIONS preflight first.',
    ],
    [
      'WebSocket 和 HTTP 轮询的区别？',
      'WebSocket 通过一次 HTTP Upgrade 建立持久的全双工连接，服务器可以随时主动推送；轮询需要客户端反复发请求，延迟更高、开销更大。',
      'WebSocket vs HTTP polling?',
      'WebSocket upgrades one HTTP request into a persistent full-duplex connection, so the server can push at any time; polling makes the client ask repeatedly, with more latency and overhead.',
    ],
  ]),
  deck('os', '操作系统与并发', 'OS & concurrency', [
    [
      '进程和线程的区别？',
      '进程是资源分配的单位，有独立的地址空间；线程是调度的单位，同一进程内的线程共享内存和文件描述符，切换开销更小，但需要同步。',
      'Process vs thread?',
      'A process is the unit of resource ownership with its own address space; a thread is the unit of scheduling — threads in a process share memory and file descriptors, switch more cheaply, and need synchronisation.',
    ],
    [
      '什么是竞态条件（race condition）？',
      '多个线程或进程并发访问共享数据，且结果取决于执行的先后时序。典型例子：两个线程同时执行 count++，其中一次更新丢失。',
      'What is a race condition?',
      'Concurrent access to shared data where the result depends on timing. Classic example: two threads run count++ at once and one update is lost.',
    ],
    [
      '死锁的四个必要条件？',
      '互斥、占有并等待、不可剥夺、循环等待。破坏任意一个就能避免死锁，最常用的是规定统一的加锁顺序来打破循环等待。',
      'The four necessary conditions for deadlock?',
      'Mutual exclusion, hold-and-wait, no preemption, circular wait. Break any one to prevent deadlock — most often by enforcing a global lock order to break circular wait.',
    ],
    [
      '互斥锁（mutex）和信号量（semaphore）的区别？',
      'mutex 同一时刻只允许一个持有者，通常由加锁的线程解锁；信号量是一个计数器，允许最多 N 个并发访问者，也常用来在线程之间发信号。',
      'Mutex vs semaphore?',
      'A mutex allows one holder at a time and is normally released by the thread that locked it; a semaphore is a counter allowing up to N concurrent holders and is also used for signalling between threads.',
    ],
    [
      '虚拟内存解决了什么问题？',
      '给每个进程一个独立、连续的地址空间，由 MMU 通过页表映射到物理内存；既实现了进程隔离，也允许把不常用的页换出到磁盘。',
      'What does virtual memory solve?',
      'Each process gets its own contiguous address space, mapped to physical memory by the MMU through page tables — giving isolation between processes and letting rarely used pages be swapped to disk.',
    ],
    [
      '什么是缺页（page fault）？',
      '访问的虚拟页当前没有映射到物理内存时触发的异常；操作系统分配或从磁盘调入这一页，然后重新执行那条指令。',
      'What is a page fault?',
      'A trap raised when a virtual page is not currently mapped to physical memory; the OS allocates or loads the page and re-runs the instruction.',
    ],
    [
      '并发（concurrency）和并行（parallelism）的区别？',
      '并发是在同一段时间内交替推进多个任务，单核也可以；并行是同一时刻真正同时执行多个任务，需要多核。',
      'Concurrency vs parallelism?',
      'Concurrency is making progress on several tasks over the same period (possible on one core); parallelism is executing several tasks at the same instant (needs multiple cores).',
    ],
    [
      '什么时候会从用户态切换到内核态？',
      '系统调用、中断和异常发生时。这种切换有开销，所以高性能程序会尽量减少系统调用次数，比如批量读写。',
      'When does the CPU switch from user mode to kernel mode?',
      'On system calls, interrupts and exceptions. The switch has a cost, so high-performance code minimises syscalls, e.g. by batching I/O.',
    ],
    [
      '什么是上下文切换？',
      'CPU 从一个线程或进程切到另一个时，保存当前的寄存器、程序计数器等状态，再恢复下一个的状态。切换本身不做有用功，太频繁会降低吞吐。',
      'What is a context switch?',
      'Saving the registers, program counter and other state of the running thread or process and restoring another’s. It does no useful work itself, so frequent switching hurts throughput.',
    ],
    [
      'I/O 多路复用（select / poll / epoll）是什么？',
      '一个线程同时监视多个文件描述符，哪个就绪就处理哪个，不用为每个连接开一个线程。Linux 的 epoll 能扩展到大量连接，是 Nginx 和 Node.js 事件循环的基础。',
      'What is I/O multiplexing (select / poll / epoll)?',
      'One thread watches many file descriptors and handles whichever is ready, instead of a thread per connection. Linux epoll scales to huge numbers of connections and underpins Nginx and the Node.js event loop.',
    ],
  ]),
  deck('llm', 'LLM 与 Agent', 'LLMs & agents', [
    [
      '什么是 token？',
      '模型处理文本的基本单位，由分词器把文本切成子词片段。英文里一个单词大约 1~2 个 token，中文大约一个字一个 token 左右（取决于分词器）。上下文长度和计费都按 token 算。',
      'What is a token?',
      'The unit of text a model processes: a tokenizer splits text into sub-word pieces. An English word is roughly 1–2 tokens; context limits and billing are counted in tokens.',
    ],
    [
      '上下文窗口（context window）是什么？',
      '模型一次能“看到”的最大 token 数，包括系统提示、对话历史、工具结果和输出。超出之后只能截断或压缩历史。',
      'What is the context window?',
      'The maximum number of tokens a model can attend to at once — system prompt, history, tool results and output together. Beyond it, history must be truncated or compacted.',
    ],
    [
      'temperature 参数控制什么？',
      '采样的随机程度。越低输出越确定、越保守；越高越多样、越有创意，但也更容易出错。',
      'What does temperature control?',
      'How random sampling is. Lower is more deterministic and conservative; higher is more varied and creative, but more error-prone.',
    ],
    [
      '什么是 RAG？',
      '检索增强生成：先从外部知识库（通常用向量检索）找出和问题相关的片段，再放进提示词里让模型作答。用来补充模型不知道或已过时的知识，并减少幻觉。',
      'What is RAG?',
      'Retrieval-augmented generation: retrieve passages relevant to the question from an external store (often via vector search) and put them in the prompt — adding knowledge the model lacks and reducing hallucination.',
    ],
    [
      'Embedding（向量嵌入）是什么？',
      '把文本映射成一个高维向量，语义相近的文本在向量空间里距离更近。常用余弦相似度做语义搜索、聚类和去重。',
      'What is an embedding?',
      'A high-dimensional vector representing text so that semantically similar texts sit close together; cosine similarity over embeddings powers semantic search, clustering and deduplication.',
    ],
    [
      'Agent 和普通聊天有什么区别？',
      'Agent 在一个循环里自主决定调用工具（读文件、跑命令、搜索），看到结果后再决定下一步，直到完成任务；普通聊天只是一问一答。',
      'How is an agent different from a plain chat?',
      'An agent loops: it decides to call tools (read files, run commands, search), observes the results, and chooses the next step until the task is done; a chat is just question and answer.',
    ],
    [
      '工具调用（tool use / function calling）是怎么工作的？',
      '开发者用 JSON Schema 描述工具；模型决定调用时输出工具名和参数，由程序真正执行，再把结果作为消息返回给模型继续推理。',
      'How does tool use (function calling) work?',
      'Tools are described with JSON Schema; when the model decides to call one it emits the name and arguments, your code executes it, and the result goes back to the model as a message.',
    ],
    [
      '什么是 prompt caching？',
      '把提示词里不变的前缀（系统提示、长文档等）缓存起来，后续请求直接复用，降低延迟和成本。前提是可复用的部分放在最前面且保持不变。',
      'What is prompt caching?',
      'Caching the unchanging prefix of a prompt (system prompt, long documents) so later requests reuse it, cutting latency and cost. The reusable part must come first and stay identical.',
    ],
    [
      '什么是幻觉？常见的缓解手段有哪些？',
      '模型自信地说出不真实的内容。缓解手段：提供检索到的资料并要求引用、允许它说“不知道”、让它调用工具去查证、对关键输出做校验。',
      'What is hallucination and how do you mitigate it?',
      'The model confidently states false things. Mitigations: ground it in retrieved sources and require citations, allow “I don’t know”, let it verify with tools, and validate critical outputs.',
    ],
    [
      'MCP（Model Context Protocol）是什么？',
      '一个开放协议，让 AI 应用用统一的方式接入外部工具和数据：提供方写一个 MCP server，任何支持 MCP 的客户端（比如 Claude Code）都能连上使用。',
      'What is MCP (Model Context Protocol)?',
      'An open protocol for connecting AI applications to tools and data in a standard way: a provider writes an MCP server and any MCP client (such as Claude Code) can use it.',
    ],
  ]),
  deck('sys', '系统设计', 'System design', [
    [
      '水平扩展和垂直扩展的区别？',
      '垂直扩展是给单台机器加 CPU 和内存，简单但有上限；水平扩展是加机器、用负载均衡分流，上限高，但要处理无状态化、数据分片和一致性。',
      'Horizontal vs vertical scaling?',
      'Vertical: a bigger machine — simple but capped. Horizontal: more machines behind a load balancer — scales further but forces you to handle statelessness, sharding and consistency.',
    ],
    [
      '缓存的穿透、击穿、雪崩分别是什么？',
      '穿透：查不存在的数据，每次都打到数据库（用布隆过滤器或缓存空值）；击穿：热点 key 过期的瞬间大量请求涌入（加互斥锁或异步刷新）；雪崩：大量 key 同时过期（过期时间加随机抖动）。',
      'Cache penetration, breakdown and avalanche?',
      'Penetration: lookups for missing data always hit the DB (Bloom filter or cache negatives). Breakdown: a hot key expires and a stampede follows (mutex or async refresh). Avalanche: many keys expire together (add TTL jitter).',
    ],
    [
      'CAP 定理说了什么？',
      '分布式系统在发生网络分区时，只能在一致性和可用性之间二选一。分区无法避免，所以实际上是在 CP 和 AP 之间取舍。',
      'What does the CAP theorem say?',
      'During a network partition a distributed system must choose between consistency and availability. Partitions happen, so the real choice is CP vs AP.',
    ],
    [
      '什么是最终一致性？',
      '不保证每次都读到最新值，但在没有新写入的情况下，所有副本经过一段时间后会收敛到同一个值。DNS 和很多 NoSQL 数据库都是这样。',
      'What is eventual consistency?',
      'Reads may be stale, but with no new writes all replicas converge to the same value over time — as in DNS and many NoSQL databases.',
    ],
    [
      '消息队列的典型作用？代价是什么？',
      '作用：异步处理、削峰填谷、服务解耦、失败重试。代价：系统更复杂，要处理重复消费（让消费者幂等）和消息顺序。',
      'Why use a message queue, and what does it cost?',
      'Async processing, absorbing traffic spikes, decoupling services and retrying failures. The cost: more moving parts, plus handling duplicate delivery (idempotent consumers) and ordering.',
    ],
    [
      '限流常用哪些算法？',
      '固定窗口、滑动窗口、漏桶（按恒定速率流出）、令牌桶（按速率发放令牌，允许一定突发）。API 网关最常用令牌桶。',
      'Common rate-limiting algorithms?',
      'Fixed window, sliding window, leaky bucket (constant outflow) and token bucket (tokens refill at a rate, allowing bursts). Token bucket is the API-gateway favourite.',
    ],
    [
      '数据库索引为什么能加速查询？代价是什么？',
      '索引（常见是 B+ 树）把查找从全表扫描变成对数级查找；代价是额外的存储空间，以及每次写入都要维护索引，写多读少的表要慎重。',
      'Why do database indexes speed up queries, and what do they cost?',
      'An index (usually a B+ tree) turns a full scan into a logarithmic lookup; it costs storage and slows every write, so be careful on write-heavy tables.',
    ],
    [
      '分库分表时怎么选分片键？',
      '选查询最常带上、分布又均匀的字段（比如 user_id），让大部分查询只落到一个分片，同时避免热点。跨分片的 JOIN 和事务会变得很贵。',
      'How do you choose a shard key?',
      'Pick a field most queries filter on that is evenly distributed (e.g. user_id), so most queries hit one shard and no shard runs hot. Cross-shard joins and transactions become expensive.',
    ],
    [
      '什么是幂等键（idempotency key）？',
      '客户端给每个操作生成一个唯一 ID 随请求发送，服务端记录处理过的 ID，重试时直接返回第一次的结果，防止重复扣款之类的问题。',
      'What is an idempotency key?',
      'A unique ID the client sends with an operation; the server records processed IDs and returns the original result on retries, preventing double charges and the like.',
    ],
    [
      'L4 和 L7 负载均衡有什么区别？',
      'L4 按 IP 和端口转发 TCP/UDP 连接，快但看不到请求内容；L7 能解析 HTTP，可以按路径、Header、Cookie 路由，还能做 TLS 终止和重试。',
      'L4 vs L7 load balancing?',
      'L4 forwards TCP/UDP connections by IP and port — fast but blind to content; L7 understands HTTP, so it can route by path, header or cookie and handle TLS termination and retries.',
    ],
  ]),
];

export function loadUserDecks(): Deck[] {
  const dir = paths.decks();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Deck[] = [];
  for (const f of files) {
    try {
      const d = parseJson<Deck>(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (d && d.id && Array.isArray(d.cards) && d.cards.length) out.push(d);
    } catch {
      /* skip broken deck */
    }
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function allDecks(): Deck[] {
  return [...loadUserDecks(), ...BUILTIN_DECKS];
}

export function saveDeck(d: Deck): void {
  ensureDir(paths.decks());
  writeJsonAtomic(path.join(paths.decks(), `${d.id}.json`), d, true);
}
