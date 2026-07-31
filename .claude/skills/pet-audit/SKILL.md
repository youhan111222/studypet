---
name: pet-audit
description: 当需要对 StudyPet 的代码质量和行为数据库进行双重自动化审计时触发此技能。
---

# StudyPet 自动化审计标准作业程序

当你（Claude）被唤醒执行 `pet-audit` 技能时，必须严格按照以下顺序不折不扣地执行，严禁自行跳过步骤：

1. **代码洁癖审计**：
   - 立即调用系统中的 `ruff check . --fix`，对当前项目的 Python 代码进行全量静态扫描并自动修复。
   - 记录修复了哪些潜在 Bug，如果有无法自动修复的死循环风险，在后续报告中加粗列出。

2. **数据库结构对撞**：
   - 调用系统中的 `sqlite-utils tables activity.db --counts`，检查当前本地行为数据库的表结构和当前的记录总数。
   - 确认 `activity.db` 中 `activity` 表是否存在 `start_time`、`process_name` 和 `window_title` 这三个核心维度字段。

3. **结构化汇报**：
   - 严禁使用任何情感废话（如"太棒了"）。
   - 直接用 Markdown 表格输出代码修复状态和数据库健康度。
