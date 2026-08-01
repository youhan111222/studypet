import http.server
import json
import os
import socketserver
import sqlite3
import sys
import urllib.parse
from datetime import datetime, timedelta

import requests as req_lib

# ===== 按职责拆分的模块（本文件只保留路由与编排） =====
from coach_prompt import build_system_prompt
from rag_service import rag_query
from sb_integration import (
    CHECKED_MARK,
    DIARY_DIR,
    MISTAKE_SUBJECT_ALLOW,
    MISTAKES_DIR,
    STATE_PATH,
    TRACKER_HEADER,
    TRACKER_INTERVALS,
    TRACKER_PATH,
    UNCHECKED_MARK,
    _sb_atomic_write,
    _sb_mistake_frontmatter,
    _sb_mistake_section,
    _sb_parse_date,
    _sb_parse_mistake_file,
    _sb_parse_tracker,
    _sb_read_state,
    _sb_read_text,
    _sb_resolve_subject_dir,
    _sb_safe_filename,
    _sb_tracker_due_items,
)
from schedule_xls import parse_official_schedule_xls

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "activity.db")
DEEPSEEK_KEY_FILE = os.path.join(BASE_DIR, "api_key.txt")
KEYWORDS_FILE = os.path.join(BASE_DIR, "study_keywords.json")
PATINA_DB = os.path.join(os.environ.get("APPDATA", ""), "Patina", "patina.db")

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
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip())
        except (OSError, ValueError):  # .env 缺失或格式错误时静默跳过
            pass


def get_api_key():
    """读取 DeepSeek API Key：优先 .env 环境变量，其次 api_key.txt"""
    env_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if env_key:
        return env_key
    if os.path.exists(DEEPSEEK_KEY_FILE):
        with open(DEEPSEEK_KEY_FILE, encoding="utf-8-sig") as f:
            key = f.read().strip()
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
        with open(KEYWORDS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
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
    except Exception:  # noqa: BLE001 - 搜索边界兜底：任何失败都返回占位结果
        return [{"title": "搜索失败，请稍后重试", "url": "", "snippet": ""}]

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
                since = datetime.now().astimezone() - timedelta(days=days)
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
            except sqlite3.Error:
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
        items = _sb_tracker_due_items(rows, datetime.now().astimezone().date())
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
        cutoff = datetime.now().astimezone().date() - timedelta(days=days)
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
        today = datetime.now().astimezone().date()
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
        today = datetime.now().astimezone().strftime("%Y-%m-%d")
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
        date = str(data.get("date", "")).strip() or datetime.now().astimezone().strftime("%Y-%m-%d")
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
        except Exception as e:  # noqa: BLE001 - 请求边界兜底，统一转 500
            import traceback
            err_msg = f"GET {self.path}: {e}\n{traceback.format_exc()}"
            try:
                with open(os.path.join(os.path.dirname(__file__), "api_error.log"), "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now().astimezone()}] {err_msg}\n\n")
            except OSError:
                pass
            try:
                self.wfile.write(json.dumps({"error": "服务器内部错误"}).encode())
            except OSError:
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
            today = datetime.now().astimezone().strftime("%Y-%m-%d")
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
            cutoff = (datetime.now().astimezone() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
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
        except (OSError, ValueError):  # 读请求体失败按空 body 处理
            body = "{}"

        parsed = urllib.parse.urlparse(self.path)

        try:
            self._handle_post(parsed, body)
        except Exception as e:  # noqa: BLE001 - 请求边界兜底，统一转 500
            import traceback
            err_msg = f"Server error: {e}\n{traceback.format_exc()}"
            # Log to file
            try:
                with open(os.path.join(os.path.dirname(__file__), "api_error.log"), "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now().astimezone()}] {parsed.path}\n{err_msg}\n\n")
            except OSError:
                pass
            try:
                self.send_response(500)
                origin = _allowed_origin(self)
                if origin:
                    self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "服务器内部错误", "success": False}).encode())
            except OSError:
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
                except (json.JSONDecodeError, TypeError):
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
            except Exception:  # noqa: BLE001 - API 边界兜底，统一返回错误
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
            except Exception:  # noqa: BLE001 - API 边界兜底，统一返回错误
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
        # 确保表结构存在（api_server 独立启动/CI 空库时无 activity 表，直接查询会 no such table）
        conn.execute("""CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            window_title TEXT,
            process_name TEXT,
            category TEXT DEFAULT 'other',
            start_time TEXT,
            duration_seconds INTEGER DEFAULT 0,
            date TEXT,
            is_idle INTEGER DEFAULT 0
        )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_date ON activity(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_date_category ON activity(date, category)")
        conn.commit()
        conn.close()
    except sqlite3.Error:
        pass
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), APIHandler)
        print(f"API Server running on http://127.0.0.1:{port} (multi-threaded)")
        server.serve_forever()
    except OSError as e:
        print(f"FATAL: Cannot bind port {port}: {e}", file=sys.stderr)
        sys.exit(1)
