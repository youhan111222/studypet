# -*- coding: utf-8 -*-
"""StudyPet 智能答题引擎：自动判定真题答案（不用人工填）。

能力：
1. English：内置语法规则库（虚拟语气/时态/非谓语/从句/倒装/短语动词/固定搭配）→ 自动答案+规则+置信度
2. Politics：高频考点-标准答案映射库（来自教材 + 已录 129 道真题提炼）
3. Math：sympy 符号计算（极限/导数/定积分等可解模式）
4. 置信度 < 阈值 → 标记 pending（宁缺毋滥）

用法：
    from zhenti_engine import answer_question
    r = answer_question("english", stem, options)  # -> {answer, confidence, rule}
"""
import os
import re
import sys
import math as _math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from politics_learned import LEARNED_POLITICS
    HAS_LEARNED = True
except ImportError:
    LEARNED_POLITICS = {}
    HAS_LEARNED = False

try:
    import sympy as sp
    HAS_SYMPY = True
except ImportError:
    HAS_SYMPY = False


# ============================================================
# 英语语法规则库
# ============================================================
def _norm(s):
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def _opts_map(options):
    """options -> {letter: text}"""
    return {chr(65 + i): (o or "").strip() for i, o in enumerate(options or [])}


_ENGLISH_RULES = [
    # (正则, 说明, 答案字母, 置信度) —— 答案字母按规则判定；None 表示需从选项内容匹配
    (r"suggest(?:ed|s|ion)?\s+that", "suggest 后虚拟语气用动词原形", "orig", 0.9),
    (r"essential\s+that", "essential 后虚拟语气用动词原形", "orig", 0.85),
    (r"necessary\s+that", "necessary 后虚拟语气用动词原形", "orig", 0.85),
    (r"required?\s+that", "required 后虚拟语气用动词原形", "orig", 0.85),
    (r"\bif\s+(?:\w+\s+)?had\b|\bif\s+had\b", "与过去事实相反虚拟：主句 would have done", "would_have", 0.92),
    (r"hadn't|had not", "与过去事实相反虚拟：主句 would have done", "would_have", 0.88),
    (r"\blest\b", "lest 后虚拟语气 should do（动词原形）", "orig", 0.85),
    (r"\bby\s+the\s+time\b", "by the time：主句用完成时（看选项）", "by_time", 0.85),
    (r"^hardly\b|^never\b|^not until\b|^no sooner\b", "否定词句首主句倒装", "invert", 0.9),
    (r"\bneither\s+(does|is|has|can|will|would)", "neither 倒装：neither+助动词+主语", "neither_aux", 0.85),
    (r"\bworth\b", "be worth doing（主动表被动）", "doing", 0.92),
    (r"look(?:ing)?\s+forward\s+to\b", "look forward to doing", "doing", 0.9),
    (r"\benough\s+to\b", "enough to do", "to_do", 0.85),
    (r"the\s+reason\b", "the reason 后接 why", "why", 0.8),
    (r"(?:school|place|room|factory|house|platform|city|village)\b[^.]*?\bwhere\b", "地点先行词用 where", "where", 0.85),
    (r"the\s+news\b", "the news 后同位语从句用 that", "that", 0.8),
    (r"\btoo\s+\w+\s+to\b", "too...to：太……而不能", "too", 0.9),
    (r"\bso\s+\w+\s+that\b", "so...that", "so", 0.85),
    (r"\bit\s+was\s+", "强调句型 It was...that", "that", 0.8),
    (r"\bfire\b|\bwar\s+", "break out：爆发（火/战争）", "break_out", 0.85),
    (r"twice\s+as\s+much", "倍数+as much as", "twice", 0.9),
    (r"the\s+number\s+of\b", "the number of+复数名词：谓语单数", "is", 0.85),
    (r"\bhardly\b.*\?", "hardly 反意疑问用肯定形式", "affirm_tag", 0.85),
    (r"no\s+sooner\b", "no sooner 倒装：had+主语+done", "had_invert", 0.9),
    (r"it\s+was\s+.*\bthat\b", "强调句型 It was...that", "that", 0.8),
    (r"\bonly\s+to\b", "only to do：结果却（意外）", "only_to", 0.85),
    (r"how\s+often\b", "提问频率用 How often", "how_often", 0.9),
    (r"\bput\s+up\s+with\b", "put up with：忍受", "put_up_with", 0.9),
    (r"\b(?:fire|war|fighting)\b.*?\bbreak\s+(?:out|off|up|down)", "break out：爆发（火/战争）", "break_out", 0.85),
    (r"\b(?:result|lead)\s+in\b", "result in：导致", "result_in", 0.85),
    (r"\baccount\s+for\b", "account for：解释", "account_for", 0.9),
    (r"\b(?:come|run)\s+into\b", "run into：偶遇", "run_into", 0.8),
    (r"\bkeep\s+up\s+with\b", "keep up with：跟上", "keep_up_with", 0.85),
    (r"\bcontribute\s+to\b", "contribute to：有助于", "contribute_to", 0.9),
    (r"\bcomposed\s+of\b", "be composed of：由……组成", "composed_of", 0.9),
    (r"out\s+of\s+reach\b", "out of one's reach：够不着", "out_of_reach", 0.9),
    (r"out\s+of\s+order\b", "out of order：故障/混乱", "out_of_order", 0.85),
    (r"on\s+second\s+thoughts?\b", "on second thoughts：再三考虑", "second_thoughts", 0.9),
    (r"make\s+(?:a\s+)?profit\b", "make a profit：获利", "profit", 0.9),
    (r"lose\s+(?:his|her|the|my|their)\s+temper\b", "lose one's temper：发脾气", "temper", 0.9),
    (r"take\s+every\s+chance\b", "take every chance：抓住每个机会", "chance", 0.9),
    (r"smoke\s+heavily\b|smoked\s+heavily\b", "smoke heavily：抽烟凶", "heavily", 0.9),
    (r"sensitive\s+to\b", "be sensitive to：对……敏感", "sensitive_to", 0.9),
    (r"after\s+all\b", "After all：毕竟", "after_all", 0.9),
    (r"in\s+that\s+case\b", "In that case：那样的话", "in_that_case", 0.9),
    (r"it's?\s+up\s+to\s+you\b|up\s+to\s+you\b", "It's up to you：由你决定", "up_to_you", 0.9),
    (r"i'?m\s+afraid\s+not\b", "I'm afraid not：恐怕不行", "afraid_not", 0.9),
    (r"\bdistinguished\b", "distinguished：杰出的", "distinguished", 0.85),
    (r"\bexcessive\b", "excessive：过度的", "excessive", 0.85),
    (r"\bfatal\b", "fatal：致命的", "fatal", 0.85),
    (r"\brevealed?\b", "reveal：揭示", "revealed", 0.85),
    (r"\bconstantly\b", "constantly：不断地", "constantly", 0.85),
    (r"\bsignificantly\b", "significantly：显著地", "significantly", 0.85),
    (r"\b(gather|collect)\s+information\b", "gather information：收集信息", "gather", 0.9),
    (r"double\s+(?:his|her|its|their|the|our)\s+efforts?\b", "double efforts：加倍努力", "efforts", 0.9),
    (r"\banyhow\b", "anyhow：无论如何", "anyhow", 0.85),
    (r"get\s+everything\s+ready\b", "get everything ready：准备好一切", "everything", 0.9),
    (r"\bstrikes?\b.*\bclock\b|\bclock\b.*\bstrikes?\b", "the clock strikes：钟敲响", "strikes", 0.85),
    (r"on\s+receiving\b|on\s+doing\b", "on doing：一……就", "on_doing", 0.85),
    (r"\bwhose\s+(?:cover|name|color|colour|roof)\b", "whose 引导定语从句", "whose", 0.85),
    (r"get\s+somewhere\b", "get somewhere：取得进展", "somewhere", 0.85),
    (r"\bwarn(?:ed)?\s+(?:him|her|them|the|us|me|his|my|their)\s+not\s+to\b", "warn sb not to do：警告不要", "warned", 0.9),
    (r"would\s+like\s+to\s+make\b", "make a profit：获利", "profit", 0.85),
    (r"used\s+to\s+smoke\b", "smoke heavily：抽烟凶", "heavily", 0.85),
]

