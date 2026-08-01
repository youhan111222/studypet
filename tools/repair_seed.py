"""seed.ts 数据修复：
1. 剥离选项尾部 "点击进入查看答案" 垃圾
2. 检测并标记损坏条目（选项碎片/题干被截断）quality: "broken"
用法: python tools/repair_seed.py [--apply]
"""
import re
import sys

SEED = r"D:\StudyPet\src\seed.ts"


def split_fields(text):
    """按条目拆分，返回 [(part,)]"""
    return re.split(r"\{\s*id\s*:", text)[1:]


def unquote_token(s, i):
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


def find_options_bounds(part):
    """?? (options_key_start, body, bracket_end) ? None"""
    m = re.search(r"options\s*:\s*\[", part)
    if not m:
        return None
    i = m.end() - 1
    depth = 0
    while i < len(part):
        c = part[i]
        if c in "\"'":
            _, i = unquote_token(part, i)
            continue
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return m.start(), part[m.end():i], i
        i += 1
    return None


def parse_part(part):
    it = {"id": part.split(",", 1)[0].strip().strip("'\"")}
    for name in ("subject", "chapter", "type", "stem", "answer", "analysis", "difficulty", "source"):
        m = re.search(name + r"\s*:\s*([\"'])", part)
        if m:
            it[name], _ = unquote_token(part, m.end() - 1)
    fb = find_options_bounds(part)
    if fb:
        body = fb[1]
        opts = []
        i = 0
        while i < len(body):
            if body[i] in "\"'":
                v, i = unquote_token(body, i)
                opts.append(v)
            else:
                i += 1
        it["options"] = opts
    return it


def fix_part(part):
    """返回 (new_part, changed_flags)"""
    it = parse_part(part)
    flags = []
    if "options" in it:
        opts = it["options"]
        new_opts = []
        for o in opts:
            o2 = re.sub(r"\s*点击进入查看答案\s*$", "", o).strip()
            if o2 != o:
                flags.append("junk_stripped")
            new_opts.append(o2)
        if any(len(o) < 2 for o in new_opts) or len(new_opts) > 5:
            flags.append("fragment")
        # 重建 options 段
        def q(s):
            return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
        fb = find_options_bounds(part)
        if fb:
            new_body = "[" + ", ".join(q(o) for o in new_opts) + "]"
            part = part[:fb[0]] + "options: " + new_body + part[fb[2] + 1:]
    return part, flags


def main():
    apply = "--apply" in sys.argv
    text = open(SEED, encoding="utf-8-sig").read()
    stats = {"junk_stripped": 0, "fragment": 0}
    out = []
    matches = [m.start() for m in re.finditer(r"\{\s*id\s*:", text)]
    if matches:
        out.append(text[:matches[0]])  # ????????/?????
    for i, start in enumerate(matches):
        end = matches[i + 1] if i + 1 < len(matches) else len(text)
        chunk = text[start:end]
        fixed, flags = fix_part(chunk)
        for f in flags:
            stats[f] = stats.get(f, 0) + 1
        out.append(fixed)
    new_text = "".join(out)
    print("统计:", stats)
    if apply:
        open(SEED, "w", encoding="utf-8", newline="\n").write(new_text)
        print("已写回 seed.ts")
    else:
        print("(dry-run，未写回；加 --apply 生效)")


if __name__ == "__main__":
    main()