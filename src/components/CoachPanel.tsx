import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { useMemoryStore } from '../store/memory';
import { analyzeState } from '../store/stateAnalyzer';
import { isWeekInRange, parseDate } from '../utils';
import type { ChatMessage, SubjectKey, SubjectProgress } from '../types';
import { API, SEMESTER_START, getCurrentWeek } from '../config';

const TOTAL_WEEKS = 17;
const MIN_WIDTH = 380;
const MAX_WIDTH = 700;

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatTabLabel(dateStr: string, isToday: boolean): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}${isToday ? ' 今天' : ''}`;
}

export function CoachPanel() {
  const sessions = useStore(s => s.sessions);
  const activeSessionDate = useStore(s => s.activeSessionDate);
  const addMessage = useStore(s => s.addMessage);
  const updateSessionSummary = useStore(s => s.updateSessionSummary);
  const toggleCoach = useStore(s => s.toggleCoach);
  const applyPlan = useStore(s => s.applyPlan);
  const tasks = useStore(s => s.tasks);
  const schedule = useStore(s => s.schedule);
  const activityLogs = useStore(s => s.activityLogs);
  const importantItems = useStore(s => s.importantItems);
  const addTask = useStore(s => s.addTask);
  const toggleTask = useStore(s => s.toggleTask);
  const deleteTask = useStore(s => s.deleteTask);
  const addScheduleItem = useStore(s => s.addScheduleItem);
  const updateScheduleItem = useStore(s => s.updateScheduleItem);
  const addImportant = useStore(s => s.addImportant);
  const toggleImportant = useStore(s => s.toggleImportant);
  const deleteImportant = useStore(s => s.deleteImportant);
  const updateSubjectProgress = useStore(s => s.updateSubjectProgress);
  const updateChapterMastery = useStore(s => s.updateChapterMastery);
  const addStudyChecklist = useStore(s => s.addStudyChecklist);
  const addPracticeLog = useStore(s => s.addPracticeLog);
  const addExamRecord = useStore(s => s.addExamRecord);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [panelWidth, setPanelWidth] = useState(460);
  const [isFullWidth, setIsFullWidth] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const todayStr = getTodayStr();
  const currentSession = sessions.find(s => s.date === activeSessionDate);
  const currentMessages = currentSession?.messages || [];
  const isToday = activeSessionDate === todayStr;
  const isEmpty = currentMessages.length === 0;

  // Yesterday summary for cross-day context
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const yesterdaySession = sessions.find(s => s.date === yesterdayStr);
  const yesterdaySummary = yesterdaySession?.summary;

  // 跨日摘要自动生成：今天首次打开空会话时，给昨天对话生成一句话摘要
  useEffect(() => {
    if (!isToday || !isEmpty) return;
    if (!yesterdaySession) return;
    if (yesterdaySession.summary) return;
    const msgs = yesterdaySession.messages;
    if (msgs.length === 0) return;

    const recent = msgs.slice(-6).map(m =>
      `${m.role === 'user' ? '用户' : '教练'}: ${(m.content || '').slice(0, 80)}`
    ).join('\n');

    const controller = new AbortController();
    fetch('/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `请用一句话（不超过30字）总结以下对话的核心话题：\n${recent}`,
        context: { system_state: '你是摘要机器人，只输出一句话摘要，不要回复其他内容。' }
      }),
      signal: controller.signal,
    }).then(r => r.json()).then(d => {
      if (d.response) {
        const s = d.response.replace(/^[：:]/g, '').trim().slice(0, 50);
        updateSessionSummary(yesterdayStr, s);
      }
    }).catch(() => {});

    return () => controller.abort();
  }, [isToday, isEmpty, yesterdayStr, yesterdaySession?.messages?.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages, loading]);

  // ====== Voice ======
  const speak = useCallback((text: string) => {
    if (!voiceOn) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/\[MEMORY:[^\]]+\]/gi, '').replace(/\[ACTION:\w+\]\s*\{[\s\S]*?\}/gi, ''));
      u.lang = 'zh-CN';
      u.rate = 1.0;
      u.volume = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* 浏览器不支持或静音 */ }
  }, [voiceOn]);

  // ====== Drag resize ======
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.startX - ev.clientX;
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + dx)));
    };
    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [panelWidth]);

  // ====== Session tabs (last 7 days) ======
  const tabDates = useMemo(() => {
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, []);

  const setActiveSessionDate = useCallback((date: string) => {
    useStore.setState({ activeSessionDate: date });
  }, []);

  // ====== Status card data (today + empty session) ======
  const statusCardData = useMemo(() => {
    if (!isToday) return null;
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const dayOfWeek = now.getDay();

    const semesterWeek = getCurrentWeek(SEMESTER_START);

    const todayDayOfWeek = dayOfWeek;
    const todayScheduleDay = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;
    const todayClasses = schedule.filter(s =>
      s.day === todayScheduleDay && isWeekInRange(s.weeks, semesterWeek)
    );

    const pendingTasks = tasks.filter(t => !t.completed);
    const todayStudyMin = activityLogs
      .filter(l => l.date === todayStr && l.category === 'study')
      .reduce((s, l) => s + l.duration, 0);

    const state = useStore.getState();
    const analysis = analyzeState({
      today: todayStr, hour: h, minute: m, dayOfWeek,
      activityLogs: state.activityLogs,
      tasks: state.tasks,
      subjectProgress: state.subjectProgress,
      streak: state.streak,
      achievements: state.achievements,
      petLevel: state.pet.level,
      petCoins: state.pet.coins,
      schedule: state.schedule,
      semesterWeek,
    });

    // 今日到期需复习的章节
    const reviewDue: { subject: SubjectKey; chapter: string; daysAgo: number }[] = [];
    const sp = state.subjectProgress;
    (Object.keys(sp) as SubjectKey[]).forEach(key => {
      (sp[key].chapterDetails || []).forEach(c => {
        if (c.nextReviewDate && c.nextReviewDate <= todayStr && c.mastery !== 'mastered') {
          const lastDate = c.lastReviewDate ? new Date(c.lastReviewDate) : new Date('2026-01-01');
          reviewDue.push({ subject: key, chapter: c.name, daysAgo: Math.floor((Date.now() - lastDate.getTime()) / 86400000) });
        }
      });
    });

    return { semesterWeek, todayClasses, pendingTasks, todayStudyMin, analysis, reviewDue };
  }, [isToday, todayStr, schedule, tasks, activityLogs, useStore(s => s.subjectProgress)]);

  // ====== buildContext (unchanged core) ======
  const buildContext = (todayDateStr: string, todayFull: string, weekDates: string[]): string => {
    const state = useStore.getState();
    const { tasks: allTasks, schedule: sch, activityLogs: logs, importantItems: imps, pet, achievements, streak, weekStats, autoPlan, subjectProgress, examRecords } = state;

    const done = allTasks.filter(t => t.completed);
    const remaining = allTasks.filter(t => !t.completed);
    const dayNamesZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    const todayDate = parseDate(todayDateStr);
    const semesterWeek = getCurrentWeek(SEMESTER_START);

    const todayDayOfWeek = parseDate(todayDateStr).getDay();
    const todayScheduleDay = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;

    const todayClasses = sch.filter(s =>
      s.day === todayScheduleDay && isWeekInRange(s.weeks, semesterWeek)
    );
    const todayClassSummary = todayClasses.length > 0
      ? todayClasses.map(s => `${s.name} ${s.timeStart}-${s.timeEnd}@${s.location}`).join('、')
      : '无课';

    const weekLines: string[] = [];
    for (let d = 1; d <= 7; d++) {
      const items = sch.filter(s => s.day === d && isWeekInRange(s.weeks, semesterWeek));
      weekLines.push(`  ${dayNamesZH[d === 7 ? 0 : d]} ${weekDates[d-1].slice(5)}: ${items.length > 0 ? items.map(s => `${s.name} ${s.timeStart}-${s.timeEnd}`).join(' | ') : '无课'}`);
    }

    // 明天课表
    const tomorrow = new Date(todayDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDayOfWeek = tomorrow.getDay();
    const tomorrowScheduleDay = tomorrowDayOfWeek === 0 ? 7 : tomorrowDayOfWeek;
    const tomorrowClasses = sch.filter(s =>
      s.day === tomorrowScheduleDay && isWeekInRange(s.weeks, semesterWeek)
    );
    const tomorrowClassSummary = tomorrowClasses.length > 0
      ? tomorrowClasses.map(s => `${s.name} ${s.timeStart}-${s.timeEnd}@${s.location}`).join('、')
      : '无课';

    // 本周剩余课表（从明天到周日）
    const restOfWeekLines: string[] = [];
    for (let d = tomorrowDayOfWeek; d <= 7; d++) {
      const items = sch.filter(s => s.day === d && isWeekInRange(s.weeks, semesterWeek));
      if (items.length > 0) {
        const dateStr = weekDates[d - 1]?.slice(5) || '';
        restOfWeekLines.push(`  ${dayNamesZH[d === 7 ? 0 : d]} ${dateStr}: ${items.map(s => `${s.name} ${s.timeStart}-${s.timeEnd}`).join(' | ')}`);
      }
    }

    const courseNames = [...new Set(sch.map(s => s.name))];
    const courseStats = courseNames.map(name => {
      const items = sch.filter(s => s.name === name);
      const weekNums = new Set<number>();
      items.forEach(s => {
        const ws = String(s.weeks);
        ws.split(',').forEach(p => {
          const t = p.trim();
          if (t.includes('-')) {
            const [a, b] = t.split('-').map(Number);
            for (let i = a; i <= b; i++) weekNums.add(i);
          } else {
            weekNums.add(Number(t));
          }
        });
      });
      const weeksArr = [...weekNums].sort((a, b) => a - b);
      return `  ${name}：出现在第${weeksArr.join('、')}周`;
    }).join('\n');

    const allTasksLines = allTasks.map(t =>
      `  [${t.completed ? '✓' : '○'}] ${t.title} | ${t.time} | ${t.tags.join(',') || '无标签'}${t.deadline ? ' | DDL:' + t.deadline : ''}${t.date ? ' | 日期:' + t.date : ''}`
    ).join('\n');

    const impLines = imps.map(i =>
      `  [${i.done ? '✓' : '○'}] [${i.priority === 'high' ? '!!' : '!'}] ${i.title}${i.content ? ' - ' + i.content : ''} | 创建:${i.createdAt}`
    ).join('\n');

    const studySec = logs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration * 60, 0);
    const entSec = logs.filter(l => l.category === 'entertainment').reduce((s, l) => s + l.duration * 60, 0);
    const totalTracked = studySec + entSec;
    const studyRatio = totalTracked > 0 ? Math.round((studySec / totalTracked) * 100) : 0;

    const recentLogs = logs.slice(-30);
    const recentStudySec = recentLogs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration * 60, 0);
    const recentDays = [...new Set(recentLogs.map(l => l.date))].length;
    const avgStudyPerDay = recentDays > 0 ? recentStudySec / recentDays : 0;

    const achLines = achievements.map(a =>
      `  ${a.unlocked ? '🌟' : '🔒'} ${a.title}: ${a.desc} (${a.progress}/${a.total})`
    ).join('\n');

    const memories = useMemoryStore.getState().memories;
    const highPriorityMemories = memories.filter(m => m.priority >= 7).sort((a, b) => b.priority - a.priority);
    const memoryContext = highPriorityMemories.length > 0
      ? highPriorityMemories.map(m =>
          `  [${m.type === 'goal' ? '长期目标' : m.type === 'preference' ? '偏好' : m.type === 'insight' ? '洞察' : '成就'}] ${m.content}`
        ).join('\n')
      : '  无';

    const ratioAlert = totalTracked > 3600 && studyRatio < 50
      ? `⚠️ 今日时间分配失衡：学习仅占${studyRatio}%，娱乐${100-studyRatio}%`
      : '';
    const ddlTasks = remaining.filter(t => t.deadline);
    const ddlConflict = ddlTasks.length >= 2 && ddlTasks.some(t => t.deadline?.includes('明天') || t.deadline?.includes('今天'));
    const overdueTasks = remaining.filter(t => t.deadline && (t.deadline.includes('今天') || t.deadline.includes('昨天')));
    const procrastination = overdueTasks.length > 0;

    const subjectNames: Record<SubjectKey, string> = { electronics: '电子技术基础', english: '英语', math: '高数', politics: '政治' };
    const studyGaps: string[] = [];
    const subjectLines: string[] = [];
    (Object.keys(subjectProgress) as SubjectKey[]).forEach(key => {
      const sp = subjectProgress[key];
      const lastDate = sp.lastStudyDate ? parseDate(sp.lastStudyDate) : null;
      const gapDays = lastDate ? Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000) : 999;
      const gapWarning = gapDays >= 999 ? '🔴 从未复习'
        : gapDays >= 7 ? `🔴 ${gapDays}天未复习`
        : gapDays >= 3 ? `🟡 ${gapDays}天未复习`
        : gapDays >= 1 ? `🟢 昨天复习过`
        : gapDays === 0 ? '🟢 今天已复习' : '';
      if (gapDays >= 3) studyGaps.push(`${subjectNames[key]}：${gapDays >= 999 ? '从未复习！' : gapDays + '天未复习！'}`);
      subjectLines.push(`  ${subjectNames[key]}(${key === 'electronics' ? 200 : 100}分): ${sp.totalMinutes}min | 进度:${sp.currentChapter} | 完成${sp.completedChapters.length}章 | ${gapWarning}${sp.notes ? ' | 备注:' + sp.notes : ''}`);
      // 章节掌握状态（只输出非 mastered 的章节）
      const cd = sp.chapterDetails || [];
      const weakChapters = cd.filter((c: any) => c.mastery !== 'mastered');
      if (weakChapters.length > 0) {
        const mMap: Record<string, string> = { not_started: '未开始', learning: '学习中', review_needed: '需复习' };
        subjectLines.push(`    薄弱章节: ${weakChapters.map((c: any) => `${c.name}(${mMap[c.mastery] || c.mastery})`).join(', ')}`);
        // 到期需复习的章节
        const todayStr2 = new Date().toISOString().slice(0, 10);
        const dueReview = cd.filter((c: any) => c.nextReviewDate && c.nextReviewDate <= todayStr2 && c.mastery !== 'mastered');
        if (dueReview.length > 0) {
          subjectLines.push(`    ⏰ 到期待复习: ${dueReview.map((c: any) => c.name).join(', ')}`);
        }
      }
    });

    const examLines = examRecords.length > 0
      ? examRecords.slice(-10).reverse().map(r =>
          `  ${r.examDate} [${subjectNames[r.subject]}] ${r.examType}: ${r.score}/${r.totalScore} (${Math.round(r.score/r.totalScore*100)}%)${r.notes ? ' | 薄弱点:' + r.notes : ''}`
        ).join('\n')
      : '  暂无考试记录（AI可录入：说"记录政治选择题得分"即可）';

    const recent7Logs = logs.filter(l => {
      const logDate = parseDate(l.date);
      return (todayDate.getTime() - logDate.getTime()) <= 7 * 86400000;
    });
    const subjectStudyTime: Record<string, number> = {};
    recent7Logs.forEach(l => {
      const subj = String(l.category).toLowerCase();
      if (['electronics', 'english', 'math', 'politics'].includes(subj)) {
        subjectStudyTime[subj] = (subjectStudyTime[subj] || 0) + l.duration;
      }
    });
    const studyTimeLines = Object.entries(subjectStudyTime)
      .map(([k, v]) => `  ${subjectNames[k as SubjectKey]}: ${v}min`)
      .join('\n') || '  暂无数据';

    const estimatedExamDate = parseDate('2027-03-25');
    const daysUntilExam = Math.ceil((estimatedExamDate.getTime() - todayDate.getTime()) / 86400000);
    const weeksUntilExam = Math.floor(daysUntilExam / 7);

    const totalChapters = (Object.values(subjectProgress) as SubjectProgress[]).reduce((s, sp) => s + sp.completedChapters.length, 0);
    const progressAssessment = totalChapters === 0 ? '⚠️ 尚未开始系统复习，立即行动！'
      : totalChapters < 10 ? `🟡 仅完成${totalChapters}章，进度偏慢`
      : `🟢 已完成${totalChapters}章，持续保持`;

    return `===== 系统状态 =====
