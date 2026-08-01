"""判题引擎回归测试：数学（极限/导数/积分/方程/极值/二重积分）+ 英语 + 政治。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
from zhenti_engine import answer_question  # noqa: E402

MATH_CASES = [
    ("设函数 f(x)=x^2+2x，求f'(x)", ["2x+2", "2x", "x+2", "2"], "A"),
    ("已知 y=x^3，求dy/dx", ["3x^2", "x^2", "3x", "6x"], "A"),
    ("求函数 f(x)=x^2 在 x=3 处的导数", ["6", "3", "9", "2"], "A"),
    ("求不定积分 ∫ x^2 dx", ["x^3/3+C", "x^3+C", "x^2/2+C", "3x^3+C"], "A"),
    ("计算定积分 ∫_0^1 x dx", ["1/2", "1", "0", "2"], "A"),
    ("解方程 x^2-4=0，则x=", ["2", "4", "-2", "±2"], None),  # -2 或 ±2 均可
    ("lim(x→∞) 1/x = ?", ["0", "1", "∞", "不存在"], "A"),
    ("lim(x→0) (1-cosx)/x^2 = ?", ["1/2", "1", "0", "2"], "A"),
    ("求极限 lim(x→0) sinx/x = ?", ["1", "0", "∞", "不存在"], "A"),
    ("若 f(x)=e^x+lnx，求f'(x)", ["e^x+1/x", "e^x", "1/x", "e^x-1/x"], "A"),
    ("lim(x→0) sin3x/x = ?", ["3", "1", "0", "2"], "A"),
    ("设函数 f(x) 具有二阶导数，且 f′(0)=-1，f′(1)=0，f″(0)=-1，f″(1)=-3，则下列说法正确的是？",
     ["点 x=0 是函数 f(x) 的极小值点", "点 x=0 是函数 f(x) 的极大值点", "点 x=1 是函数 f(x) 的极小值点", "点 x=1 是函数 f(x) 的极大值点"], "D"),
    ("设 D = {(x,y) | 1 ≤ x²+y² ≤ 9}，则 ∬_D 1/(x²+y²) dσ = ?",
     ["2π", "10π", "2πln3", "4πln3"], "C"),
]

ENGLISH_CASES = [
    ("Our teacher suggested that each of us ___ a study plan.", ["make", "made", "will make", "would make"], "A"),
    ("If you had told me earlier, I ___ to meet you at the hotel.", ["had come", "will have come", "would come", "would have come"], "D"),
    ("It is really worth ___.", ["reading", "being read", "read", "to read"], "A"),
    ("The fire that ___ yesterday caused ten deaths.", ["broke off", "broke up", "broke down", "broke out"], "D"),
    ("It was the training at college ___ made him such a good writer.", ["as", "which", "that", "what"], "C"),
    ("The student checked his writing carefully lest it ___ some spelling mistakes.", ["had", "has", "will have", "should have"], "D"),
    ("The number of students in our class ___ 45.", ["are", "is", "were", "have been"], "B"),
    ("I think we should stop arguing and work together, if we want to get ___.", ["anywhere", "everywhere", "nowhere", "somewhere"], "D"),
]

POLITICS_CASES = [
    ("党执政兴国的第一要务是？", ["发展", "革命", "改革", "开放"], "A"),
    ("中国特色社会主义最本质的特征是？", ["中国共产党领导", "人民代表大会制度", "社会主义市场经济", "以人民为中心"], "A"),
    ("中国式现代化的本质要求中，第一位的是？", ["实现高质量发展", "坚持中国共产党领导", "发展全过程人民民主", "实现全体人民共同富裕"], "B"),
    ("毛泽东思想\"活的灵魂\"不包括以下哪一项？", ["实事求是", "群众路线", "独立自主", "武装斗争"], "D"),
    ("人类社会发展的基本规律是？", ["生产关系一定要适合生产力状况的规律", "上层建筑一定要适合经济基础状况的规律", "价值规律", "剩余价值规律"], "A"),
]


def test_math_cases():
    for stem, opts, expected in MATH_CASES:
        r = answer_question("math", stem, opts)
        assert r["answer"] is not None, f"math 未判出: {stem} -> {r}"
        if expected:
            assert r["answer"] == expected, f"math 判错: {stem} -> {r['answer']} 期望 {expected}"


def test_english_cases():
    for stem, opts, expected in ENGLISH_CASES:
        r = answer_question("english", stem, opts)
        assert r["answer"] is not None, f"english 未判出: {stem} -> {r}"
        assert r["answer"] == expected, f"english 判错: {stem} -> {r['answer']} 期望 {expected}"


def test_politics_cases():
    for stem, opts, expected in POLITICS_CASES:
        r = answer_question("politics", stem, opts)
        assert r["answer"] is not None, f"politics 未判出: {stem} -> {r}"
        assert r["answer"] == expected, f"politics 判错: {stem} -> {r['answer']} 期望 {expected}"


def test_no_false_guess():
    """宁缺毋滥：未知数学题不得乱猜。"""
    r = answer_question("math", "级数 Σ(1/n²) 的敛散性判断依据是？", ["比较判别法", "比值判别法", "根值判别法", "交错级数判别法"])
    assert r["answer"] is None or r["confidence"] < 0.75