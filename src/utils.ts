/** 本地时区 YYYY-MM-DD（toISOString 是 UTC，凌晨 0-8 点会错一天，本地日期一律走这里） */
export function localToday(): string {
  return localDateStr(new Date());
}

export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 解析日期字符串，支持 ISO 和 yyyy-MM-dd、yyyy/MM/dd */
export function parseDate(s: string): Date {
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const parts = s.split(/[-/]/);
  if (parts.length === 3) return new Date(+parts[0], +parts[1] - 1, +parts[2]);
  return new Date();
}

/** 判断课程周次字段是否包含当前周 */
export function isWeekInRange(weeks: string, w: number): boolean {
  if (!weeks) return true;
  const s = String(weeks);
  const parts = s.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number);
      if (w >= start && w <= end) return true;
    } else {
      if (Number(trimmed) === w) return true;
    }
  }
  return false;
}

/** 十六进制颜色转 RGB 字符串，用于 rgba() */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return `${parseInt(h[0] + h[0], 16)}, ${parseInt(h[1] + h[1], 16)}, ${parseInt(h[2] + h[2], 16)}`;
  }
  return `${parseInt(h.substring(0, 2), 16)}, ${parseInt(h.substring(2, 4), 16)}, ${parseInt(h.substring(4, 6), 16)}`;
}

// ====== 科目推断（唯一实现，全站共用） ======
import type { SubjectKey } from './types';

const SUBJECT_KEYWORDS: Record<SubjectKey, string[]> = {
  english: ['英语', '英文', '单词', '阅读', '语法', '作文', '翻译', '听力'],
  math: ['高数', '数学', '微积分', '线代', '线性代数', '概率', '方程', '函数', '极限', '导数', '积分'],
  politics: ['政治', '马原', '毛概', '思修', '近代史', '时政', '唯物', '辩证法'],
  electronics: ['电子', '电路', '模电', '数电', '信号', '单片机', '通信', '三极管', '放大器', '嵌入式'],
};

/** 从文本（任务标题/窗口标题）推断科目 */
export function inferSubjectFromTitle(title: string): SubjectKey | null {
  const t = title.toLowerCase();
  for (const [key, kw] of Object.entries(SUBJECT_KEYWORDS)) {
    if (kw.some(word => t.includes(word.toLowerCase()))) {
      return key as SubjectKey;
    }
  }
  return null;
}
