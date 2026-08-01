"""
屏幕活动追踪器 v2
- 通过 Windows API 获取真实前台窗口进程名和标题
- 5 分钟无键盘鼠标操作判定为空闲
- 进程名合并统计，自动分类
- 数据写入 SQLite
"""

import sys
import json
import time
import sqlite3
import os
import math
import logging
from collections import Counter
from datetime import datetime
import ctypes
from ctypes import wintypes

# 强制使用 UTF-8 编码
sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tracker.log")
# 确保日志文件使用 UTF-8 编码
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
    ]
)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.info("=== tracker.py 启动 ===")

def safe_print(obj):
    try:
        print(json.dumps(obj))
        sys.stdout.flush()
    except (BrokenPipeError, OSError):
        pass  # stdout 断开时静默忽略

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "activity.db")

# 单实例锁：防止多个 tracker 重复写库（旧进程残留会双写记录）
LOCK_FILE = os.path.join(os.path.dirname(DB_PATH), "tracker.lock")

def _process_alive(pid):
    """Windows 兼容的进程存活检查（os.kill(pid,0) 在 Windows 会直接杀进程！）"""
    try:
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return False
        try:
            exit_code = ctypes.c_ulong()
            ok = ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(exit_code))
            return bool(ok) and exit_code.value == 259  # STILL_ACTIVE
        finally:
            ctypes.windll.kernel32.CloseHandle(h)
    except Exception:
        return False


def _acquire_lock():
    """原子获取单实例锁：'x' 模式独占创建，防止并发启动竞态"""
    for attempt in range(2):
        try:
            with open(LOCK_FILE, "x") as f:
                f.write(str(os.getpid()))
            return  # 成功获得锁
        except FileExistsError:
            # 已有锁：检查持有者是否存活
            try:
                with open(LOCK_FILE, "r") as f:
                    pid = int(f.read().strip())
                if _process_alive(pid):
                    logger.error(f"另一个 tracker 实例正在运行 (PID {pid})，退出")
                    sys.exit(1)
            except (ValueError, OSError):
                pass
            # 持有者已死：删除旧锁后重试接管
            try:
                os.remove(LOCK_FILE)
            except OSError:
                pass
    logger.error("无法获取单实例锁，退出")
    sys.exit(1)

if os.environ.get("STUDYPET_TEST_MODE") != "1":
    _acquire_lock()

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

conn = sqlite3.connect(DB_PATH, timeout=10)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA synchronous=NORMAL")
conn.execute("PRAGMA busy_timeout=5000")
conn.execute("""
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_title TEXT,
    process_name TEXT,
    category TEXT DEFAULT 'other',
    start_time TEXT,
    duration_seconds INTEGER DEFAULT 0,
    date TEXT,
    is_idle INTEGER DEFAULT 0
)
""")
# 兼容旧表结构（无 is_idle 列）
try:
    conn.execute("ALTER TABLE activity ADD COLUMN is_idle INTEGER DEFAULT 0")
except Exception:
    pass
conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_date ON activity(date)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_date_category ON activity(date, category)")
conn.commit()

_ACTIVITY_INSERT = (
    "INSERT INTO activity (window_title, process_name, category, start_time, duration_seconds, date, is_idle) "
    "VALUES (?,?,?,?,?,?,?)"
)


def _write_activity(params, is_idle=0, label="活动记录", attempts=3, backoff=0.5):
    """写入活动记录，SQLite 锁冲突时重试，避免静默丢数据"""
    for attempt in range(attempts):
        try:
            conn.execute(_ACTIVITY_INSERT, (*params, is_idle))
            conn.commit()
            return True
        except sqlite3.OperationalError as e:
            if attempt < attempts - 1:
                time.sleep(backoff * (attempt + 1))
                continue
            logger.warning(f"写入{label}失败 (db locked?): {e}")
    return False


