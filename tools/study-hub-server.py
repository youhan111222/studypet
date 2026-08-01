#!/usr/bin/env python3
"""
SparrowMCP — B站搜索 + Obsidian笔记检索 + PDF检索
MCP stdio 协议，Claude Code 可直调
"""

import json, sys, os, re, glob, urllib.request, urllib.parse
from pathlib import Path

OBSIDIAN_VAULT = r"D:\SecondBrain"
STUDY_HUB = r"D:\study-hub"
PDF_DIRS = [
    r"D:\SecondBrain",
    r"D:\study-hub\data\pdfs",
    r"C:\Users\20397\Desktop\专升本",
]
SKILLS_DIR = r"D:\study-hub\skills"
MAX_RESULTS = 20


# ============================================================
# 工具函数：安全JSON序列化（处理B站API返回的无效UTF-8代理字符）
# ============================================================
def safe_json_dumps(obj, indent=None):
    """json.dumps 的安全包装，先清理对象再序列化"""
    # 递归清理所有字符串中的代理字符
    cleaned = clean_str(obj)
    try:
        text = json.dumps(cleaned, ensure_ascii=False, indent=indent)
    except (UnicodeEncodeError, UnicodeDecodeError):
        text = json.dumps(cleaned, ensure_ascii=True, indent=indent)
    # 二次兜底：json 文本本身也扫一遍
    text = re.sub(r'[\ud800-\udfff]', '?', text)
    return text


def clean_str(s):
    """清理字符串中的代理字符，递归处理 dict/list"""
    if isinstance(s, str):
        return re.sub(r'[\ud800-\udfff]', '?', s)
    if isinstance(s, dict):
        return {k: clean_str(v) for k, v in s.items()}
    if isinstance(s, list):
        return [clean_str(v) for v in s]
    return s


# ============================================================
# 工具 1: B站搜索
# ============================================================
def bilibili_search(keyword, max_results=10):
    results = []
    try:
        # 优先新版接口；失败时回退旧版（均免 wbi 签名）
        keyword_quoted = urllib.parse.quote(str(keyword))
        candidates = [
            "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" + keyword_quoted + "&page=1&page_size=" + str(int(max_results)),
            "https://api.bilibili.com/x/web-interface/search/all/v2?keyword=" + keyword_quoted + "&page=1",
        ]
        body = None
        for url in candidates:
            try:
                _, body, _ = _http_get(url, timeout=10, retries=2)
                break
            except Exception:
                continue
        if body is None:
            return [{"error": "bilibili API unreachable"}]
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read()

        # B站API常返回含无效代理字符的JSON，在字节层面处理
        text = body.decode("utf-8", errors="replace")
        text = re.sub(r'[\ud800-\udfff]', '?', text)
        # 清理 JSON 转义的代理字符（\uD800-\uDFFF）
        text = re.sub(r'\\u[dD][89aAbBcCdDeEfF][0-9a-fA-F]{2}', '?', text)
        data = json.loads(text)

        if data.get("code") != 0:
            return [{"error": f"B站API code={data.get('code')}"}]

        kw_parts = [k for k in re.split(r"[\s,，。、]+", str(keyword)) if len(k) >= 2]
        _raw_results = data.get("data", {}).get("result", [])
        # 兼容多种返回结构：dict 含 result 列表 / list 直列表 / all-v2 分组
        if isinstance(_raw_results, dict):
            _raw_results = _raw_results.get("result", []) or []
        if isinstance(_raw_results, list):
            _flat = []
            for _grp in _raw_results:
                if isinstance(_grp, dict) and isinstance(_grp.get("video"), list):
                    _flat.extend(_grp["video"])
                else:
                    _flat.append(_grp)
            _raw_results = _flat
        for v in _raw_results[:int(max_results) * 3]:
            _title = re.sub(r"<.*?>", "", v.get("title", ""))
            _desc = re.sub(r"<.*?>", "", v.get("description", ""))
            _author = v.get("author", "")
            hay = _title + _desc + _author
            if kw_parts and not any(k in hay for k in kw_parts):
                continue
            title = re.sub(r'[\ud800-\udfff]', '?', _title)
            author = re.sub(r'[\ud800-\udfff]', '?', _author) if _author else ""
            desc = re.sub(r'[\ud800-\udfff]', '?', _desc)[:200]
            bvid = v.get("bvid", "") or (v.get("arcurl", "").rstrip("/").split("/")[-1] if v.get("arcurl") else "")
            if not _title and v.get("typename"):
                _title = v.get("typename", "") + " " + v.get("author", "")
            results.append({
                "title": title,
                "author": author,
                "play": v.get("play", 0),
                "duration": str(v.get("duration", "")),
                "description": desc,
                "url": f"https://www.bilibili.com/video/{bvid}",
                "bvid": bvid,
            })

        return results if results else [{"info": "no results"}]

    except urllib.error.URLError as e:
        return [{"error": f"Network error: {str(e)}"}]
    except Exception as e:
        return [{"error": str(e)}]


