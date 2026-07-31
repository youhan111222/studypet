import { create } from 'zustand';
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';
import { db } from '../db';
import { useStore } from './useStore';
import type { Question, Attempt, ReviewCard, SubjectKey, ErrorTag, MasteryLevel } from '../types';

const scheduler = fsrs();

interface QuizStore {
  currentSubject: SubjectKey | null;
  currentChapter: string | null;
  questions: Question[];
  currentIndex: number;
  selectedAnswer: string;
  showResult: boolean;
  lastAttempt: Attempt | null;
  correctCount: number;
  wrongCount: number;
  questionStartTime: number;  // timestamp for timeSpent tracking

  loadQuestions: (subject: SubjectKey, chapter?: string, count?: number) => Promise<void>;
  loadDueReviews: () => Promise<void>;
  selectAnswer: (answer: string) => void;
  submitAnswer: (errorTags?: ErrorTag[], selfGrade?: boolean) => Promise<void>;
  nextQuestion: () => void;
  nextReviewQuestion: () => void;
  updateAttemptTags: (attemptId: string, tags: ErrorTag[]) => Promise<void>;

  reviewCards: ReviewCard[];
  reviewIndex: number;

  generateQuestion: (subject: SubjectKey, chapter: string, notes: string) => Promise<Question | null>;

  submitReviewRating: (rating: Grade) => Promise<void>;

  dueCount: number;
  refreshDueCount: () => Promise<void>;
}

function toReviewCard(fsrsCard: Card, question: Question): ReviewCard {
  return {
    id: `${question.id}-review`,
    questionId: question.id,
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    elapsed_days: fsrsCard.elapsed_days,
    scheduled_days: fsrsCard.scheduled_days,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    state: fsrsCard.state as unknown as ReviewCard['state'],
    lastReview: fsrsCard.last_review?.toISOString() || null,
    due: fsrsCard.due.toISOString(),
    subject: question.subject,
    chapter: question.chapter,
  };
}

function ratingFromCorrect(isCorrect: boolean, timeSpent: number): Grade {
  if (isCorrect && timeSpent < 30) return Rating.Easy as Grade;
  if (isCorrect) return Rating.Good as Grade;
  if (timeSpent > 120) return Rating.Again as Grade;
  return Rating.Hard as Grade;
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase();
}

function tfValue(s: string): string {
  const t = s.trim().toUpperCase();
  if (t === 'A' || t === 'T' || t === 'TRUE' || t === '对') return '对';
  if (t === 'B' || t === 'F' || t === 'FALSE' || t === '错') return '错';
  return s.trim();
}

/** 按题型判题：multiple 排序字母串；truefalse 对/错（兼容 A/B）；fill/short 规范化文本；essay 由用户自评 */
export function judgeAnswer(q: Question, selected: string): boolean {
  if (!selected) return false;
  if (q.type === 'multiple') {
    const a = selected.replace(/\s+/g, '').split('').sort().join('').toUpperCase();
    const b = (q.answer || '').replace(/\s+/g, '').split('').sort().join('').toUpperCase();
    return a.length > 0 && a === b;
  }
  if (q.type === 'truefalse') {
    return tfValue(selected) === tfValue(q.answer);
  }
  if (q.type === 'fill' || q.type === 'short') {
    return normalizeText(selected) === normalizeText(q.answer);
  }
  return selected.trim() === q.answer.trim();
}

function setQuestionStart() {
  useQuizStore.setState({ questionStartTime: Date.now(), selectedAnswer: '', showResult: false, lastAttempt: null });
}

