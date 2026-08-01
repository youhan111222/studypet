# StudyPet — AI 专升本备考助手

单机自部署的备考学习系统：屏幕时间追踪 × 刷题复习 × 宠物养成 × AI 教练，与本地知识库（SecondBrain）深度联动。

> **技术栈**：React 18 + Vite 5 + TS + Zustand + Dexie + ts-fsrs + Flask/SQLite + **PWA 离线可安装**（借鉴 Anki 本地优先 / 刷题类 App 离线场景）

## 功能

- **屏幕时间追踪**：Windows 前台窗口轮询（2s）+ TF-IDF 分类 + 浏览器标题二次打标，SQLite 落盘（WAL）
- **刷题复习**：132 题内置题库（四科）+ AI 出题（DeepSeek）+ FSRS 间隔调度 + 错题自动归档到 SecondBrain
- **间隔复习**：读写 SecondBrain 复习追踪器（1/2/4/7/15/30 天），到期提醒
- **AI 教练**：数据驱动提示词（考纲/进度/屏幕数据/课程时间线）+ RAG 语义检索笔记 + ACTION 指令执行（建任务/记成绩/改掌握度）
- **学习系统**：任务/番茄钟/连胜/成就/宠物/重要事项提醒/多格式课表导入（XLS/CSV/JSON/ICS）
- **SecondBrain 集成**：错题本、日记、学习状态、复习欠账，双端单向契约

## 技术栈

| 端 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript(strict) + Zustand + Tailwind v3 + Dexie + ts-fsrs + Vite 5 |
| 后端 | Python 标准库 `http.server`（19998）+ SQLite(WAL) |
| 追踪 | ctypes Windows API + TF-IDF 分类器（`tracker.py`） |

## 快速开始

```powershell
# 一键启动（校园网认证 → 等网络 → 起服务 → 验证）
powershell -ExecutionPolicy Bypass -File D:\StudyPet\StudyPet_Launcher.ps1

# 或手动分步
python api_server.py          # API + AI 教练 :19998
python tracker.py             # 屏幕追踪（无窗口）
npm run dev                   # Vite :5173
```

浏览器打开 <http://localhost:5173>。

## 端口与服务

| 端口 | 服务 | 说明 |
|---|---|---|
| 19998 | api_server.py | 全部 API + AI 教练（统一入口，禁新增端口） |
| 5173 | Vite | 前端 dev server |
| — | tracker.py | 屏幕追踪，单实例锁 `tracker.lock` |
| — | watchdog.ps1 | 端口守护，自动拉起死掉的服务 |

AI 教练需要 DeepSeek Key：`.env` 里 `DEEPSEEK_API_KEY=sk-...`（或首次在设置里填）。

## 数据

| 数据 | 位置 |
|---|---|
| 活动记录 | `D:\StudyPet\activity.db`（WAL，可备份） |
| 前端状态 | localStorage（`studypet-data`，30 天裁剪 + 365 天连胜证据） |
| 题库/答题 | IndexedDB（`StudyPetQuiz`，90 天清理 + AI 题上限 500） |
| 复习追踪器/错题/日记 | `D:\SecondBrain\...`（契约见 `docs/secondbrain-contract.md`） |

## 质量门禁（每次改动必跑）

```powershell
npm run check   # typecheck + lint + 前端测试 + Python测试 + build
# 单独跑：
npm run typecheck     # tsc --noEmit
npm run lint          # ruff
npm test              # vitest（32 用例）
npm run test:py       # pytest（不含 RAG，需本地模型）
npm run test:py:full  # pytest 全部（含 RAG，需 sentence-transformers 模型）
```

CI（`.github/workflows/ci.yml`）在 push/PR 时自动执行上述全部门禁。

## 目录速览

```
api_server.py       API 路由与编排（19998，统一入口）
coach_prompt.py     AI 教练系统提示词构建（考纲/知识库/决策矩阵）
sb_integration.py   SecondBrain 读写解析（追踪器/错题/日记/状态）
rag_service.py      SecondBrain 语义检索（ChromaDB，静默降级）
schedule_xls.py     官方课表 XLS 解析
tracker.py          屏幕追踪核心（Windows API + 分类器 + 落盘）
sync-engine.py      每晚同步 activity.db → SecondBrain 学习状态/日记
test_api.py         后端集成测试（独立端口 23001，不碰真实服务）
test_tracker.py     tracker 核心回归（双写/分类器）
src/
  store/useStore.ts 全局状态（任务/成就/连胜/计时器）
  store/quizStore.ts 题库/判题/FSRS/章节掌握
  store/stateAnalyzer.ts 教练状态感知（告警/课程时间线）
  components/       页面组件（Coach/Dashboard/Analytics/...）
  lib/secondbrain.ts SecondBrain 接口封装（静默降级）
```

## 常见问题

- **tracker 锁残留**：启动失败提示另一个实例 → 删 `tracker.lock` 重试
- **提权 tracker 杀不掉**：`Start-Process powershell -Verb RunAs` 提权后 Stop-Process
- **凌晨日期错一天**：已修复（本地日期统一走 `utils.localDateStr/localToday`，勿用 `toISOString().slice`）
- **改 Python 服务代码**：必须重启进程才生效（无热加载），watchdog 30s 内自动拉起