def _flush_segment(title, proc, cat, start_ts, duration, date_str, label="活动记录", attempts=3, backoff=0.5):
    """写入/刷新当前活动段：已落盘则 UPDATE（长会话双写双计根因），否则 INSERT。锁冲突重试。"""
    for attempt in range(attempts):
        try:
            cur = conn.execute(
                "SELECT id FROM activity WHERE start_time=? AND process_name=? AND is_idle=0 ORDER BY id DESC LIMIT 1",
                (start_ts, proc)
            )
            row = cur.fetchone()
            if row:
                conn.execute(
                    "UPDATE activity SET duration_seconds=?, window_title=?, category=?, date=? WHERE id=?",
                    (duration, title, cat, date_str, row[0])
                )
            else:
                conn.execute(_ACTIVITY_INSERT, (title, proc, cat, start_ts, duration, date_str, 0))
            conn.commit()
            return True
        except sqlite3.OperationalError as e:
            if attempt < attempts - 1:
                time.sleep(backoff * (attempt + 1))
                continue
            logger.warning(f"写入{label}失败 (db locked?): {e}")
    return False

# === Windows API 获取前台窗口 ===
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
psapi = ctypes.windll.psapi

def get_active_window_info():
    """获取当前前台窗口的标题和进程名

    无管理员权限运行时，高权限窗口（任务管理器、系统设置等）会拒绝访问。
    此时不崩溃，逐级降级返回可用信息。
    降级链: 完整信息 → 仅进程名 → 'protected' → 'unknown'
    """
    try:
        hwnd = user32.GetForegroundWindow()
    except Exception:
        return "Unknown", "unknown"
    if not hwnd:
        return "Unknown", "unknown"

    # 窗口标题 — 访问拒绝时降级为 'Restricted Window'
    title = "Unknown"
    try:
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            err = kernel32.GetLastError()
            if err == 5:  # ERROR_ACCESS_DENIED
                title = "Restricted Window"
            else:
                title = "Unknown"
        else:
            buf = ctypes.create_unicode_buffer(length + 1)
            ret = user32.GetWindowTextW(hwnd, buf, length + 1)
            if ret == 0:
                err = kernel32.GetLastError()
                if err == 5:
                    title = "Restricted Window"
                else:
                    title = "Unknown"
            else:
                title = buf.value or "Unknown"
    except Exception:
        title = "Restricted Window"

    # 进程名 — 权限拒绝时分三级降级
    proc = "unknown"
    h_process = None
    try:
        pid = wintypes.DWORD()
        ret = user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if ret == 0 or pid.value == 0:
            err = kernel32.GetLastError()
            if err == 5:
                proc = "protected"
                return title, proc
            return title, "unknown"

        # 尝试完整权限打开进程
        h_process = kernel32.OpenProcess(0x0400 | 0x0010, False, pid.value)
        if not h_process:
            err = kernel32.GetLastError()
            if err == 5:  # ACCESS_DENIED — 系统进程
                proc = "system"
            # 尝试只读权限重试
            h_process = kernel32.OpenProcess(0x0010, False, pid.value)
            if not h_process:
                proc = "protected"

        if h_process:
            exe_buf = ctypes.create_unicode_buffer(260)
            size = wintypes.DWORD(260)
            if psapi.GetModuleBaseNameW(h_process, None, exe_buf, size):
                proc = exe_buf.value.lower().replace('.exe', '')
            else:
                err = kernel32.GetLastError()
                proc = "protected" if err == 5 else "unknown"
        elif proc == "unknown":
            proc = "protected"
    except Exception:
        proc = "protected"
        return title, proc
    finally:
        if h_process:
            kernel32.CloseHandle(h_process)

    # UWP 应用修复：ApplicationFrameHost.exe 代理了所有 UWP 窗口
    # 此时用窗口标题作为进程名，确保分类和统计正确
    if proc == 'applicationframehost' and title and title != 'Unknown':
        # 常见 UWP 标题映射（标题 -> 标准化名称）
        uwp_title_map = {
            '抖音': 'douyin',
            'bilibili': 'bilibili',
            '哔哩哔哩': 'bilibili',
            '微信': 'wechat',
            'wechat': 'wechat',
            'QQ': 'qq',
            '网易云音乐': 'cloudmusic',
            'spotify': 'spotify',
        }
        # 先尝试模糊匹配 UWP 映射
        proc = None
        for key, name in uwp_title_map.items():
            if key.lower() in title.lower():
                proc = name
                break
        # 没匹配到则直接用标题作为进程名（去掉后缀如 " - Microsoft Store"）
        if not proc:
            clean = title.strip()
            for suffix in [' - Microsoft Store', ' – Microsoft Store', ' | Microsoft Store']:
                if clean.endswith(suffix):
                    clean = clean[:-len(suffix)].strip()
            proc = clean.lower().replace(' ', '_')
    elif proc == 'applicationframehost':
        proc = 'uwp_unknown'

    return title, proc


