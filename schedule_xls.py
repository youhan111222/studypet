"""官方课表 XLS 解析（xlrd），失败返回 []。"""
import os
import re
import sys

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
    except Exception as e:  # noqa: BLE001 - 课表解析失败降级为空（docstring 契约）
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
