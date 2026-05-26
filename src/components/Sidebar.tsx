import { useStore } from '../store/useStore';

const perks: Record<string, { icon: string; label: string; color: string }> = {
  streak: { icon: '🔥', label: '连胜', color: '#ff8c00' },
  focus: { icon: '⏱️', label: '专注', color: '#4ecca3' },
  done: { icon: '✅', label: '完成率', color: '#0a84ff' },
  coins: { icon: '🪙', label: '金币', color: '#ffd700' },
};

const navItems: { id: string; label: string; icon: string }[] = [
  { id: 'tasks', label: '今日任务', icon: '📋' },
  { id: 'important', label: '重要事项', icon: '⭐' },
  { id: 'schedule', label: '课程表', icon: '📅' },
  { id: 'screentime', label: '屏幕时间', icon: '⏱️' },
  { id: 'tracking', label: '活动追踪', icon: '📊' },
  { id: 'analytics', label: '深度分析', icon: '🔍' },
  { id: 'achievements', label: '成就', icon: '🏅' },
];

export function Sidebar() {
  const pet = useStore(s => s.pet);
  const stats = useStore(s => s.weekStats);
  const streak = useStore(s => s.streak);
  const tasks = useStore(s => s.tasks);
  const setView = useStore(s => s.setView);
  const activeView = useStore(s => s.activeView);
  const autoPlan = useStore(s => s.autoPlan);
  const toggleAutoPlan = useStore(s => s.toggleAutoPlan);

  // 完成率 = 今日已完成任务数 / 今日总任务数
  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = tasks.filter(t => t.date === today || !t.date);
  const todayCompleted = todayTasks.filter(t => t.completed).length;
  const pct = todayTasks.length > 0 ? Math.round((todayCompleted / todayTasks.length) * 100) : 0;

  // 专注小时数 = 今日 tracker 学习分钟数 / 60
  // weekStats.focusHours 由 App.tsx 同步更新
  const focusHours = stats.focusHours.toFixed(1);

  const moodEmoji = { happy: '🐱', normal: '😺', sad: '😿', excited: '😸' }[pet.mood];

  return (
    <div style={{
      width: 160, minWidth: 160, height: '100vh',
      background: 'var(--bg-tertiary)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', padding: '16px 12px', gap: 12,
      overflow: 'hidden',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 60, height: 60, margin: '0 auto', borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--bg-card), var(--bg-secondary))',
          border: '2px solid var(--border)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 32,
        }}>
          {moodEmoji}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{pet.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Lv.{pet.level}</div>
        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
          <div style={{ width: `${(pet.exp / pet.expToNext) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{pet.exp}/{pet.expToNext}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { key: 'streak', value: `${streak}天`, ...perks.streak },
          { key: 'focus', value: `${focusHours}h`, ...perks.focus },
          { key: 'done', value: `${pct}%`, ...perks.done },
          { key: 'coins', value: `${pet.coins}`, ...perks.coins },
        ].map(item => (
          <div key={item.key} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', borderRadius: 6, background: 'var(--bg-card)',
          }}>
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: item.color }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {navItems.map(v => (
            <button key={v.id} onClick={() => setView(v.id as any)} style={{
              padding: '7px 12px', borderRadius: 6, textAlign: 'left',
              fontSize: 12, fontWeight: 500,
              background: activeView === v.id ? 'var(--bg-card)' : 'transparent',
              color: activeView === v.id ? 'var(--accent)' : 'var(--text-secondary)',
              border: activeView === v.id ? '1px solid var(--accent)' : '1px solid transparent',
            }}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>🤖 自动规划</span>
          <button onClick={toggleAutoPlan} style={{
            width: 36, height: 20, borderRadius: 10, border: 'none',
            background: autoPlan ? 'var(--accent)' : 'var(--border)',
            position: 'relative', cursor: 'pointer',
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2,
              left: autoPlan ? 18 : 2, transition: 'left 0.2s',
            }} />
          </button>
        </div>
      </div>
    </div>
  );
}