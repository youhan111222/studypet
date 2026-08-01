import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { inferSubjectFromTitle, localDateStr, localToday, parseDate } from '../utils';
import type { Task, Pet, Achievement, ChatMessage, ChatSession, WeekStats, ScheduleItem, ActivityLog, ImportantItem, SubjectProgress, SubjectKey, ExamRecord, MasteryLevel, StudyChecklist, PracticeLog } from '../types';
// 课表数据来自权威课表（XLS 解析），不再内置 seed

interface Store {
  tasks: Task[]; pet: Pet; achievements: Achievement[]; sessions: ChatSession[]; activeSessionDate: string;
  weekStats: WeekStats; streak: number;
  studyDays: Record<string, number>;
  coachOpen: boolean; addTaskOpen: boolean; schedule: ScheduleItem[]; activityLogs: ActivityLog[]; autoPlan: boolean;
  importantItems: ImportantItem[];
  subjectProgress: Record<SubjectKey, SubjectProgress>;
  studyChecklists: StudyChecklist[];
  practiceLogs: PracticeLog[];
  toggleTask: (id: string) => void; addTask: (task: Task) => void; deleteTask: (id: string) => void;
  addMessage: (date: string, msg: ChatMessage) => void; updateSessionSummary: (date: string, summary: string) => void;
  toggleCoach: () => void; toggleAddTask: () => void;
  applyPlan: (plan: ChatMessage['plan']) => void; addScheduleItem: (item: ScheduleItem) => void; updateScheduleItem: (id: string, updates: Partial<Pick<ScheduleItem, 'timeStart' | 'timeEnd' | 'location'>>) => void;
  importSchedule: (items: ScheduleItem[]) => void; clearSchedule: () => void;
  toggleAutoPlan: () => void;
  syncActivityLogs: (logs: ActivityLog[]) => void;
  /** 记录某天的学习时长（分钟），供 streak 打卡判定（≥30 分钟算打卡） */
  recordStudyMinutes: (date: string, minutes: number) => void;
  /** 计时器分钟数累加计入当日打卡（连胜判定）；tracker 当日累计走 recordStudyMinutes 的 max 语义 */
  addStudyMinutes: (date: string, minutes: number) => void;
  addImportant: (item: ImportantItem) => void; toggleImportant: (id: string) => void; deleteImportant: (id: string) => void;
  updateSubjectProgress: (subject: SubjectKey, updates: Partial<SubjectProgress>) => void;
  updateChapterMastery: (subject: SubjectKey, chapter: string, mastery: MasteryLevel, opts?: { countAsReview?: boolean }) => void;
  addStudyChecklist: (checklist: StudyChecklist) => void; toggleChecklistItem: (checklistId: string, itemIndex: number) => void; deleteStudyChecklist: (id: string) => void;
  addPracticeLog: (log: PracticeLog) => void;
  examRecords: ExamRecord[];
  addExamRecord: (record: ExamRecord) => void;
  deleteExamRecord: (id: string) => void;
  // Study Timer
  activeTimerSubject: SubjectKey | null;
  timerStartTime: number | null;
  timerAccumulatedSeconds: number;
  desiredRetention: number;
  setDesiredRetention: (r: number) => void;
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
    onTaskComplete: ({ task, state }) => {
      const current = state.achievements.find(a => a.id === 'a2')?.progress || 0;
      return current + (task.duration >= 180 ? 1 : 0);
    }},
  a3: { id: 'a3', icon: '🌅', title: '早起鸟儿', desc: '7点前开始学习', total: 1,
    onTaskComplete: ({ state }) => {
      const hour = new Date().getHours();
      const current = state.achievements.find(a => a.id === 'a3')?.progress || 0;
      return Math.max(current, hour < 7 ? 1 : 0);
    }},
  a4: { id: 'a4', icon: '🏆', title: '坚持一周', desc: '连续7天打卡', total: 7,
    onStateTick: ({ streak }) => streak },
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
      const dateMatch = task.deadline.match(/^(\d+)\s*天后$/);
      if (dateMatch) {
        return current + (parseInt(dateMatch[1]) >= 3 ? 1 : 0);
      }
      const m = task.deadline.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const deadlineDate = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(task.deadline);
      if (!isNaN(deadlineDate.getTime())) {
        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const daysEarly = Math.round((deadlineDate.getTime() - startOfToday.getTime()) / 86400000);
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

// ====== 成就重算（状态类成就：streak / pet.level 等）======
// toggleTask 与 stopStudyTimer 共用，保证学习会话结束后成就实时推进
function computeStateAchievements(state: Store, streak: number): Achievement[] {
  return state.achievements.map(ach => {
    const def = ACHIEVEMENT_DEFS[ach.id];
    if (!def || !def.onStateTick) return ach;
    const progress = def.onStateTick({ state, streak });
    return { ...ach, progress, unlocked: progress >= ach.total };
  });
}

// ====== 连胜计算（公共）======
// 某天算"打卡" = 该天有完成任务 **或** 该天学习时长 ≥ 30 分钟（studyDays）
// 从今天往回数连续打卡的天数，每天最多 +1
export function computeStreak(tasks: Task[], studyDays: Record<string, number>, today: string): number {
  const checkinDates = new Set<string>();
  tasks.forEach(t => {
    if (t.completed) checkinDates.add(t.date || today);
  });
  Object.entries(studyDays).forEach(([date, minutes]) => {
    if (minutes >= 30) checkinDates.add(date);
  });
  let streak = 0;
  const now = parseDate(today); // 以传入日期为锚点（可测试、确定性强）
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = localDateStr(d);
    if (checkinDates.has(dateStr)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

const defaultSchedule: ScheduleItem[] = [];

const defaultLogs: ActivityLog[] = []; // 初始为空，由 tracker 填充

const defaultImportant: ImportantItem[] = [];

const defaultSubjectProgress: Record<SubjectKey, SubjectProgress> = {
  english: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '', chapterDetails: [] },
  math: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '', chapterDetails: [] },
  politics: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '', chapterDetails: [] },
  electronics: { lastStudyDate: '', totalMinutes: 0, completedChapters: [], currentChapter: '', notes: '', chapterDetails: [] },
};

