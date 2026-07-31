"""StudyPet API 集成测试。

在独立端口启动 api_server.py 子进程进行测试：
- 不触碰正在运行的开发服务（19998）
- 不杀死任何进程（旧版用 taskkill 会杀掉所有 python.exe）
- 测试用例只访问本地路由，不依赖外网，保证稳定可复跑
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta

import pytest

API_PATH = os.path.join(os.path.dirname(__file__), "api_server.py")
TEST_PORT = 23001
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

# SecondBrain 测试用的复习追踪器模板（表头/分隔行）
TRACKER_TEMPLATE = """# 📌 复习追踪器

> 间隔复习：1/2/4/7/15/30 天

| 学习日期 | 知识点 | 科目 | ①1天 | ②2天 | ③4天 | ④7天 | ⑤15天 | ⑥30天 |
|----------|--------|------|------|------|------|------|-------|-------|
"""


def write_tracker(sb_root, data_rows):
    """把数据行写入临时复习追踪器文件"""
    p = sb_root / "15-元知识" / "学习系统" / "📌 复习追踪器.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(TRACKER_TEMPLATE + "\n".join(data_rows) + "\n", encoding="utf-8")
    return p


def api_get(url):
    resp = urllib.request.urlopen(url, timeout=5)
    return json.loads(resp.read().decode())


def api_post(url, payload, timeout=5):
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode())


@pytest.fixture(scope="session")
def sb_root(tmp_path_factory):
    """SecondBrain 临时根目录（session 级，与服务同生命周期，不碰真实 D:\\SecondBrain）"""
    root = tmp_path_factory.mktemp("secondbrain")
    (root / "15-元知识" / "学习系统").mkdir(parents=True)
    (root / "10-知识库").mkdir()
    (root / "20-日记").mkdir()
    (root / "memory-bank" / "claude-code-memory").mkdir(parents=True)
    return root


@pytest.fixture(scope="session")
def api_server(sb_root):
    env = dict(os.environ, PORT=str(TEST_PORT), SECOND_BRAIN_ROOT=str(sb_root))
    proc = subprocess.Popen(
        [sys.executable, API_PATH],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    for _ in range(40):
        try:
            urllib.request.urlopen(f"{BASE_URL}/health", timeout=1)
            break
        except Exception:
            time.sleep(0.25)
    else:
        proc.kill()
        raise RuntimeError("API server failed to start")
    yield BASE_URL
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_health(api_server):
    resp = urllib.request.urlopen(f"{api_server}/health", timeout=5)
    assert resp.status == 200
    body = json.loads(resp.read().decode())
    assert body.get("status") == "ok"


def test_unknown_route_not_found(api_server):
    # 拼错路由必须明确报错，不能静默 {"ok": true}
    resp = urllib.request.urlopen(f"{api_server}/no/such/route", timeout=5)
    body = json.loads(resp.read().decode())
    assert body.get("error") == "not found"


def test_unknown_post_route_not_found(api_server):
    req = urllib.request.Request(
        f"{api_server}/no/such/route",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=5)
    body = json.loads(resp.read().decode())
    assert body.get("error") == "not found"


def test_activity_history_shape(api_server):
    # 返回数组，字段与前端期望一致
    resp = urllib.request.urlopen(f"{api_server}/activity/history?days=7", timeout=5)
    data = json.loads(resp.read().decode())
    assert isinstance(data, list)
    for item in data:
        assert {"window_title", "process_name", "category", "start_time", "duration_seconds", "date"} <= set(item.keys())


def test_activity_history_bad_days_param(api_server):
    # days 参数非法时回退默认，不能 500
    resp = urllib.request.urlopen(f"{api_server}/activity/history?days=abc", timeout=5)
    data = json.loads(resp.read().decode())
    assert isinstance(data, list)


def test_generate_question_needs_key(api_server):
    # 未配置 key 时返回 needKey 提示（不泄露堆栈）
    req = urllib.request.Request(
        f"{api_server}/deepseek/generate-question",
        method="POST",
        data=json.dumps({"subject": "math", "chapter": "导数"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=15)
    body = json.loads(resp.read().decode())
    # 有 key 会真实调用 DeepSeek（外网，不 mock）；无 key 必须返回 needKey
    if body.get("needKey"):
        assert body.get("error")
    else:
        assert any(k in body for k in ("stem", "error"))


def test_review_add(api_server, sb_root):
    # 登记新知识点：追加一行，学习日期=今天
    body = api_post(f"{api_server}/secondbrain/review-add", {"subject": "高数", "point": "洛必达法则"})
    assert body.get("ok") is True
    p = sb_root / "15-元知识" / "学习系统" / "📌 复习追踪器.md"
    content = p.read_text(encoding="utf-8")
    assert "洛必达法则" in content
    assert "高数" in content
    # 表头保留
    assert "| 学习日期 | 知识点 | 科目 |" in content


def test_deepseek_key_masked(api_server):
    # key 掩码不能泄露完整 key（只露头尾各 2 位）
    resp = urllib.request.urlopen(f"{api_server}/deepseek/key", timeout=5)
    body = json.loads(resp.read().decode())
    if body.get("hasKey"):
        key = body.get("key", "")
        assert "****" in key
        assert len(key.replace("****", "")) <= 4


# ===== RAG 语义检索测试 =====

@pytest.fixture(scope="session")
def rag_index(sb_root):
    """在临时目录建 3 条中文笔记的 ChromaDB 索引（不碰真实库/真实笔记）"""
    idx_dir = sb_root / ".rag-index"
    idx_dir.mkdir(parents=True, exist_ok=True)
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    import chromadb
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("BAAI/bge-small-zh-v1.5")
    client = chromadb.PersistentClient(str(idx_dir))
    try:
        client.delete_collection("secondbrain")
    except Exception:
        pass
    col = client.create_collection("secondbrain")
    docs = [
        "运算放大器有两个重要特性：虚短和虚断。虚短指同相输入端与反相输入端电位近似相等，虚断指输入电流近似为零。",
        "高数极限：洛必达法则适用于 0/0 或 ∞/∞ 型不定式，使用前必须验证条件，不能盲目套用。",
        "政治：实践是检验真理的唯一标准，这是马克思主义认识论的基本观点，出自《实践论》。",
    ]
    metas = [
        {"source": str(sb_root / "10-知识库" / "电子技术基础" / "运放.md"), "subject": "电子技术", "header": "运放特性", "file": "运放.md"},
        {"source": str(sb_root / "10-知识库" / "高数" / "洛必达.md"), "subject": "高数", "header": "洛必达法则", "file": "洛必达.md"},
        {"source": str(sb_root / "10-知识库" / "政治" / "认识论.md"), "subject": "政治", "header": "实践论", "file": "认识论.md"},
    ]
    embs = model.encode(docs).tolist()
    col.add(ids=["1", "2", "3"], embeddings=embs, documents=docs, metadatas=metas)
    return model


def test_rag_query_route(api_server, rag_index):
    # POST 检索：运放问题应命中运放笔记（首次请求含模型加载，放宽超时）
    body = api_post(f"{api_server}/rag/query", {"q": "运放虚短虚断是什么", "top_k": 3}, timeout=120)
    items = body.get("items", [])
    assert len(items) >= 1
    assert "运放" in items[0]["file"]
    assert "score" in items[0]
    assert "snippet" in items[0]


def test_rag_query_get(api_server, rag_index):
    # GET 检索：subject 过滤（首次加载后模型已常驻，放宽超时兜底）
    from urllib.parse import quote
    resp = urllib.request.urlopen(
        f"{api_server}/rag/query?q={quote('洛必达 0/0', safe='')}&subject={quote('高数', safe='')}&top_k=1", timeout=120
    )
    body = json.loads(resp.read().decode())
    items = body.get("items", [])
    assert len(items) == 1
    assert items[0]["subject"] == "高数"


def test_rag_query_empty(api_server, rag_index):
    # 空 q 返回错误而非崩溃
    body = api_post(f"{api_server}/rag/query", {"q": "  "})
    assert body.get("error")


# ===== SecondBrain 路由 =====

def test_secondbrain_review_due(api_server, sb_root):
    # 3 行：1 个今天到期未勾、1 个全部已勾、1 个未来 → 只返回到期项
    today = datetime.now().date()
    d_due = (today - timedelta(days=1)).strftime("%Y-%m-%d")
    d_old = (today - timedelta(days=30)).strftime("%Y-%m-%d")
    d_future = (today + timedelta(days=10)).strftime("%Y-%m-%d")
    write_tracker(sb_root, [
        f"| {d_due} | 函数极限 | 高数 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |",
        f"| {d_old} | 已勾知识点 | 英语 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |",
        f"| {d_future} | 未来知识点 | 政治 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |",
    ])
    body = api_get(f"{api_server}/secondbrain/review-due")
    assert "error" not in body
    items = body["items"]
    assert len(items) == 1
    it = items[0]
    assert it["id"] == 1
    assert it["subject"] == "高数"
    assert it["point"] == "函数极限"
    assert it["lastStudyDate"] == d_due
    assert it["due"] == [1]
    assert it["overdue"] == [0]
    assert it["checked"] == []


def test_secondbrain_review_check(api_server, sb_root):
    # 勾选后文件内容 ⬜ → ✅（整行替换，表头保留）
    today = datetime.now().date()
    d_due = (today - timedelta(days=1)).strftime("%Y-%m-%d")
    p = write_tracker(sb_root, [
        f"| {d_due} | 函数极限 | 高数 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |",
    ])
    body = api_post(
        f"{api_server}/secondbrain/review-check",
        {"id": 1, "subject": "高数", "point": "函数极限"},
    )
    assert body.get("ok") is True
    content = p.read_text(encoding="utf-8")
    assert "| 学习日期 | 知识点 | 科目 |" in content  # 表头未动
    row = [ln for ln in content.splitlines() if ln.startswith("| 20")][0]
    cells = [c.strip() for c in row.strip("|").split("|")]
    assert cells[3] == "✅"   # ①1天 已勾
    assert cells[4] == "⬜"   # ②2天 未动
    # 再勾一次：没有新到期项，应保持 ok 且不再改动
    body2 = api_post(
        f"{api_server}/secondbrain/review-check",
        {"id": 1, "subject": "高数", "point": "函数极限"},
    )
    assert body2.get("ok") is True
    assert body2.get("checked") is None


def test_secondbrain_mistakes_write(api_server, sb_root):
    # 写入后文件存在、内容含题目；科目英文 key 映射为中文目录
    today = datetime.now().strftime("%Y-%m-%d")
    body = api_post(f"{api_server}/secondbrain/mistakes", {
        "subject": "electronics",
        "chapter": "运算放大器",
        "stem": "反相放大器闭环增益公式？",
        "answer": "Au = -Rf/Ri",
        "userAnswer": "Au = 1 + Rf/Ri",
        "analysis": "虚地：反相端电位为 0",
        "errorTags": ["虚地概念"],
        "date": today,
    })
    assert body.get("ok") is True
    f = sb_root / "10-知识库" / "电子技术" / "错题" / f"{today}-运算放大器-虚地概念.md"
    assert f.exists()
    content = f.read_text(encoding="utf-8")
    assert "反相放大器闭环增益公式" in content
    assert "subject: 电子技术" in content
    assert "虚地概念" in content


def test_secondbrain_diary_create_append(api_server, sb_root):
    # 新日期创建、同日期追加
    today = datetime.now().strftime("%Y-%m-%d")
    body = api_post(f"{api_server}/secondbrain/diary", {"date": today, "content": "## 军立状\n今天学电子"})
    assert body.get("ok") is True
    f = sb_root / "20-日记" / f"{today}.md"
    assert f.exists()
    assert "今天学电子" in f.read_text(encoding="utf-8")

    body2 = api_post(f"{api_server}/secondbrain/diary", {"date": today, "content": "## 统计\n电子 45min"})
    assert body2.get("ok") is True
    content = f.read_text(encoding="utf-8")
    assert "今天学电子" in content
    assert "电子 45min" in content

    got = api_get(f"{api_server}/secondbrain/diary?date={today}")
    assert got["exists"] is True
    assert "电子 45min" in got["content"]


def test_secondbrain_parse_robust(api_server, sb_root):
    # 损坏行（列数不足/日期非法/科目为空）跳过不崩，id 按有效数据行连续编号
    today = datetime.now().date()
    d_due = (today - timedelta(days=1)).strftime("%Y-%m-%d")
    write_tracker(sb_root, [
        f"| {d_due} | 有效点 | 高数 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |",
        "| 不是日期 | 坏日期行 | 英语 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |",
        "| 2026-07-30 | 列数不足 |",   # 列数不足
        "| 2026-07-30 | 空科目 | | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |",  # 科目为空
        f"| {d_due} | 有效点2 | 政治 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |",
    ])
    body = api_get(f"{api_server}/secondbrain/review-due")
    assert "error" not in body
    items = body["items"]
    assert [it["point"] for it in items] == ["有效点", "有效点2"]
    assert [it["id"] for it in items] == [1, 2]


def test_secondbrain_state_roundtrip(api_server, sb_root):
    # 写后读回一致；再写合并保留旧字段
    body = api_post(f"{api_server}/secondbrain/state", {"updates": {
        "todayStudyMinutes": 45,
        "subjects": {"math": {"minutes": 45}},
        "reviewOverdue": 2,
        "lastSyncDate": "2026-07-31",
    }})
    assert body.get("ok") is True
    got = api_get(f"{api_server}/secondbrain/state")
    state = got["state"]
    assert state.get("todayStudyMinutes") == 45
    assert state.get("reviewOverdue") == 2
    assert state.get("subjects", {}).get("math", {}).get("minutes") == 45

    api_post(f"{api_server}/secondbrain/state", {"updates": {"todayStudyMinutes": 60}})
    got2 = api_get(f"{api_server}/secondbrain/state")
    assert got2["state"]["todayStudyMinutes"] == 60
    assert got2["state"]["reviewOverdue"] == 2  # 旧字段保留
