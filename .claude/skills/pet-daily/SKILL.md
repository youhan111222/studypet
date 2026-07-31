---
name: pet-daily
description: 从 activity.db 生成当日/近期学习数据报告。当用户说"学习报告"、"今天学了多久"、"每日报告"、"看看今天数据"时触发。
---

# StudyPet 每日学习报告

从 `D:\StudyPet\activity.db` 提取数据，生成结构化报告。

1. **当日总览**：
   - 查询当日总活动记录数和总时长（分钟）
   ```sql
   SELECT COUNT(*) as 记录数, ROUND(SUM(duration_seconds)/60.0, 1) as 总分钟
   FROM activity WHERE date = date('now', 'localtime');
   ```

2. **分类分布**：
   - 按 category 汇总今日时长，按降序排列
   ```sql
   SELECT category, ROUND(SUM(duration_seconds)/60.0, 1) as 分钟
   FROM activity WHERE date = date('now', 'localtime')
   GROUP BY category ORDER BY 分钟 DESC;
   ```

3. **学习类 Top 5 应用**：
   - 筛选 category='study' 的今日记录，按进程名汇总
   ```sql
   SELECT process_name, ROUND(SUM(duration_seconds)/60.0, 1) as 分钟
   FROM activity WHERE date = date('now', 'localtime') AND category='study'
   GROUP BY process_name ORDER BY 分钟 DESC LIMIT 5;
   ```

4. **近 7 天趋势**：
   - 每日总时长趋势（最近 7 天）
   ```sql
   SELECT date, ROUND(SUM(CASE WHEN category='study' THEN duration_seconds ELSE 0 END)/60.0, 1) as 学习分钟,
          ROUND(SUM(duration_seconds)/60.0, 1) as 总分钟
   FROM activity WHERE date >= date('now', '-7 days', 'localtime')
   GROUP BY date ORDER BY date DESC;
   ```

5. **输出格式**：
   - 用 Markdown 表格输出所有结果
   - 最后给一行总结："今日学习 X 分钟，占总时长 Y%。[与昨日对比方向]"
   - 严禁情感化评价，只陈述数据
