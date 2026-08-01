"""LLM 判题引擎：DeepSeek API 多采样判题，规则引擎外的第二道保险。
特性：
- 3 次独立采样 + 多数投票，只接受多数票（置信度>=2/3）
- 严格输出解析 ANSWER:X，兼容 答案:X / （X）
- 支持多选答案（ABCD 排序去重）
- 本地缓存 data/zhenti/llm-cache.json，命中不重复扣费
- 并发批量接口 judge_batch()
"""
import hashlib
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.normpath(os.path.join(BASE, "..", "data", "zhenti", "llm-cache.json"))
ENV_PATH = os.path.normpath(os.path.join(BASE, "..", ".env"))


def _load_key():
    try:
        for line in open(ENV_PATH, encoding="utf-8"):
            line = line.strip()
            if line.startswith("DEEPSEEK_API_KEY="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return os.environ.get("DEEPSEEK_API_KEY", "")


def _load_cache():
    try:
        return json.load(open(CACHE_PATH, encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(cache):
    try:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        json.dump(cache, open(CACHE_PATH, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception:
        pass


def _key(subject, stem, options):
    raw = subject + "|" + (stem or "") + "|" + "|".join(options or [])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


_SUBJECT_CN = {
    "english": "英语（语法与词汇单选）",
    "politics": "政治（毛泽东思想/中国特色社会主义理论/时政，单选或多项选择）",
    "math": "高等数学（极限/导数/积分/方程）",
    "electronics": "电子技术基础（电路/半导体/数电模电单选）",
}

_SYSTEM = (
    "你是广东省专插本（普通专升本）考试的命题与阅卷专家。根据题干和选项选出唯一正确答案。"
    "先在心里推理（不要输出推理过程），最后一行严格输出 ANSWER:X（X 为一个或多个大写字母，如 A 或 ABC）。"
    "只输出那一行 ANSWER，不要输出任何其他内容。"
)


def _build_prompt(subject, stem, options):
    lines = ["科目：" + _SUBJECT_CN.get(subject, subject), "题干：" + (stem or "")]
    for i, o in enumerate(options or []):
        lines.append(chr(65 + i) + ". " + o)
    lines.append("请给出正确答案。")
    return "\n".join(lines)


def _call_once(subject, stem, options, api_key, timeout=40):
    """单次调用，返回 (letter_or_None, raw)"""
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": _build_prompt(subject, stem, options)},
        ],
        "max_tokens": 200,
        "temperature": 0.3,
    }
    headers = {"Content-Type": "application/json", "Authorization": "Bearer " + api_key}
    last_err = None
    for attempt in range(3):
        try:
            if HAS_REQUESTS:
                r = requests.post("https://api.deepseek.com/chat/completions",
                                  json=payload, headers=headers, timeout=timeout)
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"]
            else:
                import urllib.request
                req = urllib.request.Request(
                    "https://api.deepseek.com/chat/completions",
                    data=json.dumps(payload).encode(),
                    headers=headers,
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    content = json.loads(resp.read().decode())["choices"][0]["message"]["content"]
            return _parse(content), content.strip()
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    return None, "ERR:" + repr(last_err)


def _parse(content):
    """严格解析，支持 ANSWER:X / 答案：X / （X）"""
    if not content:
        return None
    for pat in (r"ANSWER\s*[:：]\s*([A-D]{1,4})", r"答案\s*[:：]\s*([A-D]{1,4})",
                r"[（(]\s*([A-D]{1,4})\s*[)）]"):
        m = re.search(pat, content, re.IGNORECASE)
        if m:
            return "".join(sorted(set(m.group(1).upper())))
    m = re.search(r"\b([A-D]{1,4})\b", content)
    return "".join(sorted(set(m.group(1).upper()))) if m else None


def _skip_reason(subject, stem):
    """规则外不判的场景：返回原因字符串或 None。"""
    s = (stem or "")
    if subject in ("math", "electronics"):
        return "skip:" + subject + "-rules-only"
    if "\u77ed\u6587" in s or "\u9605\u8bfb" in s or "\u6839\u636e\u77ed\u6587" in s or re.search(r"\bpassage\b", s, re.I):
        return "skip:needs-context"
    return None


def judge(subject, stem, options, n=3, api_key=None, cache=None, use_cache=True):
    """多采样判题。返回 {answer, confidence, votes, rule}；不达标返回 answer=None。"""
    reason = _skip_reason(subject, stem)
    if reason:
        return {"answer": None, "confidence": 0, "votes": {}, "rule": reason}
    api_key = api_key or _load_key()
    if not api_key:
        return {"answer": None, "confidence": 0, "votes": {}, "rule": "no api key"}
    key = _key(subject, stem, options)
    if cache is None:
        cache = _load_cache()
    if use_cache and key in cache:
        return dict(cache[key])
    votes = {}
    for _ in range(n):
        letter, _raw = _call_once(subject, stem, options, api_key)
        if letter:
            votes[letter] = votes.get(letter, 0) + 1
    best = max(votes, key=votes.get) if votes else None
    conf = (votes[best] / n) if best else 0.0
    result = {
        "answer": best if conf >= 0.66 else None,
        "confidence": round(conf, 2),
        "votes": votes,
        "rule": "llm:" + str(best) + "x" + str(votes.get(best, 0)) + "/" + str(n) if best else "llm:no-consensus",
    }
    if use_cache and best:
        cache[key] = result
        _save_cache(cache)
    return result


def judge_batch(items, n=3, concurrency=6, verbose=True):
    """items: [{subject, stem, options}] -> 每个 item 写入 item['llm']，返回统计。"""
    api_key = _load_key()
    cache = _load_cache()
    stats = {"ok": 0, "low_conf": 0, "fail": 0}

    def work(it):
        return judge(it["subject"], it.get("stem", ""), it.get("options") or [],
                     n=n, api_key=api_key, cache=cache)

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = {ex.submit(work, it): it for it in items}
        done = 0
        for fut in as_completed(futs):
            it = futs[fut]
            try:
                r = fut.result()
            except Exception as e:
                r = {"answer": None, "confidence": 0, "rule": "exn:" + repr(e)}
            it["llm"] = r
            if r.get("answer"):
                stats["ok"] += 1
            elif r.get("confidence", 0) >= 0.66:
                stats["low_conf"] += 1
            else:
                stats["fail"] += 1
            done += 1
            if verbose and done % 10 == 0:
                print(f"[llm] {done}/{len(items)}", file=sys.stderr)
    return stats


if __name__ == "__main__":
    demo = [
        {"subject": "english", "stem": "Our teacher suggested that each of us ___ a study plan.",
         "options": ["make", "made", "will make", "would make"]},
        {"subject": "math", "stem": "lim(x\u21920) (sin3x + sinx) / x = ?",
         "options": ["0", "1", "3", "4"]},
        {"subject": "politics", "stem": "\u4e2d\u56fd\u5171\u4ea7\u515a\u9886\u5bfc\u4eba\u6c11\u53d6\u5f97\u7684\u91cd\u5927\u6210\u5c31\u5305\u62ec\uff08\u591a\u9009\uff09",
         "options": ["\u989d\u56fd\u4e3b\u4e49", "\u5c01\u5efa\u4e3b\u4e49", "\u5b98\u50da\u8d44\u672c\u4e3b\u4e49", "\u6c11\u65cf\u4e3b\u4e49"]},
    ]
    for it in demo:
        print(it["subject"], "->", judge(it["subject"], it["stem"], it["options"], n=2))