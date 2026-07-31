import xlrd
from collections import defaultdict

wb = xlrd.open_workbook('C:/Users/20397/Desktop/学生个人课表_202430000863.xls')
sheet = wb.sheets()[0]

timeslots = {
    3: ("08:20", "09:55"),
    4: ("10:10", "11:45"),
    5: ("14:20", "15:55"),
    6: ("16:05", "17:40"),
    7: ("18:20", "19:55"),
    8: ("20:00", "21:35"),
}

days = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
day_cn = {1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日"}

def parse_week_range(week_str):
    week_str = week_str.replace('[周]', '').strip()
    weeks = set()
    parts = week_str.split(',')
    for p in parts:
        p = p.strip()
        if '-' in p:
            a, b = p.split('-')
            for w in range(int(a), int(b)+1):
                weeks.add(w)
        else:
            if p:
                weeks.add(int(p))
    return sorted(weeks)

# Build: week -> {day: [(time, name, teacher, location)]}
week_data = defaultdict(lambda: defaultdict(list))

for row_idx in [3,4,5,6,7,8]:
    for col_idx in [1,2,3,4,5]:
        v = sheet.cell_value(row_idx, col_idx)
        if not v:
            continue
        lines = [line.strip() for line in v.strip().split('\n') if line.strip()]
        i = 0
        while i < len(lines):
            if not lines[i]:
                i += 1
                continue
            name = lines[i]
            i += 1
            if i >= len(lines):
                break
            teacher = lines[i]
            i += 1
            if i >= len(lines):
                break
            week_line = lines[i]
            if '周' in week_line and '节' not in week_line:
                i += 1
            else:
                continue
            if i >= len(lines):
                break
            location = lines[i]
            i += 1
            if i >= len(lines):
                break
            periods = lines[i]
            i += 1

            day = col_idx
            ts, te = timeslots[row_idx]
            try:
                ws = parse_week_range(week_line)
            except Exception:
                continue
            for w in ws:
                if w in [1,2,3,4,5,6,7,8,9,10,11]:
                    continue  # skip past weeks
                week_data[w][day].append((ts, te, name, teacher, location))

# Print weeks 13-19
for w in range(13, 20):
    print(f"\n{'='*60}")
    print(f"  第 {w} 周")
    print(f"{'='*60}")
    total_mins = 0
    for d in range(1, 6):
        if d not in week_data[w]:
            print(f"  {day_cn[d]}: ★ 全天无课 ★")
            continue
        entries = sorted(week_data[w][d])
        parts = []
        for ts, te, name, teacher, location in entries:
            h1,m1 = map(int, ts.split(':'))
            h2,m2 = map(int, te.split(':'))
            mins = (h2*60+m2) - (h1*60+m1)
            total_mins += mins
            parts.append(f"{ts}-{te} {name}")
        print(f"  {day_cn[d]}: {' | '.join(parts)}")
    h = total_mins // 60
    m = total_mins % 60
    free_h = 0
    # Count free mornings, afternoons, evenings
    occupied_slots = set()
    for d in range(1, 6):
        for ts, te, name, teacher, location in week_data[w][d]:
            occupied_slots.add((d, ts, te))

    # Rough free time estimate
    for d in range(1, 6):
        if d not in week_data[w]:
            free_h += 8  # full day free
        else:
            # crude: if only morning occupied, afternoon is free
            has_morning = any(ts < "12:00" for ts, te, _, _, _ in week_data[w][d])
            has_afternoon = any("12:00" <= ts < "18:00" for ts, te, _, _, _ in week_data[w][d])
            has_evening = any(ts >= "18:00" for ts, te, _, _, _ in week_data[w][d])
            if not has_morning:
                free_h += 3.5
            if not has_afternoon:
                free_h += 3.5
            if not has_evening:
                free_h += 2

    print(f"  课时: {h}h{m:02d} | 可用复习时间约: {free_h}h")
