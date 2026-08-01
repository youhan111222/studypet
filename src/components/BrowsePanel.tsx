import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { useQuizStore } from '../store/quizStore';
import { parseCsv, importQuestions } from '../lib/csvImport';
import type { Question, SubjectKey, QuestionType, Difficulty } from '../types';

const SUBJECTS: { key: SubjectKey; name: string }[] = [
  { key: 'electronics', name: '电子技术' },
  { key: 'math', name: '高等数学' },
  { key: 'english', name: '英语' },
  { key: 'politics', name: '政治' },
];
const TYPE_LABELS: Record<string, string> = {
  single: '单选', multiple: '多选', truefalse: '判断', fill: '填空', short: '简答', essay: '论述',
};
const DIFF_LABELS: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' };

export function BrowsePanel() {
  const navigate = useNavigate();
  const toggleFavorite = useQuizStore(s => s.toggleFavorite);
  const [subject, setSubject] = useState<SubjectKey>('politics');
  const [all, setAll] = useState<Question[]>([]);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<string>('all');
  const [diff, setDiff] = useState<string>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void db.getQuestionsBySubject(subject, 1000).then(qs => { if (alive) setAll(qs); });
    return () => { alive = false; };
  }, [subject]);

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return all.filter(q => {
      if (favOnly && q.favorite !== true) return false;
      if (type !== 'all' && q.type !== type) return false;
      if (diff !== 'all' && q.difficulty !== diff) return false;
      if (kw) {
        const hay = `${q.stem} ${(q.options || []).join(' ')} ${q.analysis}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [all, keyword, type, diff, favOnly]);

  const count = useMemo(() => all.filter(q => q.favorite === true).length, [all]);

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">题库浏览 <span className="text-xs font-normal text-[var(--text-muted)]">（{all.length} 题 · 收藏 {count}）</span></h2>
        <button onClick={() => navigate('/')} className="text-sm text-[var(--text-muted)]">← 返回</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {SUBJECTS.map(s => (
          <button key={s.key} onClick={() => { setSubject(s.key); setExpanded(null); }}
            className={`px-3 py-1.5 rounded-full text-sm border ${subject === s.key ? 'bg-[rgba(10,132,255,0.18)] border-[var(--accent)] text-[var(--accent)]' : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-secondary)]'}`}>
            {s.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="🔍 搜索题干 / 选项 / 解析…"
          className="flex-1 min-w-[200px] p-2.5 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <select value={type} onChange={e => setType(e.target.value)}
          className="p-2.5 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] outline-none">
          <option value="all">全部题型</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={diff} onChange={e => setDiff(e.target.value)}
          className="p-2.5 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] outline-none">
          <option value="all">全部难度</option>
          {Object.entries(DIFF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={() => setFavOnly(v => !v)}
          className={`px-3 py-2 rounded-lg text-sm border ${favOnly ? 'bg-[rgba(245,197,24,0.15)] border-[#f5c518] text-[#f5c518]' : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-secondary)]'}`}>
          ★ 只看收藏
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const text = await f.text();
              const rows = parseCsv(text);
              const headerIdx = rows.findIndex(r => /stem|题干/i.test(r.join(',')));
              const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
              const summary = await importQuestions(dataRows);
              setAll(await db.getQuestionsBySubject(subject, 1000));
              setImportMsg(`导入完成：新增 ${summary.imported} 题，重复跳过 ${summary.skipped}，失败 ${summary.failed}${summary.errors.length ? '，' + summary.errors.slice(0, 3).join('；') : ''}`);
            } catch (err) {
              setImportMsg('导入失败：' + String(err));
            }
          }}
        />
        <button onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-lg text-sm border bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
          📥 导入 CSV
        </button>
      </div>

      {importMsg && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-[rgba(78,204,163,0.1)] border border-[rgba(78,204,163,0.25)] text-[var(--text-secondary)]">
          {importMsg}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {list.length === 0 && (
          <div className="text-center py-10 text-sm text-[var(--text-muted)]">没有符合条件的题目</div>
        )}
        {list.map(q => {
          const open = expanded === q.id;
          return (
            <div key={q.id} className="rounded-xl p-4 bg-[var(--bg-card)] border border-[var(--border)]">
              <div className="flex items-start gap-2">
                <button
                  onClick={() => toggleFavorite(q.id)}
                  title={q.favorite ? '取消收藏' : '收藏本题'}
                  className={`text-lg leading-none shrink-0 ${q.favorite ? 'text-[#f5c518]' : 'text-[var(--text-muted)]'}`}>
                  {q.favorite ? '★' : '☆'}
                </button>
                <button onClick={() => setExpanded(open ? null : q.id)} className="flex-1 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">{TYPE_LABELS[q.type] || q.type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${q.difficulty === 'easy' ? 'bg-[rgba(46,204,113,0.15)] text-[#2ecc71]' : q.difficulty === 'hard' ? 'bg-[rgba(231,76,60,0.15)] text-[#e74c3c]' : 'bg-[rgba(243,156,18,0.15)] text-[#f39c12]'}`}>
                      {DIFF_LABELS[q.difficulty] || q.difficulty}
                    </span>
                    {q.source === 'import' && <span className="text-xs text-[var(--text-muted)]">真题</span>}
                  </div>
                  <div className="text-sm text-[var(--text-primary)] line-clamp-2">{q.stem}</div>
                  <div className="text-xs mt-1 text-[var(--accent)]">{open ? '▲ 收起' : '▼ 展开答案'}</div>
                </button>
              </div>
              {open && (
                <div className="mt-3 pl-7 text-sm">
                  {(q.options || []).length > 0 && (
                    <div className="mb-2 space-y-1 text-[var(--text-secondary)]">
                      {(q.options || []).map((o, i) => <div key={i}>{String.fromCharCode(65 + i)}. {o}</div>)}
                    </div>
                  )}
                  <div className="mb-1"><span className="text-[#2ecc71]">答案：</span><span className="text-[var(--text-primary)]">{q.answer}</span></div>
                  {q.analysis && <div className="text-xs text-[var(--text-muted)]">解析：{q.analysis}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}