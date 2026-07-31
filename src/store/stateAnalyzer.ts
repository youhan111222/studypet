import type { ActivityLog, SubjectKey, Task, Achievement, ScheduleItem } from '../types';
import { ACHIEVEMENT_DEFS } from './useStore';
import { isWeekInRange, parseDate } from '../utils';

// ====== 状态感知层 ======
// 在原始数据送入 AI 教练之前，先做一轮分析
// 把"数据"变成"洞察"，教练才能精准发现问题

export interface Alert {
  level: 'critical' | 'high' | 'medium';
  type: 'ddl' | 'subject_gap' | 'entertainment' | 'fatigue' | 'procrastination' | 'imbalance' | 'streak_risk';
  message: string;
}

export interface CourseTimelineItem {
  name: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  status: 'past' | 'current' | 'upcoming';
  statusText: string;
}

export interface CurrentActivity {
  time: string;
  period: '清晨' | '上午' | '中午' | '下午' | '晚上' | '凌晨';
  dayOfWeek: string;
  /** 当前前台窗口类别 */
  activeCategory: string | null;
  /** 已连续活跃/空闲多久 */
  activityContext: string;
}

export interface StateSnapshot {
  current: CurrentActivity;
  alerts: Alert[];
  warnings: string[];
  positives: string[];
  /** 算法生成的建议，优先于教练自由发挥 */
  recommendations: string[];
  /** 给教练的重点关注清单 */
  coachFocus: string[];
  /** 今日课程时间线（含状态：已结束/进行中/即将开始） */
  courseTimeline: CourseTimelineItem[];
}

const SUBJECT_NAMES: Record<SubjectKey, string> = {
  english: '英语', math: '高数', politics: '政治', electronics: '电子技术',
};

/** 分析今日课程时间线：计算每门课是已结束、正在进行还是即将开始 */
function analyzeSchedule(
  schedule: ScheduleItem[],
  todayDayOfWeek: number, // JS day: 0=Sun, 1=Mon, ..., 6=Sat
  semesterWeek: number,
  currentHour: number,
  currentMinute: number,
): CourseTimelineItem[] {
  const currentMinutes = currentHour * 60 + currentMinute;
  // Convert JS day (0=Sun) to schedule day (1=Mon, ..., 7=Sun)
  const scheduleDay = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;

  const todayClasses = schedule.filter(s =>
    s.day === scheduleDay && isWeekInRange(s.weeks, semesterWeek)
  );

  if (todayClasses.length === 0) return [];

  const items: CourseTimelineItem[] = todayClasses.map(c => {
    const [sh, sm] = c.timeStart.split(':').map(Number);
    const [eh, em] = c.timeEnd.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    let status: CourseTimelineItem['status'];
    let statusText: string;

    if (currentMinutes < startMin) {
      status = 'upcoming';
      const diff = startMin - currentMinutes;
      statusText = diff < 60 ? `${diff}分钟后开始` : `${Math.floor(diff / 60)}小时${diff % 60}分钟后开始`;
    } else if (currentMinutes >= startMin && currentMinutes < endMin) {
      status = 'current';
      const remaining = endMin - currentMinutes;
      statusText = `正在进行中，还剩${remaining}分钟`;
    } else {
      status = 'past';
      const diff = currentMinutes - endMin;
      statusText = diff < 60 ? `${diff}分钟前已结束` : `${Math.floor(diff / 60)}小时${diff % 60}分钟前已结束`;
    }

    return {
      name: c.name,
      timeStart: c.timeStart,
      timeEnd: c.timeEnd,
      location: c.location,
      status,
      statusText,
    };
  });

  // Sort: current first, then upcoming, then past
  const order = { current: 0, upcoming: 1, past: 2 };
  items.sort((a, b) => order[a.status] - order[b.status] || a.timeStart.localeCompare(b.timeStart));
  return items;
}

