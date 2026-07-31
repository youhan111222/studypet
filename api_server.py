import http.server
import json
import sqlite3
import os
import sys
import urllib.parse
import socketserver
import requests as req_lib
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "activity.db")
DEEPSEEK_KEY_FILE = os.path.join(BASE_DIR, "api_key.txt")
KEYWORDS_FILE = os.path.join(BASE_DIR, "study_keywords.json")
PATINA_DB = os.path.join(os.environ.get("APPDATA", ""), "Patina", "patina.db")

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
        return open(DEEPSEEK_KEY_FILE, encoding="utf-8-sig").read().strip()
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
    for subject, kw_list in keywords.items():
        for kw in kw_list:
            if kw.lower() in title_lower:
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
    except Exception as e:
        return [{"title": f"搜索失败: {e}", "url": "", "snippet": ""}]

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
            days = int(params.get("days", 14))
        except ValueError:
            days = 14
        conn = self._patina_connect()
        if not conn:
            self.wfile.write(json.dumps({"error":"Patina DB not found","available":False}).encode())
            return

        try:
            if parsed.path == "/patina/stats":
                today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                ts = int(today_start.timestamp() * 1000)
                sessions = conn.execute(
                    "SELECT app_name, exe_name, window_title, duration FROM sessions WHERE start_time>=? ORDER BY duration DESC", (ts,)
                ).fetchall()
                web = conn.execute(
                    "SELECT domain, title, duration FROM web_activity_segments WHERE start_time>=? AND domain!='' ORDER BY duration DESC", (ts,)
                ).fetchall()
                apps, seen = [], {}
                for s in sessions:
                    key = s["app_name"] or s["exe_name"]
                    title = s["window_title"] or ""
                    subject = self._patina_subject(title)
                    dur = max(0, (s["duration"] or 0) // 60000)
                    if key in seen:
                        seen[key]["duration"] += dur
                        continue
                    cat = "study" if subject else "browser" if key in ("msedge","chrome","firefox") else "entertainment" if key in ("哔哩哔哩","cloudmusic") else "other"
                    seen[key] = {"appName":key,"category":cat,"matchedSubject":subject,"duration":dur,"title":title}
                domains = {}
                for w in web:
                    d = w["domain"] or "unknown"
                    if d not in domains:
                        domains[d] = {"domain":d,"duration":0,"subject":self._patina_subject(w["title"] or d)}
                    domains[d]["duration"] += max(0, (w["duration"] or 0) // 60000)
                apps = sorted(seen.values(), key=lambda x: x["duration"], reverse=True)
                study_min = sum(a["duration"] for a in apps if a["category"]=="study" or a["matchedSubject"])
                total_min = sum(a["duration"] for a in apps)
                conn.close()
                self.wfile.write(json.dumps({
                    "source":"patina","apps":apps,
                    "webDomains":sorted(domains.values(),key=lambda x:x["duration"],reverse=True)[:20],
                    "totalActiveMinutes":total_min,"effectiveStudyMinutes":study_min,
                    "date":today_start.strftime("%Y-%m-%d")
                }, ensure_ascii=False).encode())

            elif parsed.path == "/patina/history":
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

            elif parsed.path == "/patina/health":
                conn.close()
                self.wfile.write(json.dumps({"available":True,"db_path":PATINA_DB,"size_mb":round(os.path.getsize(PATINA_DB)/(1024*1024),2)}).encode())
            else:
                self.wfile.write(json.dumps({"error":"unknown"}).encode())
        finally:
            try:
                conn.close()
            except Exception:
                pass
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
                self.wfile.write(json.dumps({"error": str(e)}).encode())
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
                rows = conn.execute("""
                    SELECT process_name, category, SUM(duration_seconds) as total_sec,
                           COUNT(*) as sessions, window_title
                    FROM activity WHERE date=? AND is_idle=0 GROUP BY process_name
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

        elif parsed.path == "/activity/audit":
            # 数据审计：返回可信度分层 + 有效学习时间
            today = datetime.now().strftime("%Y-%m-%d")
            if not os.path.exists(DB_PATH):
                self.wfile.write(json.dumps({"error": "no data"}).encode())
                return

            conn = get_db()
            # 拿原始明细（非聚合），逐条审计
            rows = conn.execute("""
                SELECT process_name, category, window_title, duration_seconds, start_time, is_idle
                FROM activity WHERE date=? ORDER BY start_time
            """, (today,)).fetchall()
            idle_row = conn.execute(
                "SELECT COALESCE(SUM(duration_seconds), 0) FROM activity WHERE date=? AND is_idle=1",
                (today,)
            ).fetchone()[0]
            conn.close()

            records = []
            study_sec = 0
            browser_study_sec = 0
            browser_other_sec = 0
            entertainment_sec = 0
            social_sec = 0
            other_sec = 0
            idle_sec = idle_row

            for r in rows:
                proc = r[0]
                cat = r[1]
                title = r[2] or ""
                dur = r[3]

                credibility = "high"
                effective = False

                if cat == "study":
                    credibility = "high"
                    effective = True
                    study_sec += dur
                elif cat == "browser":
                    new_cat, matched = reclassify_browser(title, proc)
                    if new_cat == "study":
                        credibility = "medium"
                        effective = True
                        browser_study_sec += dur
                    else:
                        credibility = "low"
                        effective = False
                        browser_other_sec += dur
                elif cat in ("entertainment", "social"):
                    credibility = "干扰"
                    effective = False
                    if cat == "entertainment":
                        entertainment_sec += dur
                    else:
                        social_sec += dur
                else:
                    credibility = "low"
                    effective = False
                    other_sec += dur

                records.append({
                    "process": proc,
                    "category": cat,
                    "title": title[:80],
                    "durationMinutes": dur // 60,
                    "credibility": credibility,
                    "effective": effective,
                })

            effective_total_sec = study_sec + browser_study_sec
            distraction_total_sec = browser_other_sec + entertainment_sec + social_sec + other_sec
            total_tracked_sec = effective_total_sec + distraction_total_sec + idle_sec

            self.wfile.write(json.dumps({
                "date": today,
                "summary": {
                    "totalTrackedMinutes": total_tracked_sec // 60,
                    "effectiveStudyMinutes": effective_total_sec // 60,
                    "distractionMinutes": distraction_total_sec // 60,
                    "idleMinutes": idle_sec // 60,
                    "executionRate": round(effective_total_sec / max(total_tracked_sec - idle_sec, 1) * 100, 1) if (total_tracked_sec - idle_sec) > 0 else 0,
                },
                "breakdown": {
                    "study_high": {"minutes": study_sec // 60, "credibility": "高 — VSCode/PDF/笔记等原生学习应用"},
                    "browser_study": {"minutes": browser_study_sec // 60, "credibility": "中 — 浏览器标题命中学科关键词"},
                    "browser_other": {"minutes": browser_other_sec // 60, "credibility": "低/视为娱乐 — 浏览器标题未命中关键词"},
                    "entertainment": {"minutes": entertainment_sec // 60, "credibility": "干扰 — 娱乐应用"},
                    "social": {"minutes": social_sec // 60, "credibility": "干扰 — 社交通讯"},
                    "other": {"minutes": other_sec // 60, "credibility": "低 — 未分类"},
                    "idle": {"minutes": idle_sec // 60, "credibility": "不计入 — 5分钟无操作"},
                },
                "records": records,
            }, ensure_ascii=False).encode())

        elif parsed.path == "/activity/raw":
            if os.path.exists(DB_PATH):
                conn = get_db()
                rows = conn.execute("SELECT window_title, process_name, category, start_time, duration_seconds, date, is_idle FROM activity ORDER BY id DESC LIMIT 50").fetchall()
                conn.close()
                data = [{
                    "window_title": r[0], "process_name": r[1], "category": r[2],
                    "start_time": r[3], "duration_seconds": r[4], "date": r[5],
                    "is_idle": bool(r[6])
                } for r in rows]
                self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode())
            else:
                self.wfile.write(json.dumps({"error": "no data yet"}).encode())

        elif parsed.path == "/deepseek/key":
            key = get_api_key()
            if key:
                masked = key[:4] + "****" + key[-4:] if len(key) > 8 else "****"
                self.wfile.write(json.dumps({"hasKey": True, "key": masked}).encode())
            else:
                self.wfile.write(json.dumps({"hasKey": False}).encode())

        elif parsed.path == "/search":
            q = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
            if q:
                results = duckduckgo_search(q)
                self.wfile.write(json.dumps(results, ensure_ascii=False).encode())
            else:
                self.wfile.write(json.dumps({"error": "missing query param q"}).encode())

        elif parsed.path == "/health":
            self.wfile.write(json.dumps({"status": "ok", "db_exists": os.path.exists(DB_PATH)}).encode())

        else:
            self.wfile.write(json.dumps({"ok": True}).encode())

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
                self.wfile.write(json.dumps({"error": str(e), "success": False}).encode())
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
        try:
            return resp.json().get("error", {}).get("message", resp.text[:200])
        except Exception:
            return resp.text[:200]

    def _handle_post(self, parsed, body):
        if parsed.path == "/deepseek/chat":
            data = json.loads(body)
            api_key = get_api_key()

            if not api_key:
                self._respond({"error": "请先设置DeepSeek API Key", "needKey": True})
                return

            messages = data.get("messages", [])
            enable_search = data.get("search", False)

            # If search enabled, extract the last user message and search the web
            if enable_search and messages:
                last_user = ""
                for m in reversed(messages):
                    if m.get("role") == "user":
                        last_user = m.get("content", "")
                        break
                if last_user:
                    search_results = duckduckgo_search(last_user, max_results=5)
                    search_text = "\n\n".join([
                        f"[{i+1}] {r['title']}\n{r['snippet']}\n{r['url']}"
                        for i, r in enumerate(search_results) if r.get("title")
                    ])
                    if search_text:
                        messages = [
                            {"role": "system", "content": f"以下是联网搜索结果，请基于这些信息回答用户问题，并在回答中引用来源：\n\n{search_text}"},
                            *messages,
                        ]

            import requests
            try:
                resp = requests.post(
                    "https://api.deepseek.com/chat/completions",
                    json={
                        "model": "deepseek-reasoner",
                        "messages": messages,
                        "max_tokens": 8000,
                    },
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=120,
                )
                if resp.status_code != 200:
                    self._respond({"error": f"DeepSeek API {resp.status_code}: {self._deepseek_error(resp)}"})
                    return
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                if not content:
                    content = result["choices"][0]["message"].get("reasoning_content", "")
                self._respond({"content": content})
            except Exception as e:
                self._respond({"error": str(e)})

        elif parsed.path == "/api/coach/chat":
            data = json.loads(body)
            user_message = data.get("message", "")
            context = data.get("context", {})

            api_key = get_api_key()

            if not api_key:
                self._respond({"error": "请先设置DeepSeek API Key", "success": False})
                return

            # Build system prompt from context
            system_state = context.get("system_state", {})
            if isinstance(system_state, str):
                # 前端 buildContext() 返回的已经是完整上下文字符串
                system_prompt = "你是StudyPet的AI学习教练，请根据以下信息为用户提供学习建议和鼓励。\n\n" + system_state
            elif isinstance(system_state, dict) and system_state:
                system_parts = []
                schedule = system_state.get("schedule", [])
                if schedule:
                    today = datetime.now().strftime("%Y-%m-%d")
                    today_schedule = [s for s in schedule if s.get("date") == today]
                    if today_schedule:
                        lines = ["今日课表："]
                        for s in today_schedule:
                            lines.append(f"  {s.get('time','')} {s.get('name','')} @{s.get('location','')}")
                        system_parts.append("\n".join(lines))
                important = system_state.get("important", [])
                if important:
                    lines = ["重要事项："]
                    for item in important:
                        lines.append(f"  - {item.get('title','')} (截止: {item.get('deadline','')})")
                    system_parts.append("\n".join(lines))
                memories = system_state.get("memories", [])
                if memories:
                    lines = ["学习记忆："]
                    for m in memories:
                        lines.append(f"  [{m.get('type','')}] {m.get('content','')}")
                    system_parts.append("\n".join(lines))
                subjects = system_state.get("subjects", {})
                if subjects:
                    lines = ["科目进度："]
                    for name, prog in subjects.items():
                        lines.append(f"  {name}: {prog.get('progress',0)}%")
                    system_parts.append("\n".join(lines))
                exam_date = system_state.get("examDate", "")
                if exam_date:
                    system_parts.append(f"考试日期: {exam_date}")
                school_start = system_state.get("schoolStart", "")
                if school_start:
                    system_parts.append(f"开学日期: {school_start}")
                system_prompt = "你是StudyPet的AI学习教练，请根据以下信息为用户提供学习建议和鼓励。\n\n" + "\n\n".join(system_parts) if system_parts else "你是StudyPet的AI学习教练。"
            else:
                system_prompt = "你是StudyPet的AI学习教练。"

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ]

            import requests
            try:
                resp = requests.post(
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
                    self._respond({"error": f"DeepSeek API {resp.status_code}: {self._deepseek_error(resp)}", "success": False})
                    return
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                self._respond({"response": content, "success": True})
            except Exception as e:
                self._respond({"error": str(e), "success": False})

        elif parsed.path == "/deepseek/set-key":
            data = json.loads(body)
            key = data.get("key", "").strip()
            if not key:
                self._respond({"error": "Key is empty"})
            elif not key.startswith("sk-"):
                self._respond({"error": "Key 格式不正确，应以 sk- 开头"})
            else:
                open(DEEPSEEK_KEY_FILE, "w", encoding="utf-8").write(key)
                self._respond({"ok": True})

        else:
            self._respond({"ok": True})

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