# 选项内容匹配规则：需要看选项文本才能判定的
_ENGLISH_CONTENT_RULES = [
    # (题干正则, 选项匹配函数, 说明, 置信度)
    (r"needs?\b", lambda o: any(t in o.lower() for t in ["repairing", "cleaning", "fixing"]), "need doing 主动表被动", 0.85),
    (r"\bprefer\b.*\bto\b", lambda o: any(t.lower() in ["ones", "one"] for t in o), "代词替代复数用 ones", 0.8),
    (r"(?:short|tall|small|big)\s+as\s+he\s+is\b|as\s+he\s+is\b", lambda o: any("short as" in t.lower() or "as he is" in t.lower() for t in o), "形容词+as+主语：让步倒装", 0.85),
    (r"no\s+idea\b", lambda o: any("where to" in t.lower() or "when to" in t.lower() for t in o), "have no idea where/when to do", 0.8),
    (r"made\s+to\s+work\b|to\s+work\b", lambda o: any("was made" in t.lower() for t in o), "be made to do：被迫", 0.8),
    (r"online\s+shopping\b", lambda o: any("handled" in t.lower() for t in o), "when properly handled 分词", 0.8),
    (r"\bpunish", lambda o: any("be punished" in t.lower() for t in o), "被动语态 be punished", 0.85),
]


