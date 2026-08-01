"""全量回归评测：规则引擎 + LLM 判题准确率。
用法:
  python tools/engine_eval.py                          # 仅规则引擎
  python tools/engine_eval.py --llm                    # 规则+LLM（只测规则判不出的）
  python tools/engine_eval.py --subject math --source import --limit 50
输出: docs/engine-report.md + 控制台摘要
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zhenti_engine import answer_question  # noqa: E402

SEED = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "seed.ts"))
REPORT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "engine-report.md"))
CACHE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "zhenti", "llm-cache.json"))

SUBJ_CN = {"english": "英语", "politics": "政治", "math": "高数", "electronics": "电子"}


def _unquote(s, i):
    q = s[i]
    i += 1
    out = []
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            out.append(s[i + 1])
            i += 2
            continue
        if c == q:
            return "".join(out), i + 1
        out.append(c)
        i += 1
    return "".join(out), i


def parse_seed(path):
    text = open(path, encoding="utf-8-sig").read()
    items = []
    for part in re.split(r"\{\s*id\s*:", text)[1:]:
        it = {"id": part.split(",", 1)[0].strip().strip("'\"")}
        for name in ("subject", "chapter", "type", "stem", "answer", "analysis", "source"):
            m = re.search(name + r'\s*:\s*["\']', part)
            if m:
                it[name], _ = _unquote(part, m.end() - 1)
        mo = re.search(r"options\s*:\s*\[", part)
        if mo:
            i = mo.end() - 1
            depth = 0
            while i < len(part):
                c = part[i]
                if c in "\"'":
                    _, i = _unquote(part, i)
                    continue
                if c == "[":
                    depth += 1
                elif c == "]":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            body = part[mo.end():i]
            opts = []
            i = 0
            while i < len(body):
                if body[i] == chr(34) or body[i] == chr(39):
                    v, i = _unquote(body, i)
                    opts.append(v)
                else:
                    i += 1
            it["options"] = opts
        if it.get("id") and it.get("stem") and it.get("answer") and it.get("options"):
            items.append(it)
    return items


def norm_ans(s):
    return "".join(sorted(set(re.sub(r"[^A-Da-d]", "", s or "").upper())))


def is_broken(it):
    stem = (it.get("stem") or "").strip()
    opts = it.get("options") or []
    if "\u70b9\u51fb" in stem or any("\u70b9\u51fb" in o for o in opts):
        return True
    if any(re.fullmatch(r"[\s,\uff0c;\uff1b\u3001.\u3002]+", o) for o in opts):
        return True
    if any(o == "" for o in opts):
        return True
    if len(opts) != len(set(opts)):
        return True
    if len(stem) < 10 and not stem.endswith(("\uff1f", "?", "\u3002", ".")):
        return True
    if "___" not in stem and not stem.endswith(("\uff1f", "?", "\u3002", ".", "\u2026", "\uff1a", ":", "\uff09", ")")):
        return True
    if "___" in stem and re.search(r"\b(we|he|she|they|it|you|i|tom|bill|john|mr|mrs)\s*$", stem, re.IGNORECASE):
        return True
    return False


def main():
    ap = argparse.ArgumentParser(description="StudyPet 判题引擎回归评测")
    ap.add_argument("--llm", action="store_true", help="规则判不出时用 DeepSeek LLM 判题")
    ap.add_argument("--subject", help="只测指定科目")
    ap.add_argument("--source", help="只测指定来源（如 import）")
    ap.add_argument("--limit", type=int, help="LLM 评测最多测 N 道（控制成本）")
    ap.add_argument("--n", type=int, default=3, help="LLM 采样次数（默认 3）")
    args = ap.parse_args()

    items = parse_seed(SEED)
    items = [it for it in items if it.get("type") in ("single", "multiple", "truefalse")]
    broken = [it for it in items if is_broken(it)]
    items = [it for it in items if not is_broken(it)]
    print("??????(??):", len(broken))
    for b in broken[:10]:
        print("  -", b.get("id"), (b.get("stem") or "")[:36])
    if args.subject:
        items = [it for it in items if it.get("subject") == args.subject]
    if args.source:
        items = [it for it in items if it.get("source") == args.source]
    print("题目总数(带答案):", len(items))

    stat = {"total": len(items), "rules_ok": 0, "rules_wrong": 0, "pending": 0}
    pending = []
    for it in items:
        r = answer_question(it.get("subject"), it.get("stem"), it.get("options"))
        pred = norm_ans(r.get("answer"))
        known = norm_ans(it.get("answer"))
        if pred:
            if pred == known:
                stat["rules_ok"] += 1
                it["_pred"] = pred
            else:
                stat["rules_wrong"] += 1
                it["_pred"] = pred
                it["_wrong"] = r.get("rule", "")
        else:
            stat["pending"] += 1
            pending.append(it)

    rules_answered = stat["rules_ok"] + stat["rules_wrong"]
    print("\n=== 规则引擎 ===")
    print("自动判题:", rules_answered, "/", len(items))
    print("正确:", stat["rules_ok"], " 错误:", stat["rules_wrong"],
          " 准确率:", ("%.2f%%" % (100.0 * stat["rules_ok"] / rules_answered)) if rules_answered else "N/A")
    print("待判:", stat["pending"])

    llm_stat = {"ok": 0, "wrong": 0, "none": 0}
    if args.llm and pending:
        from llm_judge import judge_batch
        todo = pending if not args.limit else pending[:args.limit]
        batch = [{"subject": it.get("subject"), "stem": it.get("stem"), "options": it.get("options")} for it in todo]
        print(f"\n=== LLM 判题（采样 n={args.n}，并发 6）===")
        stats = judge_batch(batch, n=args.n, concurrency=6)
        print("LLM 结果统计:", stats)
        for it, b in zip(todo, batch):
            r = b.get("llm", {})
            pred = norm_ans(r.get("answer"))
            known = norm_ans(it.get("answer"))
            if pred == known:
                llm_stat["ok"] += 1
                it["_llm"] = pred
            elif pred:
                llm_stat["wrong"] += 1
                it["_llm"] = pred
                it["_llm_wrong"] = r.get("rule", "")
            else:
                llm_stat["none"] += 1
        llm_ans = llm_stat["ok"] + llm_stat["wrong"]
        print("LLM 判题:", llm_ans, "/", len(todo))
        if llm_ans:
            print("正确:", llm_stat["ok"], " 错误:", llm_stat["wrong"],
                  " 准确率: %.2f%%" % (100.0 * llm_stat["ok"] / llm_ans))

    # 汇总
    all_ok = stat["rules_ok"] + llm_stat["ok"]
    all_wrong = stat["rules_wrong"] + llm_stat["wrong"]
    all_ans = all_ok + all_wrong
    print("\n=== 汇总（规则+LLM）===")
    print("可判题:", all_ans, "/", len(items), " 正确:", all_ok, " 错误:", all_wrong,
          " 综合准确率:", ("%.2f%%" % (100.0 * all_ok / all_ans)) if all_ans else "N/A")

    # 错误明细
    wrongs = [it for it in items if it.get("_wrong") or it.get("_llm_wrong")]
    if wrongs:
        print("\n错误明细:")
        for it in wrongs[:20]:
            print(" -", it.get("id"), it.get("subject"), it.get("stem", "")[:36],
                  "| known:", it.get("answer"), "| pred:", it.get("_pred") or it.get("_llm"),
                  "|", it.get("_wrong") or it.get("_llm_wrong"))

    # 写报告
    lines = [
        "# 判题引擎回归报告",
        "",
        "- 生成时间: " + __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
        "- 题目范围: " + (args.subject or "全部") + " / source=" + (args.source or "全部") + " / 共 " + str(len(items)) + " 题",
        "",
        "## 规则引擎",
        "",
        "| 指标 | 值 |",
        "|---|---|",
        f"| 自动判题 | {rules_answered} / {len(items)} |",
        f"| 正确 | {stat[chr(114)+chr(117)+chr(108)+chr(101)+chr(115)+chr(95)+chr(111)+chr(107)]} |",
        f"| 错误 | {stat[chr(114)+chr(117)+chr(108)+chr(101)+chr(115)+chr(95)+chr(119)+chr(114)+chr(111)+chr(110)+chr(103)]} |",
        "| 准确率 | %.2f%% |" % (100.0 * stat["rules_ok"] / rules_answered) if rules_answered else "| 准确率 | N/A |",
        f"| 待判 | {stat[chr(112)+chr(101)+chr(110)+chr(100)+chr(105)+chr(110)+chr(103)]} |",
        "",
    ]
    if args.llm:
        llm_ans = llm_stat["ok"] + llm_stat["wrong"]
        lines += [
            "## LLM 判题（DeepSeek 多采样）",
            "",
            "| 指标 | 值 |",
            "|---|---|",
            f"| 评测题数 | {len(todo)} |" if args.llm else "",
            f"| 判出 | {llm_ans} |",
            f"| 正确 | {llm_stat[chr(111)+chr(107)]} |",
            f"| 错误 | {llm_stat[chr(119)+chr(114)+chr(111)+chr(110)+chr(103)]} |",
            "| 准确率 | %.2f%% |" % (100.0 * llm_stat["ok"] / llm_ans) if llm_ans else "| 准确率 | N/A |",
            "",
        ]
    lines += [
        "## 综合（规则+LLM）",
        "",
        "| 指标 | 值 |",
        "|---|---|",
        f"| 可判题 | {all_ans} / {len(items)} |",
        f"| 正确 | {all_ok} |",
        f"| 错误 | {all_wrong} |",
        "| 综合准确率 | %.2f%% |" % (100.0 * all_ok / all_ans) if all_ans else "| 综合准确率 | N/A |",
        "",
    ]
    if wrongs:
        lines.append("## 错误明细（前 20）\n")
        for it in wrongs[:20]:
            lines.append("- {} [{}] {} | known={} pred={} | {}".format(
                it.get("id"), SUBJ_CN.get(it.get("subject"), it.get("subject")),
                it.get("stem", "")[:50], it.get("answer"), it.get("_pred") or it.get("_llm"),
                it.get("_wrong") or it.get("_llm_wrong")))
        lines.append("")
    open(REPORT, "w", encoding="utf-8").write("\n".join(lines))
    print("\n报告 ->", REPORT)


if __name__ == "__main__":
    main()