export const useQuizStore = create<QuizStore>((set, get) => ({
  currentSubject: null,
  currentChapter: null,
  questions: [],
  currentIndex: 0,
  selectedAnswer: '',
  showResult: false,
  lastAttempt: null,
  correctCount: 0,
  wrongCount: 0,
  questionStartTime: Date.now(),
  reviewCards: [],
  reviewIndex: 0,
  dueCount: 0,

  loadQuestions: async (subject, chapter?, count = 20) => {
    let qs: Question[];
    if (chapter) {
      qs = await db.getQuestionsByChapter(subject, chapter);
    } else {
      qs = await db.getQuestionsBySubject(subject, count);
    }
    qs = qs.sort(() => Math.random() - 0.5).slice(0, count);
    set({
      currentSubject: subject, currentChapter: chapter || null, questions: qs,
      currentIndex: 0, showResult: false, selectedAnswer: '',
      correctCount: 0, wrongCount: 0, questionStartTime: Date.now(),
    });
  },

  loadDueReviews: async () => {
    const cards = await db.getDueReviews();
    set({ reviewCards: cards, reviewIndex: 0, showResult: false, selectedAnswer: '' });
    if (cards.length > 0) {
      const qIds = cards.map((c: ReviewCard) => c.questionId);
      const qs = await db.questions.bulkGet(qIds);
      // Use Map to preserve alignment even if some IDs are missing
      const qMap = new Map<string, Question>();
      qs.forEach((q, i) => { if (q) qMap.set(qIds[i], q); });
      const aligned = qIds.map(id => qMap.get(id)).filter(Boolean) as Question[];
      set({ questions: aligned, currentIndex: 0 });
    }
  },

  selectAnswer: (answer) => set({ selectedAnswer: answer }),

  submitAnswer: async (errorTags?: ErrorTag[], selfGrade?: boolean) => {
    const { questions, currentIndex, selectedAnswer, questionStartTime } = get();
    if (questions.length === 0) return;
    const q = questions[currentIndex];
    // essay 不自评：以用户自评结果为准；其余按题型判定
    const isCorrect = q.type === 'essay' ? selfGrade === true : judgeAnswer(q, selectedAnswer);
    const now = new Date().toISOString();
    const elapsed = Math.round((Date.now() - questionStartTime) / 1000);

    const attempt: Attempt = {
      id: `${q.id}-${Date.now()}`,
      questionId: q.id,
      date: now.slice(0, 10),
      userAnswer: selectedAnswer,
      isCorrect,
      timeSpent: elapsed,
      errorTags: isCorrect ? [] : (errorTags || []),
    };

    await db.attempts.put(attempt);

    // FSRS scheduling with actual elapsed time
    const existing = await db.reviewCards.where('questionId').equals(q.id).first();
    let card: Card;

    if (existing) {
      card = {
        due: new Date(existing.due),
        stability: existing.stability,
        difficulty: existing.difficulty,
        elapsed_days: existing.elapsed_days,
        scheduled_days: existing.scheduled_days,
        reps: existing.reps,
        lapses: existing.lapses,
        state: existing.state as unknown as Card['state'],
        last_review: existing.lastReview ? new Date(existing.lastReview) : null,
      } as Card;
      card = scheduler.next(card, new Date(), ratingFromCorrect(isCorrect, elapsed)).card;
    } else {
      card = createEmptyCard();
      card = scheduler.next(card, new Date(), ratingFromCorrect(isCorrect, elapsed)).card;
    }

    const reviewCard = toReviewCard(card, q);
    await db.reviewCards.put(reviewCard);

    set(s => ({
      showResult: true,
      lastAttempt: attempt,
      correctCount: s.correctCount + (isCorrect ? 1 : 0),
      wrongCount: s.wrongCount + (isCorrect ? 0 : 1),
    }));
    // Refresh due count after scheduling
    const count = await db.getReviewCount();
    set({ dueCount: count });
  },

  nextQuestion: () => {
    const { questions, currentIndex } = get();
    if (currentIndex < questions.length - 1) {
      set({ currentIndex: currentIndex + 1 });
      setQuestionStart();
    }
  },

  nextReviewQuestion: () => {
    const { reviewCards, reviewIndex } = get();
    if (reviewIndex < reviewCards.length - 1) {
      set({ reviewIndex: reviewIndex + 1 });
    }
  },

  updateAttemptTags: async (attemptId: string, tags: ErrorTag[]) => {
    await db.attempts.update(attemptId, { errorTags: tags });
  },

  generateQuestion: async (subject, chapter, notes) => {
    try {
      const res = await fetch('/deepseek/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, chapter, notes }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const q: Question = {
        id: `ai-${Date.now()}`, subject, chapter, type: 'single',
        stem: data.stem, options: data.options, answer: data.answer,
        analysis: data.analysis || '', difficulty: 'medium',
        tags: data.tags || [], source: 'ai',
        createdAt: new Date().toISOString().slice(0, 10),
      };
      await db.questions.put(q);
      return q;
    } catch { return null; }
  },

  submitReviewRating: async (rating: Grade) => {
    const { reviewCards, reviewIndex, questions } = get();
    if (reviewIndex >= reviewCards.length) return;
    const card = reviewCards[reviewIndex];
    const q = questions.find(q => q.id === card.questionId);
    if (!q) return;

    const existing = await db.reviewCards.where('questionId').equals(q.id).first();
    let fsrsCard: Card;
    if (existing) {
      fsrsCard = {
        due: new Date(existing.due), stability: existing.stability,
        difficulty: existing.difficulty, elapsed_days: existing.elapsed_days,
        scheduled_days: existing.scheduled_days, reps: existing.reps,
        lapses: existing.lapses,
        state: existing.state as unknown as Card['state'],
        last_review: existing.lastReview ? new Date(existing.lastReview) : null,
      } as Card;
    } else {
      fsrsCard = createEmptyCard();
    }
    const result = scheduler.next(fsrsCard, new Date(), rating);
    const updated = toReviewCard(result.card, q);
    await db.reviewCards.put(updated);

    const isCorrect = rating === Rating.Good || rating === Rating.Easy;
    const attempt: Attempt = {
      id: `${q.id}-review-${Date.now()}`,
      questionId: q.id,
      date: new Date().toISOString().slice(0, 10),
      userAnswer: isCorrect ? q.answer : '(复习)',
      isCorrect,
      timeSpent: 0,
      errorTags: rating === Rating.Again ? ['记忆遗漏'] : [],
    };
    await db.attempts.put(attempt);
    // Refresh due count after review rating
    const newCount = await db.getReviewCount();
    set({ dueCount: newCount });
  },

  refreshDueCount: async () => {
    const count = await db.getReviewCount();
    set({ dueCount: count });
  },
}));

