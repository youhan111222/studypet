import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task, Pet, Achievement, ChatMessage, CoachMode, WeekStats, ScheduleItem, ActivityLog, AppView, ImportantItem, SubjectProgress, SubjectKey, ExamRecord } from '../types';
// 用户真实专科课表（建筑工程相关），非假数据
import { scheduleData } from './scheduleData';

// ====== 科目推断工具函数 ======
function inferSubjectFromTitle(title: string): SubjectKey | null {
  const t = title.toLowerCase();
  const keywords: Record<SubjectKey, string[]> = {
    english: ['英语', '英文', '单词', '阅读', '语法', '作文', '翻译', '听力'],
    math: ['高数', '数学', '微积分', '线代', '线性代数', '概率', '方程', '函数', '极限', '导数', '积分'],
    politics: ['政治', '马原', '毛概', '思修', '近代史', '时政', '唯物', '辩证法'],
    electronics: ['电子', '电路', '模电', '数电', '信号', '单片机', '通信', '三极管', '放大器', '嵌入式'],
  };
  for (const [key, kw] of Object.entries(keywords)) {
    if (kw.some(word => t.includes(word.toLowerCase()))) {
      return key as SubjectKey;
    }
  }
  return null;
}

interface Store {
  tasks: Task[]; pet: Pet; achievements: Achievement[]; messages: ChatMessage[];
  coachMode: CoachMode; weekStats: WeekStats; streak: number; activeView: AppView;
  coachOpen: boolean; addTaskOpen: boolean; schedule: ScheduleItem[]; activityLogs: ActivityLog[]; autoPlan: boolean;
  importantItems: ImportantItem[];
  subjectProgress: Record<SubjectKey, SubjectProgress>;
  toggleTask: (id: string) => void; addTask: (task: Task) => void; deleteTask: (id: string) => void;
  setCoachMode: (mode: CoachMode) => void; addMessage: (msg: ChatMessage) => void;
  toggleCoach: () => void; setView: (view: AppView) => void; toggleAddTask: () => void;
  applyPlan: (plan: ChatMessage['plan']) => void; addScheduleItem: (item: ScheduleItem) => void; updateScheduleItem: (id: string, updates: Partial<Pick<ScheduleItem, 'timeStart' | 'timeEnd' | 'location'>>) => void;
  importSchedule: (items: ScheduleItem[]) => void; clearSchedule: () => void;
  addLogs: (logs: ActivityLog[]) => void; toggleAutoPlan: () => void;
  syncActivityLogs: (logs: ActivityLog[]) => void;
  addImportant: (item: ImportantItem) => void; toggleImportant: (id: string) => void; deleteImportant: (id: string) => void;
  updateSubjectProgress: (subject: SubjectKey, updates: Partial<SubjectProgress>) => void;
  examRecords: ExamRecord[];
  addExamRecord: (record: ExamRecord) => void;
  deleteExamRecord: (id: string) => void;
  // Study Timer
  activeTimerSubject: SubjectKey | null;
  timerStartTime: number | null;
  timerAccumulatedSeconds: number;
  startStudyTimer: (subject: SubjectKey) => void;
  pauseStudyTimer: () => void;
  stopStudyTimer: () => void;
}

const defaultTasks: Task[] = [];

const defaultPet: Pet = { name: '学习宠物', level: 1, exp: 0, expToNext: 100, hearts: 0, mood: 'normal', coins: 0 };

// ====== 成就策略模式 —— 每个成就自带 evaluate 函数 ======
// 新增成就只需添加一个对象，无需修改 toggleTask 中的任何逻辑代码
interface AchievementDef {
  id: string; icon: string; title: string; desc: string; total: number;
  /** 完成任务时调用，返回新的 progress 值 */
  onTaskComplete?: (ctx: { task: Task; state: Store; today: string }) => number;
  /** 状态变化时调用（如 streak、pet.level 更新后），返回 progress */
  onStateTick?: (ctx: { state: Store; streak: number }) => number;
}