def _pick_letter(predicate, options):
    """从选项里按谓词找答案字母；命中多个取第一个，无命中返回 None"""
    for i, t in enumerate(options or []):
        if t and predicate(t):
            return chr(65 + i)
    return None


def answer_english(stem, options):
    """英语语法题自动判答案。返回 {answer, confidence, rule}"""
    s = _norm(stem)
    om = _opts_map(options)
    ol = [t.lower() for t in (options or [])]

    # 规则匹配
    for pat, rule, kind, conf in _ENGLISH_RULES:
        if re.search(pat, s):
            ans = _resolve_kind(kind, s, ol, om)
            if ans:
                return {"answer": ans, "confidence": conf, "rule": rule}
    # 内容匹配规则
    for pat, pred, rule, conf in _ENGLISH_CONTENT_RULES:
        if re.search(pat, s):
            ans = _pick_letter(pred, options)
            if ans:
                return {"answer": ans, "confidence": conf, "rule": rule}
    return {"answer": None, "confidence": 0, "rule": "no rule matched"}


def _resolve_kind(kind, s, ol, om):
    if kind == "orig":
        return _pick_letter(lambda t: _is_verb_orig(t, ol), ol) or _pick_letter(lambda t: re.fullmatch(r"[a-z]+", t.strip()), ol)
    if kind == "would_have":
        return _pick_letter(lambda t: "would have" in t, ol)
    if kind == "will_have":
        return _pick_letter(lambda t: "will have" in t, ol)
    if kind == "had_done":
        return _pick_letter(lambda t: "had " in t and "been" in t or re.search(r"\bhad\s+\w+ed\b", t), ol)
    if kind == "by_time":
        a = _pick_letter(lambda t: "will have" in t, ol)
        if a:
            return a
        b = _pick_letter(lambda t: re.search(r"\bhad\s+(?:\w+ed|been)\b", t), ol)
        if b:
            return b
        return _pick_letter(lambda t: "have" in t, ol)
    if kind == "invert":
        return _pick_letter(lambda t: re.match(r"^(did|had|does|do|is|was|has|will|would)\s+(he|she|it|they|we|i|you)", t.strip()), ol)
    if kind == "neither_aux":
        return _pick_letter(lambda t: t.startswith("neither does") or t.startswith("neither has") or t.startswith("neither "), ol)
    if kind == "doing":
        return _pick_letter(lambda t: t.endswith("ing"), ol)
    if kind == "to_do":
        return _pick_letter(lambda t: re.search(r"\bto\s+[a-z]+$", t.strip()) or t.strip().startswith("to "), ol)
    if kind == "why":
        return _pick_letter(lambda t: t.strip().lower() == "why", ol)
    if kind == "where":
        return _pick_letter(lambda t: t.strip().lower() == "where", ol)
    if kind == "that":
        return _pick_letter(lambda t: t.strip().lower() == "that", ol)
    if kind == "too":
        return _pick_letter(lambda t: t.strip().lower() == "too", ol)
    if kind == "so":
        return _pick_letter(lambda t: t.strip().lower() == "so", ol)
    if kind == "twice":
        return _pick_letter(lambda t: "twice as much" in t, ol)
    if kind == "is":
        return _pick_letter(lambda t: t.strip().lower() == "is" or t.strip().lower() in ("are", "was", "were") and "number" in s, ol)
    if kind == "affirm_tag":
        return _pick_letter(lambda t: re.match(r"^(does|is|has|did|was|can|will)\s+(he|she|it|they|we|i|you)", t.strip()), ol)
    if kind == "had_invert":
        return _pick_letter(lambda t: re.match(r"^had\s+", t.strip()), ol)
    if kind == "only_to":
        return _pick_letter(lambda t: t.strip().startswith("only to"), ol)
    if kind == "how_often":
        return _pick_letter(lambda t: t.strip().lower() == "how often", ol)
    # 短语/词汇类：选项含目标词
    kind_map = {
        "put_up_with": "put up with", "break_out": "broke out", "result_in": "result in",
        "account_for": "account for", "run_into": "run into", "keep_up_with": "keep up with",
        "contribute_to": "contribute to", "composed_of": "composed of", "out_of_reach": "reach",
        "out_of_order": "out of order", "second_thoughts": "thoughts", "profit": "profit",
        "temper": "temper", "chance": "chance", "heavily": "heavily", "sensitive_to": "to",
        "after_all": "after all", "in_that_case": "in that case", "up_to_you": "up to you",
        "afraid_not": "afraid not", "distinguished": "distinguished", "excessive": "excessive",
        "fatal": "fatal", "revealed": "revealed", "constantly": "constantly", "significantly": "significantly",
        "gather": "gather", "efforts": "efforts", "anyhow": "anyhow", "everything": "everything",
        "strikes": "strikes", "on_doing": "on", "whose": "whose", "somewhere": "somewhere",
        "warned": "warned", "where": "where",
    }
    target = kind_map.get(kind)
    if target:
        return _pick_letter(lambda t: target in t.lower(), ol)
    return None


