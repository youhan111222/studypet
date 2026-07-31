import { useEffect, useState, useRef } from 'react';
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

/** 找出最薄弱科目（totalMinutes 最低） */
function getWeakestSubject(progress: Record<SubjectKey, { totalMinutes: number }>): SubjectKey {
  const subjects: SubjectKey[] = ['english', 'math', 'politics', 'electronics'];
  let weakest = subjects[0];
  let min = progress[weakest].totalMinutes;
  for (const s of subjects) {
    if (progress[s].totalMinutes < min) {
      min = progress[s].totalMinutes;
      weakest = s;
    }
  }
  return weakest;
}

export function StudyTimer() {
  const activeSubject = useStore(s => s.activeTimerSubject);
  const timerStartTime = useStore(s => s.timerStartTime);
  const accumulated = useStore(s => s.timerAccumulatedSeconds);
  const subjectProgress = useStore(s => s.subjectProgress);
  const startTimer = useStore(s => s.startStudyTimer);
  const pauseTimer = useStore(s => s.pauseStudyTimer);
  const stopTimer = useStore(s => s.stopStudyTimer);
  const weekStats = useStore(s => s.weekStats);
  const updateWeekStats = useStore(s => (updates: Partial<typeof weekStats>) => {
    const state = useStore.getState();
    useStore.setState({ weekStats: { ...state.weekStats, ...updates } });
  });

  const [tick, setTick] = useState(0);
  const [pomodoroMode, setPomodoroMode] = useState(false);
  const [pomodoroPhase, setPomodoroPhase] = useState<'work' | 'break'>('work');
  const [pomodoroCompleted, setPomodoroCompleted] = useState(0);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [quickStartToast, setQuickStartToast] = useState<string | null>(null);
  const quickStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 实时刷新
  useEffect(() => {
    if (!timerStartTime) return;
    const iv = setInterval(() => setTick(n => n + 1), 250);
    return () => clearInterval(iv);
  }, [timerStartTime]);

  const subjects: SubjectKey[] = ['english', 'math', 'politics', 'electronics'];

  const liveElapsed = timerStartTime ? accumulated + (Date.now() - timerStartTime) / 1000 : accumulated;
  const liveDisplay = formatTime(liveElapsed);

  // 番茄钟自动切换
  useEffect(() => {
    if (!pomodoroMode || !timerStartTime) return;
    const workDuration = 25 * 60; // 25 分钟
    const breakDuration = 5 * 60; // 5 分钟
    const target = pomodoroPhase === 'work' ? workDuration : breakDuration;

    if (liveElapsed >= target) {
      if (pomodoroPhase === 'work') {
        setPomodoroCompleted(c => c + 1);
        setPomodoroPhase('break');
        // 记录番茄数
        updateWeekStats({ pomodoroCount: (weekStats.pomodoroCount || 0) + 1 });
        setQuickStartToast(`🍅 番茄钟完成！休息 5 分钟吧 (已完成 ${pomodoroCompleted + 1} 个)`);
      } else {
        setPomodoroPhase('work');
        setQuickStartToast('休息结束，开始下一个 25 分钟！');
      }
      // 自动继续
      stopTimer();
      if (activeSubject) startTimer(activeSubject);
      toastTimerRef.current = setTimeout(() => setQuickStartToast(null), 4000);
    }
  }, [liveElapsed, pomodoroMode, pomodoroPhase, timerStartTime]);

  // 5 分钟快速启动到期检测
  useEffect(() => {
    if (!timerStartTime || pomodoroMode) return;
    if (activeSubject && liveElapsed >= 5 * 60 && quickStartTimerRef.current) {
      // 快速启动到期：暂停并提示
      pauseTimer();
      setQuickStartToast(`已经学 5 分钟了！要再学 25 分钟吗？`);
      setShowQuickStart(false);
      if (quickStartTimerRef.current) { clearTimeout(quickStartTimerRef.current); quickStartTimerRef.current = null; }
    }
  }, [liveElapsed, pomodoroMode, activeSubject, timerStartTime]);

  useEffect(() => {
    return () => {
      if (quickStartTimerRef.current) clearTimeout(quickStartTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleQuickStart = () => {
    const weakest = getWeakestSubject(subjectProgress);
    startTimer(weakest);
    setShowQuickStart(true);
    quickStartTimerRef.current = setTimeout(() => {}, 5 * 60 * 1000);
  };

  const handleContinue25 = () => {
    if (activeSubject) startTimer(activeSubject);
    setQuickStartToast(null);
  };

  const isAnyTimerActive = activeSubject !== null;

  return (
    <div className="flex items-center gap-[10px] p-[8px_16px] bg-[var(--bg-secondary)] border-b border-[var(--border)] overflow-x-auto relative">
      <span className="text-[12px] text-[var(--text-muted)] whitespace-nowrap font-semibold">
        学习计时
      </span>

      {/* 快速启动按钮（无活跃计时器时显示） */}
      {!isAnyTimerActive && (
        <button onClick={handleQuickStart} className="p-[6px_16px] rounded-[20px] text-[13px] font-semibold bg-[linear-gradient(135deg,_#4ecca3,_#0a84ff)] text-[#fff] border-none cursor-pointer whitespace-nowrap animate-[pulse-glow_2s_infinite]">
          🎯 先学 5 分钟
        </button>
      )}

      {subjects.map(subj => {
        const meta = SUBJECT_META[subj];
        const isActive = activeSubject === subj;
        const isPaused = isActive && timerStartTime === null;
        const totalMin = subjectProgress[subj].totalMinutes;

        return (
          <div key={subj} className={`flex items-center gap-[6px] p-[4px_10px] rounded-[14px] cursor-pointer select-none transition-[all_0.15s] hover:-translate-y-[1px] hover:shadow-[var(--shadow-card)]${isActive && !isPaused ? ' animate-[pulseGlow_2.5s_ease-in-out_infinite]' : ''}`}
            style={{
              background: isActive ? `${meta.color}20` : 'var(--bg-card)',
              border: isActive ? `1px solid ${meta.color}` : '1px solid var(--border)',
            }}>
            {isActive ? (
              <div className="flex items-center gap-[4px]">
                <span className="w-[6px] h-[6px] rounded-[50%]"
                  style={{
                    background: isPaused ? 'var(--text-muted)' : '#22c55e',
                    animation: isPaused ? 'none' : 'pulse 1.5s infinite',
                  }} />
                <span className="text-[13px] font-semibold tabular-nums" style={{ color: meta.color }}>
                  {liveDisplay}
                </span>
                {pomodoroMode && isActive && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {pomodoroPhase === 'work' ? '🍅' : '☕'}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[12px] text-[var(--text-secondary)]">
                {meta.icon} {meta.label}
              </span>
            )}

            <span className="text-[11px] text-[var(--text-muted)]">
              {totalMin >= 60 ? `${(totalMin / 60).toFixed(1)}h` : `${totalMin}min`}
            </span>

            <div className="flex gap-[2px]">
              {!isActive && (
                <button onClick={(e) => { e.stopPropagation(); startTimer(subj); setShowQuickStart(false); }} className="text-[11px] p-[2px_8px] rounded-[10px] border-none text-[#fff] cursor-pointer"
                  style={{ background: meta.color }}>开始</button>
              )}
              {isActive && !isPaused && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); pauseTimer(); }} className="text-[11px] p-[2px_8px] rounded-[10px] border-none bg-[var(--border)] text-[var(--text-primary)] cursor-pointer">暂停</button>
                  <button onClick={(e) => { e.stopPropagation(); stopTimer(); }} className="text-[11px] p-[2px_8px] rounded-[10px] border-none bg-[#ef4444] text-[#fff] cursor-pointer">结束</button>
                </>
              )}
              {isActive && isPaused && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); startTimer(subj); }} className="text-[11px] p-[2px_8px] rounded-[10px] border-none bg-[#22c55e] text-[#fff] cursor-pointer">继续</button>
                  <button onClick={(e) => { e.stopPropagation(); stopTimer(); }} className="text-[11px] p-[2px_8px] rounded-[10px] border-none bg-[#ef4444] text-[#fff] cursor-pointer">结束</button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* 番茄钟切换 */}
      <button onClick={() => { setPomodoroMode(!pomodoroMode); setPomodoroPhase('work'); }} className="text-[11px] p-[3px_10px] rounded-[10px] whitespace-nowrap cursor-pointer"
        style={{
          background: pomodoroMode ? 'rgba(78,204,163,0.15)' : 'transparent',
          border: pomodoroMode ? '1px solid #4ecca3' : '1px solid var(--border)',
          color: pomodoroMode ? '#4ecca3' : 'var(--text-muted)',
        }}>
        🍅 {pomodoroMode ? `${pomodoroCompleted}个` : '番茄'}
      </button>

      {/* Toast 提示 */}
      {quickStartToast && (
        <div className="absolute top-[100%] left-[50%] -translate-x-[50%] mt-[8px] p-[8px_16px] rounded-[12px] bg-[var(--bg-tertiary)] border border-[var(--border)] shadow-[var(--shadow-pop)] z-[200] flex items-center gap-[8px] text-[12px] whitespace-nowrap">
          <span>{quickStartToast}</span>
          {quickStartToast.includes('5 分钟') && (
            <>
              <button onClick={handleContinue25} className="p-[4px_12px] rounded-[8px] text-[11px] bg-[var(--accent)] text-[#000] border-none cursor-pointer">继续 25 分钟</button>
              <button onClick={() => setQuickStartToast(null)} className="p-[4px_8px] rounded-[8px] text-[11px] bg-transparent text-[var(--text-muted)] border border-[var(--border)] cursor-pointer">不了</button>
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(78,204,163,0.3); }
          50% { box-shadow: 0 0 20px rgba(10,132,255,0.5); }
        }
      `}</style>
    </div>
  );
}
