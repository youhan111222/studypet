import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useMemoryStore } from '../store/memory';
import type { ChatMessage, SubjectKey, SubjectProgress } from '../types';

const API = '';  // 走 Vite 代理 → /coach → 19999
const TOTAL_WEEKS = 17; // 学期总周数

export function CoachPanel() {
  const messages = useStore(s => s.messages);
  const addMessage = useStore(s => s.addMessage);
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
  const addExamRecord = useStore(s => s.addExamRecord);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  // 主动问候：打开教练时若距离上次对话超过5分钟，自动分析当前状态
  const hasGreeted = useRef(false);
  useEffect(() => {
    if (hasGreeted.current) return;
    const lastMsg = messages[messages.length - 1];
    const staleMs = 5 * 60 * 1000;
    if (!lastMsg || Date.now() - parseInt(lastMsg.id.split('-')[1] || '0') > staleMs) {
      hasGreeted.current = true;
      const doGreet = async () => {
        setLoading(true);
        try {
          const result = await callDeepSeekRef.current('【系统自动触发 - 用户刚打开AI助手，请主动分析当前状态并给出问候和建议。直接开口，不要问"有什么事"】');
          if (result.error) { setLoading(false); return; }
          let content = result.content || '';
          content = extractMemories(content);
          const { cleanContent: afterActions, summary: actionSummary } = executeActions(content);
          const { cleanContent } = extractPlan(afterActions);
          addMessage({ id: `c-${Date.now()}`, role: 'coach', content: cleanContent });
          if (actionSummary) {
            addMessage({ id: `sys-${Date.now()}`, role: 'coach', content: actionSummary });
          }
        } catch { /* silent */ }
        setLoading(false);
      };
      doGreet();
    } else {
      hasGreeted.current = true;
    }
  }, []);

  // 解析 weeks 字段判断某课程是否在某周生效
  const isWeekInRange = (weeks: string, w: number): boolean => {
    if (!weeks) return true;
    const s = String(weeks);
    const parts = s.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(Number);
        if (w >= start && w <= end) return true;
      } else {
        if (Number(trimmed) === w) return true;
      }
    }
    return false;
  };

  const buildContext = (todayStr: string, todayFull: string, weekDates: string[]): string => {
    const state = useStore.getState();
    const { tasks, schedule, activityLogs, importantItems, pet, achievements, streak, weekStats, autoPlan, subjectProgress, examRecords } = state;

    const done = tasks.filter(t => t.completed);
    const remaining = tasks.filter(t => !t.completed);
    const dayNamesZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    // 教学周计算（本地时间）
    // 开学日期（2026年春季学期），后续可改为用户配置
    const [sy, sm, sd] = '2026-03-02'.split('-').map(Number);
    const parseDate = (s: string) => {
      const [py, pm, pd] = s.split('-').map(Number);
      return new Date(py, pm - 1, pd);
    };
    const semesterStart = new Date(sy, sm - 1, sd);
    const todayDate = parseDate(todayStr);
    const semesterWeek = Math.floor((todayDate.getTime() - semesterStart.getTime()) / (7 * 86400000)) + 1;

    const todayDayOfWeek = parseDate(todayStr).getDay();
    const todayScheduleDay = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;

    // ===== 1. 今日课表 =====
    const todayClasses = schedule.filter(s =>
      s.day === todayScheduleDay && isWeekInRange(s.weeks, semesterWeek)
    );
    const todayClassSummary = todayClasses.length > 0
      ? todayClasses.map(s => `${s.name} ${s.timeStart}-${s.timeEnd}@${s.location}`).join('、')
      : '无课';

    // ===== 2. 本周课表 =====
    const weekLines: string[] = [];
    for (let d = 1; d <= 7; d++) {
      const items = schedule.filter(s => s.day === d && isWeekInRange(s.weeks, semesterWeek));
      weekLines.push(`  ${dayNamesZH[d === 7 ? 0 : d]} ${weekDates[d-1].slice(5)}: ${items.length > 0 ? items.map(s => `${s.name} ${s.timeStart}-${s.timeEnd}`).join(' | ') : '无课'}`);
    }

    // ===== 3. 全学期课表（按周排列，AI 核心数据） =====
    const fullSemesterLines: string[] = [];
    for (let w = 1; w <= TOTAL_WEEKS; w++) {
      const weekCourses: string[] = [];
      for (let d = 1; d <= 7; d++) {
        const items = schedule.filter(s => s.day === d && isWeekInRange(s.weeks, w));
        if (items.length > 0) {
          weekCourses.push(`${dayNamesZH[d === 7 ? 0 : d]}: ${items.map(s => `${s.name} ${s.timeStart}-${s.timeEnd}`).join(' | ')}`);
        }
      }
      const tag = w === semesterWeek ? ' ← 当前周' : '';
      fullSemesterLines.push(`  第${w}周${tag}: ${weekCourses.length > 0 ? weekCourses.join('；') : '无课'}`);
    }

    // ===== 4. 课程统计 =====
    const courseNames = [...new Set(schedule.map(s => s.name))];
    const courseStats = courseNames.map(name => {
      const items = schedule.filter(s => s.name === name);
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

    // ===== 5. 全部任务 =====
    const allTasksLines = tasks.map(t =>
      `  [${t.completed ? '✓' : '○'}] ${t.title} | ${t.time} | ${t.tags.join(',') || '无标签'}${t.deadline ? ' | DDL:' + t.deadline : ''}${t.date ? ' | 日期:' + t.date : ''}`
    ).join('\n');

    // ===== 6. 重要事项 =====
    const impLines = importantItems.map(i =>
      `  [${i.done ? '✓' : '○'}] [${i.priority === 'high' ? '!!' : '!'}] ${i.title}${i.content ? ' - ' + i.content : ''} | 创建:${i.createdAt}`
    ).join('\n');

    // ===== 7. 学习活动统计 =====
    const studySec = activityLogs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration * 60, 0);
    const entSec = activityLogs.filter(l => l.category === 'entertainment').reduce((s, l) => s + l.duration * 60, 0);
    const totalTracked = studySec + entSec;
    const studyRatio = totalTracked > 0 ? Math.round((studySec / totalTracked) * 100) : 0;

    // 近7天活动
    const recentLogs = activityLogs.slice(-30);
    const recentStudySec = recentLogs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration * 60, 0);
    const recentDays = [...new Set(recentLogs.map(l => l.date))].length;
    const avgStudyPerDay = recentDays > 0 ? recentStudySec / recentDays : 0;

    // ===== 8. 成就系统 =====
    const achLines = achievements.map(a =>
      `  ${a.unlocked ? '🌟' : '🔒'} ${a.title}: ${a.desc} (${a.progress}/${a.total})`
    ).join('\n');

    // ===== 9. 长期记忆 =====
    const memories = useMemoryStore.getState().memories;
    const highPriorityMemories = memories.filter(m => m.priority >= 7).sort((a, b) => b.priority - a.priority);
    const memoryContext = highPriorityMemories.length > 0
      ? highPriorityMemories.map(m =>
          `  [${m.type === 'goal' ? '长期目标' : m.type === 'preference' ? '偏好' : m.type === 'insight' ? '洞察' : '成就'}] ${m.content}`
        ).join('\n')
      : '  无';

    // ===== 10. 异常检测 =====
    const ratioAlert = totalTracked > 3600 && studyRatio < 50
      ? `⚠️ 今日时间分配失衡：学习仅占${studyRatio}%，娱乐${100-studyRatio}%`
      : '';
    const ddlTasks = remaining.filter(t => t.deadline);
    const ddlConflict = ddlTasks.length >= 2 && ddlTasks.some(t => t.deadline?.includes('明天') || t.deadline?.includes('今天'));
    const overdueTasks = remaining.filter(t => t.deadline && (t.deadline.includes('今天') || t.deadline.includes('昨天')));
    const procrastination = overdueTasks.length > 0;

    // ===== 11. 备考分析 =====
    // 学习断层检测
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
    });

    // 考试成绩
    const examLines = examRecords.length > 0
      ? examRecords.slice(-10).reverse().map(r =>
          `  ${r.examDate} [${subjectNames[r.subject]}] ${r.examType}: ${r.score}/${r.totalScore} (${Math.round(r.score/r.totalScore*100)}%)${r.notes ? ' | 薄弱点:' + r.notes : ''}`
        ).join('\n')
      : '  暂无考试记录（AI可录入：说"记录政治选择题得分"即可）';

    // 近7天各科学习时间（从 activityLogs 提取）
    const recent7Logs = activityLogs.filter(l => {
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

    // 考试倒计时
    // 专升本考试预估日期，后续可改为用户配置
    const estimatedExamDate = parseDate('2027-03-25');
    const daysUntilExam = Math.ceil((estimatedExamDate.getTime() - todayDate.getTime()) / 86400000);
    const weeksUntilExam = Math.floor(daysUntilExam / 7);

    // 备考进度评估
    const totalChapters = (Object.values(subjectProgress) as SubjectProgress[]).reduce((s, sp) => s + sp.completedChapters.length, 0);
    const progressAssessment = totalChapters === 0 ? '⚠️ 尚未开始系统复习，立即行动！'
      : totalChapters < 10 ? `🟡 仅完成${totalChapters}章，进度偏慢`
      : `🟢 已完成${totalChapters}章，持续保持`;

    const context = `===== 系统状态 =====
日期: ${todayFull} | 第${semesterWeek}周（共${TOTAL_WEEKS}周）
宠物: ${pet.name} Lv.${pet.level} EXP:${pet.exp}/${pet.expToNext} | 心情:${pet.mood} | 爱心:${'❤'.repeat(pet.hearts)} | 金币:${pet.coins}
连续打卡: ${streak}天 | 本周专注:${weekStats.focusHours}h | 完成:${weekStats.tasksCompleted}项 | 番茄:${weekStats.pomodoroCount}个 | 自动规划:${autoPlan ? '开' : '关'}

===== 今日课表 =====
${todayClassSummary}

===== 本周课表（${weekDates[0]} ~ ${weekDates[6]}） =====
${weekLines.join('\n')}

===== 全学期课表（完整${TOTAL_WEEKS}周，AI可据此判断未来课业压力、安排备考窗口） =====
${fullSemesterLines.join('\n')}

===== 课程分布统计 =====
${courseStats}

===== 全部任务（${tasks.length}项，完成${done.length}项，未完成${remaining.length}项） =====
${allTasksLines || '  无'}

===== 重要事项（${importantItems.length}项，未完成${importantItems.filter(i => !i.done).length}项） =====
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

    return context;
  };

  const callDeepSeek = async (userContent: string) => {
    // 日期计算
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
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

    const context = `【系统时间】${currentTime}\n` + buildContext(todayStr, todayFull, weekDates);
    
    // 构建用户上下文数据（用于 DeepSeek 服务）
    const state = useStore.getState();
    const memories = useMemoryStore.getState().memories;
    
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
      memories: memories.slice(0, 10).map(m => ({
        type: m.type,
        content: m.content,
        priority: m.priority
      })),
      important_items: state.importantItems.map(i => ({
        title: i.title,
        content: i.content,
        priority: i.priority,
        done: i.done
      })),
      system_state: context
    };

    // 调用 DeepSeek API 服务
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
    
    // 适配现有格式
    return {
      content: d.response || "AI教练暂时无法回复",
      error: !d.success ? d.error : null
    };
  };
  const callDeepSeekRef = useRef(callDeepSeek);
  callDeepSeekRef.current = callDeepSeek;

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
          const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          addTask({
            id, title: payload.title || '新任务',
            period: payload.period || 'morning', time: payload.time || '',
            duration: payload.duration || 0, tags: payload.tags || [],
            completed: false, source: 'coach',
            deadline: payload.deadline, pomodoroCount: 0,
          });
          results.push(`已添加任务「${payload.title}」`);
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
          addImportant({
            id, title: payload.title || '新事项',
            content: payload.content || '', priority: (payload.priority === 'high' ? 'high' : 'normal') as 'high' | 'normal',
            done: false, createdAt: new Date().toISOString().slice(0, 10),
          });
          results.push(`已添加重要事项「${payload.title}」`);
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
      }
    }
    clean = clean.replace(/\[ACTION:\w+\]\s*\{[\s\S]*?\}/gi, '').trim();
    return { cleanContent: clean, summary: results.length > 0 ? results.join('；') : undefined };
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: input };
    addMessage(userMsg);
    const userText = input;
    setInput('');
    setLoading(true);

    try {
      const result = await callDeepSeek(userText);

      if (result.error) {
        addMessage({ id: `c-${Date.now()}`, role: 'coach', content: `AI教练出错：${result.error}` });
        setLoading(false);
        return;
      }

      let content = result.content || '（AI 返回了空内容，请重试）';
      content = extractMemories(content);
      const { cleanContent: afterActions, summary: actionSummary } = executeActions(content);
      const { cleanContent, plan } = extractPlan(afterActions);

      const reply: ChatMessage = { id: `c-${Date.now()}`, role: 'coach', content: cleanContent, plan };
      addMessage(reply);
      if (actionSummary) {
        addMessage({ id: `sys-${Date.now()}`, role: 'coach', content: actionSummary });
      }
    } catch (e: any) {
      addMessage({ id: `c-${Date.now()}`, role: 'coach', content: `网络错误：${e.message}。请检查 API 服务是否启动。` });
    }
    setLoading(false);
  };

  const handleOption = async (opt: string) => {
    addMessage({ id: `u-${Date.now()}`, role: 'user', content: opt });
    setLoading(true);
    try {
      const result = await callDeepSeek(opt);
      if (result.error) {
        addMessage({ id: `c-${Date.now()}`, role: 'coach', content: `出错了：${result.error}` });
        setLoading(false);
        return;
      }
      let content = result.content || '';
      content = extractMemories(content);
      const { cleanContent: afterActions, summary: actionSummary } = executeActions(content);
      const { cleanContent, plan } = extractPlan(afterActions);
      addMessage({ id: `c-${Date.now()}`, role: 'coach', content: cleanContent, plan });
      if (actionSummary) {
        addMessage({ id: `sys-${Date.now()}`, role: 'coach', content: actionSummary });
      }
    } catch (e: any) {
      addMessage({ id: `c-${Date.now()}`, role: 'coach', content: `错误：${e.message}` });
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'absolute', bottom: 12, right: 12,
      width: 460, height: 560, background: 'var(--bg-secondary)',
      border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 100,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, rgba(78,204,163,0.08), rgba(10,132,255,0.08))',
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
          <button
            onClick={() => setSearchEnabled(!searchEnabled)}
            title={searchEnabled ? '联网搜索已开启' : '联网搜索已关闭'}
            style={{
              marginLeft: 6, padding: '2px 8px', borderRadius: 10, fontSize: 10,
              background: searchEnabled ? 'rgba(10,132,255,0.2)' : 'transparent',
              border: searchEnabled ? '1px solid #0a84ff' : '1px solid var(--border)',
              color: searchEnabled ? '#0a84ff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {searchEnabled ? '🌐 联网' : '🌐'}
          </button>
        </div>
        <button onClick={toggleCoach} style={{
          background: 'none', color: 'var(--text-muted)', fontSize: 18, padding: '2px 6px',
        }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(() => {
          // 按天分组：从消息 ID 时间戳提取日期
          const groups: { date: Date; dateKey: string; msgs: ChatMessage[] }[] = [];
          for (const msg of messages) {
            const ts = parseInt(msg.id.split('-')[1] || String(Date.now()));
            const d = new Date(ts);
            const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const last = groups[groups.length - 1];
            if (!last || last.dateKey !== dateKey) {
              groups.push({ date: d, dateKey, msgs: [msg] });
            } else {
              last.msgs.push(msg);
            }
          }
          return groups.map((g, gi) => (
            <div key={`day-${gi}`}>
              {/* 日期分隔线 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 2px',
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{
                  fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap',
                  padding: '2px 10px', borderRadius: 12, background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                }}>
                  {g.date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              {/* 当日消息 */}
              {g.msgs.map(msg => (
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
                          color: 'var(--text-primary)', fontSize: 11,
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
                          addMessage({ id: `u-${Date.now()}`, role: 'user', content: '确认应用计划' });
                          addMessage({ id: `c-${Date.now()}`, role: 'coach', content: '计划已应用！加油~' });
                        }} style={{ padding: '5px 14px', borderRadius: 6, background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 500 }}>
                          应用计划
                        </button>
                        <button onClick={() => handleOption('调整一下计划')} style={{
                          padding: '5px 14px', borderRadius: 6, background: 'var(--bg-tertiary)',
                          color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: 12,
                        }}>调整</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ));
        })()}
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

      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="问任何问题：学习、编程、写作、闲聊..."
          style={{
            flex: 1, padding: '7px 12px', borderRadius: 8,
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 12, outline: 'none',
          }}
        />
        <button onClick={handleSend} disabled={loading} style={{
          padding: '7px 14px', borderRadius: 8, background: loading ? 'var(--border)' : 'var(--accent)',
          color: '#000', fontSize: 12, fontWeight: 500, opacity: loading ? 0.5 : 1,
        }}>发送</button>
      </div>
    </div>
  );
}