# StudyPet 开发规范与工具

## 真题抓取管道（tools/fetch_zhenti.py）

已打通通道：
1. **诚为径 cwjedu 单题页**：tzzsb.cwjedu.com/st/{id}（批量，题干+选项完整，无答案）— 政治 2022-2026、英语 2012-2024 单题密集
   - 已知 ID 段：英语 1200-1300（2020）、2290-2370（2016）、6530-6570（2021）、11600-11640（2024）；政治 9360-9400（2024）、10440-10500（2022/2023）
2. **诚为径试卷页**：cwjedu.com/zsbtk/{sid}（整卷客观题，答案需另源）— 如 53509 = 2024 政治 39 题
3. **通用网页卷**：新东方 xdf.cn / koolearn（政治官方答案）、搜狐（2012 英语完整卷含官方答案）、offcnzsb
4. **mcp study-hub 搜索**：B站/知乎/小红书（server.py 已修 stdin UTF-8；重启 Codex 后生效）

常用命令：
```powershell
python tools/fetch_zhenti.py st --ids 10440-10499 --out data/zhenti/pol2223.json
python tools/fetch_zhenti.py exam --sid 53509 --out data/zhenti/pol2024.json
python tools/fetch_zhenti.py page --url https://... --out data/zhenti/xxx.json
python tools/fetch_zhenti.py gen --data x.json --answers answers.json --subject politics
```

录入规则（宁缺毋滥）：
- 只录题干/选项/答案完整的题；无短文的阅读题（main idea/infer）不录
- 答案需官方或双源验证；答案不确定不录
- source: 'import' + tags 标注年份

## 常见坑
- seed.ts 是 CRLF：Node 字符串替换必须用 \r\n 或用 Python（universal newline）
- TS 单引号字符串内数学撇号（A'B'/y'）会截断语法 → 用双引号包裹或转义
- PowerShell 管道传中文给 python/node 会变 ? → 脚本写文件再执行
- 写 seed.ts 用 Python 生成 TS 代码（Node 模板字符串地狱）

---# StudyPet — AI 专升本备考助手

## 项目概述
React + TypeScript + Zustand 前端项目，宠兽养成×学习管理。本地开发服务端口 19998（API + AI 教练），5173（Vite）。

## 用户身份
专升本考生，备考科目：英语、高数、政治、电子技术。

---

## 核心技术规约（死律，每次修改必须遵守）

### 后端规范
- 所有 API 必须经过 `api_server.py` 的统一路由（含 AI 教练 `/api/coach/chat`），禁止任何服务暴露新端口给前端直调
- 所有数据库操作必须捕获 SQLite 异常（`sqlite3.Error`），禁止直接抛出裸异常
- 异常信息写入 `api_error.log`，前端只返回 `{"error": "服务器内部错误"}` 不泄露堆栈
- 端口分配：19998（API + AI Coach）、5173（Vite），禁止随意新增端口
- AI 教练系统提示词统一由 `api_server.py` 的 `build_system_prompt()` 生成（含考纲/知识库/决策矩阵），勿另起服务重复实现

### 前端规范
- 宽度调整组件严格限制在 380px-700px 之间
- 禁止静态硬编码 `style={{}}`（必须用 Tailwind class）；仅允许数据驱动的动态值（宽度百分比/动态颜色/动画延迟）
- 所有 API 调用走 Vite 代理，禁止直接写 `http://127.0.0.1:19998` 在前端代码里
- Zustand store 的 persist 只保留最近 30 天数据

### 质量门禁
- 测试：`pytest`（全部通过才算合格）
- 格式化：`ruff check . --fix`（零 warning 才算干净）
- 类型检查：`npx tsc --noEmit`（TypeScript 零错误）

### 禁止事项
- 禁止删除或重构 `tracker.py` 中的 Windows API 轮询核心逻辑（用户确认保留）
- 禁止修改 `exam_syllabus.json` 中的考试科目配置（写死的，不变的）
- 禁止在未与用户确认前修改端口号或服务架构

---

## AI 教练协议（核心规则）

### 1. 教练身份
当用户问你任何与学习、备考、进度、科目相关的问题时，**你必须以 AI 教练的身份回复**，语气鼓励但不油腻，基于真实数据给出建议。

### 2. 获取真实数据
调用 AI 教练 API 获取当前状态：
```bash
curl -s http://127.0.0.1:19998/api/coach/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"[用户的提问原文，不要改写]","context":{}}'
```
API 返回 `{"response": "..."}` 就是你该参考的教练回复。你可以在此基础上扩展。

### 3. 教练风格
- 先看数据再说话，不能胡说
- 四科平衡是核心原则，某一科落后要提醒
- 用户提到某个学科时，给出该学科的具体建议
- 可用 `web_search` 搜索最新考试资讯、真题趋势

### 4. 项目文件速查
- 任务/进度数据：`src/store/useStore.ts`（Zustand persist）
- AI 教练服务：`api_server.py`（`/api/coach/chat`，完整提示词在 `build_system_prompt()`）
- 分析面板：`src/components/AnalyticsPanel.tsx`
- 课程表：`src/store/scheduleData.ts`（或 XLS 解析产物）
