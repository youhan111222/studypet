import { useState, useRef, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { SEMESTER_START, getCurrentWeek } from '../config';
import { isWeekInRange } from '../utils';
import type { ScheduleItem } from '../types';

const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 获取本周一的日期
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// 格式化日期为 MM/DD
function fmtDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function SchedulePanel() {
  const schedule = useStore(s => s.schedule);
  const importSchedule = useStore(s => s.importSchedule);
  const clearSchedule = useStore(s => s.clearSchedule);
  const [importing, setImporting] = useState(false);
  const [xlsImporting, setXlsImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const parseCSV = (text: string): ScheduleItem[] => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV 至少需要标题行和一行数据');

    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
    const nameIdx = headers.findIndex(h => h.includes('课程') || h === 'name');
    const dayIdx = headers.findIndex(h => h.includes('星期') || h === 'day');
    const startIdx = headers.findIndex(h => h.includes('开始') || h.includes('start'));
    const endIdx = headers.findIndex(h => h.includes('结束') || h.includes('end'));
    const locIdx = headers.findIndex(h => h.includes('地点') || h.includes('location'));
    const teacherIdx = headers.findIndex(h => h.includes('教师') || h.includes('老师') || h === 'teacher');
    const weeksIdx = headers.findIndex(h => h.includes('周次') || h === 'weeks');

    if (nameIdx < 0 || dayIdx < 0 || startIdx < 0 || endIdx < 0) {
      throw new Error('CSV 必须包含：课程名称、星期、开始时间、结束时间 列');
    }

    const items: ScheduleItem[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 4) continue;
      const name = cols[nameIdx];
      const day = parseInt(cols[dayIdx]) || 0;
      if (!name || day < 1 || day > 7) continue;

      items.push({
        id: `csv-${Date.now()}-${i}`,
        name,
        day,
        timeStart: cols[startIdx] || '08:00',
        timeEnd: cols[endIdx] || '09:40',
        location: locIdx >= 0 ? cols[locIdx] || '' : '',
        teacher: teacherIdx >= 0 ? cols[teacherIdx] || '' : '',
        weeks: weeksIdx >= 0 ? cols[weeksIdx] || '1-16' : '1-16',
      });
    }
    return items;
  };

  const parseJSON = (text: string): ScheduleItem[] => {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.schedule || data.courses || []);
    return arr.map((item: any, i: number) => ({
      id: `json-${Date.now()}-${i}`,
      name: item.name || item.course || '',
      day: item.day || item.weekday || 1,
      timeStart: item.timeStart || item.start || '08:00',
      timeEnd: item.timeEnd || item.end || '09:40',
      location: item.location || item.classroom || '',
      teacher: item.teacher || '',
      weeks: item.weeks || '1-16',
    }));
  };

  const parseICS = (text: string): ScheduleItem[] => {
    const lines = text.split('\n');
    const items: ScheduleItem[] = [];
    let current: any = {};
    let inEvent = false;

    let inAlarm = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === 'BEGIN:VALARM') {
        inAlarm = true;
        continue;
      }
      if (line === 'END:VALARM') {
        inAlarm = false;
        continue;
      }
      if (inAlarm) continue;
      if (line === 'BEGIN:VEVENT') {
        current = {};
        inEvent = true;
      } else if (line === 'END:VEVENT') {
        if (current.SUMMARY && current.DTSTART && current.DTEND) {
          const start = current.DTSTART.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
          const end = current.DTEND.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
          const startDate = new Date(start);
          const endDate = new Date(end);
          const day = startDate.getDay() || 7;
          const timeStart = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
          const timeEnd = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
          const location = current.LOCATION || '';
          const teacher = current.DESCRIPTION ? current.DESCRIPTION.split('\\n')[0] : '';
          const weeks = '1-16';

          if (day >= 1 && day <= 5) {
            items.push({
              id: `ics-${Date.now()}-${i}`,
              name: current.SUMMARY,
              day: day,
              timeStart,
              timeEnd,
              location,
              teacher,
              weeks,
            });
          }
        }
        inEvent = false;
      } else if (inEvent) {
        const [prop, ...rest] = line.split(':');
        const value = rest.join(':');
        const key = prop.split(';')[0];
        if (key === 'SUMMARY') current.SUMMARY = value;
        else if (key === 'DTSTART') current.DTSTART = value;
        else if (key === 'DTEND') current.DTEND = value;
        else if (key === 'LOCATION') current.LOCATION = value;
        else if (key === 'DESCRIPTION') current.DESCRIPTION = value;
      }
    }
    return items;
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg('');
    try {
      const text = await file.text();
      let items: ScheduleItem[];
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) {
        items = parseJSON(text);
      } else if (name.endsWith('.csv')) {
        items = parseCSV(text);
      } else if (name.endsWith('.ics')) {
        items = parseICS(text);
      } else {
        throw new Error('仅支持 .csv / .json / .ics 格式');
      }
      if (items.length === 0) throw new Error('未解析到有效课程数据');
      clearSchedule();
      importSchedule(items);
      setImportMsg(`成功导入 ${items.length} 门课程`);
    } catch (e: any) {
      setImportMsg(`导入失败：${e.message}`);
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleXlsImport = async () => {
    if (xlsImporting) return;
    setXlsImporting(true);
    setImportMsg('');
    try {
      const res = await fetch('/schedule/import-from-xls');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: ScheduleItem[] = (data && Array.isArray(data.items)) ? data.items : [];
      if (items.length === 0) throw new Error('未解析到课程数据');
      importSchedule(items);
      setImportMsg(`已导入 ${items.length} 条课表`);
    } catch (e: any) {
      alert(`官方课表导入失败：${e.message}`);
    } finally {
      setXlsImporting(false);
    }
  };

  const today = new Date();
  const todayDay = today.getDay();
  const displayDay = todayDay === 0 ? 7 : todayDay;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // 学期开始日期（统一在 src/config.ts 配置）
  const [semesterStart, setSemesterStart] = useState(SEMESTER_START);
  const currentWeek = getCurrentWeek(semesterStart);

  // 判断给定周次字符串是否包含当前周（支持 "13" / "1-17" / "1,3,5" / "1-8,10,12-14"）— 复用 utils.isWeekInRange
  // 课表数据中实际出现的最大周次（解析 weeks 字符串，支持 "13" / "1-17" / "1,3,5" / "1-8,10,12-14"）
  const maxWeek = useMemo(() => {
    let max = 0;
    for (const s of schedule) {
      const parts = String(s.weeks || '').split(',');
      for (const part of parts) {
        const t = part.trim();
        if (!t) continue;
        if (t.includes('-')) {
          const [, end] = t.split('-').map(Number);
          if (!Number.isNaN(end) && end > max) max = end;
        } else {
          const n = Number(t);
          if (!Number.isNaN(n) && n > max) max = n;
        }
      }
    }
    return max;
  }, [schedule]);
  // 显示周：0 = 自动（当前周，夹在课表范围内）；用户可浏览任意周
  const [displayWeek, setDisplayWeek] = useState(0);
  const effectiveWeek = displayWeek > 0
    ? Math.min(displayWeek, maxWeek || displayWeek)
    : Math.min(Math.max(currentWeek, 1), maxWeek || Math.max(currentWeek, 1));
  const semesterOver = maxWeek > 0 && currentWeek > maxWeek;

  // 以学期第一周的周一为锚点，计算所显示周的日期
  const [sy, sm, sd] = SEMESTER_START.split('-').map(Number);
  const week1Monday = getMondayOfWeek(new Date(sy, sm - 1, sd));
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (effectiveWeek - 1) * 7);
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDates.push(d);
  }

  return (
    <div className="flex-1 flex flex-col p-[20px_24px] overflow-hidden">
      <div className="flex items-center justify-between mb-[16px]">
        <div>
          <h2 className="text-[18px] font-semibold m-0">课程表</h2>
          <span className="text-[11px] text-[var(--text-muted)]">
            {schedule.length > 6 ? '已从文件导入' : '当前课表为空 · 点击导入按钮添加课表'}
            {' · '}第 {effectiveWeek} 周 ({fmtDate(weekDates[0])} - {fmtDate(weekDates[6])})
          </span>
        </div>
        <div className="flex gap-[8px]">
          <input ref={fileRef} type="file" accept=".csv,.json,.ics" onChange={handleFile}
            className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={importing} className="p-[6px_14px] rounded-[6px] bg-[var(--accent)] text-[#000] text-[12px] font-medium disabled:opacity-50">
            {importing ? '导入中...' : '导入课表 (CSV/JSON/ICS)'}
          </button>
          <button onClick={handleXlsImport} disabled={xlsImporting} className="p-[6px_14px] rounded-[6px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] text-[12px] font-medium disabled:opacity-50">
            {xlsImporting ? '导入中...' : '📅 官方课表（XLS）'}
          </button>
          {schedule.length > 6 && (
            <button onClick={clearSchedule} className="p-[6px_14px] rounded-[6px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] text-[12px]">重置</button>
          )}
        </div>
      </div>

      {semesterOver && (
        <div className="mb-[12px] p-[8px_12px] rounded-[6px] text-[12px] bg-[var(--bg-tertiary)] border border-[var(--accent)] text-[var(--text-primary)]">
          当前第 {currentWeek} 周，课表数据止于第 {maxWeek} 周（本学期已结束）—— 可浏览历史周次，或点击右上角导入新学期课表
        </div>
      )}

      {/* 周次浏览 */}
      {maxWeek > 0 && (
        <div className="flex items-center gap-[8px] mb-[12px]">
          <button onClick={() => setDisplayWeek(Math.max(1, effectiveWeek - 1))} disabled={effectiveWeek <= 1}
            className="p-[4px_12px] rounded-[6px] bg-[var(--bg-tertiary)] border border-[var(--border)] text-[12px] text-[var(--text-secondary)] disabled:opacity-30">
            ← 上周
          </button>
          <span className="text-[12px] font-semibold">第 {effectiveWeek} 周</span>
          <button onClick={() => setDisplayWeek(Math.min(maxWeek, effectiveWeek + 1))} disabled={effectiveWeek >= maxWeek}
            className="p-[4px_12px] rounded-[6px] bg-[var(--bg-tertiary)] border border-[var(--border)] text-[12px] text-[var(--text-secondary)] disabled:opacity-30">
            下周 →
          </button>
          {displayWeek !== 0 && (
            <button onClick={() => setDisplayWeek(0)}
              className="p-[4px_12px] rounded-[6px] bg-[var(--accent-dim)] border border-[var(--accent)] text-[12px] text-[var(--accent)]">
              回到当前周
            </button>
          )}
        </div>
      )}

      {importMsg && (
        <div className={`mb-[12px] p-[8px_12px] rounded-[6px] text-[12px] text-[var(--text-primary)] border ${importMsg.includes('失败') ? 'bg-[rgba(255,69,58,0.1)] border-[rgba(255,69,58,0.3)]' : 'bg-[rgba(78,204,163,0.1)] border-[rgba(78,204,163,0.3)]'}`}>
          {importMsg}
        </div>
      )}

      <div className="flex-1 overflow-y-auto grid grid-cols-[repeat(7,1fr)] gap-[6px] content-[start]">
        {[1, 2, 3, 4, 5, 6, 7].map(day => {
          const items = schedule.filter(s => {
            if (s.day !== day) return false;
            return isWeekInRange(s.weeks, effectiveWeek);
          });
          const dateObj = weekDates[day - 1];
          const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
          const isToday = dateStr === todayStr;
          return (
            <div key={day} className={`rounded-[8px] p-[8px] min-h-[180px] ${isToday ? 'border-2 border-[var(--accent)] bg-[var(--bg-card)]' : 'border border-[var(--border)] bg-[var(--bg-card)]'} ${day === 6 || day === 7 ? 'opacity-85' : ''}`}>
              <div className={`text-[12px] font-semibold mb-[6px] pb-[4px] border-b border-[var(--border)] flex justify-between items-baseline ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                <span>{dayNames[day]}</span>
                <span className={`text-[10px] font-normal ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                  {fmtDate(dateObj)}
                </span>
              </div>
              {isToday && (
                <div className="text-[10px] text-[var(--accent)] mb-[4px] font-semibold">● 今天</div>
              )}
              {items.length === 0 ? (
                <div className="text-[10px] text-[var(--text-muted)] text-center p-[16px_0]">
                  暂无课程
                </div>
              ) : (
                items.map(item => (
                  <div key={item.id} className="p-[6px_8px] rounded-[6px] bg-[var(--bg-secondary)] mb-[4px] border border-[var(--border)]">
                    <div className="text-[11px] font-medium">{item.name}</div>
                    <div className="text-[10px] text-[var(--text-secondary)] mt-[1px]">
                      {item.timeStart}-{item.timeEnd}
                    </div>
                    <div className="text-[9px] text-[var(--text-muted)] mt-[1px]">
                      {item.location}{item.teacher ? ' · ' + item.teacher : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-[12px] p-[8px_12px] rounded-[6px] bg-[var(--bg-tertiary)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)]">
        CSV 格式示例：<code className="text-[var(--accent)]">课程名称,星期,开始时间,结束时间,地点,教师,周次</code> · 也支持 .json 和标准 .ics (iCalendar) 格式
      </div>
    </div>
  );
}