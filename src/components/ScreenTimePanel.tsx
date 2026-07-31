import { useEffect, useState } from 'react';
import { API } from '../config';

const catMeta: Record<string, { label: string; color: string; icon: string }> = {
  study: { label: '学习', color: '#4ecca3', icon: '📖' },
  dev: { label: '开发', color: '#61afef', icon: '💻' },
  tools: { label: '工具', color: '#8a8a8a', icon: '🔧' },
  system: { label: '系统', color: '#6b6b6b', icon: '🖥️' },
  browser: { label: '浏览器', color: '#0a84ff', icon: '🌐' },
  entertainment: { label: '娱乐', color: '#ef5350', icon: '🎮' },
  social: { label: '社交', color: '#ffa726', icon: '💬' },
  other: { label: '其他', color: '#9e9e9e', icon: '📂' },
};

interface AppEntry { appName: string; category: string; duration: number; title: string; }
interface StatsResponse {
  apps: AppEntry[];
  categories: Record<string, number>;
  idleMinutes: number;
  totalActiveMinutes: number;
  effectiveStudyMinutes: number;
  distractionMinutes: number;
  browserReclassifiedMinutes: number;
  browserRemainingMinutes: number;
  date: string;
  credibilityNote?: string;
}
interface HistoryItem { window_title: string; process_name: string; category: string; start_time: string; duration_seconds: number; date: string; }
interface HourAgg { study: number; ent: number; }
interface DayAgg { key: string; label: string; isToday: boolean; study: number; ent: number; other: number; total: number; }
interface Insight { key: string; icon: string; tone: 'red' | 'accent' | 'blue'; text: string; }

// ====== 卡片通用样式 ======
const CARD_CLS = 'p-4 rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)]';
const CARD_TITLE_CLS = 'text-[13px] font-semibold mb-3';

const GREEN = '#4ecca3';
const RED = '#ef5350';
const OTHER_GRAY = '#565d7a';
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const fmtHM = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

const fmtStudyTop = (min: number): string => {
  if (min <= 0) return '0';
  const h = min / 60;
  const v = Math.round(h * 10) / 10;
  return v >= 1 ? `${v}h` : `${min}m`;
};