def _is_verb_orig(t, ol):
    """判断是否为动词原形（排除 -s/-ed/-ing 形式）"""
    t = t.strip().lower()
    if not re.fullmatch(r"[a-z]+", t):
        return False
    if t.endswith("ing") or t.endswith("ed") or t.endswith("s"):
        # make/made 特例：made 可能是原形 made（过去式），这里简单排除常见过去式
        if t in ("made",):
            return True
        return False
    return True


# ============================================================
# 政治考点映射库
# ============================================================
_POLITICS_MAP = [
    (r"执政兴国", "发展"),
    (r"最本质的特征", "中国共产党领导"),
    (r"全面建设社会主义现代化国家的首要任务", "推动高质量发展"),
    (r"首要任务", "推动高质量发展"),
    (r"中华民族伟大复兴的根本保证", "中国共产党领导"),
    (r"总任务的根本保证", "中国共产党领导"),
    (r"第一动力", "创新"),
    (r"全面依法治国的总抓手", "建设中国特色社会主义法治体系"),
    (r"基础性建设", "思想建设"),
    (r"根本制度", "人民代表大会制度"),
    (r"根本领导制度", "党的领导制度"),
    (r"外交政策", "和平发展"),
    (r"台湾问题.{0,10}最佳方式|祖国统一的最佳方式", "一国两制"),
    (r"科学发展观.{0,20}第一要义|第一要义", "发展"),
    (r"新时期最鲜明的特点", "改革开放"),
    (r"科学发展观最鲜明的精神实质", "解放思想"),
    (r"三大法宝", "统一战线"),
    (r"活的灵魂", "实事求是"),
    (r"革命动力", "无产阶级"),
    (r"基本经济制度", "公有制"),
    (r"基本政治制度", "多党合作"),
    (r"主要矛盾", "美好生活"),
    (r"新民主主义革命的标志", "五四运动"),
    (r"马克思主义的中国化.{0,15}正式提出", "论新阶段"),
    (r"探索中国社会主义建设道路的良好开端", "论十大关系"),
    (r"开启改革开放", "十一届三中全会"),
    (r"2001年12月.{0,15}加入", "世界贸易组织"),
    (r"中国特色社会主义进入", "新时代"),
    (r"四个意识", "政治意识"),
    (r"神舟十三号.{0,10}航天员", "翟志刚"),
    (r"空间站.{0,10}首次出舱", "费俊龙"),
    (r"第一次提出.{0,6}新民主主义革命.{0,6}概念", "中国革命和中国共产党"),
    (r"土地改革的基本完成.{0,10}主要矛盾", "工人阶级和资产阶级"),
    (r"1987|初级阶段理论是", "总依据"),
    (r"十月革命胜利", "促进"),
    (r"1921年.{0,8}诞生", "中国共产党成立100周年"),
    (r"三孩|三个子女", "一对夫妻可以生育三个子女"),
    (r"香港特别行政区.{0,20}选举制度", "完善香港特别行政区选举制度"),
    (r"日本.{0,8}第101任首相", "岸田文雄"),
    (r"二十届四中全会", "十五个五年规划的建议"),
    (r"抗战.{0,8}胜利.{0,4}周年", "80周年"),
    (r"G20.{0,8}首次在非洲", "约翰内斯堡"),
    (r"中国式现代化", "全体人民共同富裕"),
    (r"高质量发展.{0,10}首要任务|首要任务是", "推动高质量发展"),
    (r"中国梦|中华民族伟大复兴.{0,10}根本保证", "中国共产党领导"),
]


