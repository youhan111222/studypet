import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { useQuizStore, syncSubjectProgress } from '../store/quizStore';
import { useNavigate } from 'react-router-dom';
import type { SubjectKey } from '../types';
import { localToday } from '../utils';
import {
  fetchReviewDue, checkReview, getDiary, saveDiary,
  subjectName, daysSinceDate, reviewOrdinal, reviewOverdueDays,
  type ReviewDueItem,
} from '../lib/secondbrain';

const SUBJECTS: { key: SubjectKey; name: string; color: string; icon: string }[] = [
  { key: 'electronics', name: '电子技术', color: '#e74c3c', icon: '⚡' },
  { key: 'math', name: '高等数学', color: '#3498db', icon: '📐' },
  { key: 'english', name: '英语', color: '#2ecc71', icon: '🌍' },
  { key: 'politics', name: '政治', color: '#f39c12', icon: '📖' },
];

const colorClass: Record<string, string> = {
  '#ff8c00': 'text-[var(--orange)]',
  '#4ecca3': 'text-[var(--accent)]',
  '#0a84ff': 'text-[var(--blue)]',
  '#e74c3c': 'text-[#e74c3c]',
  '#3498db': 'text-[#3498db]',
  '#2ecc71': 'text-[#2ecc71]',
  '#f39c12': 'text-[#f39c12]',
};