const defaultChecklists: StudyChecklist[] = [];
const defaultPracticeLogs: PracticeLog[] = [];

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
      sessions: [],
      activeSessionDate: localToday(),
      weekStats: { focusHours: 0, tasksCompleted: 0, pomodoroCount: 0, tasksSkipped: 0 },
      streak: 0,
      studyDays: {},
      coachOpen: false,
      addTaskOpen: false,
      schedule: defaultSchedule,
      activityLogs: defaultLogs,
      autoPlan: true,
      importantItems: defaultImportant,
      subjectProgress: defaultSubjectProgress,
      examRecords: defaultExamRecords,
      studyChecklists: defaultChecklists,
      practiceLogs: defaultPracticeLogs,
      activeTimerSubject: null,
      timerStartTime: null,
      timerAccumulatedSeconds: 0,
      desiredRetention: 0.9,

      toggleTask: (id) => set(state => {
        const today = localToday();
        // 勾选完成时把任务日期记为完成日（跨天补打卡才算今天，保证 streak 正确）
        // rewarded 标记首次完成即永久置 true：取消勾选不回滚，避免反复勾选重复奖励
        const wasRewarded = state.tasks.find(t => t.id === id)?.rewarded === true;
        const tasks = state.tasks.map(t => t.id === id ? {
          ...t,
          completed: !t.completed,
          rewarded: !t.completed ? true : t.rewarded,
          date: !t.completed ? today : t.date,
        } : t);
        const task = tasks.find(t => t.id === id);
        const shouldReward = task?.completed === true && !wasRewarded;

        const updates: Partial<Store> = { tasks };
        
        if (shouldReward) {
          // 1. 宠物经验、金币、爱心
          let pet = { ...state.pet };
          pet.exp += 50; pet.coins += 10;
          pet.hearts = Math.min(5, pet.hearts + 1);
          // 集满 5 颗爱心获得额外金币奖励
          if (pet.hearts === 5) {
            pet.coins += 20;
            pet.hearts = 0;
          }
          if (pet.exp >= pet.expToNext) {
            pet.exp -= pet.expToNext;
            pet.level += 1;
            // 线性经验曲线：Lv.50 累计约 6.6 万经验（每个任务 +50exp，约 1300 个任务）
            pet.expToNext = 100 + pet.level * 50;
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
        
        // 5. 连胜计算（基于日期维度全量重算，每天最多+1；完成任务 或 学习≥30分钟 都算打卡）
        const streak = computeStreak(tasks, state.studyDays, today);
        updates.streak = streak;
        
        // 6. 更新基于全局状态的成就（如 streak、level）
        updates.achievements = computeStateAchievements({ ...state, ...updates }, streak);
        
        return updates;
      }),
      addTask: (task) => set(state => ({
        tasks: [...state.tasks, { ...task, date: task.date || localToday() }]
      })),
      deleteTask: (id) => set(state => ({ tasks: state.tasks.filter(t => t.id !== id) })),
      addMessage: (date, msg) => set(state => {
        const sessions = [...state.sessions];
        const idx = sessions.findIndex(s => s.date === date);
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const d = new Date(date);
        const label = `${d.getMonth() + 1}月${d.getDate()}日 ${dayNames[d.getDay()]}`;
        if (idx >= 0) {
          sessions[idx] = { ...sessions[idx], messages: [...sessions[idx].messages, msg] };
        } else {
          sessions.push({ id: date, date, label, messages: [msg] });
        }
        // 保持最近 30 天
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffStr = localDateStr(cutoff);
        return { sessions: sessions.filter(s => s.date >= cutoffStr) };
      }),
      updateSessionSummary: (date, summary) => set(state => ({
        sessions: state.sessions.map(s => s.date === date ? { ...s, summary } : s)
      })),
      toggleCoach: () => set(state => {
        const today = localToday();
        return { coachOpen: !state.coachOpen, activeSessionDate: today };
      }),
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
          date: p.date || localToday(),
        }));
        set(state => ({ tasks: [...state.tasks.filter(t => !t.id.startsWith('plan-')), ...newTasks] }));
      },
      addScheduleItem: (item) => set(state => ({ schedule: [...state.schedule, item] })),
      updateScheduleItem: (id, updates) => set(state => ({
        schedule: state.schedule.map(s => s.id === id ? { ...s, ...updates } : s),
      })),
      importSchedule: (items) => set({ schedule: items }),
      clearSchedule: () => set({ schedule: defaultSchedule }),
      syncActivityLogs: (logs) => set(state => {
        const byId = new Map(state.activityLogs.map(l => [l.id, l]));
        for (const l of logs) byId.set(l.id, l);
        return { activityLogs: Array.from(byId.values()) };
      }),
      recordStudyMinutes: (date, minutes) => set(state => {
        // 保存最大值：/activity/stats 的 effectiveStudyMinutes 是当日累计值，不能累加
        if (minutes <= (state.studyDays[date] || 0)) return {};
        const studyDays = { ...state.studyDays, [date]: minutes };
        const updates: Partial<Store> = { studyDays };
        // 学习时长 ≥30 分钟的天也计入打卡，重算连胜 + 状态类成就
        const streak = computeStreak(state.tasks, studyDays, date);
        updates.streak = streak;
        updates.achievements = computeStateAchievements({ ...state, ...updates }, streak);
        return updates;
      }),
      addStudyMinutes: (date, minutes) => set(state => {
        // 计时器分钟累加计入当日打卡（连胜判定）；tracker 累计走上面的 max 语义，互不冲突
        if (!(minutes > 0)) return {};
        const studyDays = { ...state.studyDays, [date]: (state.studyDays[date] || 0) + minutes };
        const updates: Partial<Store> = { studyDays };
        const streak = computeStreak(state.tasks, studyDays, date);
        updates.streak = streak;
        updates.achievements = computeStateAchievements({ ...state, ...updates }, streak);
        return updates;
      }),
      toggleAutoPlan: () => set(state => ({ autoPlan: !state.autoPlan })),
      addImportant: (item) => set(state => ({ importantItems: [...state.importantItems, item] })),
      toggleImportant: (id) => set(state => ({
        importantItems: state.importantItems.map(i => i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? localToday() : undefined } : i),
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
      // ====== 知识体系：章节掌握 + 学习清单 + 刻意练习 ======
      updateChapterMastery: (subject, chapter, mastery, opts) => set(state => {
        const today = localToday();
        const countAsReview = opts?.countAsReview !== false;
        const details = [...state.subjectProgress[subject].chapterDetails];
        const idx = details.findIndex(c => c.name === chapter);
        const nextMap: Record<MasteryLevel, number> = { not_started: 1, learning: 2, review_needed: 1, mastered: 7 };
        const reviewFields = {
          lastReviewDate: today,
          reviewCount: (idx >= 0 ? details[idx].reviewCount : 0) + 1,
          nextReviewDate: localDateStr(new Date(Date.now() + (nextMap[mastery] || 3) * 86400000)),
        };
        if (idx >= 0) {
          // 被动同步（countAsReview=false）：只改掌握度，打开页面≠复习，不 bump 次数/顺延日期
          details[idx] = countAsReview ? { ...details[idx], mastery, ...reviewFields } : { ...details[idx], mastery };
        } else {
          details.push(countAsReview
            ? { name: chapter, mastery, ...reviewFields }
            : { name: chapter, mastery, lastReviewDate: today, reviewCount: 0, nextReviewDate: undefined });
        }
        return {
          subjectProgress: { ...state.subjectProgress, [subject]: { ...state.subjectProgress[subject], chapterDetails: details, lastStudyDate: today } },
        };
      }),
      addStudyChecklist: (checklist) => set(state => ({ studyChecklists: [...state.studyChecklists, checklist] })),
      toggleChecklistItem: (checklistId, itemIndex) => set(state => ({
        studyChecklists: state.studyChecklists.map(c =>
          c.id === checklistId ? {
            ...c,
            doneIndexes: c.doneIndexes?.includes(itemIndex)
              ? c.doneIndexes.filter(i => i !== itemIndex)
              : [...(c.doneIndexes || []), itemIndex],
          } : c
        ),
      })),
      deleteStudyChecklist: (id) => set(state => ({ studyChecklists: state.studyChecklists.filter(c => c.id !== id) })),
      addPracticeLog: (log) => set(state => ({ practiceLogs: [...state.practiceLogs, log] })),
      // ====== 学习计时器 ======
      setDesiredRetention: (r) => set({ desiredRetention: r }),

      startStudyTimer: (subject) => {
        const state = useStore.getState();
        const now = Date.now();
        // 同一科目计时中，不做任何事（防止重置）
        if (state.activeTimerSubject === subject && state.timerStartTime !== null) return;
        // 如果已有其他科目的活跃计时，先停止它
        if (state.activeTimerSubject && state.activeTimerSubject !== subject) {
          const elapsed = state.timerAccumulatedSeconds + (state.timerStartTime ? (now - state.timerStartTime) / 1000 : 0);
          const totalMin = Math.round(elapsed / 60);
          const today = localToday();
          const prevSubject = state.activeTimerSubject;
          useStore.getState().addStudyMinutes(today, totalMin);
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
        const today = localToday();
        const subject = state.activeTimerSubject;
        // 计时分钟计入当日打卡（连胜判定）
        useStore.getState().addStudyMinutes(today, totalMin);
        const next: Partial<Store> = {
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
        };
        // 会话结束后重算成就（streak / pet.level 等状态类成就实时推进）
        next.achievements = computeStateAchievements({ ...state, ...next }, state.streak);
        set(next);
      },
    }),
    {
      name: 'studypet-data',
      version: 5,
      migrate: (persisted: any, version: number) => {
        // v4 → v5: 默认期望记忆保持率 90%（Anki Desired Retention）
        if (version < 5 && persisted.state) {
          persisted.state.desiredRetention = 0.9;
        }
        if (version < 3) {
          persisted.state.schedule = [];
        }
        // v3 → v4: 将旧 messages[] 迁移为 sessions[]
        if (version < 4 && persisted.state?.messages) {
          const oldMessages: ChatMessage[] = persisted.state.messages || [];
          const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
          const sessionMap: Record<string, ChatMessage[]> = {};
          for (const msg of oldMessages) {
            const ts = parseInt(msg.id.split('-')[1] || String(Date.now()));
            const date = localDateStr(new Date(ts));
            if (!sessionMap[date]) sessionMap[date] = [];
            sessionMap[date].push(msg);
          }
          const sessions: ChatSession[] = Object.entries(sessionMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, msgs]) => {
              const d = new Date(date);
              return { id: date, date, label: `${d.getMonth() + 1}月${d.getDate()}日 ${dayNames[d.getDay()]}`, messages: msgs };
            });
          persisted.state.sessions = sessions;
          persisted.state.activeSessionDate = localToday();
          delete persisted.state.messages;
        }
        // 确保 subjectProgress 中每个科目都有 chapterDetails
        if (persisted.state?.subjectProgress) {
          for (const key of ['english', 'math', 'politics', 'electronics']) {
            if (persisted.state.subjectProgress[key] && !persisted.state.subjectProgress[key].chapterDetails) {
              persisted.state.subjectProgress[key].chapterDetails = [];
            }
          }
        }
        return persisted;
      },
      partialize: (state) => {
        // 30 天裁剪：只保留近期数据，防止 localStorage 无限膨胀
        const cutoff30 = localDateStr(new Date(Date.now() - 30 * 86400000));
        const cutoffYear = localDateStr(new Date(Date.now() - 365 * 86400000));
        return {
          tasks: state.tasks.filter(t => !t.completed || (t.date ? t.date >= cutoffYear : true)),
          pet: state.pet,
          achievements: state.achievements,
          streak: state.streak,
          studyDays: Object.fromEntries(
            Object.entries(state.studyDays).filter(([date]) => date >= cutoffYear)
          ),
          weekStats: state.weekStats,
          schedule: state.schedule,
          autoPlan: state.autoPlan,
          importantItems: state.importantItems.filter(i => !i.done || i.createdAt >= cutoff30),
          activityLogs: state.activityLogs.filter(l => l.date >= cutoff30),
          subjectProgress: state.subjectProgress,
          examRecords: state.examRecords.filter(r => r.examDate >= cutoffYear),
          sessions: state.sessions.slice(-60), // 保留最多 60 个 session
          activeSessionDate: state.activeSessionDate,
          studyChecklists: state.studyChecklists.slice(-50), // 保留最近50条清单，防止无限膨胀
          practiceLogs: state.practiceLogs.slice(-100), // 保留最近100条练习记录
        };
      },
      merge: (persisted, current) => {
        try {
          const p = persisted as Partial<Store>;
          return {
            ...current,
            tasks: p.tasks ?? current.tasks,
            pet: p.pet ?? current.pet,
            achievements: p.achievements ?? current.achievements,
            streak: p.streak ?? current.streak,
            studyDays: p.studyDays ?? current.studyDays,
            weekStats: p.weekStats ?? current.weekStats,
            schedule: p.schedule ?? current.schedule,
            autoPlan: p.autoPlan ?? current.autoPlan,
            importantItems: p.importantItems ?? current.importantItems,
            activityLogs: p.activityLogs ?? current.activityLogs,
            subjectProgress: p.subjectProgress ?? current.subjectProgress,
            examRecords: p.examRecords ?? current.examRecords,
            sessions: p.sessions ?? current.sessions,
            activeSessionDate: p.activeSessionDate ?? current.activeSessionDate,
            studyChecklists: p.studyChecklists ?? current.studyChecklists,
            practiceLogs: p.practiceLogs ?? current.practiceLogs,
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
                  studyDays: p.studyDays ?? current.studyDays,
                  weekStats: p.weekStats ?? current.weekStats,
                  schedule: p.schedule ?? current.schedule,
                  autoPlan: p.autoPlan ?? current.autoPlan,
                  importantItems: p.importantItems ?? current.importantItems,
                  activityLogs: p.activityLogs ?? current.activityLogs,
                  subjectProgress: p.subjectProgress ?? current.subjectProgress,
                  examRecords: p.examRecords ?? current.examRecords,
                  sessions: p.sessions ?? current.sessions,
  activeSessionDate: p.activeSessionDate ?? current.activeSessionDate,
                  studyChecklists: p.studyChecklists ?? current.studyChecklists,
                  practiceLogs: p.practiceLogs ?? current.practiceLogs,
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