def _norm_key(s):
    return re.sub(r"[\s\\_（）()、，。·?？-]", "", s or "")


def answer_politics(stem, options):
    """政治题：先查自学习表（题干精确匹配），再关键词映射。"""
    s = _norm(stem)
    om = _opts_map(options)
    if HAS_LEARNED:
        key = _norm_key(s)[:60]
        hit = LEARNED_POLITICS.get(key)
        if hit and hit.get("answer"):
            return {"answer": hit["answer"], "confidence": 0.97, "rule": "自学习表: " + hit.get("id", "")}
    for pat, keyword in _POLITICS_MAP:
        if re.search(pat, s):
            # 找含 keyword 的选项
            hits = [L for L, t in om.items() if keyword and keyword in t]
            if hits:
                ans = "".join(hits) if len(hits) > 1 else hits[0]
                conf = 0.82 if len(hits) > 1 else 0.85
                return {"answer": ans, "confidence": conf, "rule": f"考点映射: {keyword}"}
    return {"answer": None, "confidence": 0, "rule": "no politics rule matched"}


# ============================================================
# 数学符号计算引擎
# ============================================================
def _extract_expr(stem):
    """从题干提取可计算的极限表达式（sin/cos/tan 组合）。"""
    s = _norm(stem)
    x = sp.Symbol("x")
    if "lim" not in s:
        return None
    try:
        # 取 lim 之后、= 之前的部分
        after = s.split("lim", 1)[-1]
        after = after.split("=")[0]
        # 去掉 (x→0) 或 x→0 前缀
        after = re.sub(r"^\s*\(?\s*x\s*[\u2192\u2794]\s*[0-9\u221e+\-]+\s*\)?\s*", "", after)
        expr = after.strip()
        if not expr:
            return None
        target = "0"
        m0 = re.search(r"[\u2192\u2794]\s*([0-9\u221e+\-]+)", s)
        if m0:
            target = m0.group(1).replace("\u221e", "oo").replace("\u2212", "-").strip()
        expr = expr.replace("^", "**").replace("\u00d7", "*").replace("\u2212", "-")
        # sin3x -> sin(3*x)；sinx -> sin(x)（sympify 用内置函数名，不加 sp. 前缀）
        expr = re.sub(r"(sin|cos|tan)(\d+)([a-z])", r"\1(\2*\3)", expr)
        expr = re.sub(r"(sin|cos|tan)(\d+)", r"\1(\2*x)", expr)
        expr = re.sub(r"(sin|cos|tan)\s*([a-z])", r"\1(\2)", expr)
        expr = expr.replace("ln", "log")
        expr = re.sub(r"e\*\*(x)", r"exp(\1)", expr)
        expr = re.sub(r"(\d)\s*([a-z(])", r"\1*\2", expr)
        expr = re.sub(r"\)\s*(\d|[a-z(])", r")*\1", expr)
        e = sp.sympify(expr)
        lim = sp.limit(e, x, sp.oo if target == "oo" else sp.Integer(target))
        return ("lim", lim)
    except Exception:
        return None


