"""tracker.py 核心逻辑测试：长会话双写回归 / 空闲记录 / 分类器。

导入前必须设置 STUDYPET_TEST_MODE=1 + STUDYPET_DB_PATH（临时库），
模块级副作用（单实例锁/主循环）全部被测试开关屏蔽。
"""
import os
import sqlite3
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["STUDYPET_TEST_MODE"] = "1"
os.environ.setdefault("STUDYPET_DB_PATH", os.path.join(tempfile.mkdtemp(), "t.db"))

import tracker


@pytest.fixture()
def tconn():
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT, window_title TEXT, process_name TEXT,
        category TEXT DEFAULT 'other', start_time TEXT, duration_seconds INTEGER DEFAULT 0,
        date TEXT, is_idle INTEGER DEFAULT 0)""")
    tracker.conn = conn
    yield conn
    conn.close()


def _seg(tconn, start_ts="2026-08-01 10:00:00"):
    return tconn.execute(
        "SELECT COUNT(*), SUM(duration_seconds) FROM activity WHERE is_idle=0 AND start_time=?",
        (start_ts,),
    ).fetchone()


# ===== 长会话双写回归（critical）：落盘 + 结束段必须只产生 1 行 =====
def test_flush_then_switch_no_duplicate(tconn):
    ts = "2026-08-01 10:00:00"
    assert tracker._flush_segment("高数笔记", "chrome", "study", ts, 60, "2026-08-01", label="增量落盘")
    assert tracker._flush_segment("高数笔记", "chrome", "study", ts, 90, "2026-08-01", label="窗口切换记录")
    rows, total = _seg(tconn, ts)
    assert rows == 1, "长会话仍双写！"
    assert total == 90, "时长未收敛到最终值"


def test_flush_repeated_updates_only(tconn):
    ts = "2026-08-01 10:00:00"
    for dur in (60, 120, 180, 240):
        assert tracker._flush_segment("高数笔记", "chrome", "study", ts, dur, "2026-08-01", label="增量落盘")
    rows, total = _seg(tconn, ts)
    assert rows == 1
    assert total == 240


def test_segment_without_flush_single_insert(tconn):
    # <60s 直接结束：从未落盘 → 正常 INSERT 一行
    ts = "2026-08-01 10:00:00"
    assert tracker._flush_segment("word", "winword", "study", ts, 45, "2026-08-01", label="窗口切换记录")
    rows, total = _seg(tconn, ts)
    assert rows == 1 and total == 45


def test_idle_row_via_write_activity(tconn):
    # 空闲段走 _write_activity（is_idle=1），与活动段互不干扰
    assert tracker._write_activity(("空闲", "idle", "idle", "2026-08-01 10:00:00", 300, "2026-08-01"), is_idle=1, label="空闲记录")
    n = tconn.execute("SELECT COUNT(*) FROM activity WHERE is_idle=1").fetchone()[0]
    assert n == 1


# ===== 分类器 =====
def test_classify_known_apps():
    assert tracker.classify("微信 - 文件传输助手", "wechat") == "social"
    assert tracker.classify("哔哩哔哩", "bilibili") == "entertainment"
    assert tracker.classify("高数第三章笔记", "obsidian") == "study"
    assert tracker.classify("", "chrome") == "browser"


def test_classify_unknown_never_study_or_dev():
    # 慢路径（向量猜测）禁止输出需要明确证据的类别
    cat = tracker.classify("zzqxyaaaa qw12345", "fakeproc")
    assert cat in ("other", "browser", "entertainment", "social")
    assert cat not in ("study", "dev", "tools", "system")


def test_proc_name_override_chinese():
    assert tracker.classify("", "哔哩哔哩") == "entertainment"
    assert tracker.classify("", "微信") == "social"


# ===== 窗口信息降级链（只验证不崩 + 返回类型） =====
def test_get_active_window_info_returns_pair():
    title, proc = tracker.get_active_window_info()
    assert isinstance(title, str) and isinstance(proc, str)
