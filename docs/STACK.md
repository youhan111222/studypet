# 技术栈对标与优化记录

> 2026-08-01 ｜ 目的：参考同类学习/刷题项目的技术选型，找出 StudyPet 可落地的优化点

## 一、对标项目

| 项目 | 技术栈 | 可借鉴点 |
|---|---|---|
| **Anki**（间隔重复行业标杆） | Rust 核心 + SQLite(WAL/事务/自定义函数) + Python/Qt UI | 本地优先 + SQLite WAL 加固；**StudyPet 已采用 WAL + synchronous=NORMAL + busy_timeout** |
| **题喵喵 MiaowTest**（AI 刷题系统） | Uni-app + Vue3 + Express + MongoDB + LangChain | AI 对话/批改/统计；多端覆盖（微信小程序/H5/App） |
| **QL-Tiku2 七洛题库** | Spring Boot + SpringAI + Vue3 前后端分离 | AI 智能出题、AI 批改 |
| **Spaced Out**（间隔重复） | Rust + **Tauri 2** 桌面壳 | 桌面原生体验：托盘、离线、轻量分发 |
| **modern local-first 实践**（2025 趋势） | PWA / Tauri + SQLite + sync engine | **离线优先**：首屏不依赖网络、可安装、断网可刷题 |

## 二、StudyPet 现状

- 前端：React 18 + Vite 5 + TypeScript + Zustand + Dexie(IndexedDB) + ts-fsrs(FSRS) + Tailwind
- 后端：Flask + waitress + SQLite(WAL) + DeepSeek(AI 教练/判题)
- 部署：单机自部署（vite build + 本地 API :19998）

## 三、本轮已落地优化（抄作业成果）

### 1. PWA 化 —— 借鉴刷题类 App 的离线场景
- 引入 `vite-plugin-pwa`：生成 `sw.js`（Workbox 预缓存 21 个资源，491KB）+ `manifest.webmanifest`
- 效果：**可安装到桌面/手机**、断网也能打开应用壳、静态资源秒开
- 图标：`public/pwa-192.png / pwa-512.png / pwa-icon.svg`（爪印主题，`tools/gen_pwa_icons.py` 可再生成）

### 2. 路由级代码分割 —— 借鉴现代 React 工程实践
- `CoachPanel/QuizPanel/ReviewPanel/StatsPanel/TaskList/SchedulePanel/AnalyticsPanel/AchievementWall/ImportantPanel/ScreenTimePanel` 全部改为 `React.lazy`
- 效果：主包 **460.9KB → 358.0KB**（gzip 150.9 → 118.9KB，↓21%），10 个面板按需加载（最大 CoachPanel 34.4KB）

### 3. 元信息与可发现性
- `index.html` 补 description / theme-color / manifest / apple-touch-icon

### 4. 收藏/标记题目 —— 借鉴 EXAM-MASTER
- `Question.favorite?` 字段 + Dexie 持久化（`setQuestionFavorite` / `getFavoriteQuestions`）
- 刷题页题目卡右上角 ☆/★ 一键收藏（本地题库量级小，用 filter 查询，避开 Dexie 对 boolean 索引的类型限制）

## 四、结论与后续可选方向（未做，按需）

| 方向 | 成本 | 收益 | 结论 |
|---|---|---|---|
| Tauri 2 桌面壳（借鉴 Spaced Out） | 高（Rust + sidecar 打包） | 原生托盘/开机自启/免浏览器 | 已有 watchdog/autostart 脚本，暂不迁移 |
| Flask → FastAPI | 中（改写 API 层） | OpenAPI 文档 + Pydantic 校验 | 单机小服务，收益有限，暂缓 |
| 多端（小程序/App） | 高 | 手机刷题 | **PWA 已覆盖手机浏览器**，性价比更高 |
| ESLint | 低 | 前端代码规范 | 待办（tsc+vitest 已兜底） |