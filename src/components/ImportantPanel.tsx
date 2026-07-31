import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { ImportantItem } from '../types';

export function ImportantPanel() {
  const items = useStore(s => s.importantItems);
  const addImportant = useStore(s => s.addImportant);
  const toggleImportant = useStore(s => s.toggleImportant);
  const deleteImportant = useStore(s => s.deleteImportant);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'high' | 'normal'>('normal');

  const active = items.filter(i => !i.done);
  const done = items.filter(i => i.done);

  const handleAdd = () => {
    if (!title.trim()) return;
    addImportant({
      id: `imp-${Date.now()}`,
      title: title.trim(),
      content: content.trim(),
      priority,
      createdAt: new Date().toISOString().slice(0, 10),
      done: false,
    });
    setTitle(''); setContent(''); setPriority('normal'); setShowAdd(false);
  };

  return (
    <div style={{ padding: '20px 24px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>⭐ 重要事项</h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            记录以后要做的重要事情，AI 教练也会关注这些事项
          </p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{
          padding: '7px 16px', borderRadius: 8, background: showAdd ? 'var(--bg-tertiary)' : 'var(--accent)',
          color: showAdd ? 'var(--text-secondary)' : '#000', fontSize: 12, fontWeight: 500,
          border: showAdd ? '1px solid var(--border)' : 'none',
        }}>{showAdd ? '取消' : '+ 新增'}</button>
      </div>

      {showAdd && (
        <div style={{
          padding: 14, borderRadius: 10, background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)', marginBottom: 16,
        }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="事项标题（必填）" style={{
            width: '100%', padding: '8px 12px', borderRadius: 6,
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 13, outline: 'none', marginBottom: 8,
          }} />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="详细描述（可选）" rows={3} style={{
            width: '100%', padding: '8px 12px', borderRadius: 6,
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 12, outline: 'none', resize: 'vertical',
            fontFamily: 'inherit', marginBottom: 8,
          }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={priority} onChange={e => setPriority(e.target.value as 'high' | 'normal')} style={{
              padding: '5px 10px', borderRadius: 6,
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', fontSize: 12, outline: 'none',
            }}>
              <option value="normal">普通优先级</option>
              <option value="high">高优先级</option>
            </select>
            <button onClick={handleAdd} style={{
              padding: '6px 16px', borderRadius: 6, background: 'var(--accent)',
              color: '#000', fontSize: 12, fontWeight: 500,
            }}>添加</button>
          </div>
        </div>
      )}

      {active.length === 0 && done.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          还没有重要事项，点击「+ 新增」添加
        </div>
      )}

      {active.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, fontWeight: 500 }}>
            待完成 ({active.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active.map(item => (
              <div key={item.id} style={{
                padding: '12px 14px', borderRadius: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <button onClick={() => toggleImportant(item.id)} style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  border: `2px solid ${item.priority === 'high' ? 'var(--red)' : 'var(--border)'}`,
                  background: 'transparent',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
                    {item.priority === 'high' && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(233,69,96,0.15)', color: 'var(--red)' }}>高优</span>
                    )}
                  </div>
                  {item.content && <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.content}</div>}
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>创建于 {item.createdAt}</div>
                </div>
                <button onClick={() => deleteImportant(item.id)} style={{
                  background: 'none', color: 'var(--text-muted)', fontSize: 14, padding: '2px 4px',
                  flexShrink: 0, opacity: 0.5,
                }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 500 }}>
            已完成 ({done.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {done.map(item => (
              <div key={item.id} style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10, opacity: 0.6,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>✅</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, textDecoration: 'line-through', color: 'var(--text-secondary)' }}>{item.title}</span>
                  {item.doneAt && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>完成于 {item.doneAt}</span>}
                </div>
                <button onClick={() => deleteImportant(item.id)} style={{
                  background: 'none', color: 'var(--text-muted)', fontSize: 14, padding: '2px 4px',
                }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}