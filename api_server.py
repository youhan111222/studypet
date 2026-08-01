import http.server
import json
import re
import sqlite3
import os
import sys
import threading
import urllib.parse
import socketserver
import requests as req_lib
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "activity.db")
DEEPSEEK_KEY_FILE = os.path.join(BASE_DIR, "api_key.txt")
KEYWORDS_FILE = os.path.join(BASE_DIR, "study_keywords.json")
PATINA_DB = os.path.join(os.environ.get("APPDATA", ""), "Patina", "patina.db")

# === SecondBrain 集成（复习追踪器 / 错题本 / 日记 / 学习状态） ===
# 根目录可用环境变量 SECOND_BRAIN_ROOT 覆盖（测试用临时目录，不碰真实文件）
SECOND_BRAIN_ROOT = os.environ.get("SECOND_BRAIN_ROOT", r"D:\SecondBrain")
TRACKER_PATH = os.path.join(SECOND_BRAIN_ROOT, r"15-元知识\学习系统\📌 复习追踪器.md")
TRACKER_HEADER = "# 📌 复习追踪器\n\n> 间隔复习：1/2/4/7/15/30 天。学习新知识点当天登记，到间隔日勾选 ✅。\n> 维护：StudyPet（/secondbrain/review-check）或手动。格式勿改（后端解析依赖）。\n\n| 学习日期 | 知识点 | 科目 | ①1天 | ②2天 | ③4天 | ④7天 | ⑤15天 | ⑥30天 |\n|----------|--------|------|------|------|------|------|-------|-------|\n"
MISTAKES_DIR = os.path.join(SECOND_BRAIN_ROOT, "10-知识库")
DIARY_DIR = os.path.join(SECOND_BRAIN_ROOT, "20-日记")
STATE_PATH = os.path.join(SECOND_BRAIN_ROOT, "memory-bank", "claude-code-memory", "learning-state.md")

# ===== SecondBrain RAG（向量语义检索） =====
RAG_INDEX_DIR = os.path.join(SECOND_BRAIN_ROOT, ".rag-index")
_RAG_MODEL = None
_RAG_COLLECTION = None
_RAG_LOAD_LOCK = threading.Lock()


def _rag_load():
    """lazy load 嵌入模型 + ChromaDB collection（进程内常驻，只加载一次）"""
    global _RAG_MODEL, _RAG_COLLECTION
    if _RAG_COLLECTION is not None:
        return _RAG_COLLECTION
    with _RAG_LOAD_LOCK:
        if _RAG_COLLECTION is not None:
            return _RAG_COLLECTION
        if not os.path.exists(RAG_INDEX_DIR):
            return None
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_OFFLINE"] = "1"
        from sentence_transformers import SentenceTransformer
        import chromadb
        _RAG_MODEL = SentenceTransformer('BAAI/bge-small-zh-v1.5')
        client = chromadb.PersistentClient(str(RAG_INDEX_DIR))
        _RAG_COLLECTION = client.get_collection("secondbrain")
    return _RAG_COLLECTION


def rag_query(q, subject="", top_k=3):
    """语义检索 SecondBrain 笔记。失败/无索引返回 []（静默降级，不影响主功能）"""
    try:
        collection = _rag_load()
        if collection is None or _RAG_MODEL is None or not q:
            return []
        query_emb = _RAG_MODEL.encode(q).tolist()
        where = {"subject": subject} if subject else None
        results = collection.query(query_embeddings=[query_emb], n_results=max(1, min(top_k, 10)), where=where)
        ids = results.get("ids", [[]])[0]
        if not ids:
            return []
        items = []
        for doc, meta, dist in zip(results["documents"][0], results["metadatas"][0], results["distances"][0]):
            items.append({
                "file": meta.get("file", "?"),
                "source": meta.get("source", ""),
                "subject": meta.get("subject", ""),
                "header": meta.get("header", ""),
                "score": round((1 - dist) * 100, 1),
                "snippet": (doc or "")[:300],
            })
        return items
    except Exception as e:
        print(f"[rag] query failed: {e}", file=sys.stderr)
        return []


# ===== 官方课表 XLS 导入 =====
OFFICIAL_SCHEDULE_XLS = r"C:\Users\20397\Desktop\学生个人课表_202430000863.xls"

# 节次 -> (开始, 结束) 分钟（按课表大节时段）
_XLS_PERIOD_SLOTS = {
    1: (500, 595), 2: (500, 595),      # 08:20-09:55
    3: (610, 705), 4: (610, 705),      # 10:10-11:45
    5: (860, 955), 6: (860, 955),      # 14:20-15:55
    7: (965, 1060), 8: (965, 1060),    # 16:05-17:40
    9: (1100, 1195), 10: (1100, 1195), # 18:20-19:55
    11: (1200, 1295), 12: (1200, 1295),# 20:00-21:35
}


def _xls_parse_cell(cell_text, fallback_start, fallback_end):
    """解析课程单元格 -> [{name, teacher, weeks, location, start, end}]"""
    courses = []
    lines = [ln.strip() for ln in (cell_text or "").split("\n") if ln.strip()]
    cur = None
    for ln in lines:
        if cur is None:
            cur = {"name": ln, "teacher": "", "weeks": "", "location": ""}
            continue
        if "节" in ln and ln.startswith("[") and ln.endswith("节"):
            nums = re.findall(r"\d+", ln)
            if nums:
                start = _XLS_PERIOD_SLOTS.get(min(nums), (fallback_start, fallback_start))[0]
                end = _XLS_PERIOD_SLOTS.get(max(nums), (fallback_end, fallback_end))[1]
            else:
                start, end = fallback_start, fallback_end
            courses.append({**cur, "start": start, "end": end})
            cur = None
        elif "周]" in ln:
            cur["weeks"] = ln
        elif not cur["teacher"]:
            cur["teacher"] = ln
        else:
            cur["location"] = ln
    return courses


def parse_official_schedule_xls():
    """解析桌面官方课表 XLS → ScheduleItem[]（day 1=周一..7=周日）。失败返回 []"""
    if not os.path.exists(OFFICIAL_SCHEDULE_XLS):
        return []
    try:
        import xlrd
        book = xlrd.open_workbook(OFFICIAL_SCHEDULE_XLS, formatting_info=False)
        sh = book.sheet_by_index(0)
        rows = []
        for r in range(sh.nrows):
            row = []
            for c in range(sh.ncols):
                v = sh.cell_value(r, c)
                row.append("" if v in ("", None) else str(v))
            rows.append(row)
    except Exception as e:
        print(f"[schedule] XLS 解析失败: {e}", file=sys.stderr)
        return []

    header_row = None
    for i, row in enumerate(rows):
        if any("星期" in v for v in row):
            header_row = i
            break
    if header_row is None:
        return []

    time_rows = []
    for i in range(header_row + 1, len(rows)):
        m = re.search(r"(\d{2}:\d{2})-(\d{2}:\d{2})", rows[i][0])
        if not m:
            continue
        sh, sm = map(int, m.group(1).split(":"))
        eh, em = map(int, m.group(2).split(":"))
        time_rows.append((rows[i], sh * 60 + sm, eh * 60 + em))
    if not time_rows:
        return []

    items = []
    rid = 0
    for day_idx in range(7):  # 列 1..7 = 周一..周日
        for row, start, end in time_rows:
            cell = row[day_idx + 1].strip() if day_idx + 1 < len(row) else ""
            if not cell or cell == " ":
                continue
            for c in _xls_parse_cell(cell, start, end):
                rid += 1
                items.append({
                    "id": f"xls-{rid}",
                    "name": c["name"],
                    "day": day_idx + 1,
                    "timeStart": f"{c['start'] // 60:02d}:{c['start'] % 60:02d}",
                    "timeEnd": f"{c['end'] // 60:02d}:{c['end'] % 60:02d}",
                    "location": c["location"],
                    "teacher": c["teacher"],
                    "weeks": c["weeks"] or "1-17",
                })
    seen = set()
    dedup = []
    for it in items:
        sig = (it["name"], it["day"], it["timeStart"], it["timeEnd"], it["location"])
        if sig in seen:
            continue
        seen.add(sig)
        dedup.append(it)
    return dedup

