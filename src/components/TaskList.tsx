import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { Task, Period } from '../types';

const periodConfig: Record<Period, { label: string; icon: string; color: string }> = {
  morning: { label: '上午', icon: '🌅', color: '#ffaf4c' },
  afternoon: { label: '下午', icon: '☀️', color: '#0a84ff' },
  evening: { label: '晚上', icon: '🌙', color: '#a855f7' },
};

export function TaskList() {
  const tasks = useStore(s => s.tasks);
  const toggle = useStore(s => s.toggleTask);
  const deleteTask = useStore(s => s.deleteTask);
  const addTask = useStore(s => s.addTask);
  const addTaskOpen = useStore(s => s.addTaskOpen);
  const toggleAddTask = useStore(s => s.toggleAddTask);
  const [newTask, setNewTask] = useState({ title: '', period: 'morning' as Period, time: '14:00-15:00', tags: '' });

  const periods: Period[] = ['morning', 'afternoon', 'evening'];
  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;

  const handleAdd = () => {
    if (!newTask.title.trim()) return;
    addTask({
      id: `manual-${Date.now()}`, title: newTask.title, period: newTask.period,
      time: newTask.time, duration: 60,
      tags: newTask.tags.split(',').map(t => t.trim()).filter(Boolean),
      completed: false, source: 'manual', pomodoroCount: 0,
    });
    setNewTask({ title: '', period: 'morning', time: '14:00-15:00', tags: '' });
    toggleAddTask();
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>今日任务</h2>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{done}/{total} 完成</span>
          {tasks.some(t => t.source === 'wechat') && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(10,132,255,0.15)', color: 'var(--blue)' }}>💬 含微信作业</span>
          )}
          {tasks.some(t => t.source === 'schedule') && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(168,85,247,0.15)', color: 'var(--purple)' }}>📅 课表导入</span>
          )}
        </div>
        <button onClick={toggleAddTask} style={{
          padding: '6px 14px', borderRadius: 6,
          background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 500,
        }}>
          + 添加任务
        </button>
      </div>

      {addTaskOpen && (
        <div style={{
          padding: 16, borderRadius: 8, marginBottom: 16,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>添加新任务 — 支持粘贴微信截图OCR解析</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })}
              placeholder="任务标题（或粘贴微信作业截图路径）"
              style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={newTask.period} onChange={e => setNewTask({ ...newTask, period: e.target.value as Period })}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}>
                <option value="morning">上午</option>
                <option value="afternoon">下午</option>
                <option value="evening">晚上</option>
              </select>
              <input value={newTask.time} onChange={e => setNewTask({ ...newTask, time: e.target.value })} placeholder="时间"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
            </div>
            <input value={newTask.tags} onChange={e => setNewTask({ ...newTask, tags: e.target.value })}
              placeholder="标签（逗号分隔，如：DDL, 小组）"
              style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAdd} style={{ flex: 1, padding: '8px 12px', borderRadius: 6, background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 500 }}>
                确认添加
              </button>
              <button onClick={toggleAddTask} style={{ flex: 1, padding: '8px 12px', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: 12 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {periods.map(period => {
          const periodTasks = tasks.filter(t => t.period === period);
          if (periodTasks.length === 0) return null;
          const cfg = periodConfig[period];
          return (
            <div key={period}>
              <div style={{ fontSize: 12, color: cfg.color, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{cfg.icon}</span>{cfg.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
  const icons: Record<string, string> = { wechat: '💬', schedule: '📅', ocr: '📸', manual: '✏️' };
  const labels: Record<string, string> = { wechat: '微信', schedule: '课表', ocr: '截图', manual: '手动' };

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
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '10px 14px', borderRadius: 8,
        background: task.completed ? 'rgba(78,204,163,0.08)' : 'var(--bg-card)',
        border: `1px solid ${task.completed ? 'rgba(78,204,163,0.2)' : 'var(--border)'}`,
        opacity: task.completed ? 0.6 : 1, transition: 'all 0.2s',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* 完成飘字动画 */}
        {floatAnim && (
          <span style={{
            position: 'absolute', right: 12, top: '50%',
            fontSize: 13, fontWeight: 700, color: '#4ecca3',
            animation: 'float-up 0.8s ease-out forwards',
            pointerEvents: 'none', zIndex: 10,
          }}>+50XP +10🪙</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.15)', color: 'var(--purple)', fontWeight: 600 }}>二选一</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>⏰ {task.time}</span>
          {!task.completed && (
            <button onClick={handleRandom} style={{
              marginLeft: 'auto', padding: '2px 8px', fontSize: 11,
              background: 'rgba(255,175,76,0.15)', color: '#ffaf4c',
              border: '1px solid rgba(255,175,76,0.3)', borderRadius: 4, cursor: 'pointer',
            }}>🎲 抽签</button>
          )}
        </div>
        {[['A', optA], ['B', optB]].map(([key, label]) => {
          const isPicked = picked === key;
          const otherPicked = picked && picked !== key;
          return (
            <div key={key} onClick={() => !task.completed && handleChoice(key as 'A' | 'B')} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              background: isPicked ? 'rgba(78,204,163,0.12)' : 'var(--bg-input)',
              border: `1px solid ${isPicked ? 'rgba(78,204,163,0.3)' : 'var(--border)'}`,
              cursor: task.completed ? 'default' : 'pointer',
              opacity: otherPicked ? 0.35 : 1,
              textDecoration: otherPicked ? 'line-through' : 'none',
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                border: `2px solid ${isPicked ? 'var(--accent)' : otherPicked ? 'var(--border)' : 'var(--text-muted)'}`,
                background: isPicked ? 'var(--accent)' : 'transparent',
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isPicked && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
              </div>
              <span style={{
                fontSize: 13, fontWeight: isPicked ? 600 : 400,
                color: isPicked ? 'var(--accent)' : otherPicked ? 'var(--text-muted)' : 'var(--text-primary)',
              }}>{label as string}</span>
              {isPicked && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 'auto' }}>已选</span>}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          {task.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 4,
              background: tag === 'DDL' ? 'rgba(233,69,96,0.15)' : 'rgba(10,132,255,0.15)',
              color: tag === 'DDL' ? 'var(--red)' : 'var(--blue)',
            }}>{tag}</span>
          ))}
          {task.deadline && <span style={{ fontSize: 10, color: 'var(--red-soft)' }}>{task.deadline}</span>}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{
            marginLeft: 'auto', padding: '2px 6px', fontSize: 10,
            background: 'rgba(233,69,96,0.1)', color: 'var(--red-soft)',
            border: '1px solid rgba(233,69,96,0.2)', borderRadius: 4,
          }}>删除</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 8,
      background: task.completed ? 'rgba(78,204,163,0.08)' : 'var(--bg-card)',
      border: `1px solid ${task.completed ? 'rgba(78,204,163,0.2)' : 'var(--border)'}`,
      opacity: task.completed ? 0.6 : 1, transition: 'all 0.2s',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* 完成飘字动画 */}
      {floatAnim && (
        <span style={{
          position: 'absolute', right: 12, top: '50%',
          fontSize: 13, fontWeight: 700, color: '#4ecca3',
          animation: 'float-up 0.8s ease-out forwards',
          pointerEvents: 'none', zIndex: 10,
        }}>+50XP +10🪙</span>
      )}
      <div onClick={onToggle} style={{
        width: 18, height: 18, borderRadius: '50%',
        border: `2px solid ${task.completed ? 'var(--accent)' : 'var(--border)'}`,
        background: task.completed ? 'var(--accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer',
      }}>
        {task.completed && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, textDecoration: task.completed ? 'line-through' : 'none', color: task.completed ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {task.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 8, marginTop: 2 }}>
          <span>⏰ {task.time}</span>
          <span>{icons[task.source]} {labels[task.source]}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {task.tags.map(tag => (
          <span key={tag} style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 4,
            background: tag === 'DDL' ? 'rgba(233,69,96,0.15)' : tag === '小组' ? 'rgba(168,85,247,0.15)' : tag === '运动' ? 'rgba(78,204,163,0.15)' : 'rgba(10,132,255,0.15)',
            color: tag === 'DDL' ? 'var(--red)' : tag === '小组' ? 'var(--purple)' : tag === '运动' ? 'var(--accent)' : 'var(--blue)',
          }}>{tag}</span>
        ))}
      </div>
      {task.deadline && <span style={{ fontSize: 10, color: 'var(--red-soft)', flexShrink: 0 }}>{task.deadline}</span>}
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{
        padding: '2px 6px', fontSize: 10, background: 'rgba(233,69,96,0.1)', color: 'var(--red-soft)',
        border: '1px solid rgba(233,69,96,0.2)', borderRadius: 4,
      }}>删除</button>
    </div>
  );
}