import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useQuizStore, syncSubjectProgress } from '../store/quizStore';
import { useNavigate } from 'react-router-dom';
import type { SubjectKey } from '../types';

const SUBJECTS: { key: SubjectKey; name: string; color: string; icon: string }[] = [
  { key: 'electronics', name: '电子技术', color: '#e74c3c', icon: '⚡' },
  { key: 'math', name: '高等数学', color: '#3498db', icon: '📐' },
  { key: 'english', name: '英语', color: '#2ecc71', icon: '🌍' },
  { key: 'politics', name: '政治', color: '#f39c12', icon: '📖' },
];

export function Dashboard() {
  const navigate = useNavigate();
  const streak = useStore(s => s.streak);
  const weekStats = useStore(s => s.weekStats);
  const activityLogs = useStore(s => s.activityLogs);
  const { dueCount, refreshDueCount } = useQuizStore();

  useEffect(() => { refreshDueCount(); }, []);

  // 每次打开 Dashboard 同步各科进度
  useEffect(() => {
    (async () => {
      for (const s of ['electronics', 'math', 'english', 'politics'] as SubjectKey[]) {
        await syncSubjectProgress(s);
      }
    })();
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayStudyMin = activityLogs
    .filter(l => l.date === today && l.category === 'study')
    .reduce((s, l) => s + l.duration, 0);

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* 顶部状态栏 */}
      <div className="grid grid-cols-4 gap-4 mb-6 animate-[fadeUp_0.4s_ease-out_both]" style={{ animationDelay: '100ms' }}>
        {[
          { label: '连续学习', value: `${streak}天`, icon: '🔥', color: '#ff8c00' },
          { label: '今日专注', value: `${Math.floor(todayStudyMin / 60)}h${todayStudyMin % 60}m`, icon: '⏱️', color: '#4ecca3' },
          { label: '待复习', value: `${dueCount}题`, icon: '📝', color: '#e74c3c' },
          { label: '本周完成', value: `${weekStats.tasksCompleted}项`, icon: '✅', color: '#0a84ff' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-xs text-[var(--text-muted)]">{s.label}</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 快速入口 */}
      <div className="grid grid-cols-4 gap-4 mb-6 animate-[fadeUp_0.4s_ease-out_both]" style={{ animationDelay: '200ms' }}>
        {SUBJECTS.map(s => (
          <button
            key={s.key}
            onClick={() => navigate(`/quiz/${s.key}`)}
            className="rounded-xl p-5 text-left transition-all hover:scale-105 cursor-pointer bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]"
          >
            <div className="text-3xl mb-2">{s.icon}</div>
            <div className="text-sm font-bold" style={{ color: s.color }}>{s.name}</div>
            <div className="text-xs mt-1 text-[var(--text-muted)]">开始刷题 →</div>
          </button>
        ))}
      </div>

      {/* 错题复习入口 */}
      {dueCount > 0 && (
        <button
          onClick={() => navigate('/review')}
          className="w-full rounded-xl p-4 mb-6 flex items-center gap-3 cursor-pointer transition-all hover:opacity-80 bg-[rgba(231,76,60,0.1)] border border-[rgba(231,76,60,0.3)] shadow-[var(--shadow-card)] animate-[fadeUp_0.4s_ease-out_both]" style={{ animationDelay: '250ms' }}
        >
          <span className="text-2xl">📝</span>
          <div className="flex-1 text-left">
            <div className="text-sm font-bold text-[#e74c3c]">错题复习</div>
            <div className="text-xs text-[var(--text-muted)]">{dueCount} 道题等待复习</div>
          </div>
          <span className="text-[var(--text-muted)]">→</span>
        </button>
      )}

      {/* 各科进度 */}
      <div className="rounded-xl p-5 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)] animate-[fadeUp_0.4s_ease-out_both]" style={{ animationDelay: '300ms' }}>
        <h3 className="text-[15px] font-bold mb-4 tracking-[0.02em] text-[var(--text-primary)]">各科进度</h3>
        <div className="space-y-3">
          {SUBJECTS.map(s => (
            <SubjectProgressBar key={s.key} subject={s.key} color={s.color} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SubjectProgressBar({ subject, color }: { subject: SubjectKey; color: string }) {
  const progress = useStore(s => s.subjectProgress[subject]);
  const hasData = progress?.chapterDetails && progress.chapterDetails.length > 0;
  const total = hasData ? progress!.chapterDetails!.length : 0;
  const done = hasData ? progress!.chapterDetails!.filter(c => c.mastery === 'mastered').length : 0;
  const pct = hasData ? Math.round((done / total) * 100) : -1;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-16 text-[var(--text-secondary)]">{['电子技术','高数','英语','政治'][['electronics','math','english','politics'].indexOf(subject)]}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden bg-[var(--bg-tertiary)]">
        <div className="h-full rounded-full transition-all" style={{ width: pct >= 0 ? `${pct}%` : '0%', background: pct >= 0 ? color : 'transparent' }} />
      </div>
      <span className="text-xs w-10 text-right text-[var(--text-muted)]">{pct >= 0 ? `${pct}%` : '—'}</span>
    </div>
  );
}
