import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuizStore, syncSubjectProgress } from '../store/quizStore';
import type { SubjectKey, ErrorTag } from '../types';

const SUBJECT_NAMES: Record<string, string> = {
  electronics: '电子技术', math: '高等数学', english: '英语', politics: '政治',
};

const ERROR_TAGS: ErrorTag[] = ['公式记错','概念混淆','计算失误','审题不清','词汇不认识','语法混淆','记忆遗漏','要点不全','逻辑误判'];

export function QuizPanel() {
  const { subject } = useParams<{ subject: string }>();
  const navigate = useNavigate();
  const { questions, currentIndex, selectedAnswer, showResult, lastAttempt,
          correctCount, wrongCount,
          loadQuestions, selectAnswer, submitAnswer, nextQuestion, updateAttemptTags } = useQuizStore();
  const [selectedTags, setSelectedTags] = useState<ErrorTag[]>([]);
  const [selectedMulti, setSelectedMulti] = useState<string[]>([]);
  const [pendingSelf, setPendingSelf] = useState(false);
  const [quizDone, setQuizDone] = useState(false);

  useEffect(() => {
    if (subject) loadQuestions(subject as SubjectKey);
  }, [subject]);

  if (questions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        <div className="text-center">
          <div className="text-4xl mb-4">📚</div>
          <div className="text-sm mb-4">暂无题目，请先在题库中添加</div>
          <button onClick={() => navigate('/')} className="px-4 py-2 rounded-lg text-sm"
            style={{ background: 'var(--accent)', color: '#fff' }}>返回首页</button>
        </div>
      </div>
    );
  }

  if (quizDone) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>本轮完成</h2>
          <div className="grid grid-cols-2 gap-3 my-6">
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
              <div className="text-2xl font-bold" style={{ color: '#2ecc71' }}>{correctCount}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>答对</div>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
              <div className="text-2xl font-bold" style={{ color: '#e74c3c' }}>{wrongCount}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>做错</div>
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={async () => { setQuizDone(false); setSelectedMulti([]); setPendingSelf(false); await loadQuestions(subject as SubjectKey); }}
              className="px-5 py-2 rounded-lg text-sm" style={{ background: 'var(--accent)', color: '#fff' }}>
              再来一轮
            </button>
            <button onClick={() => navigate('/')}
              className="px-5 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[currentIndex];
  const isCorrect = showResult && lastAttempt?.isCorrect;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      {/* 顶部信息栏 */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate('/')} className="text-sm" style={{ color: 'var(--text-muted)' }}>
          ← {SUBJECT_NAMES[subject || ''] || subject}
        </button>
        <span className="text-sm px-3 py-1 rounded-full" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {questions.length}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-1 rounded-full mb-6" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full transition-all" style={{
          width: `${((currentIndex + (showResult ? 1 : 0)) / questions.length) * 100}%`,
          background: 'var(--accent)',
        }} />
      </div>

      {/* 题目卡片 */}
      <div className="rounded-2xl p-6 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
            {q.type === 'single' ? '单选' : q.type === 'multiple' ? '多选' : q.type === 'truefalse' ? '判断' : q.type === 'fill' ? '填空' : q.type === 'short' ? '简答' : '论述'}
          </span>
          <span className="text-xs px-2 py-0.5 rounded" style={{
            background: q.difficulty === 'easy' ? 'rgba(46,204,113,0.15)' : q.difficulty === 'hard' ? 'rgba(231,76,60,0.15)' : 'rgba(243,156,18,0.15)',
            color: q.difficulty === 'easy' ? '#2ecc71' : q.difficulty === 'hard' ? '#e74c3c' : '#f39c12',
          }}>
            {q.difficulty === 'easy' ? '简单' : q.difficulty === 'hard' ? '困难' : '中等'}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{q.chapter}</span>
        </div>
        <div className="text-base leading-relaxed mb-6" style={{ color: 'var(--text-primary)' }}>
          {q.stem}
        </div>

        {/* 判断题：对/错 */}
        {q.type === 'truefalse' && (
          <div className="flex gap-3">
            {['对', '错'].map(v => (
              <button
                key={v}
                onClick={() => !showResult && selectAnswer(v)}
                disabled={showResult}
                className="flex-1 p-3 rounded-lg transition-all text-sm font-bold"
                style={{
                  background: selectedAnswer === v ? 'rgba(10,132,255,0.1)' : 'var(--bg-secondary)',
                  border: selectedAnswer === v ? '1px solid var(--accent)' : '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  cursor: showResult ? 'default' : 'pointer',
                }}
              >
                {v === '对' ? '✓ 对' : '✗ 错'}
              </button>
            ))}
          </div>
        )}

        {/* 选项 */}
        {q.options && q.type !== 'truefalse' && (
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const letter = String.fromCharCode(65 + i);
              const isSelected = q.type === 'multiple' ? selectedMulti.includes(letter) : selectedAnswer === letter;
              const isCorrectAnswer = showResult && (q.type === 'multiple' ? q.answer.includes(letter) : q.answer === letter);
              const isWrongSelected = showResult && isSelected && !isCorrectAnswer;

              const toggleOption = () => {
                if (showResult) return;
                if (q.type === 'multiple') {
                  const next = selectedMulti.includes(letter)
                    ? selectedMulti.filter(l => l !== letter)
                    : [...selectedMulti, letter];
                  setSelectedMulti(next);
                  selectAnswer([...next].sort().join(''));
                } else {
                  selectAnswer(letter);
                }
              };

              return (
                <button
                  key={i}
                  onClick={toggleOption}
                  disabled={showResult}
                  className="w-full text-left p-3 rounded-lg transition-all text-sm"
                  style={{
                    background: isCorrectAnswer ? 'rgba(46,204,113,0.15)' :
                              isWrongSelected ? 'rgba(231,76,60,0.15)' :
                              isSelected ? 'rgba(10,132,255,0.1)' : 'var(--bg-secondary)',
                    border: isCorrectAnswer ? '1px solid rgba(46,204,113,0.4)' :
                            isWrongSelected ? '1px solid rgba(231,76,60,0.4)' :
                            isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    cursor: showResult ? 'default' : 'pointer',
                  }}
                >
                  <span className="font-bold mr-2" style={{ color: 'var(--text-muted)' }}>{letter}.</span>
                  {opt}
                  {isCorrectAnswer && <span className="ml-2">✅</span>}
                  {isWrongSelected && <span className="ml-2">❌</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* 填空/简答/论述输入 */}
        {!q.options && !showResult && (
          q.type === 'essay' || q.type === 'short' ? (
            <textarea
              value={selectedAnswer}
              onChange={e => selectAnswer(e.target.value)}
              rows={q.type === 'essay' ? 6 : 3}
              className="w-full p-3 rounded-lg text-sm"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical' }}
              placeholder={q.type === 'essay' ? '输入你的论述...' : '输入你的答案...'}
            />
          ) : (
            <input
              value={selectedAnswer}
              onChange={e => selectAnswer(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitAnswer(selectedTags)}
              className="w-full p-3 rounded-lg text-sm"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              placeholder="输入你的答案..."
            />
          )
        )}

        {/* 结果展示 */}
        {showResult && (
          <div className="mt-4 p-4 rounded-lg" style={{
            background: lastAttempt?.isCorrect ? 'rgba(46,204,113,0.08)' : 'rgba(231,76,60,0.08)',
            border: `1px solid ${lastAttempt?.isCorrect ? 'rgba(46,204,113,0.2)' : 'rgba(231,76,60,0.2)'}`,
          }}>
            <div className="text-sm font-bold mb-2" style={{
              color: lastAttempt?.isCorrect ? '#2ecc71' : '#e74c3c',
            }}>
              {lastAttempt?.isCorrect ? '✅ 回答正确！' : '❌ 回答错误'}
            </div>
            {!lastAttempt?.isCorrect && (
              <div className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
                正确答案：<span style={{ color: '#2ecc71', fontWeight: 600 }}>{q.answer}</span>
              </div>
            )}
            {q.analysis && (
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                💡 {q.analysis}
              </div>
            )}

            {/* 错因标签 */}
            {!lastAttempt?.isCorrect && (
              <div className="mt-3">
                <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>错因（可多选）：</div>
                <div className="flex flex-wrap gap-1.5">
                  {ERROR_TAGS.map(tag => (
                    <button key={tag} onClick={() => {
                      setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
                    }} className="text-xs px-2 py-1 rounded-full transition-all" style={{
                      background: selectedTags.includes(tag) ? 'rgba(231,76,60,0.2)' : 'var(--bg-tertiary)',
                      color: selectedTags.includes(tag) ? '#e74c3c' : 'var(--text-muted)',
                      border: selectedTags.includes(tag) ? '1px solid rgba(231,76,60,0.3)' : '1px solid transparent',
                    }}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-center gap-3 mt-auto">
        {!showResult ? (
          q.type === 'essay' ? (
            pendingSelf ? (
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>自评：</span>
                <button onClick={() => { submitAnswer(selectedTags, true); setPendingSelf(false); }}
                  className="px-6 py-3 rounded-xl text-sm font-bold transition-all"
                  style={{ background: 'rgba(46,204,113,0.15)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.3)' }}>
                  ✅ 答对了
                </button>
                <button onClick={() => { submitAnswer(selectedTags, false); setPendingSelf(false); }}
                  className="px-6 py-3 rounded-xl text-sm font-bold transition-all"
                  style={{ background: 'rgba(231,76,60,0.15)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)' }}>
                  ❌ 答错了
                </button>
              </div>
            ) : (
              <button onClick={() => setPendingSelf(true)} disabled={!selectedAnswer.trim()}
                className="px-8 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-30"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                提交答案
              </button>
            )
          ) : (
            <button onClick={() => submitAnswer(selectedTags)} disabled={!selectedAnswer}
              className="px-8 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-30"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              提交答案
            </button>
          )
        ) : (
          <button onClick={async () => {
            // Save error tags to the attempt before moving on
            if (lastAttempt && !lastAttempt.isCorrect && selectedTags.length > 0) {
              await updateAttemptTags(lastAttempt.id, selectedTags);
            }
            setSelectedTags([]);
            setSelectedMulti([]);
            setPendingSelf(false);
            if (currentIndex >= questions.length - 1) {
              await syncSubjectProgress(subject as SubjectKey);
              setQuizDone(true);
            }
            else nextQuestion();
          }}
            className="px-8 py-3 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {currentIndex >= questions.length - 1 ? '查看结果' : '下一题 →'}
          </button>
        )}
      </div>
    </div>
  );
}
