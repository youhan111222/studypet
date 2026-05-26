import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { SubjectKey } from '../types';

const SUBJECT_META: Record<SubjectKey, { label: string; icon: string; color: string }> = {
  english: { label: '英语', icon: '🇬🇧', color: '#0a84ff' },
  math: { label: '高数', icon: '📐', color: '#ff6b6b' },
  politics: { label: '政治', icon: '📖', color: '#ffa726' },
  electronics: { label: '电子', icon: '⚡', color: '#a855f7' },
};

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function StudyTimer() {
  const activeSubject = useStore(s => s.activeTimerSubject);
  const timerStartTime = useStore(s => s.timerStartTime);
  const accumulated = useStore(s => s.timerAccumulatedSeconds);
  const subjectProgress = useStore(s => s.subjectProgress);
  const startTimer = useStore(s => s.startStudyTimer);
  const pauseTimer = useStore(s => s.pauseStudyTimer);
  const stopTimer = useStore(s => s.stopStudyTimer);

  // 实时刷新 elapsed
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!timerStartTime) return;
    const iv = setInterval(() => setTick(n => n + 1), 250);
    return () => clearInterval(iv);
  }, [timerStartTime]);

  const subjects: SubjectKey[] = ['english', 'math', 'politics', 'electronics'];

  // 当前活跃科目的实时秒数（含小数）
  const liveElapsed = timerStartTime ? accumulated + (Date.now() - timerStartTime) / 1000 : accumulated;
  const liveDisplay = formatTime(liveElapsed);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
      background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
      overflowX: 'auto',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>
        学习计时
      </span>

      {subjects.map(subj => {
        const meta = SUBJECT_META[subj];
        const isActive = activeSubject === subj;
        const isPaused = isActive && timerStartTime === null;
        const totalMin = subjectProgress[subj].totalMinutes;

        return (
          <div key={subj} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 14,
            background: isActive ? `${meta.color}20` : 'var(--bg-card)',
            border: isActive ? `1px solid ${meta.color}` : '1px solid var(--border)',
            cursor: 'pointer', userSelect: 'none',
            transition: 'all 0.15s',
          }}>
            {/* 计时器时间显示 */}
            {isActive ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: isPaused ? 'var(--text-muted)' : '#22c55e',
                  animation: isPaused ? 'none' : 'pulse 1.5s infinite',
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: meta.color, fontVariantNumeric: 'tabular-nums' }}>
                  {liveDisplay}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {meta.icon} {meta.label}
              </span>
            )}

            {/* 累计时间 */}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {totalMin >= 60 ? `${(totalMin / 60).toFixed(1)}h` : `${totalMin}min`}
            </span>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 2 }}>
              {!isActive && (
                <button onClick={(e) => { e.stopPropagation(); startTimer(subj); }} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  border: 'none', background: meta.color, color: '#fff', cursor: 'pointer',
                }}>开始</button>
              )}
              {isActive && !isPaused && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); pauseTimer(); }} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    border: 'none', background: 'var(--border)', color: 'var(--text-primary)', cursor: 'pointer',
                  }}>暂停</button>
                  <button onClick={(e) => { e.stopPropagation(); stopTimer(); }} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer',
                  }}>结束</button>
                </>
              )}
              {isActive && isPaused && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); startTimer(subj); }} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer',
                  }}>继续</button>
                  <button onClick={(e) => { e.stopPropagation(); stopTimer(); }} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer',
                  }}>结束</button>
                </>
              )}
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}