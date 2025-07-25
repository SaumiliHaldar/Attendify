from datetime import datetime, timedelta
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
from openpyxl.cell.cell import MergedCell
import calendar

# Legend constants
REGULAR_LEGEND = {
    "P": "Present",
    "A": "Absent", 
    "R": "Rest",
    "CL": "Casual Leave",
    "LAP": "Leave On Average Pay",
    "COCL": "Compensatory Casual Leave",
    "S": "Sick",
    "ART": "Accident Relief Train",
    "Trg": "Training",
    "SCL": "Special Casual Leave",
    "H": "Holiday",
    "D": "Duty",
    "Ex": "Exam",
    "Sp": "Spare",
    "Trans": "Transfer",
    "Retd": "Retired",
    "Rel": "Released"
}

APPRENTICE_LEGEND = {
    "P": "Present",
    "A": "Absent",
    "R": "Rest", 
    "S": "Sick",
    "CL": "Casual Leave",
    "REL": "Released"
}

# Styles
bold_center = Font(bold=True)
center = Alignment(horizontal="center", vertical="center")
border = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)
sunday_fill = PatternFill(start_color="DDDDDD", end_color="DDDDDD", fill_type="solid")
holiday_fill = PatternFill(fill_type="darkDown", fgColor="FF9999")


async def create_attendance_excel(db, employee_type: str, month: str):
    wb = Workbook()
    ws = wb.active
    ws.title = "Attendance"

    # Date range logic
    year, mon = map(int, month.split("-"))
    if employee_type == "regular":
        start_date = datetime(year, mon, 11)
        end_date = datetime(year + 1 if mon == 12 else year, 1 if mon == 12 else mon + 1, 10)
        legend = REGULAR_LEGEND
    else:
        start_date = datetime(year, mon, 1)
        end_date = datetime(year, mon, calendar.monthrange(year, mon)[1])
        legend = APPRENTICE_LEGEND

    total_days = (end_date - start_date).days + 1
    dates = [start_date + timedelta(days=i) for i in range(total_days)]

    # Fetch from DB
    emp_cursor = db["employees"].find({"type": employee_type})
    employees = [emp async for emp in emp_cursor]

    hol_cursor = db["holidays"].find({
        "date": {"$gte": start_date.strftime("%Y-%m-%d"), "$lte": end_date.strftime("%Y-%m-%d")}
    })
    holidays = [doc["date"] async for doc in hol_cursor]

    att_cursor = db["attendance"].find({"type": employee_type, "month": month})
    attendance = {doc["emp_no"]: doc["records"] async for doc in att_cursor}

    # Title
    ws.merge_cells("A1:AZ1")
    ws["A1"] = f"ATTENDANCE SHEET / MUSTER ROLL OF SSEE/SW/KGP"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A1"].alignment = center

    ws.append(["S.No", "NAME", "DESIGNATION", "EMPLOYEE NO."] + [d.strftime("%d/%m") for d in dates])
    for cell in ws[2]:
        cell.font = bold_center
        cell.alignment = center
        cell.border = border

    # Fill employee rows
    row = 3
    for idx, emp in enumerate(employees, start=1):
        ws.cell(row=row, column=1, value=idx)
        ws.cell(row=row, column=2, value=emp.get("name", ""))
        ws.cell(row=row, column=3, value=emp.get("designation", ""))
        ws.cell(row=row, column=4, value=emp.get("emp_no", ""))

        emp_attendance = attendance.get(emp.get("emp_no", ""), {})
        for col, d in enumerate(dates, start=5):
            date_str = d.strftime("%Y-%m-%d")
            code = emp_attendance.get(date_str, "")
            cell = ws.cell(row=row, column=col, value=code)
            cell.alignment = center
            cell.border = border

            if d.weekday() == 6:
                cell.fill = sunday_fill
            if date_str in holidays:
                cell.fill = holiday_fill

        row += 1

    # Footer LEGEND
    row += 2
    ws.cell(row=row, column=1, value="LEGENDS:").font = bold_center
    row += 1
    for code, meaning in legend.items():
        ws.cell(row=row, column=1, value=f"{code} = {meaning}")
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="Note: The above abstract attendance particulars are taken from attendance register for")
    row += 1
    ws.cell(row=row, column=1, value="supervisor and staff of O/O SSEE/SW/KGP, due to some unavoidable circumstances the manual entry had been done by the signatory.")

    row += 2
    ws.cell(row=row, column=1, value="JE: ______________   SSEE: ______________   SSE/INCHARGE: ______________")

    # Apply border to all cells
    for r in ws.iter_rows():
        for c in r:
            c.border = border

    # Auto-width columns (skip merged cells)
    for col in ws.columns:
        first_cell = col[0]
        if isinstance(first_cell, MergedCell):
            continue
        max_length = max((len(str(cell.value)) if cell.value else 0) for cell in col)
        ws.column_dimensions[first_cell.column_letter].width = max(12, min(max_length + 2, 25))

    # Finalize output
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output