export function Dashboard() {
  const navigate = useNavigate();
  const streak = useStore(s => s.streak);
  const weekStats = useStore(s => s.weekStats);
  const activityLogs = useStore(s => s.activityLogs);
  const { dueCount, refreshDueCount } = useQuizStore();

  useEffect(() => { refreshDueCount(); }, []);

  // SecondBrain 今日待复习
  const [reviewDue, setReviewDue] = useState<ReviewDueItem[]>([]);
  const loadReviewDue = useCallback(async () => {
    const items = await fetchReviewDue();
    setReviewDue(items);
  }, []);
  useEffect(() => { loadReviewDue(); }, [loadReviewDue]);

  // 勾选完成一次复习 → 成功后本地移除
  const handleReviewCheck = async (item: ReviewDueItem) => {
    const ok = await checkReview(item.id, item.subject, item.point);
    if (ok) setReviewDue(prev => prev.filter(it => it.id !== item.id));
  };

  // 登记知识点 → SecondBrain 间隔复习（POST /secondbrain/review-add，学习日期=今天）
  const handleAddKnowledgePoint = async () => {
    const subject = window.prompt('请输入科目（电子/高数/英语/政治）', '');
    if (!subject || !subject.trim()) return;
    const point = window.prompt('请输入知识点名称', '');
    if (!point || !point.trim()) return;
    try {
      const res = await fetch('/secondbrain/review-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), point: point.trim() }),
      });
      const data = await res.json();
      if (data?.ok !== true) {
        alert('登记失败（SecondBrain 服务不可用）');
        return;
      }
      alert('✅ 已登记，今天起 1/2/4/7/15/30 天间隔复习');
      loadReviewDue();
    } catch {
      alert('登记失败（SecondBrain 服务不可用）');
    }
  };

  // 收工日记：统计 + 待复习摘要 → SecondBrain 日记
  const handleDiary = async () => {
    const today = localToday();
    const studyMin = activityLogs
      .filter(l => l.date === today && l.category === 'study')
      .reduce((s, l) => s + l.duration, 0);
    const items = reviewDue.length > 0 ? reviewDue : await fetchReviewDue();
    const dueSummary = items.length > 0
      ? `${items.length} 项（${items.slice(0, 3).map(i => `${subjectName(i.subject)}·${i.point}`).join('、')}${items.length > 3 ? ' 等' : ''}）`
      : '无';
    const content = [
      `# ${today} 学习日记`,
      '',
      '## 今日统计',
      `- 学习时长：${Math.floor(studyMin / 60)}h${studyMin % 60}m`,
      `- 完成事项：${weekStats.tasksCompleted} 项`,
      `- SecondBrain 待复习：${dueSummary}`,
      '',
      '## 军立状',
      '- 今日完成：',
      '- 卡点：',
      '- 明日第一步：',
    ].join('\n');
    const existing = await getDiary(today);
    if (existing?.exists && !window.confirm('今日日记已存在，覆盖？')) return;
    const ok = await saveDiary(today, content);
    alert(ok ? '📝 日记已保存到 SecondBrain' : '保存失败（SecondBrain 服务不可用）');
  };

  // 每次打开 Dashboard 同步各科进度
  useEffect(() => {
    (async () => {
      for (const s of ['electronics', 'math', 'english', 'politics'] as SubjectKey[]) {
        await syncSubjectProgress(s);
      }
    })();
  }, []);

  const today = localToday();
  const todayStudyMin = activityLogs
    .filter(l => l.date === today && l.category === 'study')
    .reduce((s, l) => s + l.duration, 0);

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* 顶部：收工日记入口 */}
      <div className="flex justify-end mb-4 animate-[fadeUp_0.4s_ease-out_both]">
        <button
          onClick={handleDiary}
          className="rounded-xl px-4 py-2 text-sm font-bold transition-all hover:scale-105 cursor-pointer bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)] text-[var(--text-secondary)]"
        >
          📝 收工日记
        </button>
      </div>

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
            <div className={`text-2xl font-bold tabular-nums ${colorClass[s.color]}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 登记知识点（SecondBrain 间隔复习入口，常驻显示） */}
      <div className="flex justify-end mb-3 animate-[fadeUp_0.4s_ease-out_both]" style={{ animationDelay: '140ms' }}>
        <button
          onClick={handleAddKnowledgePoint}
          className="rounded-xl px-3 py-[7px] text-xs font-medium transition-all hover:scale-105 cursor-pointer bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)] text-[var(--text-secondary)]"
        >
          ➕ 登记知识点
        </button>
      </div>

      {/* SecondBrain 今日待复习（有数据才显示） */}
      {reviewDue.length > 0 && (
        <div className="rounded-xl p-5 mb-6 bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)] animate-[fadeUp_0.4s_ease-out_both]" style={{ animationDelay: '150ms' }}>
          <h3 className="text-[15px] font-bold mb-3 tracking-[0.02em] text-[var(--text-primary)]">📌 今日待复习</h3>
          <div className="space-y-2">
            {reviewDue.map(item => {
              const days = daysSinceDate(item.lastStudyDate);
              const label = item.overdue.length > 0
                ? { text: `超期${reviewOverdueDays(item)}天`, cls: 'bg-[rgba(231,76,60,0.12)] text-[#e74c3c]' }
                : item.due.some(d => d === days)
                  ? { text: '今天到期', cls: 'bg-[rgba(245,158,11,0.12)] text-[#f59e0b]' }
                  : { text: `第${reviewOrdinal(item)}次复习`, cls: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]' };
              return (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {subjectName(item.subject)} · {item.point}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">学习于 {item.lastStudyDate}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${label.cls}`}>{label.text}</span>
                  <button
                    onClick={() => handleReviewCheck(item)}
                    title="完成本次复习"
                    className="w-7 h-7 rounded-full shrink-0 text-sm border border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-pointer transition-all hover:bg-[rgba(78,204,163,0.15)] hover:text-[#4ecca3] hover:border-[rgba(78,204,163,0.4)]"
                  >
                    ✓
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 快速入口 */}
      <div className="grid grid-cols-4 gap-4 mb-6 animate-[fadeUp_0.4s_ease-out_both]" style={{ animationDelay: '200ms' }}>
        {SUBJECTS.map(s => (
          <button
            key={s.key}
            onClick={() => navigate(`/quiz/${s.key}`)}
            className="rounded-xl p-5 text-left transition-all hover:scale-105 cursor-pointer bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-card)]"
          >
            <div className="text-3xl mb-2">{s.icon}</div>
            <div className={`text-sm font-bold ${colorClass[s.color]}`}>{s.name}</div>
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
