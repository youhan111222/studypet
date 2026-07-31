import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/quizStore';
import { Rating, type Grade } from 'ts-fsrs';

const RATING_LABELS: Record<number, { label: string; color: string; desc: string }> = {
  [Rating.Again]: { label: '完全忘了', color: '#e74c3c', desc: '重置复习' },
  [Rating.Hard]: { label: '很困难', color: '#f39c12', desc: '勉强答对' },
  [Rating.Good]: { label: '正常', color: '#2ecc71', desc: '正常回忆' },
  [Rating.Easy]: { label: '很简单', color: '#3498db', desc: '轻松答对' },
};

export function ReviewPanel() {
  const navigate = useNavigate();
  const { reviewCards, reviewIndex, questions, loadDueReviews, submitReviewRating, nextReviewQuestion } = useQuizStore();
  const [showAnswer, setShowAnswer] = useState(false);
  const [rated, setRated] = useState(false);

  useEffect(() => { loadDueReviews(); }, []);

  if (reviewCards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        <div className="text-center">
          <div className="text-5xl mb-4">🎉</div>
          <div className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>没有待复习的题目</div>
          <div className="text-sm mb-4">所有错题都在按计划复习中</div>
          <button onClick={() => navigate('/')} className="px-4 py-2 rounded-lg text-sm"
            style={{ background: 'var(--accent)', color: '#fff' }}>返回首页</button>
        </div>
      </div>
    );
  }

  const q = questions[reviewIndex];
  const card = reviewCards[reviewIndex];
  if (!q || !card) return null;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate('/')} className="text-sm" style={{ color: 'var(--text-muted)' }}>
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs px-3 py-1 rounded-full" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
            {reviewIndex + 1} / {reviewCards.length}
          </span>
          <span className="text-xs px-2 py-1 rounded" style={{
            background: card.state === 'Review' ? 'rgba(46,204,113,0.15)' : 'rgba(243,156,18,0.15)',
            color: card.state === 'Review' ? '#2ecc71' : '#f39c12',
          }}>{card.state === 'Review' ? '复习中' : card.state}</span>
        </div>
      </div>

      {/* 题目 */}
      <div className="rounded-2xl p-6 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          {q.subject === 'electronics' ? '电子技术' : q.subject === 'math' ? '高数' : q.subject === 'english' ? '英语' : '政治'} · {q.chapter}
        </div>
        <div className="text-base leading-relaxed mb-4" style={{ color: 'var(--text-primary)' }}>
          {q.stem}
        </div>

        {!showAnswer ? (
          <div className="text-center py-8">
            <div className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>在脑中回忆答案...</div>
            <button onClick={() => setShowAnswer(true)}
              className="px-6 py-2 rounded-lg text-sm" style={{ background: 'var(--accent)', color: '#fff' }}>
              显示答案
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-lg" style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.2)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>正确答案</div>
            <div className="text-base font-bold mb-2" style={{ color: '#2ecc71' }}>{q.answer}</div>
            {q.analysis && <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>💡 {q.analysis}</div>}
          </div>
        )}
      </div>

      {/* 评分 */}
      {showAnswer && !rated && (
        <div className="space-y-3 mb-4">
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>你的记忆程度：</div>
          {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const).map(rating => (
            <button key={rating} onClick={async () => { await submitReviewRating(rating as Grade); setRated(true); }}
              className="w-full p-3 rounded-lg text-left flex items-center justify-between transition-all"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div>
                <div className="text-sm font-bold" style={{ color: RATING_LABELS[rating].color }}>{RATING_LABELS[rating].label}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{RATING_LABELS[rating].desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {rated && (
        <button onClick={async () => {
          setShowAnswer(false); setRated(false);
          if (reviewIndex >= reviewCards.length - 1) {
            // 最后一张卡：刷新队列（刚评完的卡已排到未来，队列里可能还有今天到期的）
            await loadDueReviews();
          } else {
            nextReviewQuestion();
          }
        }}
          className="px-8 py-3 rounded-xl text-sm font-bold mx-auto"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          下一题 →
        </button>
      )}
    </div>
  );
}
