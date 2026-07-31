// SecondBrain 接口封装（契约 v1：见 secondbrain_contract.md）
// 所有函数静默降级：失败返回 null / 空数组 / false，绝不抛出，不影响 StudyPet 主功能

/** 科目 key → 中文名（统一在这里处理映射） */
export const SUBJECT_NAMES: Record<string, string> = {
  electronics: '电子技术',
  math: '高数',
  english: '英语',
  politics: '政治',
};

/** 间隔复习序列：①1天 ②2天 ③4天 ④7天 ⑤15天 ⑥30天 */
export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];

export interface ReviewDueItem {
  id: number;                 // 追踪器行号
  subject: string;            // 科目 key 或中文名
  point: string;              // 知识点
  lastStudyDate: string;      // YYYY-MM-DD
  due: number[];              // 已到期的间隔天
  overdue: number[];          // 到期未勾的间隔天
  checked: number[];          // 已勾选间隔
}

export interface SecondBrainState {
  todayStudyMinutes: number;
  subjects: Record<string, unknown>;
  reviewOverdue: number;
  lastSyncDate: string | null;
}

export interface ArchiveMistakePayload {
  subject: string;
  chapter: string;
  stem: string;
  answer: string;
  userAnswer: string;
  analysis: string;
  errorTags: string[];
  date: string;               // YYYY-MM-DD
}

export interface DiaryResult {
  exists: boolean;
  content: string;
}

export function subjectName(key: string): string {
  return SUBJECT_NAMES[key] || key;
}

/** 距今天数（本地时区，YYYY-MM-DD） */
export function daysSinceDate(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.floor((start - s) / 86400000));
}

/** 第几次复习（取最早到期间隔在 1/2/4/7/15/30 中的序号） */
export function reviewOrdinal(item: ReviewDueItem): number {
  if (item.due.length === 0) return 1;
  const idx = REVIEW_INTERVALS.indexOf(Math.min(...item.due));
  return idx >= 0 ? idx + 1 : 1;
}

/** 超期天数（取最早漏掉的间隔计算，最严重口径） */
export function reviewOverdueDays(item: ReviewDueItem): number {
  if (item.overdue.length === 0) return 0;
  return Math.max(1, daysSinceDate(item.lastStudyDate) - Math.min(...item.overdue));
}

/** 完整到期描述：超期3天（第2次复习）/ 今天到期（第2次复习）/ 第2次复习 */
export function describeReviewDue(item: ReviewDueItem): string {
  const nth = reviewOrdinal(item);
  if (item.overdue.length > 0) return `超期${reviewOverdueDays(item)}天（第${nth}次复习）`;
  if (item.due.some(d => d === daysSinceDate(item.lastStudyDate))) return `今天到期（第${nth}次复习）`;
  return `第${nth}次复习`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'error' in data && data.error) return null;
    return data as T;
  } catch {
    return null;
  }
}

/** GET /secondbrain/review-due */
export async function fetchReviewDue(): Promise<ReviewDueItem[]> {
  const data = await requestJson<{ items?: ReviewDueItem[] }>('/secondbrain/review-due');
  return data?.items || [];
}

/** POST /secondbrain/review-check */
export async function checkReview(id: number, subject: string, point: string): Promise<boolean> {
  const data = await requestJson<{ ok?: boolean }>('/secondbrain/review-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, subject, point }),
  });
  return data?.ok === true;
}

/** POST /secondbrain/mistakes */
export async function archiveMistake(payload: ArchiveMistakePayload): Promise<boolean> {
  const data = await requestJson<{ ok?: boolean }>('/secondbrain/mistakes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data?.ok === true;
}

/** GET /secondbrain/diary?date=YYYY-MM-DD */
export async function getDiary(date: string): Promise<DiaryResult | null> {
  return requestJson<DiaryResult>(`/secondbrain/diary?date=${encodeURIComponent(date)}`);
}

/** POST /secondbrain/diary */
export async function saveDiary(date: string, content: string): Promise<boolean> {
  const data = await requestJson<{ ok?: boolean }>('/secondbrain/diary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, content }),
  });
  return data?.ok === true;
}

/** GET /secondbrain/state */
export async function getSecondBrainState(): Promise<SecondBrainState | null> {
  const data = await requestJson<{ state?: SecondBrainState }>('/secondbrain/state');
  return data?.state || null;
}