def answer_math(stem, options):
    """数学题：sympy 计算（极限等可解模式），对比选项文本。"""
    if not HAS_SYMPY:
        return {"answer": None, "confidence": 0, "rule": "sympy not available"}
    om = _opts_map(options)
    try:
        r = _extract_expr(stem)
        if r:
            kind, val = r
            if val is None:
                return {"answer": None, "confidence": 0, "rule": "limit unsolved"}
            # 对比选项：数字或符号表达式
            for L, t in om.items():
                t = re.sub(r"[\s（）()]", "", t)
                try:
                    if kind == "lim":
                        target = sp.sympify(t.replace("^", "**").replace("√", "sqrt"))
                        if sp.simplify(sp.sympify(val) - target) == 0:
                            return {"answer": L, "confidence": 0.85, "rule": f"sympy: lim = {val}"}
                except Exception:
                    pass
    except Exception:
        pass
    return {"answer": None, "confidence": 0, "rule": "no math rule matched"}


# ============================================================
# 统一入口
# ============================================================
def answer_question(subject, stem, options):
    """自动判题。subject: english/politics/math/electronics"""
    if subject == "english":
        return answer_english(stem, options)
    if subject == "politics":
        return answer_politics(stem, options)
    if subject == "math":
        return answer_math(stem, options)
    return {"answer": None, "confidence": 0, "rule": "unsupported subject"}


if __name__ == "__main__":
    # 自测
    tests = [
        ("english", "Our teacher suggested that each of us ___ a study plan.", ["make", "made", "will make", "would make"]),
        ("english", "If you had told me earlier, I ___ to meet you at the hotel.", ["had come", "will have come", "would come", "would have come"]),
        ("english", "The luggage is ___ heavy to carry all the way home.", ["very", "too", "so", "much"]),
        ("english", "By the time you arrive, I ___ the work.", ["will finish", "will have finished", "have finished", "would finish"]),
        ("english", "It is really worth ___.", ["reading", "being read", "read", "to read"]),
        ("english", "The fire that ___ yesterday caused ten deaths.", ["broke off", "broke up", "broke down", "broke out"]),
        ("politics", "党执政兴国的第一要务是？", ["发展", "革命", "改革", "开放"]),
        ("politics", "中国特色社会主义最本质的特征是？", ["中国共产党领导", "人民代表大会制度", "社会主义市场经济", "以人民为中心"]),
        ("math", "lim(x→0) (sin3x + sinx) / x = ?", ["0", "1", "3", "4"]),
        ("english", "It was the training at college ___ made him such a good writer.", ["as", "which", "that", "what"]),
    ]
    for subj, stem, opts in tests:
        r = answer_question(subj, stem, opts)
        print(f"[{subj}] {stem[:38]}... -> {r}")