# ============================================================
# 工具 2: Obsidian 笔记检索
# ============================================================
def search_obsidian(query, max_results=MAX_RESULTS):
    vault = Path(OBSIDIAN_VAULT)
    if not vault.exists():
        return [{"error": f"Vault not found: {OBSIDIAN_VAULT}"}]

    keywords = str(query).lower().split()
    found = []

    for md_file in vault.rglob("*.md"):
        if ".obsidian" in md_file.parts:
            continue
        try:
            content = md_file.read_text(encoding="utf-8", errors="ignore")
            content_lower = content.lower()
            # 评分制：每个关键词匹配加分，至少匹配一半关键词才收录
            kw_hits = sum(1 for kw in keywords if kw in content_lower)
            if kw_hits < max(1, len(keywords) // 2):
                continue

            score = kw_hits  # 匹配关键词越多，排序越靠前

            lines = content.split("\n")
            matches = []
            for i, line in enumerate(lines):
                if any(kw in line.lower() for kw in keywords):
                    start = max(0, i - 1)
                    end = min(len(lines), i + 2)
                    matches.append(
                        "\n".join(f"  L{j+1}: {lines[j]}" for j in range(start, end))
                    )
                    if len(matches) >= 3:
                        break

            total_line_hits = len([l for l in lines if any(kw in l.lower() for kw in keywords)])
            found.append({
                "file": str(md_file.relative_to(vault)),
                "path": str(md_file),
                "matches": total_line_hits,
                "score": score,
                "snippet": "\n---\n".join(matches[:3]),
            })
        except Exception:
            continue

    found.sort(key=lambda x: (-x.get("score", 0), -x.get("matches", 0)))
    return found[:int(max_results)] if found else [{"info": "no results"}]


# ============================================================
# 工具 3: PDF 检索
# ============================================================
def search_pdfs(query, max_results=10):
    try:
        from pypdf import PdfReader
    except ImportError:
        return [{"error": "pypdf not installed. Run: pip install pypdf"}]

    keywords = str(query).lower().split()
    found = []

    pdf_files = []
    for d in PDF_DIRS:
        if os.path.exists(d):
            pdf_files.extend(Path(d).rglob("*.pdf"))

    for pdf_file in pdf_files:
        try:
            text = ""
            reader = PdfReader(str(pdf_file))
            for page in reader.pages[:10]:
                t = page.extract_text()
                if t: text += t

            text_lower = text.lower()
            if not all(kw in text_lower for kw in keywords):
                continue

            idx = text_lower.find(keywords[0])
            snippet = text[max(0, idx-100):idx+300] if idx >= 0 else text[:200]
            snippet = re.sub(r'[\ud800-\udfff]', '?', snippet)

            found.append({
                "file": pdf_file.name,
                "path": str(pdf_file),
                "snippet": snippet.strip()[:400],
            })
        except Exception:
            continue

    return found[:int(max_results)] if found else [{"info": "no results"}]


# ============================================================
# 工具 4: 网页抓取
# ============================================================
_UA_LIST = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (compatible; StudyHub/1.0; +https://github.com/study-hub)",
]

def _http_get(url, timeout=15, retries=2):
    """带 UA 轮换和重试的 GET；返回 (status, bytes) 或抛错。"""
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": _UA_LIST[attempt % len(_UA_LIST)],
                "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read(), resp.headers
        except Exception as e:
            last_err = e
            if attempt < retries:
                import time as _t
                _t.sleep(1.5 * (attempt + 1))
    raise last_err


def fetch_url(url, max_chars=8000):
    """抓取网页内容，提取纯文本。Claude 自己做结构化提取。"""
    try:
        status, body, headers = _http_get(url)
        if status >= 400:
            return [{"error": f"HTTP {status}"}]
        # 检测编码
        content_type = headers.get("Content-Type", "")
        charset = "utf-8"
        if "charset=" in content_type:
            charset = content_type.split("charset=")[-1].split(";")[0].strip()
        try:
            html = body.decode(charset, errors="replace")
        except LookupError:
            html = body.decode("utf-8", errors="replace")
        html = re.sub(r'[\ud800-\udfff]', '?', html)

        # 去掉 script/style/noscript
        html = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
        # 去掉 HTML 标签
        text = re.sub(r'<[^>]+>', ' ', html)
        # 清理空白
        text = re.sub(r'&nbsp;|&lt;|&gt;|&amp;|&quot;', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        # 去重连续重复行
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        seen = set()
        deduped = []
        for l in lines:
            if l not in seen:
                deduped.append(l)
                seen.add(l)

        text = '\n'.join(deduped)[:int(max_chars)]

        return [{
            "url": url,
            "length": len(text),
            "text": text,
        }]

    except urllib.error.URLError as e:
        return [{"error": f"Network error: {str(e)}"}]
    except Exception as e:
        return [{"error": str(e)}]


# ============================================================
# 工具 5: 知乎搜索（Bing 搜索引擎代理）
# ============================================================
def search_zhihu(query, max_results=10):
    """通过Bing搜索知乎内容。免API key，免登录。"""
    return _bing_site_search("zhihu.com", query, max_results)


# ============================================================
# 工具 6: 小红书搜索（Bing 搜索引擎代理）
# ============================================================
def search_xiaohongshu(query, max_results=10):
    """通过Bing搜索小红书笔记。免API key，免登录。"""
    return _bing_site_search("xiaohongshu.com", query, max_results)


# ============================================================
# 通用：Bing site: 搜索解析器
# ============================================================
def _bing_site_search(site, query, max_results=10):
    """
    用Bing搜索指定站点的内容。
    不用 site: 操作符（Bing实现太松），而是把站点名加入查询词再过滤域名。
    """
    results = []
    try:
        full_query = f"{site.split('.')[0]} {query}"
        url = (
            "https://www.bing.com/search"
            "?q=" + urllib.parse.quote(full_query) +
            "&count=" + str(min(int(max_results) * 3, 50)) +
            "&setlang=zh-cn"
        )
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="replace")
            html = re.sub(r'[\ud800-\udfff]', '?', html)

        # 解析 Bing 搜索结果卡片
        blocks = re.findall(
            r'<li class="b_algo"[^>]*>(.*?)(?=<li class="b_|$)',
            html, re.DOTALL
        )
        seen = set()
        for block in blocks:
            # 提取链接和标题
            link_match = re.search(
                r'<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
                block, re.DOTALL
            )
            if not link_match:
                continue

            link = link_match.group(1)
            title = re.sub(r'<.*?>', '', link_match.group(2)).strip()

            # 必须包含目标域名（排除首页、话题页、发现页等导航链接）
            if site not in link:
                continue
            # 排除纯导航页（无具体内容ID）
            if re.search(r'zhihu\.com/(?:explore|topics|selection|following|search|question/waiting|$|\?|#)',
                         link) and '/p/' not in link and '/question/' not in link and '/answer/' not in link:
                continue
            if re.search(r'xiaohongshu\.com/(?:explore|search_result|category|$|\?|#)', link) and '/explore/' not in link:
                continue

            if link in seen:
                continue
            seen.add(link)

            # 提取摘要
            snippet = ""
            p_match = re.search(r'<p[^>]*>(.*?)</p>', block, re.DOTALL)
            if p_match:
                snippet = re.sub(r'<.*?>', '', p_match.group(1)).strip()
                snippet = re.sub(r'&ensp;|&#0?\d+;|&nbsp;', ' ', snippet)
                snippet = re.sub(r'\s+', ' ', snippet).strip()

            # 清理代理字符
            title = re.sub(r'[\ud800-\udfff]', '?', title)[:200]
            snippet = re.sub(r'[\ud800-\udfff]', '?', snippet)[:300]
            link = re.sub(r'[\ud800-\udfff]', '?', link)

            results.append({
                "title": title,
                "excerpt": snippet,
                "url": link,
            })

            if len(results) >= int(max_results):
                break

        return results if results else [{"info": f"no {site} results found via Bing"}]

    except urllib.error.URLError as e:
        return [{"error": f"Network error: {str(e)}"}]
    except Exception as e:
        return [{"error": f"Search failed: {str(e)}"}]


def search_bing(query, max_results=10):
    """通用 Bing 搜索：返回标题/URL/摘要（无站点过滤）。"""
    results = []
    try:
        url = (
            "https://www.bing.com/search"
            "?q=" + urllib.parse.quote(str(query)) +
            "&count=" + str(min(int(max_results) * 2, 50)) +
            "&setlang=zh-cn"
        )
        _, body, _ = _http_get(url, timeout=12)
        html = body.decode("utf-8", errors="replace")
        html = re.sub(r"[\ud800-\udfff]", "?", html)
        blocks = re.findall(r'<li class="b_algo"[^>]*>(.*?)(?=<li class="b_|$)', html, re.DOTALL)
        seen = set()
        for block in blocks:
            link_match = re.search(r'<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', block, re.DOTALL)
            if not link_match:
                continue
            link = link_match.group(1)
            title = re.sub(r"<.*?>", "", link_match.group(2)).strip()
            p_match = re.search(r"<p[^>]*>(.*?)</p>", block, re.DOTALL)
            snippet = ""
            if p_match:
                snippet = re.sub(r"<.*?>", "", p_match.group(1)).strip()
                snippet = re.sub(r"&ensp;|&#0?\d+;|&nbsp;", " ", snippet)
                snippet = re.sub(r"\s+", " ", snippet).strip()
            if link in seen:
                continue
            seen.add(link)
            results.append({
                "title": re.sub(r"[\ud800-\udfff]", "?", title)[:200],
                "excerpt": re.sub(r"[\ud800-\udfff]", "?", snippet)[:300],
                "url": re.sub(r"[\ud800-\udfff]", "?", link),
            })
            if len(results) >= int(max_results):
                break
        return results if results else [{"info": "no results"}]
    except urllib.error.URLError as e:
        return [{"error": f"Network error: {str(e)}"}]
    except Exception as e:
        return [{"error": f"Search failed: {str(e)}"}]


# ============================================================
# MCP stdio 主循环
# ============================================================
TOOLS_SCHEMA = {
    "tools": [
        {
            "name": "bilibili_search",
            "description": "搜索B站公开视频。输入关键词，返回标题、UP主、播放量、BV号、链接。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词"},
                    "max_results": {"type": "integer", "default": 10}
                },
                "required": ["keyword"]
            }
        },
        {
            "name": "search_bing",
            "description": "通用 Bing 网络搜索，返回标题、摘要、URL（无站点过滤，适合找真题/资料）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "max_results": {"type": "integer", "default": 10}
                },
                "required": ["query"]
            }
        },
        {
            "name": "search_obsidian",
            "description": "全文搜索Obsidian笔记库(D:\\SecondBrain)中的Markdown文件，返回匹配文件名和上下文片段。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索词，多词空格分隔(AND逻辑)"},
                    "max_results": {"type": "integer", "default": 20}
                },
                "required": ["query"]
            }
        },
        {
            "name": "search_pdfs",
            "description": "全文搜索本地PDF文件，返回匹配文件名和文本片段。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "max_results": {"type": "integer", "default": 10}
                },
                "required": ["query"]
            }
        },
        {
            "name": "fetch_url",
            "description": "抓取网页URL的纯文本内容（去标签/去脚本/去重）。用于获取知乎、博客等文章内容，由Claude进行结构化提取。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "网页URL"},
                    "max_chars": {"type": "integer", "default": 8000, "description": "最大返回字符数"}
                },
                "required": ["url"]
            }
        },
        {
            "name": "search_zhihu",
            "description": "搜索知乎内容（公开搜索API，无需登录）。返回标题、摘要、链接、点赞数。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "max_results": {"type": "integer", "default": 10}
                },
                "required": ["query"]
            }
        },
        {
            "name": "search_xiaohongshu",
            "description": "搜索小红书笔记。优先用网页API（需cookie会话），失败则Bing site搜索回退。返回标题、描述、链接。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "max_results": {"type": "integer", "default": 10}
                },
                "required": ["query"]
            }
        },
    ]
}


