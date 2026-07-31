import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { Task, Period } from '../types';

const periodConfig: Record<Period, { label: string; icon: string; color: string }> = {
  morning: { label: '上午', icon: '🌅', color: '#ffaf4c' },
  afternoon: { label: '下午', icon: '☀️', color: '#0a84ff' },
  evening: { label: '晚上', icon: '🌙', color: '#a855f7' },
};

const periodColorClass: Record<Period, string> = {
  morning: 'text-[#ffaf4c]',
  afternoon: 'text-[var(--blue)]',
  evening: 'text-[var(--purple)]',
};

export function TaskList() {
  const tasks = useStore(s => s.tasks);
  const toggle = useStore(s => s.toggleTask);
  const deleteTask = useStore(s => s.deleteTask);
  const addTask = useStore(s => s.addTask);
  const addTaskOpen = useStore(s => s.addTaskOpen);
  const toggleAddTask = useStore(s => s.toggleAddTask);
  const [newTask, setNewTask] = useState({ title: '', period: 'morning' as Period, time: '14:00-15:00', tags: '', duration: 60, deadline: '' });

  const periods: Period[] = ['morning', 'afternoon', 'evening'];
  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;

  const handleAdd = () => {
    if (!newTask.title.trim()) return;
    addTask({
      id: `manual-${Date.now()}`, title: newTask.title, period: newTask.period,
      time: newTask.time, duration: newTask.duration,
      tags: newTask.tags.split(',').map(t => t.trim()).filter(Boolean),
      completed: false, source: 'manual', pomodoroCount: 0,
      ...(newTask.deadline ? { deadline: newTask.deadline } : {}),
    });
    setNewTask({ title: '', period: 'morning', time: '14:00-15:00', tags: '', duration: 60, deadline: '' });
    toggleAddTask();
  };

  return (
    <div className="flex-1 flex flex-col p-[20px_24px] overflow-hidden">
      <div className="flex items-center justify-between mb-[16px]">
        <div className="flex items-center gap-[12px]">
          <h2 className="text-[18px] font-semibold">今日任务</h2>
          <span className="text-[12px] text-[var(--text-secondary)]">{done}/{total} 完成</span>
        </div>
        <button onClick={toggleAddTask} className="p-[6px_14px] rounded-[6px] bg-[var(--accent)] text-[#000] text-[12px] font-medium">
          + 添加任务
        </button>
      </div>

      {addTaskOpen && (
        <div className="p-[16px] rounded-[8px] mb-[16px] bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[14px] font-semibold mb-[8px]">添加新任务</div>
          <div className="flex flex-col gap-[8px]">
            <input value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })}
              placeholder="任务标题（可粘贴微信作业文字）"
              className="p-[8px_12px] rounded-[6px] text-[13px] bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] outline-none" />
            <div className="flex gap-[8px]">
              <select value={newTask.period} onChange={e => setNewTask({ ...newTask, period: e.target.value as Period })}
                className="flex-1 p-[8px_12px] rounded-[6px] bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[13px] outline-none">
                <option value="morning">上午</option>
                <option value="afternoon">下午</option>
                <option value="evening">晚上</option>
              </select>
              <input value={newTask.time} onChange={e => setNewTask({ ...newTask, time: e.target.value })} placeholder="时间"
                className="flex-1 p-[8px_12px] rounded-[6px] bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[13px] outline-none" />
            </div>
            <div className="flex gap-[8px]">
              <select value={newTask.duration} onChange={e => setNewTask({ ...newTask, duration: Number(e.target.value) })}
                className="flex-1 p-[8px_12px] rounded-[6px] bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[13px] outline-none">
                <option value={30}>30分钟</option>
                <option value={60}>60分钟</option>
                <option value={90}>90分钟</option>
                <option value={120}>120分钟</option>
                <option value={180}>180分钟</option>
              </select>
              <input value={newTask.deadline} onChange={e => setNewTask({ ...newTask, deadline: e.target.value })}
                placeholder="截止（如：明天 / 3天后 / 2026-08-10）"
                className="flex-1 p-[8px_12px] rounded-[6px] bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[13px] outline-none" />
            </div>
            <input value={newTask.tags} onChange={e => setNewTask({ ...newTask, tags: e.target.value })}
              placeholder="标签（逗号分隔，如：DDL, 小组）"
              className="p-[8px_12px] rounded-[6px] text-[13px] bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] outline-none" />
            <div className="flex gap-[8px]">
              <button onClick={handleAdd} className="flex-1 p-[8px_12px] rounded-[6px] bg-[var(--accent)] text-[#000] text-[12px] font-medium">
                确认添加
              </button>
              <button onClick={toggleAddTask} className="flex-1 p-[8px_12px] rounded-[6px] bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border)] text-[12px]">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-[16px]">
        {periods.map(period => {
          const periodTasks = tasks.filter(t => t.period === period);
          if (periodTasks.length === 0) return null;
          const cfg = periodConfig[period];
          return (
            <div key={period}>
              <div className={`text-[12px] font-semibold mb-[8px] flex items-center gap-[6px] ${periodColorClass[period]}`}>
                <span>{cfg.icon}</span>{cfg.label}
              </div>
              <div className="flex flex-col gap-[6px]">
                {periodTasks.map(task => (
                  <TaskCard key={task.id} task={task} onToggle={() => toggle(task.id)} onDelete={() => deleteTask(task.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes float-up {
          0% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-24px); }
        }
      `}</style>
    </div>
  );
}

function TaskCard({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) {
  // 解析二选一格式：A / B（二选一） 或 A / B
  const choiceMatch = task.title.match(/^(.+?)\s*\/\s*(.+?)(?:\s*[（(]二选一[）)])?\s*$/);
  const isChoice = !!choiceMatch;
  const [optA, optB] = isChoice && choiceMatch ? [choiceMatch[1].trim(), choiceMatch[2].trim()] : ['', ''];

  const [chosen, setChosen] = useState<'A' | 'B' | null>(task.completed ? 'A' : null);

  // 完成任务时的飘字动画
  const [floatAnim, setFloatAnim] = useState(false);
  const prevCompleted = useRef(task.completed);
  useEffect(() => {
    if (task.completed && !prevCompleted.current) {
      setFloatAnim(true);
      const t = setTimeout(() => setFloatAnim(false), 800);
      prevCompleted.current = true;
      return () => clearTimeout(t);
    }
    prevCompleted.current = task.completed;
  }, [task.completed]);

  const handleChoice = (pick: 'A' | 'B') => {
    setChosen(pick);
    onToggle(); // 标记任务完成
  };

  const handleRandom = () => {
    const pick = Math.random() < 0.5 ? 'A' : 'B';
    handleChoice(pick);
  };

  if (isChoice && optA && optB) {
    const picked = task.completed && chosen;
    return (
      <div className={`flex flex-col gap-[4px] p-[10px_14px] rounded-[8px] transition-[all_0.2s_ease] relative overflow-hidden border ${task.completed ? 'bg-[rgba(78,204,163,0.08)] border-[rgba(78,204,163,0.2)] opacity-60' : 'bg-[var(--bg-card)] border-[var(--border)] opacity-100'}`}>
        {/* 完成飘字动画 */}
        {floatAnim && (
          <span className="absolute right-[12px] top-[50%] text-[13px] font-bold text-[#4ecca3] animate-[float-up_0.8s_ease-out_forwards] pointer-events-none z-[10]">+50XP +10🪙</span>
        )}
        <div className="flex items-center gap-[8px] mb-[6px]">
          <span className="text-[10px] p-[2px_6px] rounded-[4px] bg-[rgba(168,85,247,0.15)] text-[var(--purple)] font-semibold">二选一</span>
          <span className="text-[11px] text-[var(--text-secondary)]">⏰ {task.time}</span>
          {!task.completed && (
            <button onClick={handleRandom} className="ml-auto p-[2px_8px] text-[11px] bg-[rgba(255,175,76,0.15)] text-[#ffaf4c] border border-[rgba(255,175,76,0.3)] rounded-[4px] cursor-pointer">🎲 抽签</button>
          )}
        </div>
        {[['A', optA], ['B', optB]].map(([key, label]) => {
          const isPicked = picked === key;
          const otherPicked = picked && picked !== key;
          return (
            <div key={key} onClick={() => !task.completed && handleChoice(key as 'A' | 'B')} className={`flex items-center gap-[8px] p-[6px_10px] rounded-[6px] border ${isPicked ? 'bg-[rgba(78,204,163,0.12)] border-[rgba(78,204,163,0.3)]' : 'bg-[var(--bg-input)] border-[var(--border)]'} ${task.completed ? 'cursor-default' : 'cursor-pointer'} ${otherPicked ? 'opacity-35 line-through' : 'opacity-100'}`}>
              <div className={`w-[16px] h-[16px] rounded-full shrink-0 flex items-center justify-center border-2 ${isPicked ? 'border-[var(--accent)] bg-[var(--accent)]' : otherPicked ? 'border-[var(--border)] bg-transparent' : 'border-[var(--text-muted)] bg-transparent'}`}>
                {isPicked && <span className="text-[#fff] text-[9px]">✓</span>}
              </div>
              <span className={`text-[13px] ${isPicked ? 'font-semibold text-[var(--accent)]' : otherPicked ? 'font-normal text-[var(--text-muted)]' : 'font-normal text-[var(--text-primary)]'}`}>{label as string}</span>
              {isPicked && <span className="text-[10px] text-[var(--accent)] ml-auto">已选</span>}
            </div>
          );
        })}
        <div className="flex gap-[4px] mt-[2px]">
          {task.tags.map(tag => (
            <span key={tag} className={`text-[10px] p-[2px_6px] rounded-[4px] ${tag === 'DDL' ? 'bg-[rgba(233,69,96,0.15)] text-[var(--red)]' : 'bg-[rgba(10,132,255,0.15)] text-[var(--blue)]'}`}>{tag}</span>
          ))}
          {task.deadline && <span className="text-[10px] text-[var(--red-soft)]">{task.deadline}</span>}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="ml-auto p-[2px_6px] text-[10px] bg-[rgba(233,69,96,0.1)] text-[var(--red-soft)] border border-[rgba(233,69,96,0.2)] rounded-[4px]">删除</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-[10px] p-[10px_14px] rounded-[8px] transition-[all_0.2s_ease] relative overflow-hidden border ${task.completed ? 'bg-[rgba(78,204,163,0.08)] border-[rgba(78,204,163,0.2)] opacity-60' : 'bg-[var(--bg-card)] border-[var(--border)] opacity-100'}`}>
      {/* 完成飘字动画 */}
      {floatAnim && (
        <span className="absolute right-[12px] top-[50%] text-[13px] font-bold text-[#4ecca3] animate-[float-up_0.8s_ease-out_forwards] pointer-events-none z-[10]">+50XP +10🪙</span>
      )}
      <div onClick={onToggle} className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 cursor-pointer border-2 ${task.completed ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border)] bg-transparent'}`}>
        {task.completed && <span className="text-[#fff] text-[10px]">✓</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-medium ${task.completed ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
          {task.title}
        </div>
        <div className="text-[11px] text-[var(--text-secondary)] flex gap-[8px] mt-[2px]">
          <span>⏰ {task.time}</span>
        </div>
      </div>
      <div className="flex gap-[4px] flex-shrink-0">
        {task.tags.map(tag => (
          <span key={tag} className={`text-[10px] p-[2px_6px] rounded-[4px] ${tag === 'DDL' ? 'bg-[rgba(233,69,96,0.15)] text-[var(--red)]' : tag === '小组' ? 'bg-[rgba(168,85,247,0.15)] text-[var(--purple)]' : tag === '运动' ? 'bg-[rgba(78,204,163,0.15)] text-[var(--accent)]' : 'bg-[rgba(10,132,255,0.15)] text-[var(--blue)]'}`}>{tag}</span>
        ))}
      </div>
      {task.deadline && <span className="text-[10px] text-[var(--red-soft)] flex-shrink-0">{task.deadline}</span>}
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-[2px_6px] text-[10px] bg-[rgba(233,69,96,0.1)] text-[var(--red-soft)] border border-[rgba(233,69,96,0.2)] rounded-[4px]">删除</button>
    </div>
  );
}