# 间隔复习列头 → 间隔天数（艾宾浩斯 1/2/4/7/15/30）
TRACKER_INTERVALS = ((1, "①1天"), (2, "②2天"), (4, "③4天"), (7, "④7天"), (15, "⑤15天"), (30, "⑥30天"))
CHECKED_MARK = "✅"
UNCHECKED_MARK = "⬜"

# 科目英文 key（前端）→ 知识库中文目录名；部分科目实际目录名与标准名不同，需回退
SUBJECT_CN_MAP = {"electronics": "电子技术", "math": "高等数学", "english": "英语", "politics": "政治"}
SUBJECT_DIR_ALIASES = {
    "电子技术": ["电子技术基础"],
    "高等数学": ["高数"],
}

# 错题/复习登记允许的科目（英文 key 或知识库中文目录名）；其余一律拒绝，防止路径穿越写任意目录
MISTAKE_SUBJECT_ALLOW = {
    "electronics", "math", "english", "politics",
    "电子", "电子技术", "电子技术基础", "高等数学", "高数", "数学", "英语", "政治",
}

# 仅允许本地来源跨域访问，禁止任意网页读取/改写本地服务
ALLOWED_ORIGINS = {
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:19998", "http://127.0.0.1:19998",
    "http://localhost:19999", "http://127.0.0.1:19999",
}


def _load_env():
    """加载项目 .env（若环境变量未设置）"""
    env_path = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip())
        except Exception:
            pass


def get_api_key():
    """读取 DeepSeek API Key：优先 .env 环境变量，其次 api_key.txt"""
    env_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if env_key:
        return env_key
    if os.path.exists(DEEPSEEK_KEY_FILE):
        key = open(DEEPSEEK_KEY_FILE, encoding="utf-8-sig").read().strip()
        if not key.startswith("sk-"):
            # 占位/无效 key：视为未配置，避免静默 401
            print("[warn] api_key.txt 内容不是有效的 sk- key，已忽略，请在设置中重新配置", file=sys.stderr)
            return ""
        return key
    return ""


def _allowed_origin(self):
    """校验请求来源，仅放行本地来源"""
    origin = self.headers.get("Origin", "")
    if origin in ALLOWED_ORIGINS:
        return origin
    return None


_load_env()

def load_study_keywords():
    """加载浏览器标题关键词表，用于二次打标 browser 类记录"""
    if not os.path.exists(KEYWORDS_FILE):
        return {}
    try:
        with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

# 启动时加载，后续每次请求重新读取以支持热更新
def get_keywords():
    return load_study_keywords()

# 娱乐/社交平台信号：标题命中这些词即使含学习关键词也不算学习（如 b 站娱乐视频标题带"考研"）
ENTERTAINMENT_TITLE_HINTS = [
    "bilibili", "哔哩哔哩", "抖音", "tiktok", "直播", "游戏", "番剧", "影视",
    "电影", "解说", "综艺", "电竞", "演唱会", "mv ", "番外", "剪辑",
    "netflix", "youtube", "twitch", "steam", "music", "音乐",
]

def reclassify_browser(title, proc):
    """
    对 browser 类记录做二次打标。
    返回 (new_category, matched_subject) 或 ("browser", None)
    """
    if not title:
        return "browser", None
    keywords = get_keywords()
    if not keywords:
        return "browser", None
    title_lower = title.lower()
    # 娱乐平台/内容信号优先：即使命中学习关键词也不计学习（防 b 站娱乐视频误报）
    if any(hint in title_lower for hint in ENTERTAINMENT_TITLE_HINTS):
        return "browser", None
    for subject, kw_list in keywords.items():
        if subject.startswith("_"):
            continue  # 跳过 _note 等元数据字段
        if not isinstance(kw_list, list):
            continue
        for kw in kw_list:
            if isinstance(kw, str) and kw and kw.lower() in title_lower:
                return "study", subject
    return "browser", None

def get_db():
    """获取带 WAL 模式和超时重试的数据库连接，解决多进程并发锁问题"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = sqlite3.Row
    return conn

# === Web Search via DuckDuckGo (no API key needed) ===
def duckduckgo_search(query: str, max_results: int = 5):
    try:
        resp = req_lib.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=10,
        )
        from html.parser import HTMLParser
        class ResultParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.results = []
                self._in_result = False
                self._in_link = False
                self._in_snippet = False
                self._current = {}
                self._text = ""
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == "a" and "result__a" in attrs.get("class", ""):
                    self._in_result = True
                    self._in_link = True
                    self._current = {"url": attrs.get("href", "")}
                elif tag == "a" and "result__snippet" in attrs.get("class", ""):
                    self._in_snippet = True
                    self._text = ""
            def handle_data(self, data):
                if self._in_link:
                    self._current["title"] = data.strip()
                elif self._in_snippet:
                    self._text += data
            def handle_endtag(self, tag):
                if tag == "a" and self._in_link:
                    self._in_link = False
                elif tag == "a" and self._in_snippet:
                    self._current["snippet"] = self._text.strip()
                    self._in_snippet = False
                    if self._current.get("title"):
                        self.results.append(self._current)
                    self._current = {}
        parser = ResultParser()
        parser.feed(resp.text)
        return parser.results[:max_results]
    except Exception:
        return [{"title": "搜索失败，请稍后重试", "url": "", "snippet": ""}]

# ===== AI 教练完整系统提示词（自 deepseek_service.py 合并，统一走 19998） =====

def _load_knowledge_base():
    """加载《建立知识体系》摘要（pdf_full_text.txt），模块级缓存"""
    pdf_file = os.path.join(BASE_DIR, "pdf_full_text.txt")
    if not os.path.exists(pdf_file):
        return ""
    try:
        with open(pdf_file, "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
    except Exception:
        return ""
    clean_lines = []
    for line in raw.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("===== PAGE") or stripped.startswith("@") or stripped.startswith("抓住"):
            continue
        if len(stripped) < 5:
            continue
        clean_lines.append(stripped)
    return "\n".join(clean_lines)


_KNOWLEDGE_BASE_CACHE = None

def get_knowledge_base():
    global _KNOWLEDGE_BASE_CACHE
    if _KNOWLEDGE_BASE_CACHE is None:
        _KNOWLEDGE_BASE_CACHE = _load_knowledge_base()
    return _KNOWLEDGE_BASE_CACHE


# 前端 subjectProgress 使用英文 key，考试科目为中文名，遍历时做映射
SUBJECT_KEY_MAP = {"电子技术": "electronics", "高等数学": "math", "高数": "math", "英语": "english", "政治": "politics"}

def build_system_prompt(context: dict, user_message: str = "") -> str:
    """构建系统提示词 — 硬核教练版（context 为前端 POST 的 context 对象）"""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    hour = now.hour
    period = "凌晨" if hour < 6 else "上午" if hour < 12 else "中午" if hour < 13 else "下午" if hour < 18 else "晚上"
    hour12 = hour if 0 < hour <= 12 else (hour - 12 if hour > 12 else 12)
    current_time = f"{period} {hour12:02d}:{now.minute:02d} ({now.strftime('%H:%M')})"
    today_full = now.strftime("%Y年%m月%d日 %A")

    activity_logs = context.get("activity_logs", [])
    today_study_min = sum(
        log.get("duration", 0) for log in activity_logs
        if log.get("date") == today and log.get("category") == "study"
    )
    today_study_hours = today_study_min / 60

    subject_progress = context.get("subject_progress", {})
    exam_subjects = context.get("exam_subjects", ["英语", "高数", "政治", "电子技术"])
    subject_snapshot_lines = []
    for subj in exam_subjects:
        key = SUBJECT_KEY_MAP.get(subj, subj)
        sp = subject_progress.get(key, {})
        hours = sp.get("totalMinutes", 0) / 60
        chapter = sp.get("currentChapter", "未知")
        last_date = sp.get("lastStudyDate", "")
        if last_date:
            try:
                gap = (now - datetime.strptime(last_date, "%Y-%m-%d")).days
                gap_str = f" | 距上次复习{gap}天"
            except ValueError:
                gap_str = ""
        else:
            gap_str = " | 从未复习"
        subject_snapshot_lines.append(f"- {subj}: {hours:.1f}h | 章节:{chapter}{gap_str}")

    # 加载考纲
    syllabus_text = ""
    syllabus_file = os.path.join(BASE_DIR, "exam_syllabus.json")
    if os.path.exists(syllabus_file):
        try:
            with open(syllabus_file, "r", encoding="utf-8") as f:
                syllabus = json.load(f)
            syllabus_text = f"""
