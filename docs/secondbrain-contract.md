# StudyPet ↔ SecondBrain 接口契约（v1，2026-07-31）

前端组件与后端路由必须严格按本契约对接。所有接口走 api_server.py（19998），路径前缀 /secondbrain。

## 数据文件格式（后端读写，前端只经 API）

### 复习追踪器：D:\SecondBrain\15-元知识\学习系统\📌 复习追踪器.md
```
# 📌 复习追踪器
| 学习日期 | 知识点 | 科目 | ①1天 | ②2天 | ③4天 | ④7天 | ⑤15天 | ⑥30天 |
|----------|--------|------|------|------|------|------|-------|-------|
| 2026-07-06 | 函数极限 | 高数 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
```
- 间隔列含义：学习日期 + N 天 到期（1/2/4/7/15/30）
- 勾选：该列 ⬜ → ✅（文本替换，保持表格对齐）
- id = 行号（从 2 开始计数，表头行 0、分隔行 1）

### 错题本：D:\SecondBrain\10-知识库\<科目>\错题\
- 文件名：`YYYY-MM-DD-章节-题目关键词.md`（防重：同日期同章节同关键词则追加到该文件末尾）
- 文件内容 frontmatter + 题目/答案/用户答案/错因/解析

### 日记：D:\SecondBrain\20-日记\YYYY-MM-DD.md
- 追加模式：新日期创建（frontmatter + 标题 + 军立状三块），已有日期只追加统计段

## 后端路由（api_server.py 新增）

### 读
1. `GET /secondbrain/review-due`
   返回：`{items: [{id, subject, point, lastStudyDate, due:[1,2,4,7,15,30 中到期日], overdue:[到期未勾的间隔天], checked:[已勾间隔]}]}`
   - 只返回有到期项（due 非空）的记录
2. `GET /secondbrain/mistakes?subject=xxx&days=14`
   返回：`{items: [{subject, chapter, stem, answer, userAnswer, errorTags, date}]}`
3. `GET /secondbrain/diary?date=YYYY-MM-DD`
   返回：`{exists: bool, content: string}`
4. `GET /secondbrain/state`
   返回：`{state: {todayStudyMinutes, subjects: {}, reviewOverdue: n, lastSyncDate}}`（读 learning-state.md，不存在则返回空结构）

### 写
5. `POST /secondbrain/review-check` body: `{id, subject, point}`
   勾选最早到期的未勾间隔列 → `{ok: true}`
6. `POST /secondbrain/mistakes` body: `{subject, chapter, stem, answer, userAnswer, analysis, errorTags: [..], date}`
   写入错题本 → `{ok: true, file}`
7. `POST /secondbrain/diary` body: `{date, content}`（content 为完整当日内容，追加/创建）
   → `{ok: true}`
8. `POST /secondbrain/state` body: `{updates: {}}`（合并进 learning-state.md 的 YAML frontmatter 或 JSON）
   → `{ok: true}`

## 工程约束（后端）
- 所有文件写操作：写临时文件 → os.replace 原子替换；读失败返回 `{error: "..."}` + 不 500
- 编码统一 utf-8；PYTHONIOENCODING 无关（服务端）
- 复习追踪器解析容错：表头缺失/行损坏跳过该行，不崩
- 全部走 api_server 统一路由（CLAUDE.md 铁律），不新增端口
- 新增路由全部进 test_api.py（用临时目录的测试文件测读写，不碰真实 SecondBrain 文件——通过环境变量 SECOND_BRAIN_ROOT 覆盖根路径，默认 D:\SecondBrain）

## 前端消费（src/）
- Dashboard：加载 GET /secondbrain/review-due → 渲染「📌 今日待复习」卡（科目/知识点/到期间隔），点击调 POST /secondbrain/review-check 后刷新
- QuizPanel：submitAnswer 判错且 q.source!=='ai' → 调 POST /secondbrain/mistakes（节流：同一题 10 分钟内只归档一次）
- CoachPanel：buildContext 或调用处注入 GET /secondbrain/review-due + /secondbrain/mistakes 摘要（复习欠账/错题薄弱 TOP5）
- 收工日记入口：StudyTimer 停止后（或手动按钮）调 GET /secondbrain/diary?date=today 拿现有内容 + 本地统计拼装 → POST /secondbrain/diary
- 全部走 Vite 代理（/secondbrain → 19998，需在 vite.config.ts 加代理条目）

## 测试文件
- 后端测试：test_api.py 加 test_secondbrain_*（设置 SECOND_BRAIN_ROOT=临时目录）
- 前端验证：npx tsc --noEmit + npm run build
