// 模拟考试计分纯函数单测（对标 EXAM-MASTER 模拟考试）
import { describe, it, expect } from 'vitest';
import { scoreExam } from './examStore';
import type { Question } from '../types';

function q(id: string, answer: string, type: Question['type'] = 'single'): Question {
  return {
    id, subject: 'english', chapter: 'c', type, stem: id, answer,
    analysis: '', difficulty: 'medium', tags: [], source: 'manual', createdAt: '2026-08-01',
  };
}

describe('scoreExam 模拟考试计分', () => {
  it('答对/答错统计', () => {
    const r = scoreExam([q('a', 'B'), q('b', 'C')], { a: 'B', b: 'D' });
    expect(r.correct).toBe(1);
    expect(r.wrong).toBe(1);
    expect(r.total).toBe(2);
  });

  it('未作答按错误计', () => {
    const r = scoreExam([q('a', 'A')], {});
    expect(r.correct).toBe(0);
    expect(r.wrong).toBe(1);
    expect(r.items[0].userAnswer).toBe('（未作答）');
  });

  it('多选乱序也算对', () => {
    const r = scoreExam([q('a', 'ACD', 'multiple')], { a: 'CAD' });
    expect(r.correct).toBe(1);
  });
});
