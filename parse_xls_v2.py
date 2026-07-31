import xlrd

wb = xlrd.open_workbook('C:/Users/20397/Desktop/学生个人课表_202430000863.xls')
sheet = wb.sheets()[0]

# Parse time slots
# R3C0 = 第一大节 08:20-09:55
# R4C0 = 第二大节 10:10-11:45
# R5C0 = 第三大节 14:20-15:55
# R6C0 = 第四大节 16:05-17:40
# R7C0 = 第五大节 18:20-19:55
# R8C0 = 第六大节 20:00-21:35

timeslots = {
    3: ("08:20", "09:55"),
    4: ("10:10", "11:45"),
    5: ("14:20", "15:55"),
    6: ("16:05", "17:40"),
    7: ("18:20", "19:55"),
    8: ("20:00", "21:35"),
}

days = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}

# Parse each cell into structured courses
# Each cell has multiple courses separated by newlines
# Format: name, teacher, weekrange, location, periods

def parse_week_range(week_str):
    """Parse '13-14[周]' or '16[周]' or '2,4-11[周]' or '11-16[周]'"""
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

# Parse each time-slot cell
for row_idx in [3,4,5,6,7,8]:
    for col_idx in [1,2,3,4,5,6,7]:
        v = sheet.cell_value(row_idx, col_idx)
        if not v:
            continue
        lines = [line.strip() for line in v.strip().split('\n') if line.strip()]
        # Each course entry is: name, teacher, weekrange, location, periods
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
            # Check if this line has week info
            week_line = lines[i]
            if '周' in week_line and '节' not in week_line:
                weeks_raw = week_line
                i += 1
            elif i-1 < len(lines) and '周' in lines[i-1]:
                weeks_raw = lines[i-1]
            else:
                i += 1
                continue

            if i >= len(lines):
                break
            location = lines[i]
            i += 1

            if i >= len(lines):
                break
            periods = lines[i]
            i += 1

            day = days[col_idx]
            ts, te = timeslots[row_idx]

            try:
                ws = parse_week_range(weeks_raw)
            except Exception:
                continue

            for w in ws:
                print(f"W{w:02d} | {day} {ts}-{te} | {name} | {teacher} | {location}")

print("\n=== SUMMARY BY WEEK ===")
