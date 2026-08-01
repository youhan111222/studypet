"""StudyPet 真题抓取工具（可复用管道）

通道：
1. cwjedu 单题页  : https://tzzsb.cwjedu.com/st/{id}（批量，含题干+选项，无答案）
2. cwjedu 试卷页  : https://cwjedu.com/zsbtk/{sid}（整卷客观题，答案需另源）
3. 网页真题卷     : 任意 HTML（新东方/搜狐/offcn），正则/bs4 解析

用法：
  python tools/fetch_zhenti.py st --ids 10440-10499 --out data/zhenti/pol.json
  python tools/fetch_zhenti.py exam --sid 53509 --out data/zhenti/pol2024.json
  python tools/fetch_zhenti.py page --url https://... --out data/zhenti/page.json
  python tools/fetch_zhenti.py gen --data data/zhenti/pol.json --answers answers.json --out seed_snippet.txt

输出均为 JSON（题目数组），gen 子命令生成可直接插入 seed.ts 的 TS 片段。
答案文件格式：{"<st_id>": {"answer": "A", "analysis": "..."}}
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("需要 bs4：pip install beautifulsoup4", file=sys.stderr)
    sys.exit(1)

try:
    from zhenti_engine import answer_question
    HAS_ENGINE = True
except ImportError:
    HAS_ENGINE = False

import gzip as _gzip
import ssl as _ssl

UA_LIST = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
]
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "zhenti")


def _fetch(url, timeout=20, retries=2):
    """带 UA 轮换 / gzip / 重试的 GET（book118、renrendoc 等对裸 urllib 有 TLS 指纹拦截，
    此函数通过轮换 UA + 容错 SSL 尽量穿透；仍失败时用 open_page/浏览器通道兜底）。"""
    last_err = None
    ctx = _ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = _ssl.CERT_NONE
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA_LIST[attempt % len(UA_LIST)],
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
                "Accept-Encoding": "gzip",
                "Referer": "https://www.google.com/",
            })
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                body = resp.read()
                if resp.headers.get("Content-Encoding", "").lower() == "gzip":
                    body = _gzip.decompress(body)
                return body.decode("utf-8", errors="replace")
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    raise last_err


def _clean_surrogates(s):
    return re.sub(r"[\ud800-\udfff]", "?", s)


def parse_st_page(html):
    """解析 cwjedu 单题页：{type, stem, options, src}"""
    soup = BeautifulSoup(html, "html.parser")
    body = soup.get_text("\n", strip=True)
    i = body.find("题目：")
    if i < 0:
        return None
    seg = body[i:i + 900]
    m = re.match(r"题目：\s*【([^】]+)】\s*([\s\S]*?)(?=感谢您阅读|最新试题|相关课程|关于我们)", seg)
    if not m:
        return None
    qtype, qbody = m.group(1), m.group(2)
    qbody = re.sub(r"\s+", " ", qbody).strip()
    # 题干取到第一个选项标记（A. / A、 / A．）为止，避免误删题干正文
    opt_start = re.search(r"\s*[A-D]\s*[、.．]\s*", qbody)
    if opt_start:
        stem = qbody[:opt_start.start()].strip()
        opt_text = qbody[opt_start.start():]
    else:
        stem, opt_text = qbody, ""
    opts = re.findall(r"([A-D])\s*[、.．]\s*([^\x00]{1,150}?)(?=\s*[A-D]\s*[、.．]|\s*$)", opt_text)
    opts = [re.sub(r"\s*点击进入查看答案\s*$", "", _clean_surrogates(o[1].strip())).strip() for o in opts]
    stem = _clean_surrogates(stem)
    if len(stem) < 8 or len(opts) < 2:
        return None  # 明显截断/损坏，宁缺毋滥
    src = re.search(r"(\d{4})年广东[^：:]*?([\u4e00-\u9fa5A-Za-z]+?)真题", body)
    return {
        "type": qtype,
        "stem": stem,
        "options": opts,
        "src": list(src.groups()) if src else None,
    }


def fetch_st(ids, delay=0.25):
    out = []
    for qid in ids:
        try:
            html = _fetch(f"https://tzzsb.cwjedu.com/st/{qid}")
            r = parse_st_page(html)
            if r and len(r["stem"]) > 8 and len(r["options"]) >= 4:
                out.append({"id": qid, **r})
        except Exception as e:
            print(f"[skip] {qid}: {e}", file=sys.stderr)
        time.sleep(delay)
    return out


def parse_exam_page(html):
    """解析 cwjedu 试卷页：提取 li.m-ruleQuest-li 客观题"""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for li in soup.select("li.m-ruleQuest-li"):
        sub = li.select_one(".m-r-sub-tit")
        if not sub:
            continue
        p = sub.select_one("p")
        stem = p.get_text(" ", strip=True) if p else ""
        tm = re.search(r"\[(单选|多选|判断|辨析|问答|论述|材料分析)题?\]", sub.get_text(" ", strip=True))
        opts = []
        for dd in li.select("dd.m-answer-option"):
            div = dd.select_one("div")
            if div:
                opts.append(div.get_text(" ", strip=True).strip())
        if len(stem) > 6:
            out.append({"type": tm.group(1) if tm else "?", "stem": stem, "options": opts})
    return out


def parse_doc_text(text):
    """解析 renrendoc / book118 类文档正文（适合 open_page 抓回的纯文本）。

    兼容紧凑排版（选项连排）：1.题干（）A.选项B.选项C.选项D.选项答案：A解析：...
    支持大题标题：一、单项选择题 / 二、多项选择题 / 三、判断题
    """
    if not text:
        return []
    text = re.sub(r"[\r\n\t\u3000]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    sections = re.split(r"(一、单项选择题|二、多项选择题|三、判断题|四、简答题|五、论述题|六、作文题)", text)
    items = []
    for i in range(1, len(sections), 2):
        sec_name, sec = sections[i], sections[i + 1]
        if "单项" in sec_name:
            qtype = "single"
        elif "多项" in sec_name:
            qtype = "multiple"
        elif "判断" in sec_name:
            qtype = "truefalse"
        else:
            continue
        # 题号定位：数字. 开头（排除解析里的 (1). 枚举：要求前面不是 ( 或数字）
        qs = list(re.finditer(r"(?<![\d(（A-Za-z])(\d{1,2})\.", sec))
        for idx, m in enumerate(qs):
            start, end = m.end(), qs[idx + 1].start() if idx + 1 < len(qs) else len(sec)
            chunk = sec[start:end]
            am = re.search(r"答案[:：]\s*([A-D]+)\s*解析[:：]?", chunk)
            if not am:
                continue
            ans = am.group(1)
            pre, post = chunk[:am.start()], chunk[am.end():]
            stem, opts = "", []
            om = re.match(r"(.*?)(?:A\.)\s*(.*?)(?:B\.)\s*(.*?)(?:C\.)\s*(.*?)(?:D\.)\s*(.*)$", pre, re.S)
            if om:
                stem = re.sub(r"\s+", " ", om.group(1)).strip()
                opts = [re.sub(r"\s+", " ", g).strip() for g in om.groups()[1:]]
            else:
                stem = re.sub(r"\s+", " ", pre).strip()
            analysis = re.sub(r"\s+", " ", post).strip()
            # 去掉题干里用于占位的（）
            stem = stem.rstrip("（( ）)")
            if len(stem) >= 6:
                items.append({"num": m.group(1), "type": qtype, "stem": stem,
                              "options": opts, "answer": ans, "analysis": analysis})
    return items


def parse_generic_page(html):
    """解析通用真题卷页（新东方/搜狐/offcn 格式）。

    兼容 OCR 题号（1 可能被识别成 l/I）：
      l. It is necessary to ... A. hold B. hand C. reach D. place
    """
    txt = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", "", html)
    txt = re.sub(r"<[^>]+>", "\n", txt)
    txt = re.sub(r"\s+", " ", txt)
    out = []
    # 切题：题号（数字或 OCR 的 l/I）+ 点号/顿号 开头
    num_pat = r"(?:^|(?<=\s))([0-9]{1,2}|[lI])(?:[、.．])\s*"
    starts = [m.start() for m in re.finditer(num_pat, txt)]
    for idx, s in enumerate(starts):
        e = starts[idx + 1] if idx + 1 < len(starts) else len(txt)
        seg = txt[s:e]
        num = re.match(num_pat, seg).group(1)
        seg = seg[len(re.match(num_pat, seg).group(0)):]
        # 选项块：A. ... B. ... C. ... D. ...（到段尾）
        opt_m = re.search(r"A[、.．]\s*(.+?)\s*B[、.．]\s*(.+?)\s*C[、.．]\s*(.+?)\s*D[、.．]\s*(.+?)\s*$", seg, re.DOTALL)
        if opt_m:
            stem = seg[:opt_m.start()].strip()
            opts = [re.sub(r"\s*点击进入查看答案\s*$", "", g).strip() for g in opt_m.groups()]
            stem_ok = len(stem) >= 8 and ("___" in stem or "____" in stem or "？" in stem or "?" in stem or len(stem) >= 15)
            if stem_ok and all(len(o) > 1 for o in opts):
                tm = re.search(r"【?(单选|多选|判断)题?】?", stem)
                out.append({"num": num, "type": tm.group(1) if tm else "?", "stem": stem, "options": opts})
    return out


def load_existing_stems(seed_path="src/seed.ts"):
    """读取 seed.ts 中已录题目的题干，用于去重。"""
    try:
        text = open(seed_path, encoding="utf-8").read()
    except OSError:
        return set()
    stems = set()
    for m in re.finditer(r"stem:\s*[\'\"]([^\'\"]{10,})[\'\"]", text):
        key = re.sub(r"[\s\\_（）()、，。·-]", "", m.group(1))
        stems.add(key)
    return stems


def dedup(data, seed_path="src/seed.ts"):
    """按题干归一化去重（与 seed.ts 已有题目 + 数据内部）。返回 (new_items, dup_ids)。"""
    existing = load_existing_stems(seed_path)
    seen = set(existing)
    new_items, dup_ids = [], []
    for item in data:
        key = re.sub(r"[\s\\_（）()、，。·-]", "", item.get("stem", ""))
        if not key:
            continue
        if key in seen:
            dup_ids.append(item.get("id") or item.get("num"))
        else:
            seen.add(key)
            new_items.append(item)
    return new_items, dup_ids


# 科目自动分类（关键词命中计分）
_SUBJECT_KEYWORDS = {
    "politics": ["社会主义", "共产党", "习近平", "马克思主义", "新民主主义", "中国特色", "人民", "党的", "改革", "制度", "国情", "革命", "思想", "民主", "矛盾", "新时代", "二十大", "马克思主义中国化", "百年奋斗"],
    "english": ["the", "of", "and", "to ", " in ", " he ", " she ", " it ", " was ", " are ", " English", "student", "teacher", "school", "Passage", "Paragraph"],
    "math": ["lim", "dx", "积分", "极限", "导数", "函数", "方程", "级数", "sin", "cos", "x²", "y′", "∑", "∫", "收敛", "求导", "微分"],
    "electronics": ["二极管", "运放", "三极管", "BJT", "触发器", "逻辑", "整流", "稳压", "放大", "反馈", "电路", "计数器", "卡诺图", "运算放大器"],
}

# 阅读题/无短文特征（无法作答的题）
_READONLY_MARKS = ["passage", "paragraph", "underlined", "main idea", "main purpose", "infer", "the story", "the tone", "本文", "文章", "短文", "第\\d+段", "What can we learn", "What is the main"]


def classify_subject(item):
    """按题干关键词给题目分类，返回 (subject, score) 或 (None, 0)"""
    stem = item.get("stem", "")
    low = stem.lower()
    best, best_score = None, 0
    for subj, kws in _SUBJECT_KEYWORDS.items():
        score = sum(1 for k in kws if k.lower() in low)
        if score > best_score:
            best, best_score = subj, score
    return best, best_score


def is_readonly(item):
    """判断是否依赖短文/上下文（无法独立作答）"""
    low = item.get("stem", "").lower()
    return any(re.search(m, low) for m in _READONLY_MARKS)


def scan_ids(seed_id, radius, probe_step=5, delay=0.2):
    """从 seed_id 向两侧试探扫描，命中密集段则全扫。返回 (fetched, scanned)。"""
    import time as _t
    fetched, scanned = {}, 0
    ids = list(range(max(1, seed_id - radius), seed_id + radius + 1))
    # 先试探：每 probe_step 个抓 1 个
    hits = []
    for i in range(0, len(ids), probe_step):
        qid = ids[i]
        scanned += 1
        try:
            html = _fetch(f"https://tzzsb.cwjedu.com/st/{qid}")
            r = parse_st_page(html)
            if r and len(r["stem"]) > 8 and len(r["options"]) >= 4:
                fetched[qid] = r
                hits.append(qid)
        except Exception:
            pass
        _t.sleep(delay)
    # 命中点邻域全扫（命中点 ±15）
    dense = set()
    for h in hits:
        for d in range(-15, 16):
            dense.add(h + d)
    dense = {d for d in dense if max(1, seed_id - radius) <= d <= seed_id + radius}
    for qid in sorted(dense - set(fetched.keys())):
        scanned += 1
        try:
            html = _fetch(f"https://tzzsb.cwjedu.com/st/{qid}")
            r = parse_st_page(html)
            if r and len(r["stem"]) > 8 and len(r["options"]) >= 4:
                fetched[qid] = r
        except Exception:
            pass
        _t.sleep(delay)
    return fetched, scanned


def auto_import(seed_id, radius, subject_filter=None, seed_path="src/seed.ts", out=None):
    """自动扫描 → 解析 → 分类 → 去重 → 报告。返回结构化结果。"""
    fetched, scanned = scan_ids(seed_id, radius)
    items = [{"id": qid, **r} for qid, r in sorted(fetched.items())]
    # 分类 + 过滤
    classified, skipped = [], []
    for it in items:
        if is_readonly(it):
            skipped.append((it["id"], "readonly"))
            continue
        subj, score = classify_subject(it)
        if subj is None or score == 0:
            skipped.append((it["id"], "unclassified"))
            continue
        if subject_filter and subj != subject_filter:
            skipped.append((it["id"], f"filter:{subj}"))
            continue
        it["subject"] = subj
        it["score"] = score
        classified.append(it)
    # 去重
    new_items, dup_ids = dedup(classified, seed_path)
    report = {
        "scanned": scanned,
        "fetched": len(fetched),
        "classified": len(classified),
        "new": len(new_items),
        "duplicated": len(dup_ids),
        "skipped": len(skipped),
        "by_subject": {},
        "dup_ids": dup_ids[:20],
        "skip_reasons": {},
    }
    for it in classified:
        report["by_subject"][it["subject"]] = report["by_subject"].get(it["subject"], 0) + 1
    for _, reason in skipped:
        report["skip_reasons"][reason] = report["skip_reasons"].get(reason, 0) + 1
    if out:
        json.dump({"report": report, "new_items": new_items, "skipped": skipped},
                  open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return report, new_items


def gen_stats(seed_path="src/seed.ts"):
    """扫描 seed.ts 生成真题统计（自动更新 docs/zhenti-stats.md）"""
    text = open(seed_path, encoding="utf-8").read()
    total = len(re.findall(r"subject:\s*[\'\"]", text))
    zt = len(re.findall(r"source: 'import'", text))
    by_subject = {}
    for m in re.finditer(r"subject:\s*[\'\"]([a-z]+)[\'\"]", text):
        by_subject[m.group(1)] = by_subject.get(m.group(1), 0) + 1
    by_year = {}
    for m in re.finditer(r"tags: \[([^\]]*202[0-9][^\]]*)\].*?source: 'import'", text):
        y = re.search(r"202[0-9]", m.group(1))
        if y:
            by_year[y.group(0)] = by_year.get(y.group(0), 0) + 1
    subject_cn = {"electronics": "电子技术", "math": "高等数学", "english": "英语", "politics": "政治"}
    lines = [
        "# StudyPet 题库统计（自动生成）",
        "",
        f"> 更新：{__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')} ｜ 由 tools/fetch_zhenti.py stats 生成",
        "",
        f"- **总题数**：{total}",
        f"- **真题数**：{zt}",
        "",
        "| 科目 | 总题数 |",
        "|---|---|",
    ]
    for s, n in sorted(by_subject.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {subject_cn.get(s, s)} | {n} |")
    if by_year:
        lines.append("")
        lines.append("| 真题年份 | 数量 |")
        lines.append("|---|---|")
        for y, n in sorted(by_year.items()):
            lines.append(f"| {y} | {n} |")
    doc = "\n".join(lines) + "\n"
    open("docs/zhenti-stats.md", "w", encoding="utf-8").write(doc)
    return doc


def gen_seed(data, answers, subject, chapter_map=None):
    """生成 seed.ts 片段；answers: {id 或 num: {answer, analysis}}"""
    lines = []
    for i, q in enumerate(data, 1):
        key = str(q.get("id") or q.get("num", ""))
        a = (answers or {}).get(key, {})
        ans = a.get("answer", "")
        ana = a.get("analysis", "")
        if not ans:
            print(f"[warn] 缺少答案: {key} {q['stem'][:30]}", file=sys.stderr)
        qid = f"imp-{int(time.time()) % 100000}-{i}"
        tags = ["真题"]
        _yr = (q.get("src") or [None])[0]
        if _yr and re.fullmatch(r"20\d{2}", str(_yr)):
            tags.append(str(_yr))
        stem = json.dumps(q["stem"], ensure_ascii=False)
        opts = json.dumps(q.get("options", []) or [], ensure_ascii=False)
        ana = json.dumps(ana, ensure_ascii=False)
        chapter = (chapter_map or {}).get(q.get("src", [None, ""])[0] if q.get("src") else "", "综合")
        lines.append(f"  {{ id: '{qid}', subject: '{subject}', chapter: '{chapter}', type: '{q.get('type', 'single')}',")
        lines.append(f"    stem: {stem}, options: {opts},")
        lines.append(f"    answer: '{ans}', analysis: {ana}, difficulty: 'medium', tags: {tags}, source: 'import', createdAt: '2026-08-01' }},")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="StudyPet 真题抓取工具")
    sub = ap.add_subparsers(dest="cmd")

    p1 = sub.add_parser("st", help="抓 cwjedu 单题页（支持区间 10440-10499 或逗号列表）")
    p1.add_argument("--ids", required=True)
    p1.add_argument("--out", required=True)

    p2 = sub.add_parser("exam", help="抓 cwjedu 试卷页")
    p2.add_argument("--sid", required=True)
    p2.add_argument("--out", required=True)

    p3 = sub.add_parser("page", help="解析任意真题网页")
    p3.add_argument("--url", required=True)
    p3.add_argument("--out", required=True)

    p31 = sub.add_parser("doc", help="解析文档正文纯文本（renrendoc/book118 格式，配合 open_page 抓回内容）")
    p31.add_argument("--file", required=True, help="包含正文的 txt 文件")
    p31.add_argument("--out", required=True)

    p4 = sub.add_parser("gen", help="生成 seed.ts 片段")
    p4.add_argument("--dedup", action="store_true", help="与 src/seed.ts 已有题目去重")

    p5 = sub.add_parser("auto", help="自动扫描 cwjedu ID 段：分类/去重/报告（真正的自动化采集）")
    p5.add_argument("--seed", type=int, required=True, help="种子题目 ID（如 10440）")
    p5.add_argument("--radius", type=int, default=150, help="向两侧扫描半径")
    p5.add_argument("--subject", help="只保留指定科目（politics/english/math/electronics）")
    p5.add_argument("--out", help="输出 JSON（含报告+新题）")

    sub.add_parser("stats", help="扫描 seed.ts 生成统计并更新 docs/zhenti-stats.md")
    p4.add_argument("--data", required=True)
    p4.add_argument("--answers")
    p4.add_argument("--subject", default="politics")
    p4.add_argument("--out")

    args = ap.parse_args()
    os.makedirs(CACHE_DIR, exist_ok=True)

    if args.cmd == "st":
        ids = []
        for part in args.ids.split(","):
            part = part.strip()
            if "-" in part:
                a, b = part.split("-")
                ids.extend(range(int(a), int(b) + 1))
            else:
                ids.append(int(part))
        results = fetch_st(ids)
        json.dump(results, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{len(results)} 题 -> {args.out}")

    elif args.cmd == "exam":
        html = _fetch(f"https://cwjedu.com/zsbtk/{args.sid}")
        results = parse_exam_page(html)
        json.dump(results, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{len(results)} 题 -> {args.out}")

    elif args.cmd == "page":
        html = _fetch(args.url)
        results = parse_generic_page(html)
        json.dump(results, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{len(results)} 题 -> {args.out}")

    elif args.cmd == "doc":
        text = open(args.file, encoding="utf-8", errors="replace").read()
        results = parse_doc_text(text)
        json.dump(results, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{len(results)} 题 -> {args.out}")

    elif args.cmd == "gen":
        data = json.load(open(args.data, encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("new_items") or data.get("items") or []
        answers = json.load(open(args.answers, encoding="utf-8")) if args.answers else None
        if answers is None:
            answers = {}
            for q in data:
                if q.get("answer"):
                    answers[str(q.get("id") or q.get("num", ""))] = {
                        "answer": q["answer"], "analysis": q.get("analysis", "")}
        if not answers and HAS_ENGINE:
            answers = {}
            auto, pending = 0, 0
            for q in data:
                key = str(q.get("id") or q.get("num", ""))
                r = answer_question(args.subject, q.get("stem", ""), q.get("options"))
                if r and r.get("answer") and r.get("confidence", 0) >= 0.75:
                    answers[key] = {"answer": r["answer"], "analysis": r.get("rule", "")}
                    auto += 1
                else:
                    pending += 1
                    print("[pending] " + key + " " + str(q.get("stem", ""))[:40] + " (需人工确认答案)", file=sys.stderr)
            print("[engine] 自动判题 " + str(auto) + " 道，待人工 " + str(pending) + " 道", file=sys.stderr)
        if args.dedup:
            data, dup_ids = dedup(data)
            print(f"[dedup] 去重后 {len(data)} 题，重复 {len(dup_ids)}: {dup_ids[:10]}{'...' if len(dup_ids) > 10 else ''}", file=sys.stderr)
        text = gen_seed(data, answers, args.subject)
        if args.out:
            open(args.out, "w", encoding="utf-8").write(text)
        print(text if not args.out else f"片段 -> {args.out}")

    elif args.cmd == "auto":
        report, new_items = auto_import(args.seed, args.radius, args.subject, out=args.out)
        print("=== 自动采集报告 ===")
        for k, v in report.items():
            if k in ("dup_ids", "skip_reasons", "by_subject"):
                continue
            print(f"  {k}: {v}")
        print("  科目分布:", report["by_subject"])
        print("  跳过原因:", report["skip_reasons"])
        print("  去重重复 ID:", report["dup_ids"])
        if args.out:
            print(f"  新题 {len(new_items)} 道 -> {args.out}")

    elif args.cmd == "stats":
        doc = gen_stats()
        print(doc)


if __name__ == "__main__":
    main()