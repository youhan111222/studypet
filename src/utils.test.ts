// 工具函数单测：重点是本地日期回归（toISOString 时区 bug 曾全站中招）
import { describe, it, expect } from 'vitest';
import { localToday, localDateStr, parseDate, isWeekInRange, hexToRgb, inferSubjectFromTitle } from './utils';

describe('本地日期（时区回归）', () => {
  it('localDateStr 用本地年月日，不受 UTC 偏移影响', () => {
    // 2026-08-02 06:30 本地（UTC+8）→ toISOString 会错成 08-01，localDateStr 必须正确
    const d = new Date(2026, 7, 2, 6, 30);
    expect(localDateStr(d)).toBe('2026-08-02');
    const d2 = new Date(2026, 7, 1, 23, 0);
    expect(localDateStr(d2)).toBe('2026-08-01');
  });

  it('localToday 返回今天的本地日期', () => {
    const t = localToday();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    expect(t).toBe(localDateStr(now));
  });
});

describe('parseDate', () => {
  it('解析 ISO 与 yyyy-MM-dd', () => {
    expect(parseDate('2026-08-01').getFullYear()).toBe(2026);
    expect(parseDate('2026/08/01').getDate()).toBe(1);
  });
  it('非法输入回退到当前日期', () => {
    expect(isNaN(parseDate('垃圾').getTime())).toBe(false);
  });
});

describe('isWeekInRange', () => {
  it('支持范围/单周/逗号混合', () => {
    expect(isWeekInRange('1-17', 5)).toBe(true);
    expect(isWeekInRange('1-17', 20)).toBe(false);
    expect(isWeekInRange('3,5,7', 5)).toBe(true);
    expect(isWeekInRange('3,5,7', 4)).toBe(false);
    expect(isWeekInRange('', 5)).toBe(true);
  });
});

describe('hexToRgb', () => {
  it('3/6 位色值', () => {
    expect(hexToRgb('#4ecca3')).toBe('78, 204, 163');
    expect(hexToRgb('#fff')).toBe('255, 255, 255');
  });
});

describe('inferSubjectFromTitle', () => {
  it('四科关键词推断', () => {
    expect(inferSubjectFromTitle('电子技术第三章：三极管放大电路')).toBe('electronics');
    expect(inferSubjectFromTitle('高数错题：洛必达法则')).toBe('math');
    expect(inferSubjectFromTitle('英语单词 Day 30')).toBe('english');
    expect(inferSubjectFromTitle('政治：马原背诵')).toBe('politics');
    expect(inferSubjectFromTitle('打游戏')).toBeNull();
  });
});
