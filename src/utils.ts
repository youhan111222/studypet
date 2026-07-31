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