日期: ${todayFull} | 第${semesterWeek}周（共${TOTAL_WEEKS}周）
宠物: ${pet.name} Lv.${pet.level} EXP:${pet.exp}/${pet.expToNext} | 心情:${pet.mood} | 爱心:${'❤'.repeat(pet.hearts)} | 金币:${pet.coins}
连续打卡: ${streak}天 | 本周专注:${weekStats.focusHours}h | 完成:${weekStats.tasksCompleted}项 | 番茄:${weekStats.pomodoroCount}个 | 自动规划:${autoPlan ? '开' : '关'}

===== 今日课表 =====
${todayClassSummary}

===== 本周课表（${weekDates[0]} ~ ${weekDates[6]}） =====
${weekLines.join('\n')}

===== 明日课表 =====
${tomorrowClassSummary}

===== 本周剩余课表 =====
${restOfWeekLines.length > 0 ? restOfWeekLines.join('\n') : '  本周剩余无课'}

===== 课程分布统计（学期全局） =====
${courseStats}

===== 全部任务（${allTasks.length}项，完成${done.length}项，未完成${remaining.length}项） =====
${allTasksLines || '  无'}

===== 重要事项（${imps.length}项，未完成${imps.filter(i => !i.done).length}项） =====
${impLines || '  无'}

