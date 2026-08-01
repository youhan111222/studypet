// 状态分析器单测：告警/时间线关键场景
import { describe, it, expect } from 'vitest';
import { analyzeState, type StateSnapshot } from './stateAnalyzer';
import type { ActivityLog, Task, SubjectKey, ScheduleItem, Achievement } from '../types';

const ACH: Achievement[] = [
  { id: 'a1', icon: '', title: '', desc: '', unlocked: false, progress: 3, total: 3 },
];

function makeParams(overrides: Partial<Parameters<typeof analyzeState>[0]> = {}): Parameters<typeof analyzeState>[0] {
  const sp: Record<SubjectKey, { lastStudyDate: string; totalMinutes: number; completedChapters: string[]; currentChapter: string }> = {
    english: { lastStudyDate: '2026-07-31', totalMinutes: 100, completedChapters: [], currentChapter: '' },
    math: { lastStudyDate: '2026-07-31', totalMinutes: 100, completedChapters: [], currentChapter: '' },
    politics: { lastStudyDate: '2026-07-31', totalMinutes: 100, completedChapters: [], currentChapter: '' },
    electronics: { lastStudyDate: '2026-07-31', totalMinutes: 100, completedChapters: [], currentChapter: '' },
  };
  return {
    today: '2026-08-01',
    hour: 10,
    minute: 0,
    dayOfWeek: 6,
    activityLogs: [],
    tasks: [],
    subjectProgress: sp as never,
    streak: 0,
    achievements: ACH,
    petLevel: 1,
    petCoins: 0,
    schedule: [],
    semesterWeek: 10,
    ...overrides,
  };
}

const task = (partial: Partial<Task>): Task => ({
  id: 't', title: '任务', period: 'morning', time: '10:00', duration: 60, tags: [],
  completed: false, source: 'manual', pomodoroCount: 0, ...partial,
});

const log = (category: string, duration: number, date = '2026-08-01'): ActivityLog =>
  ({ id: `l-${category}-${duration}`, appName: 'x', category: category as never, startTime: '10:00', duration, date });

describe('analyzeState 告警', () => {
  it('凌晨活跃 → fatigue 告警', () => {
    const s = analyzeState(makeParams({ hour: 2 }));
    expect(s.alerts.some(a => a.type === 'fatigue')).toBe(true);
  });

  it('DDL 超期（今天截止未完成）→ ddl 告警', () => {
    const s = analyzeState(makeParams({ tasks: [task({ deadline: '今天' })] }));
    expect(s.alerts.some(a => a.type === 'ddl')).toBe(true);
  });

  it('科目从未复习 → subject_gap 告警', () => {
    const p = makeParams();
    p.subjectProgress.electronics.lastStudyDate = '';
    const s = analyzeState(p);
    expect(s.alerts.some(a => a.type === 'subject_gap' && a.message.includes('电子技术'))).toBe(true);
  });

  it('娱乐超标（学习占比 <30%）→ entertainment 告警', () => {
    const s = analyzeState(makeParams({
      activityLogs: [log('study', 10), log('entertainment', 100)],
    }));
    expect(s.alerts.some(a => a.type === 'entertainment')).toBe(true);
  });

  it('连胜风险（20 点后今日学习 <30 分钟）→ streak_risk', () => {
    const s = analyzeState(makeParams({
      hour: 21, streak: 5,
      activityLogs: [log('study', 10)],
    }));
    expect(s.alerts.some(a => a.type === 'streak_risk')).toBe(true);
  });

  it('正常上午无任何告警', () => {
    const s = analyzeState(makeParams({
      hour: 10,
      activityLogs: [log('study', 60)],
      tasks: [task({ completed: true })],
    }));
    expect(s.alerts.length).toBe(0);
  });
});

describe('analyzeState 课程时间线', () => {
  const schedule: ScheduleItem[] = [{
    id: 's1', name: '高数', day: 6, timeStart: '08:00', timeEnd: '09:40',
    location: 'A101', teacher: '', weeks: '1-17',
  }];

  it('进行中 → current', () => {
    const s = analyzeState(makeParams({ hour: 9, dayOfWeek: 6, schedule }));
    expect(s.courseTimeline[0]?.status).toBe('current');
  });

  it('未开始 → upcoming，已结束 → past', () => {
    const s1 = analyzeState(makeParams({ hour: 7, dayOfWeek: 6, schedule }));
    expect(s1.courseTimeline[0]?.status).toBe('upcoming');
    const s2 = analyzeState(makeParams({ hour: 11, dayOfWeek: 6, schedule }));
    expect(s2.courseTimeline[0]?.status).toBe('past');
  });

  it('非本周课程不出现', () => {
    const s = analyzeState(makeParams({ hour: 9, dayOfWeek: 6, schedule, semesterWeek: 25 }));
    expect(s.courseTimeline.length).toBe(0);
  });
});