【官方考纲 — 学习地图（权威基准）】
考试: {syllabus.get('exam','')} | 日期: {syllabus.get('examDate','')} | 年份: {syllabus.get('year','')}
"""
            for key, subj in syllabus.get("subjects", {}).items():
                syllabus_text += f"\n■ {subj['name']}（{subj['score']}分，{subj['durationMinutes']}分钟）\n"
                syllabus_text += f"  教材: {'；'.join(subj.get('textbooks', []))}\n"
                for section, chapters in subj.get("chapters", {}).items():
                    syllabus_text += f"  {section}: {' → '.join(chapters)}\n"
                if "examStructure" in subj:
                    parts = []
                    for k, v in subj["examStructure"].items():
                        score = v.get('total', v.get('perScore', ''))
                        parts.append(f'{k}({score}分)')
                    syllabus_text += '  题型: ' + ' | '.join(parts) + '\n'
        except Exception:
            syllabus_text = "（考纲数据未加载）"

    knowledge_base = get_knowledge_base()
    memories = context.get("memories", [])
    current_tasks = context.get("current_tasks", [])

    prompt = f"""# ROLE & ATTITUDE
你是「专升本硬核教练」：监督严格、数据说话，但对人保留温度。
1. 监督强度不降：数据不好直接说，抓断层、催任务、报数字，不找借口、不灌鸡汤。
2. 允许简短实在的肯定：做对了就给一句有事实依据的肯定（如"今天电子 55 分钟，节奏对"）；禁止空洞敷衍（"太棒了""加油哦"这类不算数）。
3. 你的目标是：提升用户的考点通关吞吐量，把每一分钟有效备考时间用足。
4. 说话风格：一针见血、高密度、像手术刀一样精准，不说废话。
5. 回复控制在 150 字以内，除非用户明确要求详细分析。
6. 把用户当成年人，也当伙伴：批评给数据，鼓励给事实。

# INPUT RESOLUTION PROTOCOL
每次收到用户消息：
1. **先回答用户的问题**：问的是具体问题就直接答（如"明天复习什么"→直接给科目+章节+动作），不要先绕流程。
2. **再扫描告警**：检测到 [CRITICAL] 或 [HIGH] 告警（凌晨活跃、科目断层、DDL超期、娱乐超标）时，第一句用数据点出。
3. **只有需要推荐任务/给学习安排时**，才跑 STATE → TASK MATCHING 决策矩阵。

# STATE → TASK MATCHING（状态感知决策矩阵 — 最高优先级）
你在推荐任何任务之前，必须先评估用户当前状态，按以下矩阵匹配任务类型。禁止跳过此步骤直接推任务。

## 第一步：状态评估
从「状态感知报告」和上方数据中提取：
- 当前时段：{period}（高能量 / 中能量 / 低能量）
- 今日已学习：{today_study_hours:.1f}h（充足 / 不足 / 为零）
- 当前前台活动：从状态感知报告的"前台类别"字段获取（在学习 / 在娱乐 / 未知）
- 活跃上下文：从状态感知报告的"activityContext"获取

## 第二步：决策矩阵

### 时段能量 + 科目难度匹配
| 时段 | 能量 | 适合科目 |
|---|---|---|
| 清晨 6:00-9:00 | ⚡⚡⚡ 峰值 | 电子技术（刷题/理解）、高数（新概念）— 最难科目 |
| 上午 9:00-12:00 | ⚡⚡ 高 | 电子技术、高数、英语阅读 — 需要专注 |
| 中午 12:00-14:00 | ⚡ 中 | 政治（记忆类）、英语单词 — 低认知负荷 |
| 下午 14:00-18:00 | ⚡⚡ 高 | 高数、英语、电子技术 — 第二轮专注窗口 |
| 晚上 18:00-21:00 | ⚡ 中 | 政治、英语听力、错题整理 — 巩固类 |
| 深夜 21:00+ | ↓ 低 | 仅复习今日笔记、背单词 — 不布置新概念 |

### 已学习时长 + 任务量匹配
| 今日已学 | 建议 |
|---|---|
| 0h | 先启动，给一个 25 分钟番茄钟任务。不计较科目，先动起来 |
| < 2h | 按科目优先级补断层，连续安排 2-3 个番茄钟 |
| 2-4h | 检查四科覆盖是否均匀，补最弱一科 |
| > 4h | 巩固 + 错题，不追加高难度新任务 |

### 当前状态 + 应对策略
| 用户状态信号 | 应对 |
|---|---|
| 说"累""困""学不动" | 不推新任务。追问精力差的原因（睡眠？饮食？），给 15 分钟轻量任务 |
| 说"不知道学什么" | 直接查科目断层 → 给一个具体到章节的任务 |
| 凌晨还在活跃 | 不推任何任务。强制催促睡觉，明天再战 |
| 连胜即将中断（今日学习 < 30min 且已超过 20:00）| 紧急抢救：给一个 20 分钟任意科目冲刺任务保住连胜 |
| 正在娱乐应用中 | 直接指出"你正在刷XX，关了它，打开课本" |

## 第三步：验证
推荐任务前自检三个问题：
1. 现在是几点？这个时段适合这个科目吗？
2. 用户今天学了多久？还能承受多大强度？
3. 这个科目多久没复习了？比别的科目更需要吗？

三个问题都通过后，才允许推荐任务或调用 [ACTION:add_task]。

---

# EXECUTION TEMPLATES

## 重要事项操作（独立于任务系统）
用户提到某个"要记住的事"、"提醒"、"别忘了"、"重要日期"等，应该创建重要事项而非任务：
- [ACTION:add_important] {{"title":"事项标题","content":"详细内容","priority":"high或normal","remindAt":"14:30"}} — 创建重要事项，remindAt 为 HH:MM 格式，系统会提前1小时语音提醒
- [ACTION:complete_important] {{"title":"事项关键词"}} — 标记完成
- [ACTION:delete_important] {{"title":"事项关键词"}} — 删除事项
重要事项 vs 任务的区别：任务是有执行动作的（如"做高数题"），重要事项是时间锚点（如"下午3点交作业""明天考试""14:00开会"）。

## 触发条件：[科目断层 == TRUE] 或 [科目不平衡 == TRUE]
当检测到某科目断层（如：电子技术 7 天未复习）或极端不平衡时，按以下三步执行：
1. 【历史审计】：直接报出该科目的累计分钟数、上次复习时间、进度缺口百分比。
2. 【时间切片补偿】：读取今日课表的空白时段，给出具体的补偿时间段建议。
3. 【任务下发】：如果用户同意或沉默接受，调用 [ACTION:add_task] 写入任务。如果已有同名或同科目未完成任务，先说明已有任务再决定是否追加。严禁重复添加已在任务列表中的任务。

## 触发条件：[娱乐超标 == TRUE] 或 [碎片化 == TRUE]
当学习占比 < 30% 或切换会话 > 12 次时：
1. 立即停止任何技术概念讲解或闲聊。
2. 强迫用户进行【极简状态声明】：要求用户在 30 字内说出当前卡在哪个具体概念/阻碍上。
3. 要求用户承诺一个 15 分钟断网冲刺目标。仅在用户明确承诺后，才下发一个 15 分钟临时任务。

