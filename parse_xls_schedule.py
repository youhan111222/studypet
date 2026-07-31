import xlrd

wb = xlrd.open_workbook('C:/Users/20397/Desktop/学生个人课表_202430000863.xls')
sheet = wb.sheets()[0]

# Print raw text to file for inspection
with open('D:/StudyPet/schedule_raw.txt', 'w', encoding='utf-8') as out:
    out.write(f"=== {sheet.name} ({sheet.nrows} rows x {sheet.ncols} cols) ===\n\n")
    for row_idx in range(sheet.nrows):
        for col_idx in range(sheet.ncols):
            v = sheet.cell_value(row_idx, col_idx)
            if v:
                out.write(f"[R{row_idx}C{col_idx}] {v}\n")

# Extract header info
print("=== HEADER ===")
for row_idx in range(3):
    for col_idx in range(sheet.ncols):
        v = str(sheet.cell_value(row_idx, col_idx)).strip()
        if v:
            print(f"  {v}")

# Extract time slots from row 3 (index 3)
print("\n=== TIME SLOTS ===")
time_slots = []
for col_idx in range(1, 8):
    v = str(sheet.cell_value(3, col_idx)).strip()
    if v:
        time_slots.append(v)
        print(f"  Col {col_idx}: {v}")

# Print day headers from row 2
print("\n=== DAYS ===")
for col_idx in range(1, 8):
    v = str(sheet.cell_value(2, col_idx)).strip()
    if v:
        print(f"  Col {col_idx}: {v}")

print("\nDone. Raw text saved to schedule_raw.txt")
