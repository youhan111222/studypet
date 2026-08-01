// CSV 题库导入解析单测（对标 EXAM-MASTER CSV 导入）
import { describe, it, expect } from 'vitest';
import { parseCsv, rowToQuestion } from './csvImport';

describe('parseCsv', () => {
  it('解析基础行', () => {
    const rows = parseCsv('politics,single,题干？,A|B|C|D,A,解析,第一章\nenglish,fill,填空____,B,,,综合');
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toBe('politics');
    expect(rows[1][3]).toBe('B');
  });

  it('支持引号内逗号', () => {
    const rows = parseCsv('politics,single,"含,逗号的题干","A,B",A,,第一章');
    expect(rows[0][2]).toBe('含,逗号的题干');
    expect(rows[0][3]).toBe('A,B');
  });
});

describe('rowToQuestion', () => {
  it('中英文科目/题型映射 + 选项拆分', () => {
    const r = rowToQuestion(['政治', '多选', '多选题干', 'A|B|C|D', 'ABC', '解析', '毛概'], 0);
    expect(r.error).toBeNull();
    expect(r.question?.subject).toBe('politics');
    expect(r.question?.type).toBe('multiple');
    expect(r.question?.options?.length).toBe(4);
    expect(r.question?.answer).toBe('ABC');
  });

  it('缺题干/答案报错并带行号', () => {
    const r = rowToQuestion(['', '', '', '', '', '', ''], 3);
    expect(r.error).toContain('第 4 行');
    expect(r.question).toBeNull();
  });

  it('科目无法识别报错', () => {
    const r = rowToQuestion(['化学', 'single', '题干', 'A|B', 'A', '', ''], 1);
    expect(r.error).toContain('科目无法识别');
  });
});