## 触发条件：[DDL超期 == TRUE]
1. 直接列出所有超期任务名称和超期天数。
2. 按"专升本关联度"重新排序（电子技术 > 高数 > 英语 > 政治 > 其他）。
3. 强制用户选择：A) 立即处理排序第一的任务，B) 声明放弃该任务并用 [ACTION:delete_task] 删除。

# PDF KNOWLEDGE BASE（动态加载自《建立知识体系，一年顶别人十年》）
""" + (f"""
{knowledge_base}
""" if knowledge_base else "") + f"""# KNOWLEDGE SYSTEM MODULES（知识体系五模块 — 基于"一年顶十年"方法论）

## 模块1：知识漏洞分析（对应第6课：三步定位法）
当用户说"帮我分析薄弱点"、"我哪里不行"、"知识漏洞"时：
1. 扫描各科的 chapterDetails（章节掌握状态），找出 mastery="learning" 或 "review_needed" 的章节
2. 按「科目权重 × 未掌握章节数 × 距上次复习天数」排序，输出 TOP 5 薄弱章节
3. 对每个薄弱章节给出：缺少哪类知识？（程序性/概念性/事实性）→ 推荐学习材料类型
4. 调用 [ACTION:chapter_mastery] 标记用户确认的掌握状态变化

## 模块2：自测模式（对应第11课：自我测试法）
当用户说"测我"、"出题"、"考考我"时：
1. 根据用户指定的科目/章节，从考纲中选取一个知识点
2. 生成 1 道测试题（单选/填空/简答），要求用户回答
3. 用户回答后判定正误，指出知识漏洞
4. 若回答错误 → 调用 [ACTION:chapter_mastery] 将该章节标记为 "review_needed"
5. 若连续两次答对 → 建议将该章节 mastery 升级为 "mastered"

## 模块3：间隔复习调度（对应第11课：复习方法）
当用户询问"该复习什么"或在今日学习为零时主动扫描：
1. 检查各科 chapterDetails 中的 nextReviewDate
2. 列出今天到期的复习项（nextReviewDate <= today）
3. 按艾宾浩斯间隔（1/2/4/7/15/30天）安排复习优先级
4. 对超期未复习的章节发送 [ACTION:chapter_mastery] 降级为 "review_needed"

## 模块4：周计划生成（对应第7课+第12课：定期制定学习计划）
当用户说"帮我规划这周"、"周计划"时：
1. 读取考纲各章节，计算剩余章节数 vs 距考试天数
2. 读取课表空白时段，为每天分配学习时段
3. 按「早晨最难科目 → 下午中难 → 晚上轻松复习」分配
4. 输出周一至周日的每日学习计划（含具体章节 + 预估时间）
5. 若检测到某科严重落后 → 在周计划中增加该科补偿时间

## 模块5：刻意练习记录（对应第12课：第五板斧）
当用户说"做了XX"、"完成XX"、"练了XX"时：
1. 追问：用了哪个清单？效果如何？下次改进什么？
2. 调用 [ACTION:add_practice_log] 记录练习复盘

---
# NEW ACTIONS（知识体系专用，在前述 actions 基础上追加）

- [ACTION:chapter_mastery] {{"subject":"electronics","chapter":"运算放大器","mastery":"learning|review_needed|mastered"}} — 更新章节掌握等级
- [ACTION:add_checklist] {{"title":"清单标题","type":"execute或verify","items":["步骤1","步骤2"],"subject":"electronics","chapterName":"运算放大器"}} — 创建学习清单
- [ACTION:add_practice_log] {{"subject":"electronics","chapter":"运算放大器","checklistUsed":"运算放大器解题清单","result":"正确率80%","nextAction":"加强共模抑制比理解"}} — 记录刻意练习

# ANTI-COMPETENCE ILLUSION PROTOCOL（防认知逃避协议）
当用户口头声明"某知识点看懂了"、"某道题做完了"、"这个章节过了"或请求更新科目进度时：
1. 严禁直接相信并盲目调用 [ACTION:update_subject_progress]。
2. 你必须立刻启动【费曼逆向推导拦截】。从你的知识库中，提取该知识点的核心逻辑死穴。
3. 随机向用户抛出 1 个高强度的逆向追问。
4. 只有当用户回答出核心逻辑，或主动承认存在模糊点时，你才能解锁进度更新权限。如果发现模糊点，针对性地生成一个局部的"原子补丁任务"并强制下发 [ACTION:add_task]。

# 当前状态
时间: {current_time}（{today_full}）
用户: {context.get('user_name', '专升本考生')} | 目标: {context.get('exam_target', '2027年广东专升本考试，目标公办本科院校')}
科目权重: 电子技术(200分) | 英语(100分) | 高数(100分) | 政治(100分)
连胜: {context.get('streak_days', 0)}天 | 今日已学: {today_study_hours:.1f}h | 未完成任务: {len(current_tasks)}个

{chr(10).join(subject_snapshot_lines)}

{syllabus_text}

{context.get('system_state', '')}

【用户记忆】
{chr(10).join(f'[{mem.get("type", "")}] {mem.get("content", "")}' for mem in memories[:5]) if memories else '无'}

【未完成任务】
{chr(10).join(f'- {t.get("title", "")} (DDL: {t.get("deadline", "无")}, {t.get("duration", 0)}分钟)' for t in current_tasks[:10]) if current_tasks else '无'}

【行为准则 - 硬核版】
0. ⏰【时间铁律】现在是 {current_time}。**每次回复前必须先看这个时间**：涉及计划安排、时段判断、复习安排、课程状态判断，全部以当前时间为基准作答，禁止凭感觉或记忆推断现在几点；用户问时间直接回答；21:00 后提醒休息；凌晨（0:00-6:00）强制催促睡觉、不推任何新任务。
1. 每次回复前先执行 STATE → TASK MATCHING 决策矩阵（状态评估 → 时段匹配 → 任务验证），再扫描告警，最后才推任务。不跳过矩阵直接推任务就是失职。
2. 「今日课程时间线」是算法精确计算的结果（已结束/进行中/即将开始），提到课程时必须以此为准。
3. 「算法建议」必须逐条传达给用户，不可遗漏。
4. 「教练重点关注」的话题必须在对话中主动触及。
5. 电子技术（200分）每天必安排。高数薄弱时优先补高数。
6. ⚠️ 【ACTION 纪律】调用 [ACTION:add_task] 前必须先扫描上方【未完成任务】列表，确认不存在标题相似的任务。如果已存在，说明情况并拒绝重复添加。宁可少加，不可多加。
7. 每轮对话最多调用 1 次 [ACTION:add_task]，除非用户明确要求批量添加。
8. 📚 【笔记引用纪律】涉及知识点讲解、概念解释、复习建议时，优先引用「SecondBrain 笔记检索」中的内容（它是用户笔记的语义检索结果，与用户记忆一致）；检索段不足时再用模型知识补充，并明确区分"你笔记里记的是..."与"补充说明..."。