def get_idle_seconds():
    """获取键盘/鼠标空闲秒数 (LASTINPUTINFO)"""
    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]
    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
    user32.GetLastInputInfo(ctypes.byref(lii))
    idle_sec = (kernel32.GetTickCount() - lii.dwTime) / 1000.0
    # GetTickCount 在 49.7 天后溢出，处理回绕
    if idle_sec < 0:
        idle_sec = 0  # 溢出时视为刚操作，忽略本次
    return idle_sec


# === TF-IDF 应用分类器 ===
# 不再死板关键词匹配，而是基于特征向量相似度评分
# 已知应用用关键词快速命中，未知应用用 n-gram 向量推断

# 训练语料：每个分类有多个"文档"（关键词组）
# 注意：学习（study）和开发（dev）必须有明确关键词证据；终端/记事本等工具类用途不明不视为学习
CATEGORY_TRAINING = [
    # 备考学习
    ('study', ['word excel powerpoint outlook onenote winword wps',
               'pdf acrobat sumatra foxit',
               'notion obsidian typora logseq joplin evernote',
               'xmind mindmaster drawio',
               'matlab rstudio',
               'edraw max', 'onenote']),
    # 浏览器
    ('browser', ['chrome msedge firefox brave opera browser edge chromium']),
    # 社交/通讯
    ('social', ['wechat weixin qq dingtalk tim telegram discord slack teams lark skype']),
    # 娱乐（含常见中文进程名）
    ('entertainment', ['steam epicgames battle.net origin ubisoft riot',
                       'bilibili 哔哩哔哩 douyin 抖音 youtube netflix twitch iqiyi youku potplayer vlc mpc movies',
                       'cloudmusic qqmusic spotify foobar music',
                       'kugou 酷狗 ximalaya 喜马拉雅']),
    # 开发/编程（独立于备考学习）
    ('dev', ['vscode code visual-studio pycharm intellij idea eclipse webstorm sublime atom',
             'github gitlab gitee stackoverflow codeium cursor',
             'docker kubernetes postman insomnia',
             'jupyter spyder anaconda',
             'blender unity unreal']),
    # 文件管理/工具类（终端/记事本/设置面板用途不明）
    ('tools', ['explorer finder totalcmd everything',
               'terminal cmd powershell windows-terminal conhost alacritty',
               'notepad notepad++',
               'settings 设置 control-panel taskmgr regedit',
               '输入法 rime weasel 小狼毫 ime']),
    # 系统窗口（锁屏/桌面/通知等）
    ('system', ['lockapp 锁屏 lockscreen',
                'shellexperiencehost shellhost searchhost',
                'cc-switch startmenu 开始菜单 desktop 桌面']),
    # 兜底
    ('other', ['system protected restricted', 'unknown']),
]

