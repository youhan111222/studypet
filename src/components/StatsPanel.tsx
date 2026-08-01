import { useEffect, useState } from 'react';
import { db } from '../db';
import { errMsg } from '../utils';
import type { SubjectKey } from '../types';

const SUBJECTS: { key: SubjectKey; name: string; color: string }[] = [
  { key: 'electronics', name: '电子技术', color: '#e74c3c' },
  { key: 'math', name: '高等数学', color: '#3498db' },
  { key: 'english', name: '英语', color: '#2ecc71' },
  { key: 'politics', name: '政治', color: '#f39c12' },
];

const statText: Record<string, string> = {
  '#0a84ff': 'text-[var(--blue)]',
  '#4ecca3': 'text-[var(--accent)]',
  '#e74c3c': 'text-[#e74c3c]',
  '#3498db': 'text-[#3498db]',
  '#2ecc71': 'text-[#2ecc71]',
  '#f39c12': 'text-[#f39c12]',
};

const statBg: Record<string, string> = {
  '#0a84ff': 'bg-[var(--blue)]',
  '#4ecca3': 'bg-[var(--accent)]',
  '#e74c3c': 'bg-[#e74c3c]',
  '#3498db': 'bg-[#3498db]',
  '#2ecc71': 'bg-[#2ecc71]',
  '#f39c12': 'bg-[#f39c12]',
};

export function StatsPanel() {
  const [stats, setStats] = useState<Record<string, any>>({});
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await db.getAllStats();
        setStats(s);
        const qCount = await db.questions.count();
        const aCount = await db.attempts.count();
        setTotalQuestions(qCount);
        setTotalAttempts(aCount);
      } catch (e) {
        setError(errMsg(e, '加载数据失败'));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="text-sm mb-2">加载统计数据失败</div>
          <div className="text-xs mb-4 text-[#e74c3c]">{error}</div>
          <button onClick={() => { setError(null); window.location.reload(); }} className="px-4 py-2 rounded-lg text-sm bg-[var(--accent)] text-[#fff]">重试</button>
        </div>
      </div>
    );
  }

  const overallCorrect = Object.values(stats).reduce((s, v) => s + v.correct, 0);
  const overallTotal = Object.values(stats).reduce((s, v) => s + v.total, 0);
  const overallRate = overallTotal > 0 ? Math.round((overallCorrect / overallTotal) * 100) : 0;

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* 总览 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: '题库总量', value: totalQuestions, unit: '题', color: '#0a84ff' },
          { label: '总答题量', value: totalAttempts, unit: '次', color: '#4ecca3' },
          { label: '总正确率', value: `${overallRate}`, unit: '%', color: overallRate > 70 ? '#2ecc71' : '#f39c12' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4 text-center bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
            <div className={`text-3xl font-bold tabular-nums ${statText[s.color]}`}>{s.value}<span className="text-sm">{s.unit}</span></div>
            <div className="text-xs mt-1 tracking-[0.05em] text-[var(--text-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 各科正确率 */}
      <div className="rounded-xl p-5 mb-4 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
        <h3 className="text-[15px] font-bold mb-4 tracking-[0.02em] text-[var(--text-primary)]">各科正确率</h3>
        <div className="space-y-4">
          {SUBJECTS.map(s => {
            const data = stats[s.key];
            const rate = data?.rate ? Math.round(data.rate * 100) : 0;
            return (
              <div key={s.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[var(--text-secondary)]">{s.name}</span>
                  <span className={`text-sm font-bold tabular-nums ${statText[s.color]}`}>{rate}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-[var(--bg-tertiary)]">
                  <div className={`h-full rounded-full transition-all ${statBg[s.color]}`} style={{ width: `${rate}%` }} />
                </div>
                <div className="text-xs mt-1 text-[var(--text-muted)]">
                  {data?.total || 0} 次答题 · {data?.correct || 0} 次正确
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 章节详情 */}
      {SUBJECTS.map(s => {
        const data = stats[s.key];
        if (!data) return null;
        const chapters = Object.keys(data.byChapter);
        if (chapters.length === 0) {
          return (
            <div key={s.key} className="rounded-xl p-5 mb-4 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
              <h4 className={`text-sm font-bold mb-3 tracking-[0.02em] ${statText[s.color]}`}>{s.name} · 章节详情</h4>
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>📭</span>
                <span>暂无章节数据，完成几次刷题后这里会展示各章节正确率</span>
              </div>
            </div>
          );
        }
        return (
          <div key={s.key} className="rounded-xl p-5 mb-4 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]">
            <h4 className={`text-sm font-bold mb-3 tracking-[0.02em] ${statText[s.color]}`}>{s.name} · 章节详情</h4>
            <div className="space-y-2">
              {Object.entries(data.byChapter).map(([ch, d]: [string, any]) => (
                <div key={ch} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{ch}</span>
                  <span className="text-[var(--text-muted)]">
                    {d.correct}/{d.total} · {d.total > 0 ? Math.round(d.correct / d.total * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