def main():
    # Fix: Windows GBK locale causes mojibake — force UTF-8 on ALL std streams
    # (stdin 未包装会导致 MCP 的 UTF-8 JSON 请求被 GBK 解码，中文参数变 surrogate 后 quote() 崩溃)
    import io
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            if not line.strip():
                continue

            request = json.loads(line.strip())
            req_id = request.get("id", 0)
            method = request.get("method", "")

            if method == "initialize":
                resp = {
                    "jsonrpc": "2.0", "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "sparrow-mcp", "version": "1.0.0"}
                    }
                }

            elif method == "notifications/initialized":
                continue  # 无需回复

            elif method == "tools/list":
                resp = {"jsonrpc": "2.0", "id": req_id, "result": TOOLS_SCHEMA}

            elif method == "tools/call":
                params = request.get("params", {})
                tool_name = params.get("name", "")
                args = params.get("arguments", {})

                if tool_name == "bilibili_search":
                    result = bilibili_search(
                        args.get("keyword", ""),
                        args.get("max_results", 10)
                    )
                elif tool_name == "search_bing":
                    result = search_bing(
                        args.get("query", ""),
                        args.get("max_results", 10)
                    )
                elif tool_name == "search_obsidian":
                    result = search_obsidian(
                        args.get("query", ""),
                        args.get("max_results", MAX_RESULTS)
                    )
                elif tool_name == "search_pdfs":
                    result = search_pdfs(
                        args.get("query", ""),
                        args.get("max_results", 10)
                    )
                elif tool_name == "fetch_url":
                    result = fetch_url(
                        args.get("url", ""),
                        args.get("max_chars", 8000)
                    )
                elif tool_name == "search_zhihu":
                    result = search_zhihu(
                        args.get("query", ""),
                        args.get("max_results", 10)
                    )
                elif tool_name == "search_xiaohongshu":
                    result = search_xiaohongshu(
                        args.get("query", ""),
                        args.get("max_results", 10)
                    )
                else:
                    result = [{"error": f"Unknown tool: {tool_name}"}]

                result_text = safe_json_dumps(result, indent=2)
                resp = {
                    "jsonrpc": "2.0", "id": req_id,
                    "result": {"content": [{"type": "text", "text": result_text}]}
                }

            else:
                resp = {
                    "jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"}
                }

            # 输出响应（安全序列化）
            output = safe_json_dumps(resp)
            sys.stdout.write(output + "\n")
            sys.stdout.flush()

        except json.JSONDecodeError:
            continue
        except BrokenPipeError:
            break
        except Exception as e:
            err_msg = str(e)
            err_msg = re.sub(r'[\ud800-\udfff]', '?', err_msg)
            err_resp = {
                "jsonrpc": "2.0",
                "id": req_id if 'req_id' in dir() else 0,
                "error": {"code": -32603, "message": err_msg}
            }
            try:
                output = safe_json_dumps(err_resp)
                sys.stdout.write(output + "\n")
                sys.stdout.flush()
            except Exception:
                pass


if __name__ == "__main__":
    main()
