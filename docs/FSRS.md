# StudyPet × Anki 算法（FSRS-5）实现说明

> 2026-08-01 ｜ StudyPet 用的就是 Anki 现行核心调度算法 **FSRS-5**（`ts-fsrs` 5.4.1，Anki 2023 起默认采用，替代老 SM-2），不是自己拍的复习间隔。

## 一、算法接线（代码位置）

| 环节 | 实现 |
|---|---|
| 初始卡片 | `createEmptyCard(now)`（state=New, stability/difficulty 默认值） |
| 调度 | `scheduler.next(card, now, rating)` — 四个评分 Again/Hard/Good/Easy → 新的 stability/difficulty/due |
| 持久化 | `toReviewCard()` → Dexie `reviewCards`（含 stability/difficulty/elapsed_days/scheduled_days/reps/lapses/**learning_steps**/state/due） |
| 读回 | `fsrsCardFromReview()` → Card（**learning_steps 缺省补 0**） |
| 可提取性 | `scheduler.get_retrievability(card, now)` → R（0~1） |
| 间隔预览 | `scheduler.repeat(card, now)` → 四个评分各自的 next card |

## 二、Anki 精髓：本轮抄齐的部分

1. **Desired Retention（期望记忆保持率）** — Anki 设置里的核心参数
   - ReviewPanel 顶栏可调 80% / 85% / 90% / 95%（默认 90%）
   - 落地：`scheduler.parameters = { ...scheduler.parameters, request_retention: r }`
     ⚠️ parameters setter 是**整组替换**，必须先读再合并，否则会把 enable_short_term 等重置回默认（踩过的坑，有单测保护）
   - 公式：`I(r,s) = (r^(1/DECAY) - 1) / FACTOR × s`，保持率越高间隔越短、复习越频繁
2. **R% 记忆强度显示** — 复习时顶栏显示当前卡片可提取性（如 `R 87%`），到期时 ≈ 保持率，过期递减
3. **调度预览** — 四个评分按钮右侧显示"下次 +N天"，选之前就知道后果（Anki 的间隔预览）
4. **复习状态统计** — 空态页显示：今日到期 / 学习中 / 复习中 / 重学（对应 FSRS state: New/Learning/Review/Relearning）
5. **learning_steps 持久化修复** — 之前存/取丢了这个字段，新卡学习步骤（分钟级）会失真；已补上

## 三、核心公式

- 稳定性：`S' = f(S, D, R, G)`（w1-w19 参数矩阵）
- 难度：`D' = D - w6 × (G - 3)`（含下限 1、上限 10）
- 可提取性：`R(t,S) = (1 + FACTOR × t/S)^DECAY^-1`（DECAY=-0.5, FACTOR=19/81）
- 间隔：`I = (R^(1/DECAY) - 1)/FACTOR × S`

## 四、回归测试（src/store/fsrs.test.ts，4 用例）

- 评分越高间隔越长：Again < Hard < Good < Easy（关闭分钟级学习步骤后验证天级核心）
- R 随时间衰减：到期时 ≈ 保持率，逾期更低
- 保持率越高间隔越短：85% → 4 天 vs 95% → 3 天
- 连续复习间隔单调增长（稳定性累积）

> 结论：算法层已经和 Anki 同源（FSRS-5），本轮把 Anki 的"调度可视化 + 保持率可调"精髓补齐。