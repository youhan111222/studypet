import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useQuizStore } from '../store/quizStore';
import { useEffect } from 'react';

const navItems = [
  { id: 'dashboard', path: '/', label: '学习概览', icon: '🏠' },
  { id: 'quiz', path: '/quiz/electronics', label: '刷题', icon: '📝' },
  { id: 'review', path: '/review', label: '错题复习', icon: '🔄' },
  { id: 'stats', path: '/stats', label: '统计', icon: '📊' },
  { id: 'schedule', path: '/schedule', label: '课程表', icon: '📅' },
  { id: 'analytics', path: '/analytics', label: '深度分析', icon: '🔍' },
  { id: 'achievements', path: '/achievements', label: '成就墙', icon: '🏆' },
  { id: 'important', path: '/important', label: '重要事项', icon: '⭐' },
  { id: 'screentime', path: '/screentime', label: '屏幕时间', icon: '🖥️' },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const streak = useStore(s => s.streak);
  const weekStats = useStore(s => s.weekStats);
  const activityLogs = useStore(s => s.activityLogs);
  const activeTimerSubject = useStore(s => s.activeTimerSubject);
  const autoPlan = useStore(s => s.autoPlan);
  const toggleAutoPlan = useStore(s => s.toggleAutoPlan);
  const { dueCount, refreshDueCount } = useQuizStore();

  useEffect(() => { refreshDueCount(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayStudyMin = activityLogs
    .filter(l => l.date === today && l.category === 'study')
    .reduce((s, l) => s + l.duration, 0);

  function getNudge(): string | null {
    if (activeTimerSubject) return '加油！专注中...';
    if (todayStudyMin === 0) return '今天还没开始学习哦';
    if (dueCount > 0) return `${dueCount} 道错题等待复习`;
    if (todayStudyMin >= 180) return '今天学得很扎实！';
    if (todayStudyMin >= 60) return '不错，再加把劲！';
    return '好的开始是成功的一半~';
  }

  const nudge = getNudge();
  const currentPath = location.pathname;
  const isActive = (path: string) => currentPath === path || (path !== '/' && currentPath.startsWith(path));

  return (
    <div style={{
      width: 160, minWidth: 160, height: '100vh',
      background: 'var(--bg-tertiary)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', padding: '16px 12px', gap: 12,
      overflow: 'hidden',
    }}>
      {/* Logo + 状态 */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, margin: '0 auto', borderRadius: '50%',
          background: 'linear-gradient(135deg, #4ecca3, #0a84ff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28,
        }}>📚</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>StudyPet</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
          专升本备考助手
        </div>

        {nudge && (
          <div style={{
            marginTop: 8, padding: '6px 8px', borderRadius: 8,
            background: 'rgba(78,204,163,0.1)', border: '1px solid rgba(78,204,163,0.2)',
            fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.4,
            textAlign: 'center',
          }}>
            💬 {nudge}
          </div>
        )}
      </div>

      {/* 关键指标 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { icon: '🔥', label: '连续', value: `${streak}天`, color: '#ff8c00' },
          { icon: '⏱️', label: '今日', value: `${Math.floor(todayStudyMin/60)}h${todayStudyMin%60}m`, color: '#4ecca3' },
          { icon: '📝', label: '待复习', value: `${dueCount}题`, color: dueCount > 0 ? '#e74c3c' : '#2ecc71' },
        ].map(item => (
          <div key={item.label} style={{
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

      {/* 导航 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {navItems.map(v => (
            <button key={v.id} onClick={() => navigate(v.path)} style={{
              padding: '7px 12px', borderRadius: 6, textAlign: 'left',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: isActive(v.path) ? 'var(--bg-card)' : 'transparent',
              color: isActive(v.path) ? 'var(--accent)' : 'var(--text-secondary)',
              border: isActive(v.path) ? '1px solid var(--accent)' : '1px solid transparent',
            }}>
              {v.icon} {v.label}
              {v.id === 'review' && dueCount > 0 && (
                <span style={{
                  marginLeft: 4, padding: '0 6px', borderRadius: 10,
                  background: '#e74c3c', color: '#fff', fontSize: 10, fontWeight: 700,
                }}>{dueCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 底部 */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>🤖 自动规划</span>
          <button onClick={toggleAutoPlan} style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: autoPlan ? 'var(--accent)' : 'var(--border)', position: 'relative',
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
