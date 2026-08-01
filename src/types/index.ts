export type Period = 'morning' | 'afternoon' | 'evening';
export type TaskSource = 'manual' | 'wechat' | 'schedule' | 'ocr' | 'coach';

export interface Task {
  id: string; title: string; period: Period; time: string; duration: number;
  tags: string[]; completed: boolean; source: TaskSource; deadline?: string; pomodoroCount: number;
  date?: string; // YYYY-MM-DD，支持多日规划
  rewarded?: boolean; // 首次完成已发放奖励（取消勾选不回滚，避免重复奖励）
}
export interface Pet {
  name: string; level: number; exp: number; expToNext: number; hearts: number;
  mood: 'happy' | 'normal' | 'sad' | 'excited'; coins: number;
}
export interface Achievement {
  id: string; icon: string; title: string; desc: string; unlocked: boolean; progress: number; total: number;
}
export interface ChatMessage {
  id: string; role: 'coach' | 'user'; content: string;
  options?: string[];
  plan?: { time: string; title: string; tag?: string; source?: TaskSource; date?: string }[];
}

export interface ChatSession {
  id: string;          // YYYY-MM-DD
  date: string;        // YYYY-MM-DD
  label: string;       // "5月26日 周一"
  messages: ChatMessage[];
  summary?: string;    // AI 生成的一句话摘要
}
export interface WeekStats { focusHours: number; tasksCompleted: number; pomodoroCount: number; tasksSkipped: number; }
export interface ScheduleItem {
  id: string; name: string; day: number; timeStart: string; timeEnd: string;
  location: string; teacher: string; weeks: string;
}
export interface ActivityLog {
  id: string; appName: string; category: 'study' | 'entertainment' | 'social' | 'other';
  startTime: string; duration: number; date: string;
}
export interface ImportantItem {
  id: string; title: string; content: string; priority: 'high' | 'normal';
  createdAt: string; done: boolean; doneAt?: string;
  remindAt?: string; // HH:MM 格式，到点前1小时弹窗提醒
}

/** 专升本科目进度 */
export interface SubjectProgress {
  lastStudyDate: string;        // YYYY-MM-DD，最近一次复习日期
  totalMinutes: number;          // 累计复习分钟数
  completedChapters: string[];   // 已完成的章节名列表
  currentChapter: string;        // 当前正在攻克的章节
  notes: string;                 // 自由备注（薄弱点/重点等）
  chapterDetails: ChapterProgress[];  // 章节级详细掌握状态
}

/** 4个专升本考试科目 */
export type SubjectKey = 'politics' | 'english' | 'math' | 'electronics';

/** 知识点掌握等级 */
export type MasteryLevel = 'not_started' | 'learning' | 'review_needed' | 'mastered';

/** 章节级学习进度 */
export interface ChapterProgress {
  name: string;                    // 章节名
  mastery: MasteryLevel;           // 掌握等级
  lastReviewDate: string;          // YYYY-MM-DD，最近一次复习日期
  reviewCount: number;             // 复习次数
  nextReviewDate?: string;         // YYYY-MM-DD，下次计划复习日期
  notes?: string;                  // 薄弱点备注
}

/** 学习清单（执行清单 / 核查清单） */
export interface StudyChecklist {
  id: string;
  title: string;
  type: 'execute' | 'verify';      // 执行清单=怎么做，核查清单=做完后检查
  items: string[];                 // 清单条目
  doneIndexes?: number[];          // 已完成条目下标（勾选状态）
  chapterName?: string;            // 关联章节
  subject?: SubjectKey;
}

/** 每日刻意练习记录 */
export interface PracticeLog {
  id: string;
  date: string;
  subject: SubjectKey;
  chapter: string;
  checklistUsed: string;           // 使用的清单标题
  result: string;                  // 复盘记录
  nextAction: string;              // 下一步改进
}

/** 考试成绩记录 */
export interface ExamRecord {
  id: string;
  subject: SubjectKey;
  score: number;           // 总分或某部分得分
  totalScore: number;      // 满分
  examType: string;        // 章节测试/模拟卷/真题
  examDate: string;        // YYYY-MM-DD
  notes: string;           // 错题汇总/薄弱知识点
}

// ====== 题库 & 刷题 ======

export type QuestionType = 'single' | 'multiple' | 'truefalse' | 'fill' | 'short' | 'essay';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ErrorTag = '公式记错' | '概念混淆' | '计算失误' | '审题不清' | '词汇不认识' | '语法混淆' | '记忆遗漏' | '要点不全' | '逻辑误判';

export interface Question {
  id: string; subject: SubjectKey; chapter: string; type: QuestionType;
  stem: string; options?: string[]; answer: string; analysis: string;
  difficulty: Difficulty; tags: string[]; source: 'manual' | 'ai' | 'import'; createdAt: string;
  favorite?: boolean;  // 收藏/标记（对标 EXAM-MASTER 收藏功能）
}

export interface Attempt {
  id: string; questionId: string; date: string; userAnswer: string;
  isCorrect: boolean; timeSpent: number; errorTags: ErrorTag[];
}

export interface ReviewCard {
  id: string; questionId: string;
  stability: number; difficulty: number; elapsed_days: number; scheduled_days: number;
  reps: number; lapses: number; learning_steps?: number; state: 'New' | 'Learning' | 'Review' | 'Relearning';
  lastReview: string | null; due: string; subject: SubjectKey; chapter: string;
}