class AppClassifier:
    """基于 TF-IDF 向量 + 关键词得分的混合分类器"""

    def __init__(self):
        self.categories = list(set(c for c, _ in CATEGORY_TRAINING))
        # 构建每个分类的 TF-IDF 特征向量
        self.category_vectors = {}  # cat -> {token: tfidf_score}
        self._build_index()

    def _tokenize(self, text):
        """提取字符 2-4 gram + 单词 token"""
        t = text.lower()
        tokens = []
        # 单词 token
        words = t.replace('-', ' ').replace('_', ' ').split()
        tokens.extend(words)
        # 字符 n-gram (2-4)，捕获子串特征如 "ode" 匹配 "vscode"
        clean = t.replace(' ', '')
        for n in [2, 3, 4]:
            for i in range(len(clean) - n + 1):
                tokens.append(clean[i:i+n])
        return tokens

    def _build_index(self):
        """构建 TF-IDF 索引"""
        # 收集所有文档
        all_docs = []  # [(cat, tokens)]
        for cat, doc_list in CATEGORY_TRAINING:
            for doc in doc_list:
                tokens = self._tokenize(doc)
                all_docs.append((cat, tokens))

        # 计算 IDF
        total_docs = len(all_docs)
        doc_freq = Counter()
        for _, tokens in all_docs:
            for token in set(tokens):
                doc_freq[token] += 1

        self.idf = {token: math.log(total_docs / (freq + 1)) + 1
                    for token, freq in doc_freq.items()}

        # 为每个分类计算 TF-IDF 质心向量
        cat_vectors = {cat: Counter() for cat in self.categories}
        cat_counts = {cat: 0 for cat in self.categories}
        for cat, tokens in all_docs:
            cat_counts[cat] += 1
            tf = Counter(tokens)
            for token, count in tf.items():
                cat_vectors[cat][token] += (count / len(tokens)) * self.idf.get(token, 0)

        # 取平均得到质心
        self.category_vectors = {}
        for cat in self.categories:
            if cat_counts[cat] > 0:
                n = cat_counts[cat]
                self.category_vectors[cat] = {t: v/n for t, v in cat_vectors[cat].items()}
            else:
                self.category_vectors[cat] = {}

        # 快速关键词索引（保留原关键词匹配作为加速路径）
        self.keyword_map = {}  # keyword -> cat
        for cat, doc_list in CATEGORY_TRAINING:
            for doc in doc_list:
                for word in doc.split():
                    self.keyword_map[word] = cat

    def classify(self, title, proc):
        """返回 (category, confidence) — confidence 0-1"""
        text = f"{title} {proc}".lower()

        # 快速路径：精确关键词命中
        for word in text.replace('-', ' ').replace('_', ' ').split():
            if word in self.keyword_map:
                return self.keyword_map[word], 1.0

        # 慢速路径：TF-IDF 向量相似度
        tokens = self._tokenize(text)
        if not tokens:
            return 'other', 0.0

        # 输入文本的 TF 向量
        tf = Counter(tokens)
        input_vector = {token: (count / len(tokens)) * self.idf.get(token, 1.0)
                       for token, count in tf.items()}

        # 余弦相似度
        scores = {}
        input_norm = math.sqrt(sum(v**2 for v in input_vector.values()))
        if input_norm == 0:
            return 'other', 0.0

        for cat, cat_vec in self.category_vectors.items():
            dot = sum(input_vector.get(t, 0) * cat_vec.get(t, 0) for t in input_vector)
            cat_norm = math.sqrt(sum(v**2 for v in cat_vec.values()))
            if cat_norm > 0:
                scores[cat] = dot / (input_norm * cat_norm)
            else:
                scores[cat] = 0.0

        best_cat = max(scores, key=scores.get)
        # 慢路径（向量猜测）不输出需要明确证据的类别（study/dev/tools/system），
        # 避免 n-gram 巧合误报（opencode→code、lockapp→lock、输入法设置等）
        if best_cat in ('study', 'dev', 'tools', 'system'):
            best_cat = 'other'
        return best_cat, scores[best_cat]

# 全局分类器实例
_classifier = AppClassifier()

# 中文进程名先验：中文名无法被英文关键词快路径识别，直接按进程名定类
PROC_NAME_OVERRIDE = {
    '哔哩哔哩': 'entertainment', '抖音': 'entertainment', '酷狗': 'entertainment',
    '网易云音乐': 'entertainment', '优酷': 'entertainment',
    '微信': 'social', '腾讯QQ': 'social',
    '资源管理器': 'tools', '任务管理器': 'tools',
    '输入法': 'tools',
}


def classify(title, proc):
    """分类入口：返回 category 字符串"""
    if proc in PROC_NAME_OVERRIDE:
        return PROC_NAME_OVERRIDE[proc]
    cat, confidence = _classifier.classify(title, proc)
    if confidence < 0.05:
        return 'other'
    return cat


# === 主循环 ===
last_proc = ''
last_title = ''
last_start = time.time()
last_idle_logged = False
idle_start_time = 0.0   # 记录进入空闲的时间点
POLL_SEC = 2
IDLE_THRESHOLD_SEC = 300  # 5 分钟


