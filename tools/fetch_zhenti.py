# -*- coding: utf-8 -*-
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

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "zhenti")


def _fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", errors="replace")


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
    opts = re.findall(r"([A-D])\s*[、.．]\s*([^\x00]{1,150}?)(?=\s*[A-D]\s*[、.．]|\s*$)", qbody)
    stem = re.sub(r"\s*[A-D]\s*[、.．]\s*[^\x00]{1,150}", "", qbody).strip()
    src = re.search(r"(\d{4})年广东[^：:]*?([\u4e00-\u9fa5A-Za-z]+?)真题", body)
    return {
        "type": qtype,
        "stem": _clean_surrogates(stem),
        "options": [_clean_surrogates(o[1].strip()) for o in opts],
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
            opts = [g.strip() for g in opt_m.groups()]
            if len(stem) > 4 and all(len(o) > 0 for o in opts):
                tm = re.search(r"【?(单选|多选|判断)题?】?", stem)
                out.append({"num": num, "type": tm.group(1) if tm else "?", "stem": stem, "options": opts})
    return out


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
        stem = q["stem"].replace('"', '\\"')
        opts = ", ".join(f'"{o.replace(chr(34), chr(92) + chr(34))}"' for o in q.get("options", []) or [])
        chapter = (chapter_map or {}).get(q.get("src", [None, ""])[0] if q.get("src") else "", "综合")
        lines.append(f"  {{ id: '{qid}', subject: '{subject}', chapter: '{chapter}', type: 'single',")
        lines.append(f"    stem: \"{stem}\", options: {'[' + opts + ']' if opts else 'undefined'},")
        lines.append(f"    answer: '{ans}', analysis: \"{ana}\", difficulty: 'medium', tags: ['真题'], source: 'import', createdAt: '2026-08-01' }},")
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

    p4 = sub.add_parser("gen", help="生成 seed.ts 片段")
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

    elif args.cmd == "gen":
        data = json.load(open(args.data, encoding="utf-8"))
        answers = json.load(open(args.answers, encoding="utf-8")) if args.answers else None
        text = gen_seed(data, answers, args.subject)
        if args.out:
            open(args.out, "w", encoding="utf-8").write(text)
        print(text if not args.out else f"片段 -> {args.out}")


if __name__ == "__main__":
    main()