// ====== 记忆系统：答题数据 → Dashboard 进度 ======
// 做完一轮题后调用，自动同步章节掌握度

function accuracyToMastery(rate: number, attempts: number): MasteryLevel {
  if (attempts === 0) return 'not_started';
  if (rate >= 0.85) return 'mastered';
  if (rate >= 0.5) return 'review_needed';
  return 'learning';
}

export async function syncSubjectProgress(subject: SubjectKey) {
  const storeState = useStore.getState();
  const progress = storeState.subjectProgress[subject];
  if (!progress) return;

  // 从 Dexie 按章节统计正确率
  const questions = await db.questions.where('subject').equals(subject).toArray();
  if (questions.length === 0) return;

  const questionIds = questions.map(q => q.id);
  const attempts = await db.attempts.where('questionId').anyOf(questionIds).toArray();

  // 按章节聚合
  const chapterStats: Record<string, { correct: number; total: number }> = {};
  for (const a of attempts) {
    const q = questions.find(q => q.id === a.questionId);
    const ch = q?.chapter || '未知';
    if (!chapterStats[ch]) chapterStats[ch] = { correct: 0, total: 0 };
    chapterStats[ch].total++;
    if (a.isCorrect) chapterStats[ch].correct++;
  }

  // 更新 Zustand store
  const today = new Date().toISOString().slice(0, 10);
  const totalMinutes = progress.totalMinutes + Math.round(attempts.length * 1.5); // estimate 1.5 min per question

  const existingChapters = new Map((progress.chapterDetails || []).map(c => [c.name, c]));

  for (const [ch, stats] of Object.entries(chapterStats)) {
    const rate = stats.correct / stats.total;
    const mastery = accuracyToMastery(rate, stats.total);
    const existing = existingChapters.get(ch);

    useStore.getState().updateChapterMastery(subject, ch, mastery);

    // Also update reviewCount on the chapter
    if (existing) {
      const chapterDetail = progress.chapterDetails?.find(c => c.name === ch);
      if (chapterDetail) {
        // updateChapterMastery handles the update, but we also want to bump reviewDate
        storeState.updateSubjectProgress(subject, {
          lastStudyDate: today,
          totalMinutes,
        });
      }
    }
  }

  // Mark chapters not yet quizzed but in syllabus as 'not_started'
  for (const q of questions) {
    if (!chapterStats[q.chapter] && !existingChapters.has(q.chapter)) {
      useStore.getState().updateChapterMastery(subject, q.chapter, 'not_started');
    }
  }

  storeState.updateSubjectProgress(subject, {
    lastStudyDate: today,
    totalMinutes,
  });
}
