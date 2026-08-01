// 连胜计算单测（曾因 toISOString 时区 + 30 天裁剪出过问题）
import { describe, it, expect } from 'vitest';
import { computeStreak } from './useStore';
import type { Task } from '../types';

const done = (date: string): Task => ({
  id: `t-${date}`, title: 'x', period: 'morning', time: '', duration: 60, tags: [],
  completed: true, source: 'manual', pomodoroCount: 0, date,
});

describe('computeStreak', () => {
  it('连续完成 3 天 → 3', () => {
    const tasks = ['2026-07-30', '2026-07-31', '2026-08-01'].map(done);
    expect(computeStreak(tasks, {}, '2026-08-01')).toBe(3);
  });

  it('中间断一天 → 只数到今天', () => {
    const tasks = ['2026-07-29', '2026-07-31', '2026-08-01'].map(done);
    expect(computeStreak(tasks, {}, '2026-08-01')).toBe(2);
  });

  it('学习 ≥30 分钟也算打卡（studyDays）', () => {
    const studyDays = { '2026-08-01': 30, '2026-07-31': 45 };
    expect(computeStreak([], studyDays, '2026-08-01')).toBe(2);
    expect(computeStreak([], { '2026-08-01': 29 }, '2026-08-01')).toBe(0);
  });

  it('任务与 studyDays 混算不重复计天', () => {
    const tasks = ['2026-08-01'].map(done);
    const studyDays = { '2026-08-01': 60 };
    expect(computeStreak(tasks, studyDays, '2026-08-01')).toBe(1);
  });

  it('跨越 30 天的长连胜不被截断（回归：partialize 曾只保留 30 天）', () => {
    const days: string[] = [];
    for (let i = 40; i >= 0; i--) {
      const d = new Date(2026, 7, 1); // 锚点今天，往前 40 天
      d.setDate(d.getDate() - i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    expect(computeStreak(days.map(done), {}, '2026-08-01')).toBe(41);
  });
});