export function ScreenTimePanel() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [statRes, histRes] = await Promise.all([
          fetch(`${API}/activity/stats`),
          fetch(`${API}/activity/history?days=7`),
        ]);
        const s: StatsResponse = await statRes.json();
        const raw: HistoryItem[] = await histRes.json();
        setStats(s);
        setHistory(raw);
      } catch { } finally { setLoading(false); }
    };
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
        {loading ? '加载中...' : '暂无屏幕时间数据，请确保 tracker.py 已启动'}
      </div>
    );
  }

  const effectiveStudy = stats.effectiveStudyMinutes ?? 0;
  const distraction = stats.distractionMinutes ?? 0;
  const browserReclassified = stats.browserReclassifiedMinutes ?? 0;
  const totalActive = stats.totalActiveMinutes || 0;
  const idleMin = stats.idleMinutes || 0;
  const totalAll = totalActive + idleMin;
  const categories = stats.categories || {};
  const sortedApps = [...stats.apps].sort((a, b) => b.duration - a.duration);

  // ===== 24h 聚合：学习（绿）与 娱乐+社交（红） =====
  const hourAggs: HourAgg[] = Array.from({ length: 24 }, () => ({ study: 0, ent: 0 }));
  history.forEach(r => {
    if (!r.start_time) return;
    const h = parseInt(r.start_time.slice(11, 13), 10);
    if (!Number.isInteger(h) || h < 0 || h > 23) return;
    const m = Math.round(r.duration_seconds / 60);
    if (r.category === 'study') hourAggs[h].study += m;
    else if (r.category === 'entertainment' || r.category === 'social') hourAggs[h].ent += m;
  });
  const maxHour = Math.max(1, ...hourAggs.map(h => h.study + h.ent));
  const nowHour = new Date().getHours();

  // ===== 过去 7 天：按 date + 类别聚合（本地日期键，避免 UTC 偏移） =====
  const days: DayAgg[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let study = 0, ent = 0, other = 0;
    history.forEach(r => {
      if (r.date !== key) return;
      const m = Math.round(r.duration_seconds / 60);
      if (r.category === 'study') study += m;
      else if (r.category === 'entertainment' || r.category === 'social') ent += m;
      else other += m;
    });
    days.push({ key, label: DAY_LABELS[d.getDay()], isToday: i === 6, study, ent, other, total: study + ent + other });
  }
  const maxDayTotal = Math.max(1, ...days.map(d => d.total));

  // ===== 学习占比（环形） =====
  const studyShare = effectiveStudy + distraction > 0 ? effectiveStudy / (effectiveStudy + distraction) : 0;
  const sharePct = Math.round(studyShare * 100);
  const ringColor = sharePct >= 40 ? GREEN : sharePct >= 20 ? '#ffa726' : RED;
  const RING_R = 29;
  const RING_C = 2 * Math.PI * RING_R;

  // ===== 洞察 =====
  const insights: Insight[] = [];
  if (effectiveStudy + distraction > 0 && studyShare < 0.3) {
    const entMin = (categories['entertainment'] || 0) + (categories['social'] || 0);
    insights.push({ key: 'low-share', icon: '⚠️', tone: 'red', text: `今日学习占比仅 ${sharePct}%，娱乐 ${fmtHM(entMin)}，建议收心` });
  }
  let bestHourIdx = -1, bestStudy = 0;
  hourAggs.forEach((h, i) => { if (h.study > bestStudy) { bestStudy = h.study; bestHourIdx = i; } });
  if (bestStudy > 0) {
    insights.push({ key: 'golden', icon: '💡', tone: 'accent', text: `你的黄金学习时段：${bestHourIdx}-${bestHourIdx + 1} 时（今日学习 ${bestStudy}m）` });
  }
  if (browserReclassified > 0) {
    insights.push({ key: 'browser', icon: '🌐', tone: 'blue', text: `浏览器中命中学习内容 ${browserReclassified}m（已计入有效学习）` });
  }

  const toneCls: Record<Insight['tone'], string> = {
    red: 'bg-[rgba(233,69,96,0.1)] border border-[rgba(233,69,96,0.35)] text-[var(--red-soft)]',
    accent: 'bg-[var(--accent-dim)] border border-[rgba(78,204,163,0.35)] text-[var(--accent-2)]',
    blue: 'bg-[rgba(10,132,255,0.1)] border border-[rgba(10,132,255,0.35)] text-[var(--blue)]',
  };

  return (
    <div className="flex-1 overflow-y-auto p-[24px_28px] flex flex-col gap-[14px]">
      {/* 1. 头部 */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-[22px] font-bold">屏幕使用时间</h2>
          <p className="text-xs text-[var(--text-muted)] mt-[4px]">{stats.date} · 每10秒自动刷新</p>
        </div>
        <div className="p-[10px_18px] rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)] text-center">
          <div className="text-[26px] font-extrabold leading-none text-[#4ecca3]">{fmtHM(effectiveStudy)}</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-[2px]">今日有效学习</div>
        </div>
      </div>

      {/* 2. 核心对比行 */}
      <div className="grid grid-cols-4 gap-[14px] shrink-0">
        <MetricCard icon="📖" label="有效学习" value={fmtHM(effectiveStudy)} color={GREEN} />
        <MetricCard icon="🎮" label="干扰时长" value={fmtHM(distraction)} color={RED} />
        <div className={`${CARD_CLS} flex items-center gap-3`}>
          <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0">
            <circle cx="38" cy="38" r={RING_R} fill="none" stroke="var(--bg-tertiary)" strokeWidth="9" />
            <circle cx="38" cy="38" r={RING_R} fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${RING_C * studyShare} ${RING_C}`} transform="rotate(-90 38 38)" />
            <text x="38" y="43" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--text-primary)">{sharePct}%</text>
          </svg>
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--text-muted)]">⚖️ 学习占比</div>
            <div className="text-[12px] font-semibold mt-[6px] truncate">
              <span className="text-[#4ecca3]">{fmtHM(effectiveStudy)}</span>
              <span className="text-[var(--text-muted)] font-normal"> / </span>
              <span className="text-[#ef5350]">{fmtHM(distraction)}</span>
            </div>
          </div>
        </div>
        <MetricCard icon="⏱" label="屏幕总时长" value={fmtHM(totalAll)} color="var(--text-secondary)" />
      </div>

      {/* 3. 24h 时间轴（双色堆叠） */}
      <div className={`${CARD_CLS} shrink-0`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold">24h 时段分布</h3>
          <span className="text-[10px] text-[var(--text-muted)]">🟩 学习 · 🟥 娱乐</span>
        </div>
        <div className="flex items-end gap-[3px] h-[110px]">
          {hourAggs.map((h, i) => {
            const isNow = i === nowHour;
            const studyPx = (h.study / maxHour) * 110;
            const entPx = (h.ent / maxHour) * 110;
            return (
              <div key={i}
                className={`flex-1 h-full flex flex-col justify-end rounded-[3px] ${isNow ? 'ring-1 ring-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
                title={`${i}时: 学习${h.study}m 娱乐${h.ent}m`}>
                {h.study + h.ent > 0 && (
                  <>
                    <div className="w-full bg-[#ef5350]" style={{ height: entPx }} />
                    <div className="w-full bg-[#4ecca3]" style={{ height: studyPx }} />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-[var(--text-muted)]">
          <span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>23时</span>
        </div>
      </div>

      {/* 4. 中部两列 */}
      <div className="grid grid-cols-2 gap-[14px] shrink-0">
        {/* 左：7 天堆叠趋势 */}
        <div className={CARD_CLS}>
          <h3 className={CARD_TITLE_CLS}>过去 7 天趋势</h3>
          <div className="flex items-end gap-2 h-[120px]">
            {days.map(d => {
              const barPx = (d.total / maxDayTotal) * 120;
              return (
                <div key={d.key} className="flex-1 h-full flex flex-col items-center justify-end gap-1 min-w-0">
                  <span className={`text-[9px] leading-none ${d.isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-muted)]'}`}>
                    {fmtStudyTop(d.study)}
                  </span>
                  <div className={`w-full rounded-[3px] overflow-hidden flex flex-col justify-end ${d.isToday ? 'ring-1 ring-[var(--accent)]' : ''}`}
                    style={{ height: `${Math.max(4, barPx)}px` }}>
                    <div className="w-full" style={{ height: (d.other / maxDayTotal) * 120, background: OTHER_GRAY }} />
                    <div className="w-full" style={{ height: (d.ent / maxDayTotal) * 120, background: RED }} />
                    <div className="w-full" style={{ height: (d.study / maxDayTotal) * 120, background: GREEN }} />
                  </div>
                  <span className={`text-[9px] leading-none ${d.isToday ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}`}>{d.label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-2 text-[10px] text-[var(--text-muted)]">
            <span>🟩 学习</span><span>🟥 娱乐</span><span>🟨 其他</span>
          </div>
        </div>

        {/* 右：分类占比（8 类全显示） */}
        <div className={CARD_CLS}>
          <h3 className={CARD_TITLE_CLS}>分类占比</h3>
          <div className="flex flex-col gap-2">
            {Object.entries(catMeta).map(([cat, meta]) => {
              const min = categories[cat] || 0;
              const pct = totalActive > 0 ? Math.round((min / totalActive) * 100) : 0;
              return (
                <div key={cat}>
                  <div className="flex justify-between mb-[3px]">
                    <span className="text-xs font-medium">{meta.icon} {meta.label}</span>
                    <span className="text-xs font-semibold" style={{ color: meta.color }}>{fmtHM(min)} · {pct}%</span>
                  </div>
                  <div className="h-[6px] bg-[var(--bg-tertiary)] rounded-[3px] overflow-hidden">
                    <div className="h-full rounded-[3px] transition-[width] duration-500" style={{ width: `${pct}%`, background: meta.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. 洞察区（无命中不显示） */}
      {insights.length > 0 && (
        <div className={`${CARD_CLS} shrink-0`}>
          <h3 className={CARD_TITLE_CLS}>今日洞察</h3>
          <div className="flex flex-col gap-2">
            {insights.map(it => (
              <div key={it.key} className={`flex items-center gap-2 p-[10px_12px] rounded-[8px] text-xs ${toneCls[it.tone]}`}>
                <span className="text-sm shrink-0">{it.icon}</span>
                <span>{it.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. 应用排行 Top 8（紧凑无进度条） */}
      <div className={`${CARD_CLS} shrink-0`}>
        <h3 className={CARD_TITLE_CLS}>应用排行 Top 8</h3>
        {sortedApps.length === 0 ? (
          <div className="py-3 text-center text-xs text-[var(--text-muted)]">暂无数据</div>
        ) : (
          <div className="flex flex-col">
            {sortedApps.slice(0, 8).map((app, i) => {
              const meta = catMeta[app.category] || { label: app.category, color: '#9e9e9e', icon: '📌' };
              return (
                <div key={app.appName}
                  className={`flex items-center gap-2 px-2 py-[5px] rounded-[6px] ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]' : 'bg-transparent'}`}>
                  <span className="text-[11px] text-[var(--text-muted)] w-4 text-center shrink-0">{i + 1}</span>
                  <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="flex-1 min-w-0 text-xs font-medium truncate">{app.appName}</span>
                  <span className="text-[11px] font-semibold shrink-0 tabular-nums" style={{ color: meta.color }}>{fmtHM(app.duration)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div className={`${CARD_CLS} flex items-center gap-3`}>
      <span className="text-[22px] shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-[var(--text-muted)] truncate">{label}</div>
        <div className="text-[17px] font-bold tabular-nums truncate" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}
