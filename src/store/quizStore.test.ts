// 判题引擎单测：6 种题型全覆盖（此前"判不了选择题/简答"的历史 bug 回归）
import { describe, it, expect } from 'vitest';
import { judgeAnswer } from './quizStore';
import type { Question } from '../types';

function q(partial: Partial<Question>): Question {
  return {
    id: 't1', subject: 'electronics', chapter: 'c', type: 'single',
    stem: 's', answer: 'A', analysis: '', difficulty: 'medium',
    tags: [], source: 'manual', createdAt: '2026-08-01',
    ...partial,
  };
}

describe('judgeAnswer 判题', () => {
  it('单选：字母精确匹配', () => {
    expect(judgeAnswer(q({ type: 'single', answer: 'B' }), 'B')).toBe(true);
    expect(judgeAnswer(q({ type: 'single', answer: 'B' }), 'C')).toBe(false);
    expect(judgeAnswer(q({ type: 'single', answer: 'B' }), '')).toBe(false);
  });

  it('多选：与选项顺序无关，按排序字母串比对', () => {
    const multi = q({ type: 'multiple', answer: 'ACD' });
    expect(judgeAnswer(multi, 'CAD')).toBe(true);
    expect(judgeAnswer(multi, 'AC')).toBe(false);
    expect(judgeAnswer(multi, 'A,C,D')).toBe(true); // 带逗号/空格容错
  });

  it('判断：对/错 与 A/B 兼容', () => {
    expect(judgeAnswer(q({ type: 'truefalse', answer: '对' }), '对')).toBe(true);
    expect(judgeAnswer(q({ type: 'truefalse', answer: '对' }), 'A')).toBe(true);
    expect(judgeAnswer(q({ type: 'truefalse', answer: '错' }), 'B')).toBe(true);
    expect(judgeAnswer(q({ type: 'truefalse', answer: '对' }), '错')).toBe(false);
  });

  it('填空/简答：去空格+小写规范化', () => {
    expect(judgeAnswer(q({ type: 'fill', answer: ' 虚短 ' }), '虚短')).toBe(true);
    expect(judgeAnswer(q({ type: 'short', answer: 'Ohm' }), 'ohm')).toBe(true);
    expect(judgeAnswer(q({ type: 'fill', answer: '虚短' }), '虚断')).toBe(false);
  });

  it('论述：默认按自评（selfGrade）处理', () => {
    expect(judgeAnswer(q({ type: 'essay', answer: '任意' }), '我的论述')).toBe(false); // 纯文本比对不通过
  });

  it('空答案一律判错', () => {
    for (const t of ['single', 'multiple', 'truefalse', 'fill', 'short'] as const) {
      expect(judgeAnswer(q({ type: t }), '')).toBe(false);
    }
  });
});