// ====== 主入口 ======
export function analyzeState(params: {
  today: string;
  hour: number;
  minute: number;
  dayOfWeek: number; // 0=周日
  activityLogs: ActivityLog[];
  tasks: Task[];
  subjectProgress: Record<SubjectKey, { lastStudyDate: string; totalMinutes: number; completedChapters: string[]; currentChapter: string }>;
  streak: number;
  achievements: Achievement[];
  petLevel: number;
  petCoins: number;
  schedule: ScheduleItem[];
  semesterWeek: number;
}): StateSnapshot {
  const { today, hour, minute, dayOfWeek, activityLogs, tasks, subjectProgress, streak, achievements, petLevel, schedule, semesterWeek } = params;

  const period = hour < 6 ? '凌晨' as const : hour < 9 ? '清晨' as const : hour < 12 ? '上午' as const : hour < 13 ? '中午' as const : hour < 18 ? '下午' as const : hour < 21 ? '晚上' as const : '凌晨' as const;
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // ---- 当前活动 ----
  const todayLogs = activityLogs.filter(l => l.date === today);
  const lastLog = todayLogs[todayLogs.length - 1];
  const activeCategory = lastLog?.category || null;

  let activityContext = '刚上线';
  if (todayLogs.length > 0) {
    const studyMin = todayLogs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration, 0);
    const entMin = todayLogs.filter(l => l.category === 'entertainment').reduce((s, l) => s + l.duration, 0);
    if (studyMin + entMin > 0) {
      activityContext = `今日已活跃${Math.floor((studyMin + entMin) / 60)}h${(studyMin + entMin) % 60}m，学习${studyMin}m / 娱乐${entMin}m`;
    }
  }

  const current: CurrentActivity = {
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    period,
    dayOfWeek: dayNames[dayOfWeek],
    activeCategory,
    activityContext,
  };

  // ---- 告警检测 ----
  const alerts: Alert[] = [];
  const warnings: string[] = [];
  const positives: string[] = [];
  const recommendations: string[] = [];
  const coachFocus: string[] = [];

  // 1. 凌晨活跃检测
  if (hour >= 0 && hour < 6) {
    alerts.push({
      level: 'critical',
      type: 'fatigue',
      message: `现在是凌晨${hour}:${String(minute).padStart(2, '0')}，用户仍在活跃。生物钟严重偏离，长期如此影响记忆力和学习效率。`,
    });
    recommendations.push('强制提醒休息，建议立即关闭屏幕，设定明早7:30闹钟');
    coachFocus.push('用户处于凌晨活跃状态，应以关心口吻催促休息');
  } else if (hour >= 23 || hour < 7) {
    warnings.push(`深夜${hour}:${String(minute).padStart(2, '0')}，应尽快结束当前活动准备休息`);
    coachFocus.push('时间较晚，关注用户作息');
  }

  // 2. DDL 紧急度
  const overdue = tasks.filter(t => !t.completed && t.deadline && (t.deadline.includes('今天') || t.deadline.includes('昨天')));
  const urgent = tasks.filter(t => !t.completed && t.deadline && (t.deadline.includes('明天') || t.deadline.includes('明')));
  const hasDdl = tasks.filter(t => !t.completed && t.deadline).length;
  if (overdue.length > 0) {
    alerts.push({
      level: 'critical',
      type: 'ddl',
      message: `${overdue.length}个任务已超期：${overdue.map(t => t.title).join('、')}`,
    });
    recommendations.push(`立即处理超期任务：${overdue[0].title}`);
    coachFocus.push(`超期任务${overdue.map(t => t.title).join('、')}需要用户立即行动`);
  } else if (urgent.length > 0 && hour > 18) {
    alerts.push({
      level: 'high',
      type: 'ddl',
      message: `${urgent.length}个任务明天截止，今晚必须完成`,
    });
    recommendations.push(`今晚优先：${urgent.map(t => t.title).join(' > ')}`);
  }

  // 3. 科目断层检测
  const subjectGaps: string[] = [];
  for (const [key, name] of Object.entries(SUBJECT_NAMES) as [SubjectKey, string][]) {
    const sp = subjectProgress[key];
    const lastDate = sp.lastStudyDate ? parseDate(sp.lastStudyDate) : null;
    if (!lastDate) {
      alerts.push({
        level: 'high',
        type: 'subject_gap',
        message: `${name}从未复习过！这是专升本必考科目`,
      });
      subjectGaps.push(name);
    } else {
      const gap = Math.floor((parseDate(today).getTime() - lastDate.getTime()) / 86400000);
      if (gap >= 7) {
        alerts.push({
          level: 'high',
          type: 'subject_gap',
          message: `${name}已${gap}天未复习，知识遗忘率已超过50%`,
        });
        subjectGaps.push(name);
      } else if (gap >= 3) {
        warnings.push(`${name}${gap}天未复习，接近遗忘临界点`);
      }
    }
  }
  if (subjectGaps.length >= 2) {
    recommendations.push(`今天必须安排：${subjectGaps.join('、')}`);
    coachFocus.push(`科目断层严重：${subjectGaps.join('、')}需要立即安排复习`);
  }

  // 4. 今日学习/娱乐比例
  const todayStudy = todayLogs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration, 0);
  const todayEnt = todayLogs.filter(l => l.category === 'entertainment').reduce((s, l) => s + l.duration, 0);
  const totalActive = todayStudy + todayEnt;
  if (totalActive > 60) {
    const studyRatio = todayStudy / totalActive;
    if (studyRatio < 0.3) {
      alerts.push({
        level: 'high',
        type: 'entertainment',
        message: `今日学习仅占${Math.round(studyRatio * 100)}%，娱乐${todayEnt}m远超学习${todayStudy}m`,
      });
      recommendations.push('立即切换为学习模式，可开启番茄钟25分钟起步');
      coachFocus.push('娱乐占比严重超标，需要严厉但不失温度地指出');
    } else if (studyRatio < 0.5) {
      warnings.push(`今日学习占比${Math.round(studyRatio * 100)}%，娱乐偏多`);
    }
  }

  // 5. 会话切换频率
  const studySessions = todayLogs.filter(l => l.category === 'study').length;
  if (studySessions > 12 && totalActive > 120) {
    warnings.push(`今日已有${studySessions}次学习会话切换，频繁切换降低深度专注力，建议合并碎片时间`);
    recommendations.push('尝试连续专注45分钟再休息，减少切换');
  }

  // 6. 连续打卡风险
  if (streak >= 2 && streak < 7) {
    if (hour >= 20 && todayStudy < 30) {
      alerts.push({
        level: 'medium',
        type: 'streak_risk',
        message: `连续${streak}天打卡可能今天中断！今日学习仅${todayStudy}分钟`,
      });
      recommendations.push(`至少再学30分钟保住${streak}天连胜`);
    }
  }

  // 7. 科目平衡
  const totalSubjectMin = Object.values(subjectProgress).reduce((s, sp) => s + sp.totalMinutes, 0);
  if (totalSubjectMin > 120) {
    const subjectShares = Object.entries(subjectProgress) as [SubjectKey, typeof subjectProgress[SubjectKey]][];
    const maxMin = Math.max(...subjectShares.map(([, sp]) => sp.totalMinutes));
    const minMin = Math.min(...subjectShares.map(([, sp]) => sp.totalMinutes || 0.1));
    if (maxMin / minMin > 5) {
      const weakest = subjectShares.reduce((a, b) => a[1].totalMinutes < b[1].totalMinutes ? a : b);
      warnings.push(`科目严重不平衡：最少的${SUBJECT_NAMES[weakest[0]]}仅${weakest[1].totalMinutes}分钟，最多的科目是其${Math.round(maxMin / minMin)}倍`);
      recommendations.push(`本周重点倾斜${SUBJECT_NAMES[weakest[0]]}`);
      coachFocus.push(`科目不平衡：${SUBJECT_NAMES[weakest[0]]}严重落后`);
    }
  }

  // 8. 正面信号
  if (streak >= 7) {
    positives.push(`已连续打卡${streak}天，意志力在增强`);
  }
  if (todayStudy >= 180) {
    positives.push(`今日已学习${Math.floor(todayStudy / 60)}h${todayStudy % 60}m，非常扎实`);
  }
  // 检查本周是否有全勤
  const thisWeekDays = new Set(activityLogs.filter(l => {
    const d = parseDate(l.date);
    const todayD = parseDate(today);
    const diff = (todayD.getTime() - d.getTime()) / 86400000;
    return diff <= 7 && l.category === 'study';
  }).map(l => l.date));
  if (thisWeekDays.size >= 5) {
    positives.push(`本周已有${thisWeekDays.size}天学习记录，接近全勤`);
  }
  // 接近解锁的成就
  const nearAchievements = achievements.filter(a => !a.unlocked && a.progress >= a.total * 0.8);
  for (const a of nearAchievements) {
    positives.push(`成就【${a.title}】即将解锁（${a.progress}/${a.total}）`);
    recommendations.push(`${a.desc} — 再加把劲就解锁了！`);
  }

  // 9. 时段效率推荐
  const hourStudyMap: Record<number, number> = {};
  activityLogs.filter(l => l.category === 'study').forEach(l => {
    const hh = parseInt(l.startTime?.split(':')[0]) || 0;
    hourStudyMap[hh] = (hourStudyMap[hh] || 0) + l.duration;
  });
  const bestHour = Object.entries(hourStudyMap).sort((a, b) => b[1] - a[1])[0];
  if (bestHour && bestHour[1] > 60) {
    const hh = parseInt(bestHour[0]);
    const periodName = hh < 12 ? '上午' : hh < 18 ? '下午' : '晚上';
    positives.push(`历史数据显示${periodName}${hh}:00-${hh + 1}:00是你的黄金学习时段`);
    if (period !== '凌晨' && period !== '清晨') {
      recommendations.push(`建议在当前时段安排需要深度专注的任务`);
    }
  }

  // 10. 今日课程时间线（算法精确计算，无需 AI 自行推断）
  const courseTimeline = analyzeSchedule(schedule, dayOfWeek, semesterWeek, hour, minute);

  return { current, alerts, warnings, positives, recommendations, coachFocus, courseTimeline };
}