export const ACHIEVEMENT_DEFS: Record<string, AchievementDef> = {
  a1: { id: 'a1', icon: '🔥', title: '初露锋芒', desc: '连续3天完成任务', total: 3,
    onStateTick: ({ streak }) => streak },
  a2: { id: 'a2', icon: '⚡', title: '深度专注', desc: '单次专注3小时', total: 3,
    onTaskComplete: ({ task }) => task.duration >= 180 ? 1 : 0 },
  a3: { id: 'a3', icon: '🌅', title: '早起鸟儿', desc: '7点前开始学习', total: 1,
    onTaskComplete: () => {
      const hour = new Date().getHours();
      return hour < 7 ? 1 : 0;
    }},
  a4: { id: 'a4', icon: '🏆', title: '全勤月', desc: '本月每天都有学习', total: 30,
    onStateTick: ({ state, streak }) => {
      const month = new Date().toISOString().slice(0, 7);
      const studyDaysThisMonth = new Set(
        state.activityLogs.filter(l => l.date.startsWith(month) && l.category === 'study').map(l => l.date)
      );
      return Math.min(30, studyDaysThisMonth.size);
    }},
  a5: { id: 'a5', icon: '📚', title: '学海无涯', desc: '累计专注100小时', total: 100,
    onTaskComplete: ({ task, state }) => {
      const currentHours = state.achievements.find(a => a.id === 'a5')?.progress || 0;
      return currentHours + task.duration / 60;
    }},
  a6: { id: 'a6', icon: '💪', title: '永不言弃', desc: '连续30天打卡', total: 30,
    onStateTick: ({ streak }) => streak },
  a7: { id: 'a7', icon: '🎯', title: 'DDL杀手', desc: '提前3天完成DDL', total: 3,
    onTaskComplete: ({ task, state }) => {
      if (!task.deadline) return state.achievements.find(a => a.id === 'a7')?.progress || 0;
      const current = state.achievements.find(a => a.id === 'a7')?.progress || 0;
      // 支持两种 DDL 格式：日期字符串 "2026-06-01" 或相对中文 "3天后"
      const dateMatch = task.deadline.match(/(\d+)\s*天/);
      if (dateMatch) {
        return current + (parseInt(dateMatch[1]) >= 3 ? 1 : 0);
      }
      const deadlineDate = new Date(task.deadline);
      if (!isNaN(deadlineDate.getTime())) {
        const daysEarly = Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000);
        return current + (daysEarly >= 3 ? 1 : 0);
      }
      return current;
    }},
  a8: { id: 'a8', icon: '🌟', title: '满级大佬', desc: '宠物达到Lv.50', total: 50,
    onStateTick: ({ state }) => state.pet.level },
};

const defaultAchievements: Achievement[] = Object.values(ACHIEVEMENT_DEFS).map(d => ({
  id: d.id, icon: d.icon, title: d.title, desc: d.desc,
  unlocked: false, progress: 0, total: d.total,
}));

const defaultSchedule: ScheduleItem[] = scheduleData;

const defaultLogs: ActivityLog[] = []; // 初始为空，由 tracker 填充

const defaultMessages: ChatMessage[] = [];

const defaultImportant: ImportantItem[] = [];

const defaultSubjectProgress: Record<SubjectKey, SubjectProgress> = {
  english: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '' },
  math: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '' },
  politics: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '' },
  electronics: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '' },
};

const defaultExamRecords: ExamRecord[] = [];

// ====== 数据保护：sessionStorage 备份 key ======
const SESSION_BACKUP_KEY = 'studypet-data-session-fallback';