def _run_main_loop():
    global last_proc, last_title, last_start, last_idle_logged, idle_start_time
    logger.info(f"进入主循环，空闲阈值={IDLE_THRESHOLD_SEC}s，DB={DB_PATH}")
    try:
        while True:
            try:
                title, proc = get_active_window_info()
                idle_sec = get_idle_seconds()
                now = time.time()
                date_str = datetime.now().strftime("%Y-%m-%d")

                is_idle = idle_sec >= IDLE_THRESHOLD_SEC

                if is_idle:
                    # 空闲超时：记录上一次活动的时长，然后进入空闲状态
                    if not last_idle_logged and last_proc:
                        duration = int(now - last_start)
                        cat = classify(last_title, last_proc)
                        _flush_segment(
                            last_title, last_proc, cat,
                            datetime.fromtimestamp(last_start).strftime("%Y-%m-%d %H:%M:%S"),
                            duration, date_str, label="空闲记录"
                        )
                        safe_print({
                            "event": "idle_start",
                            "from": last_proc, "duration": duration,
                            "idle_seconds": int(idle_sec)
                        })
                        last_proc = ''
                        last_title = ''
                        last_idle_logged = True
                        idle_start_time = now  # 记录空闲起始时间

                elif proc != last_proc or title != last_title:
                    # 如果刚从空闲恢复，先写入空闲记录
                    if last_idle_logged and idle_start_time > 0:
                        idle_duration = int(now - idle_start_time)
                        _write_activity(
                            ('空闲', 'idle', 'idle',
                             datetime.fromtimestamp(idle_start_time).strftime("%Y-%m-%d %H:%M:%S"),
                             idle_duration, date_str),
                            is_idle=1, label="空闲恢复记录"
                        )
                        safe_print({
                            "event": "idle_end",
                            "idle_duration": idle_duration,
                            "resume_to": proc
                        })
                        idle_start_time = 0.0
                        last_idle_logged = False

                    # 窗口切换：记录上一段活动
                    if last_proc and not last_idle_logged:
                        duration = int(now - last_start)
                        cat = classify(last_title, last_proc)
                        _flush_segment(
                            last_title, last_proc, cat,
                            datetime.fromtimestamp(last_start).strftime("%Y-%m-%d %H:%M:%S"),
                            duration, date_str, label="窗口切换记录"
                        )
                        safe_print({
                            "event": "switch",
                            "from": last_proc, "to": proc,
                            "duration": duration, "category": cat,
                            "title": last_title
                        })

                    last_proc = proc
                    last_title = title
                    last_start = now
                    last_idle_logged = False

                # 增量落盘：每 60s 刷新当前会话，防止进程被强杀（Stop-Process -Force）时丢失长会话；
                # 与结束段写入共用 _flush_segment（UPDATE-or-INSERT），杜绝长会话双写双计
                if not is_idle and last_proc and not last_idle_logged and (now - last_start) >= 60:
                    dur = int(now - last_start)
                    start_ts = datetime.fromtimestamp(last_start).strftime("%Y-%m-%d %H:%M:%S")
                    _flush_segment(last_title, last_proc, classify(last_title, last_proc),
                                   start_ts, dur, date_str, label="增量落盘")

                time.sleep(POLL_SEC)

            except KeyboardInterrupt:
                raise  # 向外层抛出，走清理逻辑
            except Exception as loop_err:
                logger.error(f"循环内异常: {loop_err}", exc_info=True)
                time.sleep(2)
                continue

    except KeyboardInterrupt:
        logger.info("收到 KeyboardInterrupt，开始清理退出")
        # 退出前保存当前活动
        if last_proc and not last_idle_logged:
            duration = int(time.time() - last_start)
            cat = classify(last_title, last_proc)
            if _flush_segment(
                last_title, last_proc, cat,
                datetime.fromtimestamp(last_start).strftime("%Y-%m-%d %H:%M:%S"),
                duration, datetime.now().strftime("%Y-%m-%d"), label="最后活动记录"
            ):
                logger.info(f"保存最后活动: {last_proc} ({duration}s)")
        conn.close()
        logger.info("数据库连接关闭，退出完成")

if os.environ.get("STUDYPET_TEST_MODE") == "1":
    logger.info("测试模式：跳过主循环")
else:
    try:
        _run_main_loop()
    finally:
        # 释放单实例锁
        try:
            os.remove(LOCK_FILE)
        except OSError:
            pass
