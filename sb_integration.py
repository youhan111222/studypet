"""SecondBrain 集成：复习追踪器 / 错题本 / 日记 / 学习状态（纯函数，无 HTTP 依赖）。

路由层在 api_server.py；本模块只做文件读写/解析/到期判定。
"""
import json
import os
import re
from datetime import date, datetime, timedelta

# === SecondBrain 集成（复习追踪器 / 错题本 / 日记 / 学习状态） ===
# 根目录可用环境变量 SECOND_BRAIN_ROOT 覆盖（测试用临时目录，不碰真实文件）
SECOND_BRAIN_ROOT = os.environ.get("SECOND_BRAIN_ROOT", r"D:\SecondBrain")
TRACKER_PATH = os.path.join(SECOND_BRAIN_ROOT, r"15-元知识\学习系统\📌 复习追踪器.md")
TRACKER_HEADER = "# 📌 复习追踪器\n\n> 间隔复习：1/2/4/7/15/30 天。学习新知识点当天登记，到间隔日勾选 ✅。\n> 维护：StudyPet（/secondbrain/review-check）或手动。格式勿改（后端解析依赖）。\n\n| 学习日期 | 知识点 | 科目 | ①1天 | ②2天 | ③4天 | ④7天 | ⑤15天 | ⑥30天 |\n|----------|--------|------|------|------|------|------|-------|-------|\n"
MISTAKES_DIR = os.path.join(SECOND_BRAIN_ROOT, "10-知识库")
DIARY_DIR = os.path.join(SECOND_BRAIN_ROOT, "20-日记")
STATE_PATH = os.path.join(SECOND_BRAIN_ROOT, "memory-bank", "claude-code-memory", "learning-state.md")

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
        return date.fromisoformat(str(s).strip())
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
    today_d = _sb_parse_date(today) or datetime.now().astimezone().date()
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
            if stripped.startswith(("#", "---")):
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
    except (OSError, json.JSONDecodeError):
        return {}
