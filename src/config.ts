export const API = '';  // 走 Vite 代理

// 学期开始日期（每学期开学改这里一次，全站共用）
export const SEMESTER_START = '2026-03-02';

// 考试日期（2027 年 3 月专插本；改这里一次，全站共用）
export const EXAM_DATE = '2027-03-25';

// 计算当前是第几周（从学期开始日期算起，均使用本地时间）
export function getCurrentWeek(semesterStart: string = SEMESTER_START): number {
  const [y, m, d] = semesterStart.split('-').map(Number);
  const start = new Date(y, m - 1, d); // 本地时间 00:00
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 本地时间 00:00
  const diffMs = today.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}
