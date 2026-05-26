import http.server
import json
import sqlite3
import os
import urllib.parse
import socketserver
import requests as req_lib
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "activity.db")
DEEPSEEK_KEY_FILE = os.path.join(BASE_DIR, "api_key.txt")

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
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()

        parsed = urllib.parse.urlparse(self.path)

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

                # 各类别汇总
                cat_rows = conn.execute("""
                    SELECT category, SUM(duration_seconds) FROM activity
                    WHERE date=? AND is_idle=0 GROUP BY category
                """, (today,)).fetchall()
                conn.close()

                apps = [{
                    "appName": r[0], "category": r[1],
                    "duration": r[2] // 60, "sessions": r[3], "title": r[4]
                } for r in rows]
                categories = {c: t // 60 for c, t in cat_rows}
                total_active = sum(a["duration"] for a in apps)

                self.wfile.write(json.dumps({
                    "apps": apps,
                    "categories": categories,
                    "idleMinutes": idle // 60,
                    "totalActiveMinutes": total_active,
                    "date": today
                }, ensure_ascii=False).encode())
            else:
                self.wfile.write(json.dumps({"apps": [], "categories": {}, "idleMinutes": 0, "totalActiveMinutes": 0}).encode())

        elif parsed.path == "/activity/history":
            params = urllib.parse.parse_qs(parsed.query)
            days = int(params.get("days", [14])[0])
            since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
            if os.path.exists(DB_PATH):
                conn = get_db()
                rows = conn.execute("""
                    SELECT window_title, process_name, category, start_time, duration_seconds, date, is_idle
                    FROM activity WHERE date >= ? AND is_idle=0
                    ORDER BY date, start_time
                """, (since,)).fetchall()
                conn.close()
                data = [{
                    "window_title": r[0], "process_name": r[1], "category": r[2],
                    "start_time": r[3], "duration_seconds": r[4], "date": r[5]
                } for r in rows]
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode())
            else:
                self.wfile.write(b"[]")

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
            if os.path.exists(DEEPSEEK_KEY_FILE):
                key = open(DEEPSEEK_KEY_FILE, encoding="utf-8-sig").read().strip()
                self.wfile.write(json.dumps({"hasKey": True, "key": key[:4] + "****" + key[-4:]} if len(key) > 8 else {"hasKey": True, "key": key}).encode())
            else:
                self.wfile.write(json.dumps({"hasKey": False}).encode())

        elif parsed.path == "/search":
            q = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
            if q:
                results = duckduckgo_search(q)
                self.wfile.write(json.dumps(results, ensure_ascii=False).encode())
            else:
                self.wfile.write(json.dumps({"error": "missing query param q"}).encode())

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
            except:
                pass
            try:
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e), "success": False}).encode())
            except:
                pass

    def _handle_post(self, parsed, body):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()

        if parsed.path == "/deepseek/chat":
            data = json.loads(body)
            key_file = DEEPSEEK_KEY_FILE
            api_key = ""
            if os.path.exists(key_file):
                api_key = open(key_file, encoding="utf-8-sig").read().strip()

            if not api_key:
                self.wfile.write(json.dumps({"error": "请先设置DeepSeek API Key", "needKey": True}).encode())
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
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                if not content:
                    content = result["choices"][0]["message"].get("reasoning_content", "")
                self.wfile.write(json.dumps({"content": content}, ensure_ascii=False).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode())

        elif parsed.path == "/api/coach/chat":
            data = json.loads(body)
            user_message = data.get("message", "")
            context = data.get("context", {})

            key_file = DEEPSEEK_KEY_FILE
            api_key = ""
            if os.path.exists(key_file):
                api_key = open(key_file, encoding="utf-8-sig").read().strip()

            if not api_key:
                self.wfile.write(json.dumps({"error": "请先设置DeepSeek API Key", "success": False}).encode())
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
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                self.wfile.write(json.dumps({"response": content, "success": True}, ensure_ascii=False).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e), "success": False}).encode())

        elif parsed.path == "/deepseek/set-key":
            data = json.loads(body)
            key = data.get("key", "").strip()
            if key:
                open(DEEPSEEK_KEY_FILE, "w", encoding="utf-8").write(key)
                self.wfile.write(json.dumps({"ok": True}).encode())
            else:
                self.wfile.write(json.dumps({"error": "Key is empty"}).encode())

        else:
            self.wfile.write(json.dumps({"ok": True}).encode())

    def log_message(self, format, *args):
        pass

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 19998), APIHandler)
    print("API Server running on http://127.0.0.1:19998 (multi-threaded)")
    server.serve_forever()