import { create } from 'zustand';
import { db } from '../db';
import { judgeAnswer, syncSubjectProgress } from './quizStore';
import { localToday } from '../utils';
import type { Question, SubjectKey, Attempt } from '../types';

/** 一场考试的结果条目（纯数据，可单测） */
export interface ExamResultItem {
  questionId: string;
  stem: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

export interface ExamResult {
  correct: number;
  wrong: number;
  total: number;
  items: ExamResultItem[];
}

/** 纯函数：按题目与作答计算成绩（不依赖 DB，便于单测） */
export function scoreExam(questions: Question[], answers: Record<string, string>): ExamResult {
  const items: ExamResultItem[] = questions.map(q => {
    const userAnswer = (answers[q.id] || '').trim();
    const isCorrect = userAnswer !== '' && judgeAnswer(q, userAnswer);
    return {
      questionId: q.id,
      stem: q.stem,
      userAnswer: userAnswer || '（未作答）',
      correctAnswer: q.answer,
      isCorrect,
    };
  });
  return {
    correct: items.filter(i => i.isCorrect).length,
    wrong: items.filter(i => !i.isCorrect).length,
    total: items.length,
    items,
  };
}

interface ExamStore {
  active: boolean;
  subject: SubjectKey | null;
  questions: Question[];
  answers: Record<string, string>;
  totalSec: number;
  remainingSec: number;
  result: ExamResult | null;
  startExam: (subject: SubjectKey, count?: number, minutes?: number) => Promise<void>;
  answerQuestion: (questionId: string, answer: string) => void;
  tick: () => void;
  finishExam: () => Promise<void>;
  exitExam: () => void;
}

export const useExamStore = create<ExamStore>((set, get) => ({
  active: false,
  subject: null,
  questions: [],
  answers: {},
  totalSec: 0,
  remainingSec: 0,
  result: null,

  startExam: async (subject, count = 20, minutes = 30) => {
    const qs = await db.getQuestionsBySubject(subject, 1000);
    const picked = qs.sort(() => Math.random() - 0.5).slice(0, count);
    set({
      active: true, subject, questions: picked, answers: {},
      totalSec: minutes * 60, remainingSec: minutes * 60, result: null,
    });
  },

  answerQuestion: (questionId, answer) => {
    set(s => ({ answers: { ...s.answers, [questionId]: answer } }));
  },

  tick: () => {
    const { remainingSec, active } = get();
    if (!active) return;
    if (remainingSec <= 1) {
      void get().finishExam();
    } else {
      set({ remainingSec: remainingSec - 1 });
    }
  },

  finishExam: async () => {
    const { questions, answers, subject, remainingSec, active } = get();
    if (!active) return;
    const result = scoreExam(questions, answers);
    const now = Date.now();
    const attempts: Attempt[] = result.items.map(it => ({
      id: `${it.questionId}-exam-${now}-${Math.random().toString(36).slice(2, 6)}`,
      questionId: it.questionId,
      date: localToday(),
      userAnswer: it.userAnswer === '（未作答）' ? '' : it.userAnswer,
      isCorrect: it.isCorrect,
      timeSpent: 0,
      errorTags: [],
    }));
    try {
      await db.attempts.bulkPut(attempts);
      if (subject) await syncSubjectProgress(subject);
    } catch (e) {
      console.error('exam 记录失败:', e);
    }
    void remainingSec;
    set({ active: false, result, remainingSec: 0 });
  },

  exitExam: () => {
    set({ active: false, result: null, questions: [], answers: {}, totalSec: 0, remainingSec: 0 });
  },
}));