function sessionBackup(data: string) {
  try { sessionStorage.setItem(SESSION_BACKUP_KEY, data); } catch { /* 静默 */ }
}
function sessionRestore(): string | null {
  try { return sessionStorage.getItem(SESSION_BACKUP_KEY); } catch { return null; }
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      tasks: defaultTasks,
      pet: defaultPet,
      achievements: defaultAchievements,
      messages: defaultMessages,
      coachMode: 'preview' as CoachMode,
      weekStats: { focusHours: 0, tasksCompleted: 0, pomodoroCount: 0, tasksSkipped: 0 },
      streak: 0,
      activeView: 'tasks' as AppView,
      coachOpen: false,
      addTaskOpen: false,
      schedule: defaultSchedule,
      activityLogs: defaultLogs,
      autoPlan: true,
      importantItems: defaultImportant,
      subjectProgress: defaultSubjectProgress,
      examRecords: defaultExamRecords,
      activeTimerSubject: null,
      timerStartTime: null,
      timerAccumulatedSeconds: 0,

      toggleTask: (id) => set(state => {
        const tasks = state.tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
        const task = tasks.find(t => t.id === id);
        
        const updates: Partial<Store> = { tasks };
        const today = new Date().toISOString().slice(0, 10);
        
        if (task?.completed) {
          // 1. 宠物经验与金币
          let pet = { ...state.pet };
          pet.exp += 50; pet.coins += 10;
          if (pet.exp >= pet.expToNext) { 
            pet.exp -= pet.expToNext; 
            pet.level += 1; 
            pet.expToNext = Math.floor(pet.expToNext * 1.2); 
          }
          pet.mood = 'happy';
          updates.pet = pet;
          
          // 2. 周统计：今日完成任务数 +1
          const weekStats = { ...state.weekStats };
          weekStats.tasksCompleted += 1;
          updates.weekStats = weekStats;
          
          // 3. 科目进度：从任务标题推断科目，更新学习时长
          const subject = inferSubjectFromTitle(task.title);
          if (subject) {
            const subjectProgress = { ...state.subjectProgress };
            const current = subjectProgress[subject];
            subjectProgress[subject] = {
              ...current,
              lastStudyDate: today,
              totalMinutes: current.totalMinutes + task.duration,
              completedChapters: current.completedChapters,
            };
            updates.subjectProgress = subjectProgress;
          }
          
          // 4. 成就进度更新（策略模式：每个成就自带 evaluate 函数）
          const achievements = state.achievements.map(ach => {
            const def = ACHIEVEMENT_DEFS[ach.id];
            if (!def || !def.onTaskComplete) return ach;
            const progress = def.onTaskComplete({ task: task!, state, today });
            return { ...ach, progress, unlocked: progress >= ach.total };
          });
          updates.achievements = achievements;
        }
        
        // 5. 连胜计算（基于日期维度全量重算，每天最多+1）
        // 收集所有完成任务的日期集合
        const completedDates = new Set<string>();
        tasks.forEach(t => {
          if (t.completed) {
            // 用任务自身的 date 字段，如果没有则用今天的日期
            completedDates.add(t.date || today);
          }
        });
        // 从今天往回数连续有完成的天数
        let streak = 0;
        const now = new Date();
        for (let i = 0; i < 365; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          if (completedDates.has(dateStr)) {
            streak++;
          } else {
            break;
          }
        }
        updates.streak = streak;
        
        // 6. 更新基于全局状态的成就（如 streak、level）
        const baseAchievements = updates.achievements || state.achievements;
        const finalAchievements = baseAchievements.map(ach => {
          const def = ACHIEVEMENT_DEFS[ach.id];
          if (!def || !def.onStateTick) return ach;
          const progress = def.onStateTick({ state: { ...state, ...updates }, streak });
          return { ...ach, progress, unlocked: progress >= ach.total };
        });
        updates.achievements = finalAchievements;
        
        return updates;
      }),
      addTask: (task) => set(state => ({
        tasks: [...state.tasks, { ...task, date: task.date || new Date().toISOString().slice(0, 10) }]
      })),
      deleteTask: (id) => set(state => ({ tasks: state.tasks.filter(t => t.id !== id) })),
      setCoachMode: (mode) => set({ coachMode: mode }),
      addMessage: (msg) => set(state => ({ messages: [...state.messages, msg] })),
      toggleCoach: () => set(state => ({ coachOpen: !state.coachOpen })),
      setView: (view) => set({ activeView: view }),
      toggleAddTask: () => set(state => ({ addTaskOpen: !state.addTaskOpen })),
      applyPlan: (plan) => {
        if (!plan) return;
        const getPeriod = (time: string): 'morning' | 'afternoon' | 'evening' => {
          const startHour = parseInt(time?.split(':')?.[0]) || 8;
          if (startHour < 12) return 'morning';
          if (startHour < 18) return 'afternoon';
          return 'evening';
        };
        const newTasks: Task[] = plan.map((p, i) => ({
          id: `plan-${Date.now()}-${i}`, title: p.title, period: getPeriod(p.time),
          time: p.time, duration: 60, tags: p.tag ? [p.tag] : [],
          completed: false, source: p.source || 'manual', pomodoroCount: 0,
          date: (p as any).date || new Date().toISOString().slice(0, 10),
        }));
        set(state => ({ tasks: [...state.tasks.filter(t => !t.id.startsWith('plan-')), ...newTasks] }));
      },
      addScheduleItem: (item) => set(state => ({ schedule: [...state.schedule, item] })),
      updateScheduleItem: (id, updates) => set(state => ({
        schedule: state.schedule.map(s => s.id === id ? { ...s, ...updates } : s),
      })),
      importSchedule: (items) => set({ schedule: items }),
      clearSchedule: () => set({ schedule: defaultSchedule }),
      addLogs: (logs) => set(state => ({ activityLogs: [...state.activityLogs, ...logs] })),
  syncActivityLogs: (logs) => set({ activityLogs: logs }),
      toggleAutoPlan: () => set(state => ({ autoPlan: !state.autoPlan })),
      addImportant: (item) => set(state => ({ importantItems: [...state.importantItems, item] })),
      toggleImportant: (id) => set(state => ({
        importantItems: state.importantItems.map(i => i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? new Date().toISOString().slice(0, 10) : undefined } : i),
      })),
      deleteImportant: (id) => set(state => ({ importantItems: state.importantItems.filter(i => i.id !== id) })),
      updateSubjectProgress: (subject, updates) => set(state => ({
        subjectProgress: {
          ...state.subjectProgress,
          [subject]: { ...state.subjectProgress[subject], ...updates },
        },
      })),
      addExamRecord: (record) => set(state => ({
        examRecords: [...state.examRecords, record],
      })),
      deleteExamRecord: (id) => set(state => ({
        examRecords: state.examRecords.filter(r => r.id !== id),
      })),
      // ====== 学习计时器 ======
      startStudyTimer: (subject) => {
        const state = useStore.getState();
        const now = Date.now();
        // 如果已有其他科目的活跃计时，先停止它
        if (state.activeTimerSubject && state.activeTimerSubject !== subject) {
          const elapsed = state.timerAccumulatedSeconds + (state.timerStartTime ? (now - state.timerStartTime) / 1000 : 0);
          const totalMin = Math.round(elapsed / 60);
          const today = new Date().toISOString().slice(0, 10);
          const prevSubject = state.activeTimerSubject;
          set({
            subjectProgress: {
              ...state.subjectProgress,
              [prevSubject]: {
                ...state.subjectProgress[prevSubject],
                totalMinutes: state.subjectProgress[prevSubject].totalMinutes + totalMin,
                lastStudyDate: today,
              },
            },
            activeTimerSubject: subject,
            timerStartTime: now,
            timerAccumulatedSeconds: 0,
          });
          return;
        }
        // 如果正在计时同一个科目 -> 恢复
        if (state.activeTimerSubject === subject && state.timerStartTime === null) {
          set({ timerStartTime: now });
          return;
        }
        // 全新计时
        set({ activeTimerSubject: subject, timerStartTime: now, timerAccumulatedSeconds: 0 });
      },
      pauseStudyTimer: () => {
        const state = useStore.getState();
        if (!state.activeTimerSubject || !state.timerStartTime) return;
        const elapsed = (Date.now() - state.timerStartTime) / 1000;
        set({
          timerStartTime: null,
          timerAccumulatedSeconds: state.timerAccumulatedSeconds + elapsed,
        });
      },
      stopStudyTimer: () => {
        const state = useStore.getState();
        if (!state.activeTimerSubject) return;
        const now = Date.now();
        const elapsed = state.timerAccumulatedSeconds + (state.timerStartTime ? (now - state.timerStartTime) / 1000 : 0);
        const totalMin = Math.round(elapsed / 60);
        const today = new Date().toISOString().slice(0, 10);
        const subject = state.activeTimerSubject;
        set({
          subjectProgress: {
            ...state.subjectProgress,
            [subject]: {
              ...state.subjectProgress[subject],
              totalMinutes: state.subjectProgress[subject].totalMinutes + totalMin,
              lastStudyDate: today,
            },
          },
          activeTimerSubject: null,
          timerStartTime: null,
          timerAccumulatedSeconds: 0,
        });
      },
    }),
    {
      name: 'studypet-data',
      version: 3,
      migrate: (persisted: any, version: number) => {
        // v2 → v3: reset schedule to use real course data
        if (version < 3) {
          persisted.state.schedule = scheduleData;
        }
        return persisted;
      },
      partialize: (state) => ({
        tasks: state.tasks,
        pet: state.pet,
        achievements: state.achievements,
        streak: state.streak,
        weekStats: state.weekStats,
        schedule: state.schedule,
        autoPlan: state.autoPlan,
        importantItems: state.importantItems,
        activityLogs: state.activityLogs,
        subjectProgress: state.subjectProgress,
        examRecords: state.examRecords,
        messages: state.messages.slice(-50),
      }),
      merge: (persisted, current) => {
        try {
          const p = persisted as Partial<Store>;
          return {
            ...current,
            tasks: p.tasks ?? current.tasks,
            pet: p.pet ?? current.pet,
            achievements: p.achievements ?? current.achievements,
            streak: p.streak ?? current.streak,
            weekStats: p.weekStats ?? current.weekStats,
            schedule: p.schedule ?? current.schedule,
            autoPlan: p.autoPlan ?? current.autoPlan,
            importantItems: p.importantItems ?? current.importantItems,
            activityLogs: p.activityLogs ?? current.activityLogs,
            subjectProgress: p.subjectProgress ?? current.subjectProgress,
            examRecords: p.examRecords ?? current.examRecords,
            messages: p.messages ?? current.messages,
          };
        } catch {
          // localStorage 数据损坏 → 尝试 sessionStorage 备份
          const fallback = sessionRestore();
          if (fallback) {
            try {
              const parsed = JSON.parse(fallback);
              const p = parsed?.state as Partial<Store> | undefined;
              if (p) {
                return {
                  ...current,
                  tasks: p.tasks ?? current.tasks,
                  pet: p.pet ?? current.pet,
                  achievements: p.achievements ?? current.achievements,
                  streak: p.streak ?? current.streak,
                  weekStats: p.weekStats ?? current.weekStats,
                  schedule: p.schedule ?? current.schedule,
                  autoPlan: p.autoPlan ?? current.autoPlan,
                  importantItems: p.importantItems ?? current.importantItems,
                  activityLogs: p.activityLogs ?? current.activityLogs,
                  subjectProgress: p.subjectProgress ?? current.subjectProgress,
                  examRecords: p.examRecords ?? current.examRecords,
                  messages: p.messages ?? current.messages,
                };
              }
            } catch { /* 连 session 备份也损坏，回退默认值 */ }
          }
          console.warn('[StudyPet] localStorage 数据损坏，已回退到默认值。');
          return current;
        }
      },
      onRehydrateStorage: () => {
        return (state, error) => {
          if (!error && state) {
            // 每次成功从 storage 恢复后，同步备份到 sessionStorage
            try {
              const raw = localStorage.getItem('studypet-data');
              if (raw) sessionBackup(raw);
            } catch { /* 静默 */ }
          }
        };
      },
    }
  )
);