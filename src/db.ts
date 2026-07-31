import Dexie, { type Table } from 'dexie';
import type { Question, Attempt, ReviewCard } from './types';

export class StudyPetDB extends Dexie {
  questions!: Table<Question, string>;
  attempts!: Table<Attempt, string>;
  reviewCards!: Table<ReviewCard, string>;

  constructor() {
    super('StudyPetQuiz');
    this.version(1).stores({
      questions: 'id, subject, chapter, type, difficulty, tags',
      attempts: 'id, questionId, date, isCorrect',
      reviewCards: 'id, questionId, due, subject, state',
    });
    this.version(2).stores({
      questions: 'id, subject, chapter, type, difficulty, tags, [subject+chapter]',
      attempts: 'id, questionId, date, isCorrect',
      reviewCards: 'id, questionId, due, subject, state',
    });
  }

  // ---- 题库查询 ----

  async getQuestionsBySubject(subject: string, limit = 50) {
    return this.questions.where('subject').equals(subject).limit(limit).toArray();
  }

  async getQuestionsByChapter(subject: string, chapter: string) {
    return this.questions
      .where('[subject+chapter]')
      .equals([subject, chapter])
      .toArray();
  }

  async getDueReviews(limit = 500) {
    // Include cards due today or past due (24-hour window)
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const endOfToday = todayEnd.toISOString();
    return this.reviewCards
      .where('due')
      .belowOrEqual(endOfToday)
      .limit(limit)
      .toArray();
  }

  async getReviewCount() {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    return this.reviewCards.where('due').belowOrEqual(todayEnd.toISOString()).count();
  }

  // ---- 数据清理（防止 IndexedDB 无限膨胀） ----

  /** 清理旧答题记录（默认保留 90 天），并限制 AI 生成题数量（保留最新 N 道） */
  async cleanupOldData(keepDays = 90, maxAiQuestions = 500) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    await this.attempts.where('date').below(cutoffStr).delete();

    const aiQuestions = (await this.questions.toArray()).filter(q => q.source === 'ai');
    if (aiQuestions.length > maxAiQuestions) {
      const toDelete = aiQuestions
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .slice(0, aiQuestions.length - maxAiQuestions)
        .map(q => q.id);
      await this.questions.bulkDelete(toDelete);
    }
  }

  // ---- 统计查询 ----

  async getSubjectStats(subject: string) {
    const questions = await this.questions.where('subject').equals(subject).toArray();
    const questionIds = questions.map(q => q.id);
    const attempts = await this.attempts
      .where('questionId')
      .anyOf(questionIds)
      .toArray();

    const total = attempts.length;
    const correct = attempts.filter(a => a.isCorrect).length;
    const byChapter: Record<string, { total: number; correct: number }> = {};

    for (const a of attempts) {
      const q = questions.find(q => q.id === a.questionId);
      const ch = q?.chapter || '未知';
      if (!byChapter[ch]) byChapter[ch] = { total: 0, correct: 0 };
      byChapter[ch].total++;
      if (a.isCorrect) byChapter[ch].correct++;
    }

    return { total, correct, rate: total > 0 ? correct / total : 0, byChapter };
  }

  async getAllStats(): Promise<Record<string, Awaited<ReturnType<typeof this.getSubjectStats>>>> {
    const subjects = ['electronics', 'math', 'english', 'politics'] as const;
    const results: Record<string, any> = {};
    for (const s of subjects) {
      results[s] = await this.getSubjectStats(s);
    }
    return results;
  }
}

export const db = new StudyPetDB();