===== 学习活动 =====
今日: ${Math.floor(studySec/3600)}h${Math.floor((studySec%3600)/60)}m学习 / ${Math.floor(entSec/3600)}h${Math.floor((entSec%3600)/60)}m娱乐 / 学习占比${studyRatio}%
近${recentDays}天日均学习: ${Math.floor(avgStudyPerDay/3600)}h${Math.floor((avgStudyPerDay%3600)/60)}m

===== 近7天各科复习时间 =====
${studyTimeLines}

===== 成就进度 =====
${achLines}

===== 长期记忆 =====
${memoryContext}

===== 专升本备考核心面板 =====
目标: 2027年3月 广东专升本 | 总分500(电子技术200+政/英/数各100)
倒计时: ${daysUntilExam}天 / ${weeksUntilExam}周 | 进度评估: ${progressAssessment}
${subjectLines.join('\n')}
${studyGaps.length > 0 ? '\n⚠️ 学习断层警告:\n' + studyGaps.map(g => '  ' + g).join('\n') : ''}

===== 考试成绩记录 =====
${examLines}
${ratioAlert ? '\n' + ratioAlert : ''}${ddlConflict ? '\n⚠️ DDL冲突：多个任务临近截止' : ''}${procrastination ? '\n⚠️ 拖延：' + overdueTasks.map(t => t.title).join('、') + '已超期' : ''}`;
  };

  // ====== buildStateReport ======
  function buildStateReport(snapshot: ReturnType<typeof analyzeState>): string {
    const { current, alerts, warnings, positives, recommendations, coachFocus, courseTimeline } = snapshot;
    const catNames: Record<string, string> = { study: '学习', entertainment: '娱乐', social: '社交', other: '其他' };

    const lines: string[] = [];
    lines.push('===== 状态感知报告（算法生成，优先级最高） =====');

    lines.push(`【当前状态】${current.dayOfWeek} ${current.period} ${current.time} | ${current.activityContext}`);
    if (current.activeCategory) {
      lines.push(`  前台类别: ${catNames[current.activeCategory] || current.activeCategory}`);
    }

    if (courseTimeline.length > 0) {
      lines.push('');
      lines.push('【今日课程时间线 — 教练必须以此为唯一依据，禁止自行推断课程状态】');
      for (const c of courseTimeline) {
        const marker = c.status === 'current' ? '▶ 现在' : c.status === 'upcoming' ? '○ 即将' : '✓ 已结束';
        lines.push(`  ${marker} ${c.timeStart}-${c.timeEnd} ${c.name} @${c.location} — ${c.statusText}`);
      }
    } else {
      lines.push('');
      lines.push('【今日课程时间线】今日无课');
    }

    if (alerts.length > 0) {
      lines.push('');
      lines.push('【告警 — 需立即关注】');
      for (const a of alerts) {
        const emoji = a.level === 'critical' ? 'CRITICAL' : a.level === 'high' ? 'HIGH' : 'MEDIUM';
        lines.push(`  [${emoji}][${a.type}] ${a.message}`);
      }
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push('【注意事项】');
      for (const w of warnings) lines.push(`  ${w}`);
    }

    if (positives.length > 0) {
      lines.push('');
      lines.push('【正面信号】');
      for (const p of positives) lines.push(`  ${p}`);
    }

    if (recommendations.length > 0) {
      lines.push('');
      lines.push('【算法建议 — 教练必须传达给用户】');
      for (const r of recommendations) lines.push(`  ${r}`);
    }

    if (coachFocus.length > 0) {
      lines.push('');
      lines.push('【教练重点关注 — 对话中必须触及这些话题】');
      for (const f of coachFocus) lines.push(`  ${f}`);
    }

    return lines.join('\n');
  }

  // ====== callDeepSeek ======
  const callDeepSeek = async (userContent: string) => {
    const today = new Date();
    const todayDateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const todayFull = today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const h = today.getHours();
    const m = today.getMinutes();
    const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const currentTime = `${period} ${String(hour12).padStart(2,'0')}:${String(m).padStart(2,'0')} (24h: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')})`;
    const dayOfWeek = today.getDay();
    const mondayDate = new Date(today);
    mondayDate.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(mondayDate.getDate() + i);
      weekDates.push(d.toISOString().slice(0, 10));
    }

    const context = `【系统时间】${currentTime}\n` + buildContext(todayDateStr, todayFull, weekDates);

    const state = useStore.getState();
    const memories = useMemoryStore.getState().memories;

    const semesterWeek = getCurrentWeek(SEMESTER_START);
    const stateAnalysis = analyzeState({
      today: todayDateStr,
      hour: h,
      minute: m,
      dayOfWeek,
      activityLogs: state.activityLogs,
      tasks: state.tasks,
      subjectProgress: state.subjectProgress,
      streak: state.streak,
      achievements: state.achievements,
      petLevel: state.pet.level,
      petCoins: state.pet.coins,
      schedule: state.schedule,
      semesterWeek,
    });
    const stateReport = buildStateReport(stateAnalysis);

    // 跨日上下文：附加上一天的对话摘要
    let crossDayContext = '';
    if (yesterdaySummary) {
      crossDayContext = `\n\n【昨日对话摘要 — 教练可据此追问进展】\n昨天你和教练讨论了：${yesterdaySummary}\n如果今天的对话涉及相关内容，可以自然地问"昨天提到的XX今天做了吗？"`;
    }

    const enrichedContext = stateReport + '\n\n' + context + crossDayContext;

    const userContext = {
      user_id: "default_user",
      user_name: "专升本考生",
      exam_target: "2027年广东专升本考试，目标公办本科院校",
      exam_subjects: ["英语", "高数", "政治", "电子技术"],
      current_tasks: state.tasks.filter(t => !t.completed).map(t => ({
        title: t.title,
        deadline: t.deadline,
        duration: t.duration,
        tags: t.tags,
        date: t.date
      })),
      completed_tasks: state.tasks.filter(t => t.completed).map(t => ({
        title: t.title,
        duration: t.duration,
        date: t.date
      })),
      streak_days: state.streak,
      pet_level: state.pet.level,
      pet_coins: state.pet.coins,
      subject_progress: state.subjectProgress,
      activity_logs: state.activityLogs,
      screen_time_stats: {
        study: state.activityLogs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration, 0) / 60,
        entertainment: state.activityLogs.filter(l => l.category === 'entertainment').reduce((s, l) => s + l.duration, 0) / 60
      },
      memories: memories.slice(0, 10).map(mem => ({
        type: mem.type,
        content: mem.content,
        priority: mem.priority
      })),
      important_items: state.importantItems.map(i => ({
        title: i.title,
        content: i.content,
        priority: i.priority,
        done: i.done
      })),
      system_state: enrichedContext
    };

    const res = await fetch(`${API}/coach/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userContent,
        context: userContext
      }),
    });

    if (!res.ok) {
      throw new Error(`DeepSeek 服务错误: ${res.status}`);
    }

    const d = await res.json();

    return {
      content: d.response || "AI教练暂时无法回复",
      error: !d.success ? d.error : null
    };
  };
  const callDeepSeekRef = useRef(callDeepSeek);
  callDeepSeekRef.current = callDeepSeek;

  // ====== extractPlan ======
  const extractPlan = (content: string): { cleanContent: string; plan?: ChatMessage['plan'] } => {
    const jsonMatch = content.match(/\{[\s\S]*"plan"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          cleanContent: content.replace(jsonMatch[0], '').trim(),
          plan: parsed.plan,
        };
      } catch {}
    }
    return { cleanContent: content };
  };

  // ====== extractMemories ======
  const extractMemories = (content: string): string => {
    const memRegex = /\[MEMORY:(goal|preference|insight|achievement):([^\]]+)\]/gi;
    let clean = content;
    let match;
    while ((match = memRegex.exec(content)) !== null) {
      const type = match[1].toLowerCase() as 'goal' | 'preference' | 'insight' | 'achievement';
      const memContent = match[2].trim();
      useMemoryStore.getState().addMemory({
        type,
        content: memContent,
        tags: [type, 'ai-extracted'],
        priority: type === 'goal' ? 9 : type === 'achievement' ? 5 : 7,
      });
    }
    return clean.replace(/\[MEMORY:[^\]]+\]/gi, '').trim();
  };

  // ====== executeActions ======
  const executeActions = (content: string): { cleanContent: string; summary?: string } => {
    const actionRegex = /\[ACTION:(\w+)\]\s*(\{[\s\S]*?\})/gi;
    let clean = content;
    const results: string[] = [];
    let match;
    while ((match = actionRegex.exec(content)) !== null) {
      const actionName = match[1];
      let payload: any;
      try { payload = JSON.parse(match[2]); } catch { continue; }
      switch (actionName) {
        case 'add_task': {
          const title = payload.title || '新任务';
          // 去重：检查是否已存在标题高度相似的任务（模糊匹配）
          const existing = tasks.find(t => {
            const a = t.title.toLowerCase().replace(/\s+/g, '');
            const b = title.toLowerCase().replace(/\s+/g, '');
            // 完全包含 或 编辑距离 ≤ 3
            if (a.includes(b) || b.includes(a)) return true;
            const common = [...a].filter(c => b.includes(c)).length;
            return common >= Math.max(a.length, b.length) - 3;
          });
          if (existing) {
            results.push(`任务「${title}」已存在（「${existing.title}」），跳过重复添加`);
            break;
          }
          const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          addTask({
            id, title,
            period: payload.period || 'morning', time: payload.time || '',
            duration: payload.duration || 0, tags: payload.tags || [],
            completed: false, source: 'coach',
            deadline: payload.deadline, pomodoroCount: 0,
          });
          results.push(`已添加任务「${title}」`);
          break;
        }
        case 'complete_task': {
          const t = tasks.find(t => !t.completed && t.title.includes(payload.title));
          if (t) { toggleTask(t.id); results.push(`已完成任务「${t.title}」`); }
          else results.push(`未找到可完成的任务「${payload.title}」`);
          break;
        }
        case 'delete_task': {
          const t = tasks.find(t => t.title.includes(payload.title));
          if (t) { deleteTask(t.id); results.push(`已删除任务「${t.title}」`); }
          else results.push(`未找到任务「${payload.title}」`);
          break;
        }
        case 'add_important': {
          const id = `i-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const title = payload.title || '新事项';
          // 去重
          const exists = importantItems.find(i => !i.done && i.title.includes(title));
          if (exists) {
            results.push(`重要事项「${title}」已存在（「${exists.title}」），跳过重复添加`);
            break;
          }
          addImportant({
            id, title,
            content: payload.content || '', priority: (payload.priority === 'high' ? 'high' : 'normal') as 'high' | 'normal',
            done: false, createdAt: new Date().toISOString().slice(0, 10),
            remindAt: payload.remindAt || payload.time || undefined,
          });
          const remindNote = payload.remindAt ? `（${payload.remindAt}前1小时提醒）` : '';
          results.push(`已添加重要事项「${title}」${remindNote}`);
          break;
        }
        case 'complete_important': {
          const item = importantItems.find(i => !i.done && i.title.includes(payload.title));
          if (item) { toggleImportant(item.id); results.push(`已完成重要事项「${item.title}」`); }
          else results.push(`未找到可完成的事项「${payload.title}」`);
          break;
        }
        case 'delete_important': {
          const item = importantItems.find(i => i.title.includes(payload.title));
          if (item) { deleteImportant(item.id); results.push(`已删除重要事项「${item.title}」`); }
          else results.push(`未找到事项「${payload.title}」`);
          break;
        }
        case 'add_schedule': {
          addScheduleItem({
            id: `s-${Date.now()}`,
            name: payload.name || '新课程',
            day: payload.day || 1,
            timeStart: payload.timeStart || '',
            timeEnd: payload.timeEnd || '',
            location: payload.location || '',
            teacher: '',
            weeks: '1-17',
          });
          results.push(`已添加课表「${payload.name}」`);
          break;
        }
        case 'update_schedule': {
          const s = schedule.find(s => s.name === payload.courseName && s.day === payload.day);
          if (s) {
            updateScheduleItem(s.id, {
              timeStart: payload.timeStart,
              timeEnd: payload.timeEnd,
              location: payload.location,
            });
            results.push(`已更新课表「${payload.courseName}」`);
          } else {
            results.push(`未找到课表「${payload.courseName}」`);
          }
          break;
        }
        case 'update_subject_progress': {
          updateSubjectProgress(payload.subject, payload);
          results.push(`已更新${payload.subject}学习进度`);
          break;
        }
        case 'add_exam': {
          addExamRecord({
            id: payload.id || `e-${Date.now()}`,
            subject: payload.subject,
            score: payload.score,
            totalScore: payload.totalScore,
            examType: payload.examType || '章节测试',
            examDate: payload.examDate,
            notes: payload.notes || '',
          });
          results.push(`已记录${payload.subject}考试: ${payload.score}/${payload.totalScore}`);
          break;
        }
        case 'chapter_mastery': {
          updateChapterMastery(payload.subject, payload.chapter, payload.mastery);
          results.push(`已更新「${payload.chapter}」掌握状态为 ${payload.mastery}`);
          break;
        }
        case 'add_checklist': {
          addStudyChecklist({
            id: `cl-${Date.now()}`,
            title: payload.title || '清单',
            type: payload.type === 'verify' ? 'verify' : 'execute',
            items: payload.items || [],
            chapterName: payload.chapterName,
            subject: payload.subject,
          });
          results.push(`已创建${payload.type === 'verify' ? '核查' : '执行'}清单「${payload.title}」`);
          break;
        }
        case 'add_practice_log': {
          addPracticeLog({
            id: `pl-${Date.now()}`,
            date: new Date().toISOString().slice(0, 10),
            subject: payload.subject,
            chapter: payload.chapter || '',
            checklistUsed: payload.checklistUsed || '',
            result: payload.result || '',
            nextAction: payload.nextAction || '',
          });
          results.push(`已记录练习：${payload.chapter} — ${payload.result}`);
          break;
        }
      }
    }
    clean = clean.replace(/\[ACTION:\w+\]\s*\{[\s\S]*?\}/gi, '').trim();
    return { cleanContent: clean, summary: results.length > 0 ? results.join('；') : undefined };
  };

  // ====== doSend: core send logic ======
  const doSend = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    // Always send to today's session
    const date = getTodayStr();
    if (activeSessionDate !== date) {
      useStore.setState({ activeSessionDate: date });
    }

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    addMessage(date, userMsg);
    setInput('');
    setLoading(true);

    try {
      const result = await callDeepSeek(text);

      if (result.error) {
        addMessage(date, { id: `c-${Date.now()}`, role: 'coach', content: `AI教练出错：${result.error}` });
        setLoading(false);
        return;
      }

      let content = result.content || '（AI 返回了空内容，请重试）';
      content = extractMemories(content);
      const { cleanContent: afterActions, summary: actionSummary } = executeActions(content);
      const { cleanContent, plan } = extractPlan(afterActions);

      const reply: ChatMessage = { id: `c-${Date.now()}`, role: 'coach', content: cleanContent, plan };
      addMessage(date, reply);
      if (actionSummary) {
        addMessage(date, { id: `sys-${Date.now()}`, role: 'coach', content: actionSummary });
      }

      // Voice: speak the coach reply
      if (voiceOn && cleanContent) {
        speak(cleanContent);
      }
    } catch (e: any) {
      addMessage(date, { id: `c-${Date.now()}`, role: 'coach', content: `网络错误：${e.message}。请检查 API 服务是否启动。` });
    }
    setLoading(false);
  }, [loading, activeSessionDate, addMessage, voiceOn, speak]);

  const handleSend = () => doSend(input);

  const handleOption = async (opt: string) => {
    const date = getTodayStr();
    if (activeSessionDate !== date) {
      useStore.setState({ activeSessionDate: date });
    }
    addMessage(date, { id: `u-${Date.now()}`, role: 'user', content: opt });
    setLoading(true);
    try {
      const result = await callDeepSeek(opt);
      if (result.error) {
        addMessage(date, { id: `c-${Date.now()}`, role: 'coach', content: `出错了：${result.error}` });
        setLoading(false);
        return;
      }
      let content = result.content || '';
      content = extractMemories(content);
      const { cleanContent: afterActions, summary: actionSummary } = executeActions(content);
      const { cleanContent, plan } = extractPlan(afterActions);
      addMessage(date, { id: `c-${Date.now()}`, role: 'coach', content: cleanContent, plan });
      if (actionSummary) {
        addMessage(date, { id: `sys-${Date.now()}`, role: 'coach', content: actionSummary });
      }
      if (voiceOn && cleanContent) {
        speak(cleanContent);
      }
    } catch (e: any) {
      addMessage(date, { id: `c-${Date.now()}`, role: 'coach', content: `错误：${e.message}` });
    }
    setLoading(false);
  };

  // Quick action handler
  const quickActions = [
    { icon: '📋', label: '帮我规划今天', prompt: '根据我今天课表和未完成任务，帮我规划今天的学习计划' },
    { icon: '😫', label: '今天状态不好', prompt: '我今天状态不太好，学不进去，怎么办？' },
    { icon: '✅', label: '汇报进度', prompt: '我完成了一些任务，帮我看看今天整体表现怎么样' },
    { icon: '📊', label: '周总结', prompt: '帮我总结这周的学习情况，哪些做得好哪些需要改进' },
    { icon: '🔍', label: '分析薄弱点', prompt: '根据我的学习数据，我的薄弱环节在哪里？给我具体的改进建议' },
    { icon: '🧪', label: '测我', prompt: '测我！随机抽一个章节出题考我，看看我到底掌握了没有' },
  ];

  const effectiveWidth = isFullWidth ? Math.min(window.innerWidth * 0.9, 900) : panelWidth;

  // ====== Render ======
  return (
    <div style={{
      position: 'absolute', bottom: 12, right: 12,
      width: effectiveWidth, height: 560, background: 'var(--bg-secondary)',
      border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 100,
      transition: isFullWidth ? 'width 0.2s ease' : 'none',
    }}>
      {/* Left-edge drag handle */}
      {!isFullWidth && (
        <div
          onMouseDown={handleDragStart}
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: 6, cursor: 'ew-resize', zIndex: 10,
            borderRadius: '12px 0 0 12px',
          }}
        />
      )}

      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, rgba(78,204,163,0.08), rgba(10,132,255,0.08))',
        borderRadius: '12px 12px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'linear-gradient(135deg, #4ecca3, #0a84ff)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
          }}>🐱</div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>AI 教练</span>
            <span style={{
              fontSize: 10, fontWeight: 700, marginLeft: 6, padding: '2px 6px', borderRadius: 4,
              background: 'linear-gradient(135deg, rgba(78,204,163,0.2), rgba(10,132,255,0.2))',
              color: 'var(--accent)',
            }}>V7</span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--accent)' }}>● DeepSeek R1</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Web search toggle */}
          <button
            onClick={() => setSearchEnabled(!searchEnabled)}
            title={searchEnabled ? '联网搜索已开启' : '联网搜索已关闭'}
            style={{
              padding: '2px 8px', borderRadius: 10, fontSize: 10,
              background: searchEnabled ? 'rgba(10,132,255,0.2)' : 'transparent',
              border: searchEnabled ? '1px solid #0a84ff' : '1px solid var(--border)',
              color: searchEnabled ? '#0a84ff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {searchEnabled ? '🌐 联网' : '🌐'}
          </button>
          {/* Voice toggle */}
          <button
            onClick={() => setVoiceOn(!voiceOn)}
            title={voiceOn ? '语音播报已开启' : '语音播报已关闭'}
            style={{
              padding: '2px 8px', borderRadius: 10, fontSize: 10,
              background: voiceOn ? 'rgba(78,204,163,0.2)' : 'transparent',
              border: voiceOn ? '1px solid #4ecca3' : '1px solid var(--border)',
              color: voiceOn ? '#4ecca3' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {voiceOn ? '🔊 语音' : '🔇'}
          </button>
          {/* Full-width toggle */}
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            title={isFullWidth ? '还原宽度' : '全宽显示'}
            style={{
              padding: '2px 8px', borderRadius: 10, fontSize: 10,
              background: isFullWidth ? 'rgba(10,132,255,0.15)' : 'transparent',
              border: isFullWidth ? '1px solid #0a84ff' : '1px solid var(--border)',
              color: isFullWidth ? '#0a84ff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {isFullWidth ? '⊠ 还原' : '⛶ 全宽'}
          </button>
          {/* Close */}
          <button onClick={toggleCoach} style={{
            background: 'none', color: 'var(--text-muted)', fontSize: 18, padding: '2px 6px',
            cursor: 'pointer', border: 'none',
          }}>×</button>
        </div>
      </div>

      {/* Session tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 14px',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto', flexShrink: 0,
        scrollbarWidth: 'none',
      }}>
        {tabDates.map(date => {
          const active = date === activeSessionDate;
          const session = sessions.find(s => s.date === date);
          const hasMessages = session && session.messages.length > 0;
          return (
            <button
              key={date}
              onClick={() => setActiveSessionDate(date)}
              style={{
                padding: '4px 12px', borderRadius: 14, fontSize: 12,
                whiteSpace: 'nowrap', cursor: 'pointer',
                background: active ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: active ? '#000' : hasMessages ? 'var(--text-primary)' : 'var(--text-muted)',
                border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                fontWeight: active ? 600 : 400,
                opacity: hasMessages || date === todayStr ? 1 : 0.5,
                flexShrink: 0,
              }}
            >
              {formatTabLabel(date, date === todayStr)}
            </button>
          );
        })}
      </div>

      {/* Messages area */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {/* Yesterday summary banner (for non-today sessions) */}
        {!isToday && currentSession?.summary && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, fontSize: 11,
            background: 'rgba(78,204,163,0.08)', border: '1px solid rgba(78,204,163,0.2)',
            color: 'var(--text-secondary)', marginBottom: 4,
          }}>
            <span style={{ color: '#4ecca3', fontWeight: 600 }}>📝 当日摘要：</span>
            {currentSession.summary}
          </div>
        )}

        {/* Status card for empty today session */}
        {isToday && isEmpty && statusCardData && (
          <div style={{
            padding: '16px', borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(78,204,163,0.06), rgba(10,132,255,0.06))',
            border: '1px solid var(--border)',
          }}>
            {/* Header */}
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📅</span>
              <span>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
              <span style={{
                fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                background: 'rgba(10,132,255,0.12)', color: '#0a84ff',
              }}>第{statusCardData.semesterWeek}周</span>
            </div>

            {/* Info rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>📚 今日课表：</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {statusCardData.todayClasses.length > 0
                    ? `${statusCardData.todayClasses.length}节课`
                    : '无课'}
                </span>
              </div>
              {statusCardData.todayClasses.length > 0 && (
                <div style={{ paddingLeft: 98 }}>
                  {statusCardData.todayClasses.map((c, i) => (
                    <div key={i} style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.6 }}>
                      {c.timeStart}-{c.timeEnd} {c.name} <span style={{ color: 'var(--text-muted)' }}>@{c.location}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>📋 待完成：</span>
                <span style={{ color: statusCardData.pendingTasks.length > 3 ? '#f59e0b' : 'var(--text-primary)' }}>
                  {statusCardData.pendingTasks.length}个任务
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>🔥 连胜：</span>
                <span style={{ color: 'var(--text-primary)' }}>{useStore.getState().streak}天</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>⏱ 已学习：</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {statusCardData.todayStudyMin >= 60
                    ? `${Math.floor(statusCardData.todayStudyMin / 60)}h${statusCardData.todayStudyMin % 60}m`
                    : `${statusCardData.todayStudyMin}分钟`}
                </span>
              </div>

              {/* 今日到期复习 */}
              {statusCardData.reviewDue.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>🔔 待复习：</span>
                  <span style={{ color: '#f59e0b', fontSize: 11 }}>
                    {statusCardData.reviewDue.map(r => `${r.chapter}(${r.daysAgo}天前)`).join(', ')}
                  </span>
                </div>
              )}
            </div>

            {/* Recommendations */}
            {statusCardData.analysis.recommendations.length > 0 && (
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'rgba(78,204,163,0.08)', border: '1px solid rgba(78,204,163,0.15)',
                marginBottom: 12,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#4ecca3', marginBottom: 6 }}>💡 今日建议</div>
                {statusCardData.analysis.recommendations.slice(0, 3).map((r, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    • {r}
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => doSend('你好教练，帮我分析一下今天的情况，给我一些建议')}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 10,
                  background: 'var(--accent)', color: '#000',
                  border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                💬 开始对话
              </button>
              <button
                onClick={() => {
                  useStore.setState({ coachOpen: false });
                  // Trigger quick start study
                  const state = useStore.getState();
                  const subjects = Object.entries(state.subjectProgress) as [SubjectKey, SubjectProgress][];
                  const sorted = subjects.sort((a, b) => a[1].totalMinutes - b[1].totalMinutes);
                  state.startStudyTimer(sorted[0][0]);
                }}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 10,
                  background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                🎯 先学5分钟
              </button>
            </div>
          </div>
        )}

        {/* Empty non-today session */}
        {!isToday && isEmpty && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 12,
          }}>
            这天没有对话记录
          </div>
        )}

        {/* Messages */}
        {currentMessages.map(msg => (
          <div key={msg.id}>
            <div style={{ display: 'flex', justifyContent: msg.role === 'coach' ? 'flex-start' : 'flex-end' }}>
              <div style={{
                maxWidth: '85%', padding: '8px 12px', borderRadius: 10,
                background: msg.role === 'coach' ? 'var(--bg-tertiary)' : 'var(--accent)',
                color: msg.role === 'coach' ? 'var(--text-primary)' : '#000',
                fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                borderTopLeftRadius: msg.role === 'coach' ? 2 : 10,
                borderTopRightRadius: msg.role === 'coach' ? 10 : 2,
              }}>
                {msg.content}
              </div>
            </div>

            {msg.options && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, paddingLeft: 4 }}>
                {msg.options.map(opt => (
                  <button key={opt} onClick={() => handleOption(opt)} style={{
                    padding: '4px 12px', borderRadius: 16,
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
                  }}>{opt}</button>
                ))}
              </div>
            )}

            {msg.plan && (
              <div style={{ marginTop: 6, paddingLeft: 4 }}>
                {msg.plan.map((p, i) => (
                  <div key={i} style={{
                    padding: '7px 10px', borderRadius: 8,
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                    marginBottom: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary)', marginRight: 8 }}>{p.time}</span>
                      {p.title}
                    </div>
                    {p.tag && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(78,204,163,0.15)', color: 'var(--accent)' }}>{p.tag}</span>}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button onClick={() => {
                    applyPlan(msg.plan);
                    const date = getTodayStr();
                    addMessage(date, { id: `u-${Date.now()}`, role: 'user', content: '确认应用计划' });
                    addMessage(date, { id: `c-${Date.now()}`, role: 'coach', content: '计划已应用！加油~' });
                  }} style={{
                    padding: '5px 14px', borderRadius: 6, background: 'var(--accent)', color: '#000',
                    fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
                  }}>
                    应用计划
                  </button>
                  <button onClick={() => handleOption('调整一下计划')} style={{
                    padding: '5px 14px', borderRadius: 6, background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: 12, cursor: 'pointer',
                  }}>调整</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '8px 12px', borderRadius: 10, background: 'var(--bg-tertiary)',
              fontSize: 12, color: 'var(--text-muted)',
            }}>小橘正在深度思考...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick action buttons */}
      <div style={{
        display: 'flex', gap: 4, padding: '0 14px 6px',
        overflowX: 'auto', flexShrink: 0,
        scrollbarWidth: 'none',
      }}>
        {quickActions.map(qa => (
          <button
            key={qa.label}
            onClick={() => doSend(qa.prompt)}
            disabled={loading}
            style={{
              padding: '4px 10px', borderRadius: 14, fontSize: 11,
              whiteSpace: 'nowrap', cursor: loading ? 'default' : 'pointer',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', opacity: loading ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {qa.icon} {qa.label}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={isToday ? '问任何问题：学习、编程、写作、闲聊...' : '切换到今天才能发送新消息'}
          disabled={!isToday}
          style={{
            flex: 1, padding: '7px 12px', borderRadius: 8,
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 12, outline: 'none',
            opacity: isToday ? 1 : 0.5,
          }}
        />
        <button onClick={handleSend} disabled={loading || !isToday} style={{
          padding: '7px 14px', borderRadius: 8, background: loading || !isToday ? 'var(--border)' : 'var(--accent)',
          color: '#000', fontSize: 12, fontWeight: 500, opacity: loading || !isToday ? 0.5 : 1,
          border: 'none', cursor: loading || !isToday ? 'default' : 'pointer',
        }}>发送</button>
      </div>
    </div>
  );
}
