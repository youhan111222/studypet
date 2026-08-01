// CSV 题库导入（对标 EXAM-MASTER 的 CSV 导入题库）
// 列格式：subject,type,stem,options,answer,analysis,chapter
//   options 用 | 分隔（A|B|C|D）；type/subject 支持中英文；首行表头可省略
import { db } from '../db';
import type { Question, QuestionType, SubjectKey, Difficulty } from '../types';

const SUBJ_MAP: Record<string, SubjectKey> = {
  electronics: 'electronics', 电子: 'electronics', 电子技术: 'electronics',
  math: 'math', 高数: 'math', 高等数学: 'math',
  english: 'english', 英语: 'english',
  politics: 'politics', 政治: 'politics',
};
const TYPE_MAP: Record<string, QuestionType> = {
  single: 'single', 单选: 'single',
  multiple: 'multiple', 多选: 'multiple',
  truefalse: 'truefalse', 判断: 'truefalse',
  fill: 'fill', 填空: 'fill',
  short: 'short', 简答: 'short',
  essay: 'essay', 论述: 'essay',
};
const DIFF_MAP: Record<string, Difficulty> = {
  easy: 'easy', 简单: 'easy',
  medium: 'medium', 中等: 'medium',
  hard: 'hard', 困难: 'hard',
};

/** 标准 CSV 解析（支持双引号转义、逗号/换行在引号内、\r\n） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      cur.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field); field = '';
      if (cur.some(x => x.trim() !== '')) rows.push(cur);
      cur = [];
    } else {
      field += c;
    }
  }
  cur.push(field);
  if (cur.some(x => x.trim() !== '')) rows.push(cur);
  return rows;
}

export interface ParsedRow {
  question: Question | null;
  error: string | null;
}

/** 一行 CSV → Question（纯函数，便于单测） */
export function rowToQuestion(row: string[], idx: number, chapterFallback = '综合'): ParsedRow {
  const cols = row.map(x => (x || '').trim());
  const [subjRaw, typeRaw, stem, optionsRaw, answer, analysis = '', chapterRaw = ''] = cols;
  if (!stem || !answer) {
    return { question: null, error: `第 ${idx + 1} 行缺少题干或答案` };
  }
  const subject = SUBJ_MAP[(subjRaw || '').toLowerCase()];
  if (!subject) {
    return { question: null, error: `第 ${idx + 1} 行科目无法识别：${subjRaw}` };
  }
  const type = TYPE_MAP[(typeRaw || '').toLowerCase()];
  if (!type) {
    return { question: null, error: `第 ${idx + 1} 行题型无法识别：${typeRaw}` };
  }
  const options = (optionsRaw || '')
    .split(/[|;；\n]+/)
    .map(o => o.trim())
    .filter(o => o !== '');
  const difficulty = DIFF_MAP[(cols[7] || '').toLowerCase()] || 'medium';
  return {
    question: {
      id: `csv-${Date.now()}-${idx}`,
      subject,
      chapter: chapterRaw || chapterFallback,
      type,
      stem,
      options: options.length >= 2 ? options : undefined,
      answer,
      analysis,
      difficulty,
      tags: ['CSV导入'],
      source: 'manual',
      createdAt: new Date().toISOString().slice(0, 10),
    },
    error: null,
  };
}

function normalizeStem(s: string): string {
  return s.replace(/[\s\\_（）()、，。·\-:：?？]/g, '').toLowerCase();
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/** 批量导入：按题干归一化去重（与题库已有题目 + 本批内去重） */
export async function importQuestions(rows: string[][]): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: 0, skipped: 0, failed: 0, errors: [] };
  const existing = new Set((await db.questions.toArray()).map(q => normalizeStem(q.stem)));
  const batch: Question[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const { question, error } = rowToQuestion(row, i);
    if (error || !question) {
      summary.failed++;
      if (error) summary.errors.push(error);
      return;
    }
    const key = normalizeStem(question.stem);
    if (existing.has(key) || seen.has(key)) {
      summary.skipped++;
      return;
    }
    seen.add(key);
    existing.add(key);
    batch.push(question);
  });
  if (batch.length > 0) {
    await db.questions.bulkPut(batch);
  }
  summary.imported = batch.length;
  return summary;
}