import json
from collections import defaultdict

with open('D:/StudyPet/src/store/scheduleData.ts', 'r', encoding='utf-8') as f:
    text = f.read()

start = text.index('[')
depth = 0
end = start
for i in range(start, len(text)):
    if text[i] == '[':
        depth += 1
    elif text[i] == ']':
        depth -= 1
        if depth == 0:
            end = i + 1
            break

data = json.loads(text[start:end])

weeks = defaultdict(list)
for item in data:
    weeks[item['weeks']].append(item)

day_names = {'1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五'}

for w in sorted(weeks.keys(), key=int):
    print(f'\n=== 第{w}周 ===')
    items = sorted(weeks[w], key=lambda x: (int(x['day']), x['timeStart']))
    total = 0
    for item in items:
        d = day_names.get(item['day'], item['day'])
        h1, m1 = map(int, item['timeStart'].split(':'))
        h2, m2 = map(int, item['timeEnd'].split(':'))
        mins = (h2 * 60 + m2) - (h1 * 60 + m1)
        total += mins
        print(f"  {d} {item['timeStart']}-{item['timeEnd']} ({mins//60}h{mins%60:02d}) | {item['name']} | {item['location']}")
    print(f'  >> 本周课时: {total//60}h{total%60:02d}')
