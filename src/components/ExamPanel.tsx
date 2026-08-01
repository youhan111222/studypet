import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useExamStore } from '../store/examStore';
import { useStore } from '../store/useStore';
import type { SubjectKey } from '../types';

const SUBJECT_NAMES: Record<string, string> = {
  electronics: '电子技术', math: '高等数学', english: '英语', politics: '政治',
};
const TYPE_LABELS: Record<string, string> = {
  single: '单选', multiple: '多选', truefalse: '判断', fill: '填空', short: '简答', essay: '论述',
};

export function ExamPanel() {
  const { subject } = useParams<{ subject: string }>();
  const navigate = useNavigate();
  const { active, questions, answers, remainingSec, result,
          startExam, answerQuestion, finishExam, exitExam } = useExamStore();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [fillText, setFillText] = useState('');
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState(30);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => useExamStore.getState().tick(), 1000);
    return () => clearInterval(iv);
  }, [active]);

  if (result) {
    const rate = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;
    const wrongs = result.items.filter(i => !i.isCorrect);
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="max-w-2xl mx-auto w-full">
          <div className="rounded-2xl p-6 mb-4 bg-[var(--bg-card)] border border-[var(--border)] text-center">
            <div className="text-5xl mb-2">{rate >= 90 ? '🏆' : rate >= 60 ? '🎉' : '📚'}</div>
            <h2 className="text-xl font-bold mb-1 text-[var(--text-primary)]">考试完成</h2>
            <div className="text-3xl font-bold text-[var(--accent)] mb-3">{rate} 分</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl p-3 bg-[var(--bg-secondary)]">
                <div className="text-2xl font-bold text-[#2ecc71]">{result.correct}</div>
                <div className="text-xs text-[var(--text-muted)]">答对</div>
              </div>
              <div className="rounded-xl p-3 bg-[var(--bg-secondary)]">
                <div className="text-2xl font-bold text-[#e74c3c]">{result.wrong}</div>
                <div className="text-xs text-[var(--text-muted)]">答错/未答</div>
              </div>
              <div className="rounded-xl p-3 bg-[var(--bg-secondary)]">
                <div className="text-2xl font-bold">{result.total}</div>
                <div className="text-xs text-[var(--text-muted)]">总题数</div>
              </div>
            </div>
            <div className="flex gap-3 justify-center mt-5">
              <button onClick={() => { exitExam(); setCurrentIdx(0); setFillText(''); }}
                className="px-5 py-2 rounded-lg text-sm bg-[var(--accent)] text-[#fff]">再来一场</button>
              <button onClick={() => navigate('/')}
                className="px-5 py-2 rounded-lg text-sm bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border)]">返回首页</button>
            </div>
          </div>

          {wrongs.length > 0 && (
            <div className="rounded-2xl p-5 bg-[var(--bg-card)] border border-[var(--border)]">
              <h3 className="text-sm font-bold mb-3 text-[var(--text-primary)]">错题回顾（{wrongs.length}）</h3>
              <div className="flex flex-col gap-3">
                {wrongs.map((w, i) => (
                  <div key={w.questionId} className="rounded-xl p-3 bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <div className="text-[13px] mb-1 text-[var(--text-primary)]">{i + 1}. {w.stem}</div>
                    <div className="text-xs space-y-0.5">
                      <div className="text-[#e74c3c]">你的答案：{w.userAnswer}</div>
                      <div className="text-[#2ecc71]">正确答案：{w.correctAnswer}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md w-full rounded-2xl p-8 bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-5xl mb-3">⏱️</div>
          <h2 className="text-xl font-bold mb-1 text-[var(--text-primary)]">模拟考试</h2>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            {SUBJECT_NAMES[subject || ''] || subject} · 限时整卷，交卷后统一判分（对标真实考场）
          </p>
          <div className="flex gap-3 justify-center mb-4">
            {[10, 20, 30].map(n => (
              <button key={n} onClick={() => setCount(n)}
                className={`px-4 py-2 rounded-lg text-sm border ${count === n ? 'bg-[rgba(10,132,255,0.18)] border-[var(--accent)] text-[var(--accent)]' : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)]'}`}>
                {n} 题
              </button>
            ))}
          </div>
          <div className="flex gap-3 justify-center mb-6">
            {[15, 30, 45].map(m => (
              <button key={m} onClick={() => setMinutes(m)}
                className={`px-4 py-2 rounded-lg text-sm border ${minutes === m ? 'bg-[rgba(10,132,255,0.18)] border-[var(--accent)] text-[var(--accent)]' : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)]'}`}>
                {m} 分钟
              </button>
            ))}
          </div>
          <div className="flex gap-3 justify-center">
            <button disabled={starting} onClick={async () => {
              if (!subject) return;
              setStarting(true);
              try { await startExam(subject as SubjectKey, count, minutes); setCurrentIdx(0); setFillText(''); }
              finally { setStarting(false); }
            }}
              className="px-6 py-2.5 rounded-lg text-sm bg-[var(--accent)] text-[#fff] disabled:opacity-40">
              {starting ? '准备中…' : '开始考试'}
            </button>
            <button onClick={() => navigate('/')}
              className="px-5 py-2.5 rounded-lg text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border)]">返回</button>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[currentIdx];
  if (!q) return null;
  const answeredCount = Object.keys(answers).length;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');
  const myAnswer = answers[q.id] || '';

  const setAnswer = (val: string) => {
    if (q.type === 'multiple') {
      const cur = new Set(myAnswer.split('').filter(Boolean));
      if (cur.has(val)) cur.delete(val); else cur.add(val);
      answerQuestion(q.id, [...cur].sort().join(''));
    } else {
      answerQuestion(q.id, val);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/')} className="text-sm text-[var(--text-muted)]">← {SUBJECT_NAMES[subject || ''] || subject} 考试</button>
        <div className={`text-lg font-bold tabular-nums ${remainingSec <= 60 ? 'text-[#e74c3c]' : 'text-[var(--text-primary)]'}`}>⏱ {mm}:{ss}</div>
        <div className="text-sm text-[var(--text-secondary)]">已答 {answeredCount}/{questions.length}</div>
      </div>

      <div className="rounded-2xl p-6 mb-4 bg-[var(--bg-card)] border border-[var(--border)]">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            {TYPE_LABELS[q.type] || q.type}
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            {currentIdx + 1} / {questions.length}
          </span>
        </div>
        <div className="text-base leading-relaxed mb-5 text-[var(--text-primary)]">{q.stem}</div>

        {q.type === 'truefalse' && (
          <div className="flex gap-3">
            {['对', '错'].map(v => (
              <button key={v} onClick={() => setAnswer(v)}
                className={`flex-1 p-3 rounded-lg text-sm font-bold border ${myAnswer === v ? 'bg-[rgba(10,132,255,0.18)] border-[var(--accent)]' : 'bg-[var(--bg-secondary)] border-[var(--border)]'} text-[var(--text-primary)]`}>
                {v}
              </button>
            ))}
          </div>
        )}

        {(q.type === 'single' || q.type === 'multiple') && (q.options || []).map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const selected = q.type === 'multiple' ? myAnswer.includes(letter) : myAnswer === letter;
          return (
            <button key={letter} onClick={() => setAnswer(letter)}
              className={`w-full text-left p-3 rounded-lg mb-2 text-sm border transition-all ${selected ? 'bg-[rgba(10,132,255,0.18)] border-[var(--accent)]' : 'bg-[var(--bg-secondary)] border-[var(--border)]'} text-[var(--text-primary)]`}>
              <span className="font-bold mr-2">{letter}.</span>{opt}
              {q.type === 'multiple' && <span className="float-right">{selected ? '☑' : '☐'}</span>}
            </button>
          );
        })}

        {(q.type === 'fill' || q.type === 'short' || q.type === 'essay') && (
          <div className="flex gap-2">
            <input
              value={fillText}
              onChange={e => setFillText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setAnswer(fillText.trim()); }}
              placeholder="输入你的答案…"
              className="flex-1 p-3 rounded-lg text-sm bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <button onClick={() => setAnswer(fillText.trim())}
              className="px-4 py-2 rounded-lg text-sm bg-[var(--accent)] text-[#fff]">保存</button>
          </div>
        )}
      </div>

      {/* 题号导航 */}
      <div className="rounded-2xl p-4 mb-4 bg-[var(--bg-card)] border border-[var(--border)]">
        <div className="flex flex-wrap gap-2">
          {questions.map((qq, i) => {
            const done = Boolean(answers[qq.id]);
            return (
              <button key={qq.id} onClick={() => setCurrentIdx(i)}
                className={`w-9 h-9 rounded-lg text-xs font-bold border ${i === currentIdx ? 'bg-[var(--accent)] text-[#fff] border-[var(--accent)]' : done ? 'bg-[rgba(46,204,113,0.15)] border-[rgba(46,204,113,0.4)] text-[#2ecc71]' : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)]'}`}>
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between">
        <button onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
          className="px-5 py-2 rounded-lg text-sm bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">上一题</button>
        {currentIdx < questions.length - 1 ? (
          <button onClick={() => setCurrentIdx(i => i + 1)}
            className="px-5 py-2 rounded-lg text-sm bg-[var(--accent)] text-[#fff]">下一题</button>
        ) : (
          <button onClick={() => { if (window.confirm('确定交卷吗？未作答的题按错误计。')) void finishExam(); }}
            className="px-5 py-2 rounded-lg text-sm bg-[#e74c3c] text-[#fff]">交卷</button>
        )}
      </div>
    </div>
  );
}