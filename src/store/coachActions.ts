import { useStore } from './useStore';
import { localToday } from '../utils';

/**
 * 解析教练回复中的 [ACTION:xxx] 指令并执行。
 * 独立模块：始终从 useStore.getState() 读取实时状态，避免组件闭包过期。
 */
export function executeCoachActions(content: string): { cleanContent: string; summary?: string } {
  const liveState = useStore.getState();
  const {
    tasks, importantItems, schedule,
    addTask, toggleTask, deleteTask,
    addImportant, toggleImportant, deleteImportant,
    addScheduleItem, updateScheduleItem, updateSubjectProgress, addExamRecord,
    updateChapterMastery, addStudyChecklist, addPracticeLog,
  } = liveState;
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
          done: false, createdAt: localToday(),
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
          date: localToday(),
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
}
