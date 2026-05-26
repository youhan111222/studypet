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
import logging
from datetime import datetime
import ctypes
from ctypes import wintypes

# 强制使用 UTF-8 编码
sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tracker.log")
# 确保日志文件使用 UTF-8 编码
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
    ]
)
logger = logging.getLogger(__name__)
logger.info("=== tracker.py 启动 ===")

def safe_print(obj):
    try:
        print(json.dumps(obj))
        sys.stdout.flush()
    except (BrokenPipeError, OSError):
        pass  # stdout 断开时静默忽略

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "activity.db")

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
except:
    pass
conn.commit()

# === Windows API 获取前台窗口 ===
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
psapi = ctypes.windll.psapi

def get_active_window_info():
    """获取当前前台窗口的标题和进程名（UWP 应用自动提取真实标题作为进程名）"""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return "Unknown", "unknown"

    # 窗口标题
    length = user32.GetWindowTextLengthW(hwnd)
    if length == 0:
        title = "Unknown"
    else:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or "Unknown"

    # 进程名
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value:
        h_process = kernel32.OpenProcess(0x0400 | 0x0010, False, pid.value)
        if h_process:
            exe_buf = ctypes.create_unicode_buffer(260)
            size = wintypes.DWORD(260)
            if psapi.GetModuleBaseNameW(h_process, None, exe_buf, size):
                proc = exe_buf.value.lower().replace('.exe', '')
            else:
                proc = "unknown"
            kernel32.CloseHandle(h_process)
        else:
            proc = "unknown"
    else:
        proc = "unknown"

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


# === 分类规则 ===
CATEGORIES = [
    # 学习/开发
    (['vscode', 'code', 'visual studio', 'pycharm', 'intellij', 'idea', 'eclipse',
      'webstorm', 'sublime', 'notepad++', 'notepad', 'atom'], 'study'),
    (['terminal', 'cmd', 'powershell', 'windows terminal', 'conhost', 'alacritty'], 'study'),
    (['word', 'excel', 'powerpoint', 'outlook', 'onenote', 'winword', 'wps'], 'study'),
    (['pdf', 'acrobat', 'sumatra', 'foxit'], 'study'),
    (['notion', 'obsidian', 'typora', 'logseq', 'joplin', 'evernote'], 'study'),
    (['xmind', 'mindmaster', 'drawio'], 'study'),
    (['matlab', 'rstudio', 'jupyter', 'spyder', 'anaconda'], 'study'),

    # 浏览器
    (['chrome', 'msedge', 'firefox', 'brave', 'opera', 'browser'], 'browser'),

    # 社交/通讯
    (['微信', 'wechat', 'weixin', 'qq', '钉钉', 'dingtalk', 'tim', 'telegram',
      'discord', 'slack', 'teams', '飞书', 'lark', 'skype'], 'social'),

    # 娱乐
    (['steam', 'epicgames', 'battle.net', 'origin', 'ubisoft', 'riot'], 'entertainment'),
    (['bilibili', '抖音', 'douyin', 'youtube', 'netflix', 'twitch', 'iqiyi', 'youku',
      '腾讯视频', '芒果tv', 'potplayer', 'vlc', 'mpc', 'movies'], 'entertainment'),
    (['cloudmusic', 'qqmusic', 'spotify', 'foobar', 'music', '网易云', '酷狗', '千千'], 'entertainment'),

    # 设计/创作
    (['photoshop', 'illustrator', 'figma', 'sketch', 'blender', 'premiere', 'afterfx'], 'study'),

    # 文件管理
    (['explorer', 'finder', 'totalcmd', 'everything'], 'other'),
]


def classify(title, proc):
    t = (title + ' ' + proc).lower()
    for keywords, cat in CATEGORIES:
        for kw in keywords:
            if kw in t:
                return cat
    return 'other'


# === 主循环 ===
last_proc = ''
last_title = ''
last_start = time.time()
last_idle_logged = False
idle_start_time = 0.0   # 记录进入空闲的时间点
POLL_SEC = 2
IDLE_THRESHOLD_SEC = 300  # 5 分钟

logger.info(f"进入主循环，空闲阈值={IDLE_THRESHOLD_SEC}s，DB={DB_PATH}")

try:
    while True:
        try:
            title, proc = get_active_window_info()
            idle_sec = get_idle_seconds()
            now = time.time()
            date_str = datetime.now().strftime("%Y-%m-%d")

            is_idle = idle_sec >= IDLE_THRESHOLD_SEC
            logger.debug(f"窗口: {proc} - {title[:30]}, 空闲: {idle_sec}s, 空闲状态: {is_idle}")

            if is_idle:
                # 空闲超时：记录上一次活动的时长，然后进入空闲状态
                if not last_idle_logged and last_proc:
                    duration = int(now - last_start)
                    cat = classify(last_title, last_proc)
                    try:
                        conn.execute(
                            "INSERT INTO activity (window_title, process_name, category, start_time, duration_seconds, date, is_idle) VALUES (?,?,?,?,?,?,0)",
                            (last_title, last_proc, cat,
                             datetime.fromtimestamp(last_start).strftime("%Y-%m-%d %H:%M:%S"),
                             duration, date_str)
                        )
                        conn.commit()
                    except sqlite3.OperationalError as e:
                        logger.warning(f"写入空闲记录失败 (db locked?): {e}")
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
                    try:
                        conn.execute(
                            "INSERT INTO activity (window_title, process_name, category, start_time, duration_seconds, date, is_idle) VALUES (?,?,?,?,?,?,1)",
                            ('空闲', 'idle', 'idle',
                             datetime.fromtimestamp(idle_start_time).strftime("%Y-%m-%d %H:%M:%S"),
                             idle_duration, date_str)
                        )
                        conn.commit()
                    except sqlite3.OperationalError as e:
                        logger.warning(f"写入空闲恢复记录失败: {e}")
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
                    try:
                        conn.execute(
                            "INSERT INTO activity (window_title, process_name, category, start_time, duration_seconds, date, is_idle) VALUES (?,?,?,?,?,?,0)",
                            (last_title, last_proc, cat,
                             datetime.fromtimestamp(last_start).strftime("%Y-%m-%d %H:%M:%S"),
                             duration, date_str)
                        )
                        conn.commit()
                    except sqlite3.OperationalError as e:
                        logger.warning(f"写入窗口切换记录失败: {e}")
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
        try:
            conn.execute(
                "INSERT INTO activity (window_title, process_name, category, start_time, duration_seconds, date, is_idle) VALUES (?,?,?,?,?,?,0)",
                (last_title, last_proc, cat,
                 datetime.fromtimestamp(last_start).strftime("%Y-%m-%d %H:%M:%S"),
                 duration, datetime.now().strftime("%Y-%m-%d"))
            )
            conn.commit()
            logger.info(f"保存最后活动: {last_proc} ({duration}s)")
        except sqlite3.OperationalError:
            logger.warning("保存最后活动时数据库异常，忽略")
    conn.close()
    logger.info("数据库连接关闭，退出完成")