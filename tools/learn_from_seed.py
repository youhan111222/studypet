# -*- coding: utf-8 -*-
"""从 seed.ts 已录真题生成引擎学习表（行级解析，兼容单双引号）"""
import sys, re
sys.stdout.reconfigure(encoding="utf-8")

lines = open("D:/StudyPet/src/seed.ts", encoding="utf-8").read().split("\n")

def field_val(line, name):
    m = re.search(name + r"\s*:\s*[\'\"]([^\'\"]*)[\'\"]", line)
    return m.group(1) if m else None

def norm(s):
    return re.sub(r"[\s\\_（）()、，。·?？-]", "", s or "")

items = []
cur = {}
for l in lines:
    if re.search(r"\{\s*id\s*:", l):
        cur = {"id": field_val(l, "id")}
        for name in ("subject", "chapter", "type"):
            if name not in cur:
                v = field_val(l, name)
                if v is not None:
                    cur[name] = v
    elif cur is not None:
        for name in ("subject", "chapter", "type", "stem", "answer", "analysis", "source"):
            if name not in cur:
                v = field_val(l, name)
                if v is not None:
                    cur[name] = v
        if "}" in l and "id" in cur:
            items.append(cur)
            cur = None

pol = [it for it in items if it.get("subject") == "politics" and it.get("source") == "import"]
print("总题块:", len(items), "| 政治真题:", len(pol))

learned = {}
for it in pol:
    key = norm(it.get("stem", ""))[:60]
    if len(key) >= 10:
        learned[key] = {"answer": it.get("answer", ""), "analysis": (it.get("analysis", "") or "")[:60], "id": it.get("id", "")}

out = ['# -*- coding: utf-8 -*-',
       '# 自动生成：从 seed.ts 已录政治真题学习（zhenti_engine 自学习表）',
       '# 重新生成：python tools/learn_from_seed.py',
       'LEARNED_POLITICS = {']
for k in sorted(learned):
    v = learned[k]
    out.append("    " + repr(k) + ": " + repr(v) + ",")
out.append("}")
open("D:/StudyPet/tools/politics_learned.py", "w", encoding="utf-8").write("\n".join(out))
print("学习表:", len(learned), "条 -> tools/politics_learned.py")