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

import pytest

API_PATH = os.path.join(os.path.dirname(__file__), "api_server.py")
TEST_PORT = 23001
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"


@pytest.fixture(scope="session")
def api_server():
    env = dict(os.environ, PORT=str(TEST_PORT))
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


def test_search_requires_query(api_server):
    req = urllib.request.Request(f"{api_server}/search")
    resp = urllib.request.urlopen(req, timeout=10)
    body = json.loads(resp.read().decode())
    assert body.get("error") == "missing query param q"
