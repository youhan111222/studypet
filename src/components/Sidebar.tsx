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
    <div className="w-[160px] min-w-[160px] h-screen bg-[var(--bg-tertiary)] border-r border-[var(--border)] flex flex-col p-[16px_12px] gap-[12px] overflow-hidden">
      {/* Logo + 状态 */}
      <div className="text-center">
        <div className="w-[56px] h-[56px] mx-auto rounded-[50%] bg-[linear-gradient(135deg,_#4ecca3,_#0a84ff)] flex items-center justify-center text-[28px]">📚</div>
        <div className="text-[14px] font-bold mt-[6px]">StudyPet</div>
        <div className="text-[11px] text-[var(--text-secondary)] mt-[2px]">
          专升本备考助手
        </div>

        {nudge && (
          <div className="mt-[8px] p-[6px_8px] rounded-[8px] bg-[rgba(78,204,163,0.1)] border border-[rgba(78,204,163,0.2)] text-[10px] text-[var(--text-secondary)] leading-[1.4] text-center">
            💬 {nudge}
          </div>
        )}
      </div>

      {/* 关键指标 */}
      <div className="flex flex-col gap-[6px]">
        {[
          { icon: '🔥', label: '连续', value: `${streak}天`, color: '#ff8c00' },
          { icon: '⏱️', label: '今日', value: `${Math.floor(todayStudyMin/60)}h${todayStudyMin%60}m`, color: '#4ecca3' },
          { icon: '📝', label: '待复习', value: `${dueCount}题`, color: dueCount > 0 ? '#e74c3c' : '#2ecc71' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-[8px] p-[6px_8px] rounded-[6px] bg-[var(--bg-card)]">
            <span className="text-[14px]">{item.icon}</span>
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">{item.label}</div>
              <div className="text-[12px] font-semibold" style={{ color: item.color }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 导航 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col gap-[4px]">
          {navItems.map(v => (
            <button key={v.id} onClick={() => navigate(v.path)} className="p-[7px_12px] rounded-[6px] text-left text-[12px] font-medium cursor-pointer" style={{
              background: isActive(v.path) ? 'var(--bg-card)' : 'transparent',
              color: isActive(v.path) ? 'var(--accent)' : 'var(--text-secondary)',
              border: isActive(v.path) ? '1px solid var(--accent)' : '1px solid transparent',
            }}>
              {v.icon} {v.label}
              {v.id === 'review' && dueCount > 0 && (
                <span className="ml-[4px] p-[0_6px] rounded-[10px] bg-[#e74c3c] text-[#fff] text-[10px] font-bold">{dueCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 底部 */}
      <div className="border-t border-[var(--border)] pt-[8px] flex flex-col gap-[6px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-secondary)]">🤖 自动规划</span>
          <button onClick={toggleAutoPlan} className="w-[36px] h-[20px] rounded-[10px] border-none cursor-pointer relative" style={{
            background: autoPlan ? 'var(--accent)' : 'var(--border)',
          }}>
            <div className="w-[16px] h-[16px] rounded-[50%] bg-[#fff] absolute top-[2px]" style={{
              left: autoPlan ? 18 : 2, transition: 'left 0.2s',
            }} />
          </button>
        </div>
      </div>
    </div>
  );
}
