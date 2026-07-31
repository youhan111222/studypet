#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""StudyPet → SecondBrain 每日同步引擎

每晚 21:30 由计划任务调用（也可手动）：
1. 汇总当日统计（activity.db，date=今天，is_idle=0）
2. 更新 learning-state.md（JSON，原子写）
3. 写/追加日记统计段（幂等，标记 <!-- studypet-sync -->）
4. 生成明日复习提醒（读复习追踪器）

用法：
  python sync-engine.py                  # 同步今天
  python sync-engine.py --date 2026-07-31
  python sync-engine.py --dry-run --date 2026-07-31
  python sync-engine.py --sb-root <临时目录>   # 测试用，覆盖 SecondBrain 根
"""
import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ACTIVITY_DB = r"D:\StudyPet\activity.db"
DEFAULT_SB_ROOT = r"D:\SecondBrain"
DIARY_DIR = "20-日记"
TRACKER_REL = os.path.join("15-元知识", "学习系统", "📌 复习追踪器.md")
STATE_REL = os.path.join("memory-bank", "claude-code-memory", "learning-state.md")
RUNLOG_REL = os.path.join("memory-bank", "runlog", "sync-engine.log")

SYNC_MARKER = "<!-- studypet-sync -->"
INTERVALS = [1, 2, 4, 7, 15, 30]
WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]
CATEGORY_CN = {
    "study": "学习",
    "dev": "开发",
    "browser": "浏览器",
    "entertainment": "娱乐",
    "social": "社交",
    "tools": "工具",
    "system": "系统",
    "other": "其他",
}


def log_entry(sb_root, msg):
    """追加一行运行日志到 runlog/sync-engine.log（失败不崩）。"""
    try:
        p = os.path.join(sb_root, RUNLOG_REL)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(p, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (ts, msg))
    except Exception as e:
        print("警告：写运行日志失败：%s" % e)


def secs_to_min(secs):
    return int(secs / 60 + 0.5)


def query_stats(db_path, date_str):
    """查 date 当天 is_idle=0 的按分类聚合分钟数。返回 dict 或 None（查询失败）。"""
    try:
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT category, SUM(duration_seconds) FROM activity "
                "WHERE date=? AND is_idle=0 GROUP BY category",
                (date_str,),
            )
            rows = cur.fetchall()
        finally:
            conn.close()
    except Exception as e:
        print("错误：查询 activity.db 失败：%s" % e)
        return None

    categories = {}
    total_secs = 0
    for cat, secs in rows:
        if secs is None:
            continue
        categories[cat] = categories.get(cat, 0) + int(secs)
        total_secs += int(secs)
    return {
        "categories": {c: secs_to_min(s) for c, s in categories.items() if secs_to_min(s) > 0},
        "total_minutes": secs_to_min(total_secs),
        "study_minutes": secs_to_min(categories.get("study", 0)),
        "browser_minutes": secs_to_min(categories.get("browser", 0)),
    }


def read_state(sb_root):
    """读 learning-state.md（JSON）。不存在或损坏返回 {}。"""
    p = os.path.join(sb_root, STATE_REL)
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("JSON 根不是对象")
        return data
    except FileNotFoundError:
        return {}
    except Exception as e:
        print("警告：读取 learning-state.md 失败（按空结构继续）：%s" % e)
        return {}


def write_state(sb_root, state):
    """合并写 learning-state.md（临时文件 + os.replace 原子替换）。"""
    p = os.path.join(sb_root, STATE_REL)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)
    return p


def parse_due_items(tracker_path, tomorrow):
    """解析复习追踪器，返回明天到期（未勾选）的 [(科目, 知识点, 第N次复习), ...]。容错：坏行跳过。"""
    items = []
    try:
        with open(tracker_path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return items
    except Exception as e:
        print("警告：读复习追踪器失败：%s" % e)
        return items

    for line in lines:
        line = line.strip()
        if not line.startswith("|"):
            continue
        if "学习日期" in line:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 9:
            continue
        if all(re.fullmatch(r"-{1,}", c) or c == "" for c in cells):
            continue
        try:
            ld = datetime.strptime(cells[0], "%Y-%m-%d").date()
        except ValueError:
            continue
        subject, point = cells[2], cells[1]
        for i, iv in enumerate(INTERVALS):
            marker = cells[3 + i] if 3 + i < len(cells) else ""
            if "✅" in marker:
                continue
            if (ld + timedelta(days=iv)).isoformat() == tomorrow:
                items.append((subject, point, i + 1))
    return items


def build_diary_block(stats, due_items):
    """构造统计段 + 明日复习段。"""
    top3 = sorted(stats["categories"].items(), key=lambda kv: -kv[1])[:3]
    parts = ["%s%d" % (CATEGORY_CN.get(c, c), m) for c, m in top3]
    cat_line = " / ".join(parts) if parts else "无"

    lines = [
        SYNC_MARKER,
        "## 📊 今日学习统计（StudyPet 自动同步）",
        "- 学习时长：%d 分钟" % stats["study_minutes"],
        "- 总活跃：%d 分钟" % stats["total_minutes"],
        "- 分类：%s" % cat_line,
        "- 浏览器：%d 分钟" % stats["browser_minutes"],
        "",
        "## ⏰ 明日待复习（StudyPet 自动生成）",
    ]
    if due_items:
        for subject, point, n in due_items:
            lines.append("- %s·%s：明天到期（第%d次复习）" % (subject, point, n))
    else:
        lines.append("- 无")
    return "\n".join(lines) + "\n"


def write_diary(sb_root, date_str, stats, due_items):
    """创建/追加日记统计段。已有标记则跳过（幂等）。返回 'written' / 'skipped' / 'error'。"""
    p = os.path.join(sb_root, DIARY_DIR, "%s.md" % date_str)
    block = build_diary_block(stats, due_items)
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                content = f.read()
            if SYNC_MARKER in content:
                return "skipped"
            new_content = content.rstrip() + "\n\n" + block
        else:
            weekday_cn = WEEKDAYS[datetime.strptime(date_str, "%Y-%m-%d").date().weekday()]
            header = (
                "---\n"
                "tags: [daily]\n"
                "type: daily\n"
                "---\n"
                "# %s 周%s\n\n" % (date_str, weekday_cn)
            )
            new_content = header + block
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(new_content)
        os.replace(tmp, p)
        return "written"
    except Exception as e:
        print("错误：写日记失败：%s" % e)
        return "error"


def print_summary(date_str, stats, due_items, mode, sb_root):
    total = stats["total_minutes"]
    print("=" * 46)
    print("StudyPet → SecondBrain 同步引擎")
    print("日期：%s（%s）" % (date_str, mode))
    print("学习时长：%d 分钟" % stats["study_minutes"])
    print("总活跃：%d 分钟" % total)
    top3 = sorted(stats["categories"].items(), key=lambda kv: -kv[1])[:3]

    def pct(m):
        return "%.1f%%" % (m * 100.0 / total) if total else "-"

    print("分类 TOP3：%s" % " / ".join(
        "%s %d 分钟 (%s)" % (CATEGORY_CN.get(c, c), m, pct(m)) for c, m in top3
    ) or "无")
    print("浏览器：%d 分钟" % stats["browser_minutes"])
    print("明日待复习：")
    if due_items:
        for subject, point, n in due_items:
            print("  - %s·%s：明天到期（第%d次复习）" % (subject, point, n))
    else:
        print("  - 无")
    print("SecondBrain 根：%s" % sb_root)
    print("=" * 46)


def main():
    parser = argparse.ArgumentParser(description="StudyPet → SecondBrain 每日同步引擎")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写任何文件")
    parser.add_argument("--date", default=None, help="指定日期 YYYY-MM-DD（默认今天）")
    parser.add_argument("--sb-root", default=None, help="覆盖 SecondBrain 根目录（测试用）")
    args = parser.parse_args()

    date_str = args.date or date.today().isoformat()
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        print("错误：日期格式无效：%s（应为 YYYY-MM-DD）" % date_str)
        return 1
    sb_root = args.sb_root or DEFAULT_SB_ROOT
    tomorrow = (day + timedelta(days=1)).isoformat()
    mode = "dry-run" if args.dry_run else "real"

    stats = query_stats(ACTIVITY_DB, date_str)
    if stats is None:
        if not args.dry_run:
            log_entry(sb_root, "date=%s ERROR 查询 activity.db 失败" % date_str)
        return 1

    due_items = parse_due_items(os.path.join(sb_root, TRACKER_REL), tomorrow)
    print_summary(date_str, stats, due_items, mode, sb_root)

    if args.dry_run:
        print("（dry-run：未写任何文件）")
        return 0

    # 2. learning-state
    state_ok = False
    try:
        state = read_state(sb_root)
        merged = dict(state)
        merged.update({
            "lastSyncDate": date_str,
            "todayStudyMinutes": stats["study_minutes"],
            "totalActiveMinutes": stats["total_minutes"],
            "categories": stats["categories"],
            "subjects": state.get("subjects", {}),
        })
        p = write_state(sb_root, merged)
        state_ok = True
        print("已更新 learning-state.md：%s" % p)
    except Exception as e:
        print("错误：更新 learning-state.md 失败：%s" % e)
        log_entry(sb_root, "date=%s ERROR learning-state: %s" % (date_str, e))

    # 3. 日记统计段
    result = write_diary(sb_root, date_str, stats, due_items)
    if result == "written":
        print("已写入日记统计段：%s" % os.path.join(sb_root, DIARY_DIR, "%s.md" % date_str))
    elif result == "skipped":
        print("日记已有统计段，跳过（幂等）")
    else:
        log_entry(sb_root, "date=%s ERROR 写日记失败" % date_str)

    log_entry(
        sb_root,
        "date=%s mode=%s study=%dm total=%dm browser=%dm "
        "state=%s diary=%s reminder=%d项"
        % (
            date_str, mode, stats["study_minutes"], stats["total_minutes"],
            stats["browser_minutes"],
            "ok" if state_ok else "fail", result, len(due_items),
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
