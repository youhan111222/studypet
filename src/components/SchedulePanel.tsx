import { useState, useRef, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { SEMESTER_START, getCurrentWeek } from '../config';
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

  const today = new Date();
  const todayDay = today.getDay();
  const displayDay = todayDay === 0 ? 7 : todayDay;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // 学期开始日期（统一在 src/config.ts 配置）
  const [semesterStart, setSemesterStart] = useState(SEMESTER_START);
  const currentWeek = getCurrentWeek(semesterStart);

  // 判断给定周次字符串是否包含当前周（支持 "13" / "1-17" / "1,3,5" / "1-8,10,12-14"）
  const isWeekActive = (weeks: string, current: number): boolean => {
    if (!weeks) return true;
    const parts = weeks.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(Number);
        if (current >= start && current <= end) return true;
      } else {
        if (Number(trimmed) === current) return true;
      }
    }
    return false;
  };
  const monday = getMondayOfWeek(today);
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDates.push(d);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>课程表</h2>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {schedule.length > 6 ? '已从文件导入' : '当前课表为空 · 点击导入按钮添加课表'}
            {' · '}第 {currentWeek} 周 ({fmtDate(weekDates[0])} - {fmtDate(weekDates[6])})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileRef} type="file" accept=".csv,.json,.ics" onChange={handleFile}
            style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing} style={{
            padding: '6px 14px', borderRadius: 6,
            background: 'var(--accent)', color: '#000',
            fontSize: 12, fontWeight: 500, opacity: importing ? 0.5 : 1,
          }}>
            {importing ? '导入中...' : '导入课表 (CSV/JSON/ICS)'}
          </button>
          {schedule.length > 6 && (
            <button onClick={clearSchedule} style={{
              padding: '6px 14px', borderRadius: 6,
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', fontSize: 12,
            }}>重置</button>
          )}
        </div>
      </div>

      {importMsg && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 6,
          background: importMsg.includes('失败') ? 'rgba(255,69,58,0.1)' : 'rgba(78,204,163,0.1)',
          border: `1px solid ${importMsg.includes('失败') ? 'rgba(255,69,58,0.3)' : 'rgba(78,204,163,0.3)'}`,
          fontSize: 12, color: 'var(--text-primary)',
        }}>
          {importMsg}
        </div>
      )}

      <div style={{
        flex: 1, overflowY: 'auto',
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 6, alignContent: 'start',
      }}>
        {[1, 2, 3, 4, 5, 6, 7].map(day => {
          const items = schedule.filter(s => {
            if (s.day !== day) return false;
            if (!isWeekActive(s.weeks, currentWeek)) return false;
            return true;
          });
          const dateObj = weekDates[day - 1];
          const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
          const isToday = dateStr === todayStr;
          return (
            <div key={day} style={{
              background: 'var(--bg-card)', borderRadius: 8,
              border: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
              padding: 8, minHeight: 180, opacity: (day === 6 || day === 7) ? 0.85 : 1,
            }}>
              <div style={{
                fontSize: 12, fontWeight: 600, marginBottom: 6,
                color: isToday ? 'var(--accent)' : 'var(--text-primary)',
                paddingBottom: 4, borderBottom: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              }}>
                <span>{dayNames[day]}</span>
                <span style={{ fontSize: 10, color: isToday ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 400 }}>
                  {fmtDate(dateObj)}
                </span>
              </div>
              {isToday && (
                <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 4, fontWeight: 600 }}>● 今天</div>
              )}
              {items.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                  暂无课程
                </div>
              ) : (
                items.map(item => (
                  <div key={item.id} style={{
                    padding: '6px 8px', borderRadius: 6,
                    background: 'var(--bg-secondary)', marginBottom: 4,
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 500 }}>{item.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>
                      {item.timeStart}-{item.timeEnd}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                      {item.location}{item.teacher ? ' · ' + item.teacher : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 12, padding: '8px 12px', borderRadius: 6,
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-secondary)',
      }}>
        CSV 格式示例：<code style={{ color: 'var(--accent)' }}>课程名称,星期,开始时间,结束时间,地点,教师,周次</code> · 也支持 .json 和标准 .ics (iCalendar) 格式
      </div>
    </div>
  );
}