export type Period = 'morning' | 'afternoon' | 'evening';
export type CoachMode = 'auto' | 'preview' | 'suggest';
export type TaskSource = 'manual' | 'wechat' | 'schedule' | 'ocr' | 'coach';

export interface Task {
  id: string; title: string; period: Period; time: string; duration: number;
  tags: string[]; completed: boolean; source: TaskSource; deadline?: string; pomodoroCount: number;
  date?: string; // YYYY-MM-DD，支持多日规划
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
  plan?: { time: string; title: string; tag?: string; source?: TaskSource }[];
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
}

/** 专升本科目进度 */
export interface SubjectProgress {
  lastStudyDate: string;        // YYYY-MM-DD，最近一次复习日期
  totalMinutes: number;          // 累计复习分钟数
  completedChapters: string[];   // 已完成的章节名列表
  currentChapter: string;        // 当前正在攻克的章节
  notes: string;                 // 自由备注（薄弱点/重点等）
}

/** 4个专升本考试科目 */
export type SubjectKey = 'politics' | 'english' | 'math' | 'electronics';

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

export type AppView = 'tasks' | 'achievements' | 'schedule' | 'tracking' | 'screentime' | 'important' | 'analytics';