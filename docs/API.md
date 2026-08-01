# StudyPet API 清单（统一入口 `api_server.py` :19998）

> 前端一律走 Vite 代理（`/api`、`/activity`、`/coach`、`/deepseek`、`/patina`、`/secondbrain`、`/rag`、`/search`、`/schedule`），禁止直连 127.0.0.1:19998。
> CORS：仅放行 localhost:5173/19998/19999 来源。未知路由返回 `{"error":"not found"}`，不静默成功。
> 错误约定：内部异常只回 `{"error":"服务器内部错误"}`，堆栈写 `api_error.log`。

## 健康检查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{"status":"ok","db_exists":bool}` |

## 屏幕活动

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/activity/stats` | 今日聚合：apps/categories/rawCategories/idleMinutes/totalActiveMinutes/effectiveStudyMinutes/distractionMinutes/browserReclassifiedMinutes；browser 类按窗口标题关键词二次打标 |
| GET | `/activity/raw` | 最近 50 条原始记录（含 is_idle） |
| GET | `/activity/history?days=7` | 近 N 天明细（1-365，不含空闲），供趋势/24h 分布 |
| GET | `/patina/history?days=14` | Patina 历史（进程/网页分段），days 钳制 1-365 |

## AI 教练 / 出题

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/coach/chat` | 教练对话。Body：`{"message","context":{...}}`；context 支持 activity_logs/subject_progress/exam_subjects 等。需要有效 `sk-` Key，否则返回 `{"error":"请先设置DeepSeek API Key","needKey":true}` |
| POST | `/deepseek/generate-question` | AI 出单选。Body：`{"subject","chapter","notes"}` → `{stem,options,answer,analysis,tags}` |

## SecondBrain

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/secondbrain/review-due` | 到期复习项（due/overdue/checked；今天到期不算超期） |
| POST | `/secondbrain/review-check` | 勾选最早到期间隔。Body：`{"id","subject","point"}` → `{"ok":true,"checked":iv}` |
| POST | `/secondbrain/review-add` | 登记知识点。Body：`{"subject","point"}`（科目自动归一化：电子技术→电子 等） |
| GET | `/secondbrain/mistakes?subject=&days=14` | 近 N 天错题；subject 白名单（electronics/math/english/politics/中文目录名），防路径穿越 |
| POST | `/secondbrain/mistakes` | 归档错题。Body：`{"subject","chapter","stem","answer","userAnswer","analysis","errorTags","date"}`，subject 同白名单 |
| GET | `/secondbrain/diary?date=YYYY-MM-DD` | 读日记 |
| POST | `/secondbrain/diary` | 写/追加日记。Body：`{"date","content"}` |
| GET | `/secondbrain/state` | 读学习状态（JSON） |
| POST | `/secondbrain/state` | 合并更新状态。Body：`{"updates":{...}}` |

## 检索 / 课表

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/rag/query?q=&subject=&top_k=` | SecondBrain 语义检索（失败静默返回空数组） |
| GET | `/schedule/import-from-xls` | 解析桌面官方课表 XLS → `{items:[ScheduleItem]}` |
