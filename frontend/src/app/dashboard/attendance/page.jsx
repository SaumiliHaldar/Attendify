"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/layouts/Sidebar";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ClipboardList,
  Download,
  Plus,
  Loader2,
  Eye,
  PieChart,
  Info
} from "lucide-react";
import { toast, Toaster } from "sonner";
import {
  PieChart as RePieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";

export default function Attendance() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("admin");
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [attendanceData, setAttendanceData] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [legend, setLegend] = useState({ regular: {}, apprentice: {} });
  const [empType, setEmpType] = useState("all");
  const [markDialogOpen, setMarkDialogOpen] = useState(false);
  const [searchEmp, setSearchEmp] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState({});
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  const getCurrentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("user");
      if (saved) {
        const parsed = JSON.parse(saved);
        setUser(parsed);
        setRole(parsed.role || "admin");
      }
      const cur = getCurrentMonth();
      setSelectedMonth(cur);
      // keep calendarDate in sync
      const [y, m] = cur.split("-").map(Number);
      setCalendarDate(new Date(y, m - 1, 1));
    }
  }, []);

  // Fetch legend
  const fetchLegend = async () => {
    try {
      const res = await fetch(`${API_URL}/attendance/legend`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setLegend(data);
    } catch (err) {
      console.error("Legend fetch failed", err);
    }
  };

  // Fetch employees (large list for marking)
  const fetchEmployees = async () => {
    try {
      const params = new URLSearchParams({ limit: "1000" });
      if (empType !== "all") params.append("emp_type", empType);
      const res = await fetch(`${API_URL}/employees?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();

      if (res.status === 403) {
        toast.error("Session expired. Please log in again.");
        localStorage.removeItem("user");
        window.location.href = "/login";
        return;
      }

      if (res.ok) {
        setEmployees(data.employees || []);
      } else {
        toast.error(data.detail || "Failed to fetch employees");
      }
    } catch (err) {
      console.error("Failed to load employees", err);
    }
  };

  // Fetch attendance overview for table
  const fetchAttendance = async () => {
    if (!selectedMonth) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/attendance?month=${selectedMonth}`, {
        credentials: "include",
      });
      const data = await res.json();

      if (res.status === 403) {
        toast.error("Session expired. Please log in again.");
        localStorage.removeItem("user");
        window.location.href = "/login";
        return;
      }

      if (res.ok) {
        setAttendanceData(data.data || []);
      } else {
        toast.error(data.detail || "Failed to load attendance");
      }
    } catch (err) {
      console.error("Fetch attendance error", err);
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  // Monthly summary (for pie chart)
  const fetchMonthlySummary = async () => {
    try {
      const res = await fetch(`${API_URL}/attendance/monthly?month=${selectedMonth}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) setSummaryData(data.summary || []);
    } catch (err) {
      console.error("Failed to load summary", err);
    }
  };

  // Convert UI key (DD-MM-YYYY) -> backend date (YYYY-MM-DD)
  const uiToBackendDate = (uiDate) => {
    // uiDate expected "DD-MM-YYYY"
    const parts = uiDate.split("-");
    if (parts.length !== 3) return null;
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  };

  // Mark attendance: send one POST per day to match backend
  const handleMarkAttendance = async () => {
    if (!selectedEmployee) return toast.error("Select an employee first.");
    if (Object.keys(attendanceRecords).length === 0)
      return toast.error("Mark at least one day's attendance.");

    setLoading(true);
    try {
      const entries = Object.entries(attendanceRecords); // [ [ "DD-MM-YYYY", "P" ], ... ]

      for (const [uiDate, code] of entries) {
        const backendDate = uiToBackendDate(uiDate);
        if (!backendDate) {
          toast.error(`Invalid date ${uiDate}`);
          continue;
        }

        const res = await fetch(`${API_URL}/attendance`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emp_no: selectedEmployee.emp_no,
            date: backendDate,
            code,
          }),
        });

        const data = await res.json();

        // Handle forbidden/session expiry same as employees page
        if (res.status === 403) {
          toast.error("Session expired. Please log in again.");
          localStorage.removeItem("user");
          window.location.href = "/login";
          return;
        }

        if (!res.ok) {
          // show backend message
          toast.error(data.detail || "Failed to mark attendance");
        } else {
          toast.success(data.message || "Attendance updated");
        }
      }

      setMarkDialogOpen(false);
      setAttendanceRecords({});
      fetchAttendance();
    } catch (err) {
      console.error("Mark attendance error", err);
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  // Export Excel
  const handleExport = async (type) => {
    if (!selectedMonth) return toast.error("Select a month first");
    setLoading(true);
    try {
      const endpoint = type === "regular" ? "export_regular" : "export_apprentice";
      const res = await fetch(`${API_URL}/${endpoint}?month=${selectedMonth}`, {
        credentials: "include",
      });

      if (res.status === 403) {
        toast.error("Session expired. Please log in again.");
        localStorage.removeItem("user");
        window.location.href = "/login";
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.detail || "Export failed");
        setLoading(false);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}_attendance_${selectedMonth}.xlsx`;
      a.click();
      toast.success("Export successful");
    } catch (err) {
      console.error("Export error", err);
      toast.error("Export failed");
    } finally {
      setLoading(false);
    }
  };

  // Sync data when month or type changes
  useEffect(() => {
    fetchLegend();
    fetchEmployees();
    fetchAttendance();
    fetchMonthlySummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, empType]);

  // Pie chart data aggregation
  const pieData = summaryData
    ? Object.entries(
        summaryData.reduce((acc, cur) => {
          Object.entries(cur.summary || {}).forEach(([code, count]) => {
            acc[code] = (acc[code] || 0) + count;
          });
          return acc;
        }, {})
      ).map(([code, count]) => ({ code, count }))
    : [];

  const COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

  // Helper to build UI date key: DD-MM-YYYY from day number + selectedMonth
  const buildUiDateKey = (dayNum) => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return `${String(dayNum).padStart(2, "0")}-${String(month).padStart(2, "0")}-${String(year)}`;
  };

  // Handle Calendar month selection (react-calendar)
  const onCalendarChange = (date) => {
    // `date` will be a Date object when user selects
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const monthStr = `${y}-${String(m).padStart(2, "0")}`;
    setSelectedMonth(monthStr);
    setCalendarDate(new Date(y, m - 1, 1));
    setMonthPickerOpen(false);
  };

  return (
    <div className="flex min-h-screen">
      <Toaster position="top-right" richColors closeButton />
      <Sidebar user={user} />
      <div className="flex-1 w-full">
        <AuroraBackground>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 flex flex-col w-full min-h-screen"
          >
            <h2 className="text-3xl font-bold mb-6 text-gray-800 flex items-center gap-2">
              <ClipboardList className="text-blue-500" /> Attendance Management
            </h2>

            {/* Controls */}
            <div className="flex flex-wrap gap-3 mb-6 justify-between">
              <div className="flex gap-3">
                <Select value={empType} onValueChange={(val) => setEmpType(val)}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="apprentice">Apprentice</SelectItem>
                  </SelectContent>
                </Select>

                {/* Month input + Calendar picker trigger */}
                <div className="flex items-center gap-2">
                  <Input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedMonth(val);
                      const [y, m] = val.split("-").map(Number);
                      setCalendarDate(new Date(y, m - 1, 1));
                    }}
                    className="w-[160px]"
                  />
                  <Button variant="outline" size="sm" onClick={() => setMonthPickerOpen(true)}>
                    <Info className="w-4 h-4 mr-1" /> Pick
                  </Button>

                  <Dialog open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Select Month</DialogTitle>
                      </DialogHeader>
                      <div className="p-4">
                        <Calendar
                          onClickMonth={(date) => onCalendarChange(date)}
                          onClickYear={(date) => onCalendarChange(date)}
                          value={calendarDate}
                          view="month"
                          // showNavigation can remain default; react-calendar doesn't have native month-only picker,
                          // we accept month click via onClickMonth
                        />
                        <div className="mt-3 flex justify-end">
                          <Button onClick={() => setMonthPickerOpen(false)}>Close</Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              <div className="flex gap-2">
                {(role === "admin" || role === "superadmin") && (
                  <Dialog open={markDialogOpen} onOpenChange={setMarkDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-1">
                        <Plus className="w-4 h-4" /> Mark Attendance
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-6xl h-[90vh] overflow-hidden flex flex-col">
                      <DialogHeader>
                        <DialogTitle>Mark Attendance</DialogTitle>
                      </DialogHeader>

                      <div className="flex flex-col flex-1 p-4 gap-4">
                        <div className="flex gap-3">
                          <Input
                            placeholder="Search employee..."
                            value={searchEmp}
                            onChange={(e) => setSearchEmp(e.target.value)}
                            className="flex-1"
                          />
                        </div>

                        <div className="border rounded-md bg-white/70 flex-1 grid grid-cols-1 md:grid-cols-3 gap-2 p-3 overflow-y-auto">
                          {employees
                            .filter(
                              (emp) =>
                                emp.name.toLowerCase().includes(searchEmp.toLowerCase()) ||
                                emp.emp_no.toLowerCase().includes(searchEmp.toLowerCase())
                            )
                            .map((emp) => (
                              <div
                                key={emp.emp_no}
                                onClick={() => setSelectedEmployee(emp)}
                                className={`p-3 cursor-pointer border rounded-md ${
                                  selectedEmployee?.emp_no === emp.emp_no
                                    ? "bg-blue-50 border-blue-500"
                                    : "hover:bg-gray-100"
                                }`}
                              >
                                <div className="font-semibold text-gray-800">{emp.name}</div>
                                <div className="text-xs text-gray-500">
                                  {emp.emp_no} • {emp.designation} • {emp.type}
                                </div>
                              </div>
                            ))}
                        </div>

                        {selectedEmployee && (
                          <div className="border-t pt-4 flex-1 overflow-hidden flex flex-col">
                            <h4 className="text-base font-semibold mb-2 text-gray-800">
                              Marking Attendance for{" "}
                              <span className="text-blue-600">
                                {selectedEmployee.name} ({selectedEmployee.emp_no})
                              </span>
                            </h4>

                            <div className="flex-1 grid grid-cols-7 gap-2 overflow-y-auto">
                              {(() => {
                                // derive total days for month
                                const [year, month] = selectedMonth.split("-").map(Number);
                                const totalDays = new Date(year, month, 0).getDate();
                                const legendCodes =
                                  selectedEmployee.type === "regular" ? legend.regular : legend.apprentice;

                                return Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
                                  const uiKey = buildUiDateKey(day); // "DD-MM-YYYY"
                                  return (
                                    <div
                                      key={day}
                                      className="flex flex-col items-center border rounded-md p-2 bg-white shadow-sm"
                                    >
                                      <span className="text-xs font-medium mb-1 text-gray-600">{day}</span>
                                      <Select
                                        value={attendanceRecords[uiKey] || ""}
                                        onValueChange={(val) =>
                                          setAttendanceRecords((prev) => ({
                                            ...prev,
                                            [uiKey]: val,
                                          }))
                                        }
                                      >
                                        <SelectTrigger className="h-8 text-xs w-full">
                                          <SelectValue placeholder="-" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.entries(legendCodes || {}).map(([code, desc]) => (
                                            <SelectItem key={code} value={code}>
                                              {code} – {desc}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  );
                                });
                              })()}
                            </div>

                            <div className="mt-4 flex justify-end">
                              <Button onClick={handleMarkAttendance} disabled={loading} className="px-8">
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : `Submit (${Object.keys(attendanceRecords).length} days)`}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                )}

                <Button variant="outline" onClick={() => handleExport("regular")} disabled={loading}>
                  <Download className="w-4 h-4 mr-2" /> Regular
                </Button>
                <Button variant="outline" onClick={() => handleExport("apprentice")} disabled={loading}>
                  <Download className="w-4 h-4 mr-2" /> Apprentice
                </Button>
              </div>
            </div>

            {/* Table + Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-[75vh]">
              {/* Table */}
              <div className="lg:col-span-2 bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-700">Employee Attendance</h3>
                  <Button variant="outline" size="sm" onClick={fetchAttendance} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {loading ? (
                    <div className="flex justify-center items-center h-64">
                      <Loader2 className="animate-spin h-8 w-8 text-gray-500" />
                    </div>
                  ) : attendanceData.length === 0 ? (
                    <div className="flex flex-col justify-center items-center h-64 text-gray-500">
                      <ClipboardList className="w-10 h-10 mb-2" />
                      No attendance records found
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[900px] text-sm">
                        <TableHeader>
                          <TableRow className="bg-gray-100">
                            <TableHead>Emp No</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Total Days</TableHead>
                            <TableHead>Summary</TableHead>
                            <TableHead>View</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {attendanceData.map((row) => (
                            <TableRow key={row.emp_no}>
                              <TableCell>{row.emp_no}</TableCell>
                              <TableCell>{row.emp_name}</TableCell>
                              <TableCell className="capitalize">{row.emp_type}</TableCell>
                              <TableCell>{row.total_days}</TableCell>
                              <TableCell>
                                {Object.entries(row.summary || {}).map(([code, count]) => (
                                  <span key={code} className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md mr-1 mb-1 text-xs">
                                    {code}:{count}
                                  </span>
                                ))}
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="sm">
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>

              {/* Pie Chart */}
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
                    <PieChart className="text-blue-500" /> Summary
                  </h3>
                </div>
                <div className="flex-1 flex justify-center items-center p-2">
                  {pieData.length === 0 ? (
                    <div className="text-gray-400 text-sm">No data</div>
                  ) : (
                    <ResponsiveContainer width="95%" height={280}>
                      <RePieChart>
                        <Pie data={pieData} dataKey="count" nameKey="code" cx="50%" cy="50%" outerRadius={80} label>
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </RePieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </AuroraBackground>
      </div>
    </div>
  );
}
