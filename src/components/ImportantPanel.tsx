import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { ImportantItem } from '../types';
import { localToday } from '../utils';

export function ImportantPanel() {
  const items = useStore(s => s.importantItems);
  const addImportant = useStore(s => s.addImportant);
  const toggleImportant = useStore(s => s.toggleImportant);
  const deleteImportant = useStore(s => s.deleteImportant);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'high' | 'normal'>('normal');
  const [remindAt, setRemindAt] = useState('');

  const active = items.filter(i => !i.done);
  const done = items.filter(i => i.done);

  const handleAdd = () => {
    if (!title.trim()) return;
    const remind = remindAt || undefined;
    // 设置了提醒时间 → 请求浏览器通知权限（未授予时）
    if (remind && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    addImportant({
      id: `imp-${Date.now()}`,
      title: title.trim(),
      content: content.trim(),
      priority,
      createdAt: localToday(),
      done: false,
      remindAt: remind,
    });
    setTitle(''); setContent(''); setPriority('normal'); setRemindAt(''); setShowAdd(false);
  };

  // 到点提醒统一由全局 useReminders()（App.tsx 的 ReminderHost）轮询，
  // 面板内不再重复实现，避免同一条提醒同时弹两次

  return (
    <div className="p-[20px_24px] h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[18px] font-semibold">⭐ 重要事项</h2>
          <p className="text-[12px] text-[var(--text-secondary)] mt-1">
            记录以后要做的重要事情，AI 教练也会关注这些事项
          </p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className={`px-4 py-[7px] rounded-lg text-[12px] font-medium ${
          showAdd
            ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)]'
            : 'bg-[var(--accent)] text-[#000]'
        }`}>{showAdd ? '取消' : '+ 新增'}</button>
      </div>

      {showAdd && (
        <div className="p-[14px] rounded-[10px] bg-[var(--bg-tertiary)] border border-[var(--border)] mb-4">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="事项标题（必填）" className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[13px] outline-none mb-2" />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="详细描述（可选）" rows={3} className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[12px] outline-none resize-y mb-2" />
          <div className="flex gap-2 items-center">
            <input type="time" value={remindAt} onChange={e => setRemindAt(e.target.value)} title="到点提醒时间（可选）" className="px-[10px] py-[5px] rounded-md bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[12px] outline-none" />
            <select value={priority} onChange={e => setPriority(e.target.value as 'high' | 'normal')} className="px-[10px] py-[5px] rounded-md bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] text-[12px] outline-none">
              <option value="normal">普通优先级</option>
              <option value="high">高优先级</option>
            </select>
            <button onClick={handleAdd} className="px-4 py-[6px] rounded-md bg-[var(--accent)] text-[#000] text-[12px] font-medium">添加</button>
          </div>
        </div>
      )}

      {active.length === 0 && done.length === 0 && (
        <div className="text-center p-10 text-[var(--text-muted)] text-[13px]">
          还没有重要事项，点击「+ 新增」添加
        </div>
      )}

      {active.length > 0 && (
        <div className="mb-6">
          <div className="text-[12px] text-[var(--text-secondary)] mb-[10px] font-medium">
            待完成 ({active.length})
          </div>
          <div className="flex flex-col gap-2">
            {active.map(item => (
              <div key={item.id} className="p-[12px_14px] rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)] flex items-start gap-[10px]">
                <button onClick={() => toggleImportant(item.id)} className={`w-5 h-5 rounded-full shrink-0 mt-[1px] bg-transparent border-2 ${
                  item.priority === 'high' ? 'border-[var(--red)]' : 'border-[var(--border)]'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[6px] mb-[2px]">
                    <span className="text-[13px] font-medium">{item.title}</span>
                    {item.priority === 'high' && (
                      <span className="text-[10px] px-[6px] py-[1px] rounded bg-[rgba(233,69,96,0.15)] text-[var(--red)]">高优</span>
                    )}
                  </div>
                  {item.content && <div className="text-[11px] text-[var(--text-secondary)] leading-[1.5]">{item.content}</div>}
                  <div className="text-[10px] text-[var(--text-muted)] mt-1">创建于 {item.createdAt}</div>
                </div>
                <button onClick={() => deleteImportant(item.id)} className="bg-transparent text-[var(--text-muted)] text-[14px] px-1 py-[2px] shrink-0 opacity-50">×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <div className="text-[12px] text-[var(--text-muted)] mb-[10px] font-medium">
            已完成 ({done.length})
          </div>
          <div className="flex flex-col gap-[6px]">
            {done.map(item => (
              <div key={item.id} className="p-[10px_14px] rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center gap-[10px] opacity-60">
                <span className="text-[14px] shrink-0">✅</span>
                <div className="flex-1">
                  <span className="text-[12px] line-through text-[var(--text-secondary)]">{item.title}</span>
                  {item.doneAt && <span className="text-[10px] text-[var(--text-muted)] ml-2">完成于 {item.doneAt}</span>}
                </div>
                <button onClick={() => deleteImportant(item.id)} className="bg-transparent text-[var(--text-muted)] text-[14px] px-1 py-[2px]">×</button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
