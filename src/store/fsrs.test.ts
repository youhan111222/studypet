// FSRS 算法回归测试（Anki 核心算法：间隔调度 + 可提取性 + 期望保持率）
import { describe, it, expect } from 'vitest';
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';

const NOW = new Date('2026-08-01T00:00:00Z');

// 关闭分钟级学习步骤，直接测天级核心算法（Anki 复习调度主逻辑）
function newScheduler() {
  const s = fsrs();
  s.parameters = { enable_short_term: false };
  return s;
}

describe('FSRS 算法（Anki 核心）', () => {
  it('评分越高，下次间隔越长（Again < Hard < Good < Easy）', () => {
    const s = newScheduler();
    const base = createEmptyCard(NOW);
    const again = s.next(base, NOW, Rating.Again).card;
    const hard = s.next(base, NOW, Rating.Hard).card;
    const good = s.next(base, NOW, Rating.Good).card;
    const easy = s.next(base, NOW, Rating.Easy).card;
    expect(hard.scheduled_days).toBeGreaterThanOrEqual(again.scheduled_days);
    expect(good.scheduled_days).toBeGreaterThan(hard.scheduled_days);
    expect(easy.scheduled_days).toBeGreaterThan(good.scheduled_days);
  });

  it('记忆可提取性 R 随时间衰减（到期待复习，过期更低）', () => {
    const s = newScheduler();
    const card = s.next(createEmptyCard(NOW), NOW, Rating.Good).card;
    const atDue = s.get_retrievability(card, card.due, false);
    const overdue = s.get_retrievability(card, new Date(card.due.getTime() + 3 * 86400000), false);
    expect(atDue).toBeGreaterThan(overdue);
    expect(atDue).toBeGreaterThan(0.5);
  });

  it('期望保持率越高（越严格），间隔越短（Anki Desired Retention）', () => {
    const s = newScheduler();
    const base = createEmptyCard(NOW);
    s.parameters = { enable_short_term: false, request_retention: 0.85 };
    const d85 = s.next(base, NOW, Rating.Good).card.scheduled_days;
    s.parameters = { enable_short_term: false, request_retention: 0.95 };
    const d95 = s.next(base, NOW, Rating.Good).card.scheduled_days;
    expect(d95).toBeLessThan(d85);
  });

  it('复习次数与稳定性单调增长（学得越牢，间隔越长）', () => {
    const s = newScheduler();
    let card = createEmptyCard(NOW);
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      const next = s.next(card, new Date(card.due), Rating.Good);
      intervals.push(next.card.scheduled_days);
      card = next.card;
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
  });
});