用户说：{user_message}"""
    return prompt


# ===== SecondBrain 工具函数 =====

def _sb_atomic_write(path, content):
    """原子写：写临时文件 → os.replace，避免半写状态；自动创建父目录"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def _sb_parse_date(s):
    if not s:
        return None
    try:
        return datetime.strptime(str(s).strip(), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _sb_read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _sb_parse_tracker(text):
    """解析复习追踪器 markdown 表格。
    返回 (header_cols, rows)；rows = [{id(数据行序号，从1起), subject, point, lastStudyDate, line_no, cells}]
    容错：表头缺失 → 空列表；行损坏（列数不足/日期非法）→ 跳过该行不崩。
    """
    lines = text.splitlines()
    header_idx = None
    header_cols = []  # 各数据行的列在 split("|") 后的下标：date/point/subject/intervals...
    for i, line in enumerate(lines):
        if "学习日期" in line and "知识点" in line and "科目" in line:
            cells = line.split("|")
            if any("天" in c for c in cells):
                header_idx = i
                header_cols = cells
                break
    if header_idx is None:
        return [], []
    rows = []
    rid = 0
    for line_no in range(header_idx + 1, len(lines)):
        line = lines[line_no].strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 3 + len(TRACKER_INTERVALS):
            continue  # 列数不足 → 损坏行
        date = _sb_parse_date(cells[0])
        point = cells[1]
        subject = cells[2]
        if date is None or not point or not subject:
            continue  # 日期非法/关键字段缺失 → 损坏行
        rid += 1
        rows.append({
            "id": rid,
            "subject": subject,
            "point": point,
            "lastStudyDate": date.strftime("%Y-%m-%d"),
            "line_no": line_no,
            "cells": cells,
        })
    return header_cols, rows


def _sb_tracker_due_items(rows, today):
    """到期判定：学习日期 + 间隔天 <= 今天 → 到期；到期且该列未勾(⬜) → 需要复习；已勾(✅)跳过"""
    today_d = _sb_parse_date(today) or datetime.now().date()
    items = []
    for r in rows:
        study = _sb_parse_date(r["lastStudyDate"])
        if study is None:
            continue
        due, overdue, checked = [], [], []
        col_idx = 3  # 第3列起依次对应 ①1天..⑥30天
        for iv, _h in TRACKER_INTERVALS:
            mark = r["cells"][col_idx]
            col_idx += 1
            due_date = study + timedelta(days=iv)
            if mark == CHECKED_MARK:
                checked.append(iv)
                continue
            if due_date <= today_d:
                due.append(iv)
                od = (today_d - due_date).days
                if od > 0:
                    overdue.append(od)  # 仅真正超期（>0 天）计入，今天到期不算超期
        if due or overdue:
            items.append({
                "id": r["id"],
                "subject": r["subject"],
                "point": r["point"],
                "lastStudyDate": r["lastStudyDate"],
                "due": due,
                "overdue": overdue,
                "checked": checked,
            })
    return items


def _sb_resolve_subject_dir(subject):
    """科目 key/中文名 → 知识库目录名；优先已存在的目录（真实库用 电子技术基础/高数，避免新建空目录）"""
    cn = SUBJECT_CN_MAP.get(subject, subject)
    if os.path.isdir(os.path.join(MISTAKES_DIR, cn)):
        return cn
    for alias in SUBJECT_DIR_ALIASES.get(cn, []):
        if os.path.isdir(os.path.join(MISTAKES_DIR, alias)):
            return alias
    return cn


def _sb_safe_filename(name):
    """清洗文件名中的非法字符（Windows 禁止 \\ / : * ? " < > |）"""
    return re.sub(r'[\\/:*?"<>|]+', "-", str(name).strip()) or "未命名"


def _sb_mistake_section(data, error_tags, subject_cn):
    return (
        f"## 题目\n{data.get('stem', '')}\n\n"
        f"## 我的答案\n{data.get('userAnswer', '')}\n\n"
        f"## 正确答案\n{data.get('answer', '')}\n\n"
        f"## 错因\n{'、'.join(error_tags)}\n\n"
        f"## 解析\n{data.get('analysis', '')}\n"
    )


def _sb_mistake_frontmatter(data, error_tags, subject_cn, date):
    return (
        "---\n"
        f"subject: {subject_cn}\n"
        f"chapter: {data.get('chapter', '')}\n"
        f"date: {date}\n"
        f"errorTags: [{', '.join(error_tags)}]\n"
        "---\n"
    )


def _sb_section(text, title):
    """提取 markdown 中 '## <title>'（或 '# <title>'）之后的正文段（到下一个 # 标题或 --- 为止）"""
    lines = text.splitlines()
    result = []
    collecting = False
    for line in lines:
        stripped = line.strip()
        if collecting:
            if stripped.startswith("#") or stripped.startswith("---"):
                break
            result.append(stripped)
        elif stripped in (f"## {title}", f"# {title}"):
            collecting = True
    return "\n".join(result).strip()


def _sb_parse_mistake_file(path):
    """解析错题 .md：优先 frontmatter，缺失字段回退到标题/文件名"""
    try:
        text = _sb_read_text(path)
    except OSError:
        return None
    meta = {}
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            for line in text[3:end].splitlines():
                line = line.strip()
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
    date = meta.get("date", "") or meta.get("created", "")
    if not date:
        m = re.match(r"(\d{4}-\d{2}-\d{2})", os.path.basename(path))
        if m:
            date = m.group(1)
    error_tags = meta.get("errorTags", "")
    error_tags = [t.strip() for t in str(error_tags).strip("[]").split(",") if t.strip()]
    return {
        "subject": meta.get("subject", ""),
        "chapter": meta.get("chapter", ""),
        "stem": meta.get("stem", "") or _sb_section(text, "题目"),
        "answer": meta.get("answer", "") or _sb_section(text, "正确答案"),
        "userAnswer": meta.get("userAnswer", "") or _sb_section(text, "我的答案"),
        "errorTags": error_tags,
        "date": date,
    }


def _sb_read_state():
    """读学习状态：文件不存在/损坏 → 返回空 {}（不 500）"""
    if not os.path.exists(STATE_PATH):
        return {}
    try:
        data = json.loads(_sb_read_text(STATE_PATH))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


class APIHandler(http.server.BaseHTTPRequestHandler):

    def _patina_connect(self):
        if not os.path.exists(PATINA_DB):
            return None
        conn = sqlite3.connect(f"file:{PATINA_DB}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn

    def _patina_subject(self, title):
        if not title:
            return None
        t = title.lower()
        kw = {
            "electronics": ["电子","电路","模电","数电","三极管","放大器","BJT","运放","卡诺图","逻辑","触发器"],
            "math": ["高数","数学","微积分","导数","积分","极限","线代","方程"],
            "english": ["英语","单词","阅读","语法","作文","翻译","词汇","reading"],
            "politics": ["政治","马原","毛概","中国式","二十大","时政","唯物"],
        }
        for subj, kws in kw.items():
            if any(k in t for k in kws):
                return subj
        return None

    def _handle_patina(self, parsed):
        params = dict(urllib.parse.parse_qsl(parsed.query))
        try:
            days = max(1, min(int(params.get("days", 14)), 365))
        except ValueError:
            days = 14
        conn = self._patina_connect()
        if not conn:
            self.wfile.write(json.dumps({"error":"Patina DB not found","available":False}).encode())
            return

        try:
            if parsed.path == "/patina/history":
                since = datetime.now() - timedelta(days=days)
                ts = int(since.timestamp() * 1000)
                rows = conn.execute(
                    "SELECT app_name, exe_name, window_title, duration, datetime(start_time/1000,'unixepoch','localtime') as dt FROM sessions WHERE start_time>=?", (ts,)
                ).fetchall()
                web_rows = conn.execute(
                    "SELECT domain, title, duration, datetime(start_time/1000,'unixepoch','localtime') as dt FROM web_activity_segments WHERE start_time>=?", (ts,)
                ).fetchall()
                history = []
                for r in rows:
                    title = r["window_title"] or ""
                    app = (r["app_name"] or r["exe_name"] or "").lower()
                    subject = self._patina_subject(title)
                    if subject:
                        cat = "study"
                    elif app in ("msedge", "chrome", "firefox"):
                        cat = "browser"
                    elif app in ("哔哩哔哩", "cloudmusic"):
                        cat = "entertainment"
                    else:
                        cat = "other"
                    history.append({"window_title":title,"process_name":r["app_name"] or r["exe_name"],"category":cat,"start_time":r["dt"],"duration_seconds":max(0,(r["duration"] or 0)//1000),"date":(r["dt"] or "")[:10]})
                for w in web_rows:
                    title = w["title"] or w["domain"] or ""
                    history.append({"window_title":f"[Web] {w['domain']} - {title}","process_name":"browser-web","category":"study" if self._patina_subject(title) else "browser","start_time":w["dt"],"duration_seconds":max(0,(w["duration"] or 0)//1000),"date":(w["dt"] or "")[:10]})
                conn.close()
                self.wfile.write(json.dumps(history, ensure_ascii=False).encode())

            else:
                self.wfile.write(json.dumps({"error":"unknown"}).encode())
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # ===== SecondBrain 路由（GET） =====

    def _sb_review_due(self):
        if not os.path.exists(TRACKER_PATH):
            self.wfile.write(json.dumps({"error": "复习追踪器文件不存在"}).encode())
            return
        try:
            text = _sb_read_text(TRACKER_PATH)
        except OSError:
            self.wfile.write(json.dumps({"error": "复习追踪器读取失败"}).encode())
            return
        _cols, rows = _sb_parse_tracker(text)
        items = _sb_tracker_due_items(rows, datetime.now().date())
        self.wfile.write(json.dumps({"items": items}, ensure_ascii=False).encode())

    def _sb_mistakes_get(self, parsed):
        params = dict(urllib.parse.parse_qsl(parsed.query))
        subject = params.get("subject", "")
        if not subject:
            self.wfile.write(json.dumps({"error": "缺少 subject 参数"}).encode())
            return
        if subject not in MISTAKE_SUBJECT_ALLOW:
            self.wfile.write(json.dumps({"error": "subject 参数不合法"}).encode())
            return
        try:
            days = max(1, min(int(params.get("days", "14")), 365))
        except ValueError:
            days = 14
        cn = _sb_resolve_subject_dir(subject)
        dir_path = os.path.join(MISTAKES_DIR, cn, "错题")
        if not os.path.isdir(dir_path):
            self.wfile.write(json.dumps({"items": []}).encode())
            return
        cutoff = datetime.now().date() - timedelta(days=days)
        items = []
        try:
            fnames = sorted(os.listdir(dir_path), reverse=True)
        except OSError:
            fnames = []
        for fname in fnames:
            if not fname.endswith(".md"):
                continue
            item = _sb_parse_mistake_file(os.path.join(dir_path, fname))
            if not item:
                continue
            d = _sb_parse_date(item["date"])
            if d is None or d < cutoff:
                continue
            items.append(item)
        self.wfile.write(json.dumps({"items": items}, ensure_ascii=False).encode())

    def _sb_diary_get(self, parsed):
        params = dict(urllib.parse.parse_qsl(parsed.query))
        date = params.get("date", "")
        if _sb_parse_date(date) is None:
            self.wfile.write(json.dumps({"error": "date 参数格式应为 YYYY-MM-DD"}).encode())
            return
        path = os.path.join(DIARY_DIR, f"{date}.md")
        if not os.path.exists(path):
            self.wfile.write(json.dumps({"exists": False, "content": ""}).encode())
            return
        try:
            content = _sb_read_text(path)
        except OSError:
            self.wfile.write(json.dumps({"error": "日记读取失败"}).encode())
            return
        self.wfile.write(json.dumps({"exists": True, "content": content}, ensure_ascii=False).encode())

    def _sb_state_get(self):
        self.wfile.write(json.dumps({"state": _sb_read_state()}, ensure_ascii=False).encode())

    # ===== SecondBrain 路由（POST） =====

    def _sb_review_check(self, data):
        if not os.path.exists(TRACKER_PATH):
            self._respond({"error": "复习追踪器文件不存在"})
            return
        try:
            text = _sb_read_text(TRACKER_PATH)
        except OSError:
            self._respond({"error": "复习追踪器读取失败"})
            return
        _cols, rows = _sb_parse_tracker(text)
        target = None
        for r in rows:
            if r["id"] == data.get("id"):
                target = r
                break
        if target is None:
            self._respond({"error": f"未找到 id={data.get('id')} 的复习项"})
            return
        if data.get("subject") and target["subject"] != data.get("subject"):
            self._respond({"error": "科目不匹配"})
            return
        if data.get("point") and target["point"] != data.get("point"):
            self._respond({"error": "知识点不匹配"})
            return
        study = _sb_parse_date(target["lastStudyDate"])
        today = datetime.now().date()
        lines = text.splitlines()
        parts = lines[target["line_no"]].split("|")
        checked_iv = None
        # 原始行按 "|" 拆分后：parts[0] 为空，date/point/subject 在 1..3，间隔列从 4 起
        for pos, (iv, _h) in enumerate(TRACKER_INTERVALS):
            col = 4 + pos
            if col >= len(parts) - 1:
                break
            if parts[col].strip() != UNCHECKED_MARK:
                continue
            if study + timedelta(days=iv) > today:
                continue
            parts[col] = " " + CHECKED_MARK + " "
            checked_iv = iv
            break
        if checked_iv is None:
            self._respond({"ok": True, "checked": None})
            return
        lines[target["line_no"]] = "|".join(parts)
        try:
            _sb_atomic_write(TRACKER_PATH, "\n".join(lines) + "\n")
        except OSError:
            self._respond({"error": "复习追踪器写入失败"})
            return
        self._respond({"ok": True, "checked": checked_iv})

    def _sb_review_add(self, data):
        """登记新知识点到复习追踪器（学习日期=今天，追加一行）"""
        subject = str(data.get("subject", "")).strip()
        point = str(data.get("point", "")).strip()
        if not subject or not point:
            self._respond({"error": "缺少 subject/point 字段"})
            return
        cn_map = {"电子": "电子", "电子技术": "电子", "电子技术基础": "电子",
                  "高数": "高数", "高等数学": "高数", "数学": "高数",
                  "英语": "英语", "政治": "政治"}
        subject = cn_map.get(subject, subject)
        today = datetime.now().strftime("%Y-%m-%d")
        row = f"| {today} | {point} | {subject} | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |"
        try:
            if os.path.exists(TRACKER_PATH):
                text = _sb_read_text(TRACKER_PATH)
                content = text.rstrip("\n") + "\n" + row + "\n"
            else:
                content = TRACKER_HEADER + row + "\n"
            _sb_atomic_write(TRACKER_PATH, content)
        except OSError:
            self._respond({"error": "复习追踪器写入失败"})
            return
        self._respond({"ok": True, "date": today})

    def _sb_mistakes_post(self, data):
        subject = str(data.get("subject", "")).strip()
        stem = str(data.get("stem", "")).strip()
        if not subject or not stem:
            self._respond({"error": "缺少 subject/stem 字段"})
            return
        if subject not in MISTAKE_SUBJECT_ALLOW:
            self._respond({"error": "subject 参数不合法"})
            return
        date = str(data.get("date", "")).strip() or datetime.now().strftime("%Y-%m-%d")
        if _sb_parse_date(date) is None:
            self._respond({"error": "date 格式应为 YYYY-MM-DD"})
            return
        error_tags = data.get("errorTags") or []
        if isinstance(error_tags, str):
            error_tags = [error_tags]
        error_tags = [str(t).strip() for t in error_tags if str(t).strip()]
        keyword = error_tags[0] if error_tags else stem[:10]
        cn = _sb_resolve_subject_dir(subject)
        fname = _sb_safe_filename(f"{date}-{data.get('chapter', '')}-{keyword}") + ".md"
        path = os.path.join(MISTAKES_DIR, cn, "错题", fname)
        section = _sb_mistake_section(data, error_tags, cn)
        try:
            if os.path.exists(path):
                old = _sb_read_text(path)
                content = old.rstrip("\n") + "\n\n---\n\n" + section
            else:
                content = _sb_mistake_frontmatter(data, error_tags, cn, date) + "\n" + section
            _sb_atomic_write(path, content)
        except OSError:
            self._respond({"error": "错题写入失败"})
            return
        self._respond({"ok": True, "file": fname})

    def _sb_diary_post(self, data):
        date = str(data.get("date", "")).strip()
        content = str(data.get("content", "")).strip()
        if _sb_parse_date(date) is None:
            self._respond({"error": "date 格式应为 YYYY-MM-DD"})
            return
        if not content:
            self._respond({"error": "content 不能为空"})
            return
        path = os.path.join(DIARY_DIR, f"{date}.md")
        try:
            if os.path.exists(path):
                old = _sb_read_text(path)
                content = old.rstrip("\n") + "\n\n" + content
            _sb_atomic_write(path, content)
        except OSError:
            self._respond({"error": "日记写入失败"})
            return
        self._respond({"ok": True})

    def _sb_state_post(self, data):
        updates = data.get("updates", {})
        if not isinstance(updates, dict):
            self._respond({"error": "updates 必须为对象"})
            return
        state = _sb_read_state()
        state.update(updates)
        try:
            _sb_atomic_write(STATE_PATH, json.dumps(state, ensure_ascii=False, indent=2))
        except OSError:
            self._respond({"error": "状态写入失败"})
            return
        self._respond({"ok": True})

    def do_OPTIONS(self):
        self.send_response(200)
        origin = _allowed_origin(self)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            self._dispatch_get()
        except Exception as e:
            import traceback
            err_msg = f"GET {self.path}: {e}\n{traceback.format_exc()}"
            try:
                with open(os.path.join(os.path.dirname(__file__), "api_error.log"), "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now()}] {err_msg}\n\n")
            except Exception:
                pass
            try:
                self.wfile.write(json.dumps({"error": "服务器内部错误"}).encode())
            except Exception:
                pass

    def _dispatch_get(self):
        origin = _allowed_origin(self)
        self.send_response(200)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

        parsed = urllib.parse.urlparse(self.path)

        if parsed.path.startswith("/patina"):
            self._handle_patina(parsed)
            return

        if parsed.path == "/activity/stats":
            today = datetime.now().strftime("%Y-%m-%d")
            if os.path.exists(DB_PATH):
                conn = get_db()
                try:
                    # 按 process_name + window_title 分组，避免同进程多标签页被整体误分类
                    rows = conn.execute("""
                        SELECT process_name, category, SUM(duration_seconds) as total_sec,
                               COUNT(*) as sessions, window_title
                        FROM activity WHERE date=? AND is_idle=0 GROUP BY process_name, window_title
                        ORDER BY total_sec DESC
                    """, (today,)).fetchall()

                    # 空闲总时长
                    idle = conn.execute(
                        "SELECT COALESCE(SUM(duration_seconds), 0) FROM activity WHERE date=? AND is_idle=1",
                        (today,)
                    ).fetchone()[0]

                    # 各类别汇总（原始分类）
                    cat_rows = conn.execute("""
                        SELECT category, SUM(duration_seconds) FROM activity
                        WHERE date=? AND is_idle=0 GROUP BY category
                    """, (today,)).fetchall()
                finally:
                    conn.close()

                # ===== 浏览器二次打标 =====
                apps_raw = []
                for r in rows:
                    proc = r[0]
                    cat = r[1]
                    total_sec = r[2]
                    sessions = r[3]
                    title = r[4] or ""
                    corrected_cat = cat
                    matched_subject = None

                    if cat == "browser" and title:
                        corrected_cat, matched_subject = reclassify_browser(title, proc)

                    apps_raw.append({
                        "appName": proc,
                        "category": cat,
                        "correctedCategory": corrected_cat,
                        "matchedSubject": matched_subject,
                        "duration": total_sec // 60,
                        "durationSeconds": total_sec,
                        "sessions": sessions,
                        "title": title,
                    })

                # ===== 修正后聚合 =====
                # 按修正后的 category 重新汇总
                corrected_categories = {}
                browser_reclassified_sec = 0  # 从 browser 抢救回来的秒数
                browser_remaining_sec = 0      # browser 中未能抢救的秒数
                for a in apps_raw:
                    cat = a["correctedCategory"]
                    corrected_categories[cat] = corrected_categories.get(cat, 0) + a["durationSeconds"]
                    if a["category"] == "browser" and a["correctedCategory"] == "study":
                        browser_reclassified_sec += a["durationSeconds"]
                    elif a["category"] == "browser":
                        browser_remaining_sec += a["durationSeconds"]

                # 有效学习时间（秒）
                effective_study_sec = corrected_categories.get("study", 0)
                # 干扰时间
                distraction_sec = (
                    corrected_categories.get("entertainment", 0) +
                    corrected_categories.get("social", 0) +
                    browser_remaining_sec
                )

                total_active = sum(a["duration"] for a in apps_raw)

                # ===== 输出 apps（合并同类进程的修正结果）=====
                # 按进程名 + 修正分类聚合
                merged = {}
                for a in apps_raw:
                    key = (a["appName"], a["correctedCategory"])
                    if key not in merged:
                        merged[key] = {
                            "appName": a["appName"],
                            "category": a["correctedCategory"],
                            "originalCategory": a["category"],
                            "matchedSubject": a["matchedSubject"],
                            "duration": 0,
                            "sessions": 0,
                            "title": a["title"],
                        }
                    merged[key]["duration"] += a["duration"]
                    merged[key]["sessions"] += a["sessions"]
                apps = sorted(merged.values(), key=lambda x: x["duration"], reverse=True)

                self.wfile.write(json.dumps({
                    "apps": apps,
                    "categories": {c: t // 60 for c, t in corrected_categories.items()},
                    "rawCategories": {c: t // 60 for c, t in cat_rows},
                    "idleMinutes": idle // 60,
                    "totalActiveMinutes": total_active,
                    "effectiveStudyMinutes": effective_study_sec // 60,
                    "distractionMinutes": distraction_sec // 60,
                    "browserReclassifiedMinutes": browser_reclassified_sec // 60,
                    "browserRemainingMinutes": browser_remaining_sec // 60,
                    "date": today,
                    "credibilityNote": "browser类已根据窗口标题关键词二次打标，命中关键词的计入study，未命中的计入distraction"
                }, ensure_ascii=False).encode())
            else:
                self.wfile.write(json.dumps({
                    "apps": [], "categories": {}, "idleMinutes": 0,
                    "totalActiveMinutes": 0, "effectiveStudyMinutes": 0,
                    "distractionMinutes": 0,
                }).encode())

        elif parsed.path == "/activity/raw":
            if os.path.exists(DB_PATH):
                conn = get_db()
                try:
                    rows = conn.execute("SELECT window_title, process_name, category, start_time, duration_seconds, date, is_idle FROM activity ORDER BY id DESC LIMIT 50").fetchall()
                finally:
                    conn.close()
                data = [{
                    "window_title": r[0], "process_name": r[1], "category": r[2],
                    "start_time": r[3], "duration_seconds": r[4], "date": r[5],
                    "is_idle": bool(r[6])
                } for r in rows]
                self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode())
            else:
                self.wfile.write(json.dumps({"error": "no data yet"}).encode())

        elif parsed.path == "/activity/history":
            # 历史明细（供趋势图/小时分布），返回与 /activity/raw 同构的数组
            params = urllib.parse.parse_qs(parsed.query)
            try:
                days = max(1, min(int(params.get("days", ["7"])[0]), 365))
            except ValueError:
                days = 7
            cutoff = (datetime.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
            if os.path.exists(DB_PATH):
                conn = get_db()
                try:
                    rows = conn.execute("""
                        SELECT window_title, process_name, category, start_time, duration_seconds, date
                        FROM activity
                        WHERE date >= ? AND is_idle = 0
                        ORDER BY date DESC, start_time DESC
                    """, (cutoff,)).fetchall()
                finally:
                    conn.close()
                data = [{
                    "window_title": r[0] or "", "process_name": r[1] or "",
                    "category": r[2] or "other", "start_time": r[3] or "",
                    "duration_seconds": r[4], "date": r[5],
                } for r in rows]
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode())
            else:
                self.wfile.write(json.dumps([]).encode())

        elif parsed.path == "/health":
            self.wfile.write(json.dumps({"status": "ok", "db_exists": os.path.exists(DB_PATH)}).encode())

        elif parsed.path == "/secondbrain/review-due":
            self._sb_review_due()

        elif parsed.path == "/secondbrain/mistakes":
            self._sb_mistakes_get(parsed)

        elif parsed.path == "/secondbrain/diary":
            self._sb_diary_get(parsed)

        elif parsed.path == "/secondbrain/state":
            self._sb_state_get()

        elif parsed.path == "/rag/query":
            params = dict(urllib.parse.parse_qsl(parsed.query))
            q = params.get("q", "").strip()
            if not q:
                self.wfile.write(json.dumps({"error": "missing query param q"}).encode())
                return
            try:
                top_k = max(1, min(int(params.get("top_k", "3")), 10))
            except ValueError:
                top_k = 3
            items = rag_query(q, subject=params.get("subject", ""), top_k=top_k)
            self.wfile.write(json.dumps({"items": items}, ensure_ascii=False).encode())

        elif parsed.path == "/schedule/import-from-xls":
            # 从桌面官方课表 XLS 解析课表（ScheduleItem[]，day 1=周一..7=周日）
            items = parse_official_schedule_xls()
            self.wfile.write(json.dumps({"items": items}, ensure_ascii=False).encode())

        else:
            # 未知路由明确报错（此前静默返回 {"ok":true}，导致前端拼错路由无感知）
            self.wfile.write(json.dumps({"error": "not found"}).encode())

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode() if length > 0 else "{}"
        except Exception:
            body = "{}"

        parsed = urllib.parse.urlparse(self.path)

        try:
            self._handle_post(parsed, body)
        except Exception as e:
            import traceback
            err_msg = f"Server error: {e}\n{traceback.format_exc()}"
            # Log to file
            try:
                with open(os.path.join(os.path.dirname(__file__), "api_error.log"), "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now()}] {parsed.path}\n{err_msg}\n\n")
            except Exception:
                pass
            try:
                self.send_response(500)
                origin = _allowed_origin(self)
                if origin:
                    self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "服务器内部错误", "success": False}).encode())
            except Exception:
                pass

    def _respond(self, data):
        self.send_response(200)
        origin = _allowed_origin(self)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    @staticmethod
    def _deepseek_error(resp):
        return "服务器内部错误"

    def _handle_post(self, parsed, body):
        if parsed.path == "/deepseek/generate-question":
            # AI 出题：按科目+章节生成一道单选题，返回结构化 JSON
            data = json.loads(body)
            api_key = get_api_key()

            if not api_key:
                self._respond({"error": "请先设置DeepSeek API Key", "needKey": True})
                return

            subject = data.get("subject", "")
            chapter = data.get("chapter", "")
            notes = data.get("notes", "")
            subject_names = {
                "english": "英语", "math": "高等数学",
                "politics": "政治", "electronics": "电子技术",
            }
            subject_cn = subject_names.get(subject, subject)

            sys_prompt = (
                "你是广东专升本题库出题员。严格依据考试大纲出题，题目必须对标真题风格，不泛科普。\n"
                "只输出一个 JSON 对象，不要输出任何其他文字，格式如下：\n"
                '{"stem":"题干","options":["选项A文本","选项B文本","选项C文本","选项D文本"],'
                '"answer":"A","analysis":"答案解析（讲清对错原因）","tags":["知识点标签"]}\n'
                "要求：答案字母必须与 options 数组顺序对应；分析要具体，直接讲知识点。"
            )
            user_prompt = f"科目：{subject_cn}；章节：{chapter}；出题数：1 道单选题（四选一）。"
            if notes:
                user_prompt += f"\n参考笔记/薄弱点：{notes}"

            try:
                resp = req_lib.post(
                    "https://api.deepseek.com/chat/completions",
                    json={
                        "model": "deepseek-chat",
                        "messages": [
                            {"role": "system", "content": sys_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "max_tokens": 1500,
                        "response_format": {"type": "json_object"},
                    },
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=60,
                )
                if resp.status_code != 200:
                    self._respond({"error": "服务器内部错误"})
                    return
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                try:
                    q = json.loads(content)
                except Exception:
                    self._respond({"error": "出题结果解析失败，请重试"})
                    return
                if not q.get("stem") or not q.get("options") or not q.get("answer"):
                    self._respond({"error": "出题结果不完整，请重试"})
                    return
                self._respond({
                    "stem": q.get("stem"),
                    "options": q.get("options"),
                    "answer": q.get("answer"),
                    "analysis": q.get("analysis", ""),
                    "tags": q.get("tags", []),
                })
            except Exception:
                self._respond({"error": "服务器内部错误"})

        elif parsed.path == "/api/coach/chat":
            data = json.loads(body)
            user_message = data.get("message", "")
            context = data.get("context", {})

            api_key = get_api_key()

            if not api_key:
                self._respond({"error": "请先设置DeepSeek API Key", "success": False})
                return

            # 完整版硬核教练 prompt（含考纲/知识库/决策矩阵，合并自 deepseek_service.py）
            system_prompt = build_system_prompt(context, user_message)

            # RAG：语义检索 SecondBrain 笔记，注入相关段落（失败静默降级）
            rag_items = rag_query(user_message, top_k=3)
            if rag_items:
                rag_block = "\n\n【SecondBrain 笔记检索（语义相关，权威参考）】\n" + "\n".join(
                    f"① 来源: {i['subject']}/{i['file']} 章节:{i['header']}（相似度{i['score']}%）\n{i['snippet']}"
                    for i in rag_items
                )
                system_prompt = rag_block + "\n\n" + system_prompt

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ]

            try:
                resp = req_lib.post(
                    "https://api.deepseek.com/chat/completions",
                    json={
                        "model": "deepseek-chat",
                        "messages": messages,
                        "max_tokens": 2000,
                    },
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=60,
                )
                if resp.status_code != 200:
                    self._respond({"error": "服务器内部错误", "success": False})
                    return
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                self._respond({"response": content, "success": True})
            except Exception:
                self._respond({"error": "服务器内部错误", "success": False})

        elif parsed.path == "/secondbrain/review-check":
            data = json.loads(body)
            self._sb_review_check(data)

        elif parsed.path == "/secondbrain/review-add":
            data = json.loads(body)
            self._sb_review_add(data)

        elif parsed.path == "/secondbrain/mistakes":
            data = json.loads(body)
            self._sb_mistakes_post(data)

        elif parsed.path == "/secondbrain/diary":
            data = json.loads(body)
            self._sb_diary_post(data)

        elif parsed.path == "/secondbrain/state":
            data = json.loads(body)
            self._sb_state_post(data)

        elif parsed.path == "/rag/query":
            data = json.loads(body)
            q = data.get("q", "").strip()
            if not q:
                self._respond({"error": "missing query q"})
                return
            try:
                top_k = max(1, min(int(data.get("top_k", 3)), 10))
            except (ValueError, TypeError):
                top_k = 3
            items = rag_query(q, subject=data.get("subject", ""), top_k=top_k)
            self._respond({"items": items})

        else:
            # 未知路由明确报错，避免前端拼错路由静默成功
            self._respond({"error": "not found"})

    def log_message(self, format, *args):
        pass

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "19998"))
    # 确保活动表索引存在（幂等，加速按日期统计）
    try:
        conn = get_db()
        conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_date ON activity(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_date_category ON activity(date, category)")
        conn.commit()
        conn.close()
    except Exception:
        pass
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), APIHandler)
        print(f"API Server running on http://127.0.0.1:{port} (multi-threaded)")
        server.serve_forever()
    except OSError as e:
        print(f"FATAL: Cannot bind port {port}: {e}", file=sys.stderr)
        sys.exit(1)