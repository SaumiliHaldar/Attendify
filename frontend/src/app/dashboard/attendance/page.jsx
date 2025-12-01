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
import { toast } from "sonner";

export default function Attendance() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [attendanceData, setAttendanceData] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [legend, setLegend] = useState({ regular: {}, apprentice: {} });
  const [empType, setEmpType] = useState("all");
  const [markDialogOpen, setMarkDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [searchEmp, setSearchEmp] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [viewEmployee, setViewEmployee] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState({});
  const [notifications, setNotifications] = useState([]);

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
      }
      setSelectedMonth(getCurrentMonth());
    }
  }, []);

  // Fetch legend
  const fetchLegend = async () => {
    try {
      if (!selectedMonth) return;
      const res = await fetch(`${API_URL}/attendance/legend?month=${selectedMonth}`, {
        credentials: "include"
      });
      const data = await res.json();
      if (res.ok) setLegend(data);
    } catch (err) {
      console.error("Legend fetch failed", err);
    }
  };

  // Fetch employees for marking
  const fetchEmployees = async () => {
    try {
      const params = new URLSearchParams({
        limit: "1000",
        skip: "0"
      });
      if (empType !== "all") params.append("emp_type", empType);

      const res = await fetch(`${API_URL}/employees?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();

      if (res.status === 403) {
        toast.error("Session expired. Please log in again.");
        localStorage.removeItem("user");
        setUser(null);
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
      const res = await fetch(
        `${API_URL}/attendance/monthly?month=${selectedMonth}`,
        { credentials: "include" }
      );
      const data = await res.json();

      if (res.status === 403) {
        toast.error("Session expired. Please log in again.");
        localStorage.removeItem("user");
        setUser(null);
        return;
      }

      if (res.ok) {
        // FIXED: Backend returns { employees: [...] }
        setAttendanceData(data.employees || []);
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

  // Fetch individual employee attendance for view dialog
  const fetchEmployeeAttendance = async (emp_no) => {
    if (!emp_no || !selectedMonth) return;

    try {
      const res = await fetch(
        `${API_URL}/attendance/${emp_no}?month=${selectedMonth}`,
        { credentials: "include" }
      );
      const data = await res.json();

      if (res.ok) {
        setViewEmployee(data);
      } else {
        toast.error(data.detail || "Failed to load employee attendance");
      }
    } catch (err) {
      console.error("Failed to load employee attendance", err);
      toast.error("Network error");
    }
  };

  // FIXED: Convert UI date (DD-MM-YYYY) to backend format (YYYY-MM-DD)
  const uiToBackendDate = (uiDate) => {
    const parts = uiDate.split("-");
    if (parts.length !== 3) return null;
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  };

  // Mark attendance
  const handleMarkAttendance = async () => {
    if (!selectedEmployee) return toast.error("Select an employee first.");
    if (Object.keys(attendanceRecords).length === 0)
      return toast.error("Mark at least one day's attendance.");

    setLoading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      const entries = Object.entries(attendanceRecords);

      for (const [uiDate, code] of entries) {
        const backendDate = uiToBackendDate(uiDate);
        if (!backendDate) {
          toast.error(`Invalid date ${uiDate}`);
          errorCount++;
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
          toast.error("Session expired or permission denied.");
          localStorage.removeItem("user");
          setUser(null);
          setLoading(false);
          return;
        }

        if (!res.ok) {
          toast.error(data.detail || "Failed to mark attendance");
          errorCount++;
        } else {
          successCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} day(s) marked successfully`);
      }
      if (errorCount > 0) {
        toast.error(`${errorCount} day(s) failed`);
      }

      setMarkDialogOpen(false);
      setAttendanceRecords({});
      setSelectedEmployee(null);
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
        setUser(null);
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

  // Load data when month or type changes
  useEffect(() => {
    if (user && selectedMonth) {
      fetchLegend();
      fetchEmployees();
      fetchAttendance();
    }
  }, [selectedMonth, empType, user]);

  // FIXED: Pie chart data from attendanceData
  const pieData = attendanceData.length > 0
    ? Object.entries(
      attendanceData.reduce((acc, emp) => {
        Object.entries(emp.summary || {}).forEach(([code, count]) => {
          if (code !== "total_days") {
            acc[code] = (acc[code] || 0) + count;
          }
        });
        return acc;
      }, {})
    ).map(([code, count]) => ({ code, count }))
    : [];

  // Helper to build UI date key: DD-MM-YYYY
  const buildUiDateKey = (dayNum) => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return `${String(dayNum).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
  };

  // Open view dialog
  const handleViewEmployee = async (emp) => {
    await fetchEmployeeAttendance(emp.emp_no);
    setViewDialogOpen(true);
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={user}
        setUser={setUser}
        notifications={notifications}
        setNotifications={setNotifications}
        API_URL={API_URL}
      />

      {/* Main content */}
      <div className="flex-1 w-full flex flex-col overflow-y-auto">
        <AuroraBackground>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 flex flex-col w-full min-h-screen"
          >

            <motion.h2
              className="text-2xl sm:text-3xl font-semibold mb-6 flex-shrink-0"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              Attendance Management
            </motion.h2>


            {/* Controls */}
            <div className="flex flex-col md:flex-row md:justify-between gap-3 mb-6">
              {/* Row 1: Select + Month */}
              <div className="flex w-full gap-3">
                <Select value={empType} onValueChange={(val) => setEmpType(val)}>
                  <SelectTrigger
                    className="w-[130px] sm:w-[150px] md:w-[160px]" // slightly smaller for mobile
                  >
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="apprentice">Apprentice</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="flex-1 min-w-[160px] md:w-[160px]" // full width on mobile
                />
              </div>

              {/* Row 2: Mark button (full width mobile) */}
              {(user?.role === "admin" || user?.role === "superadmin") && (
                <Dialog open={markDialogOpen} onOpenChange={setMarkDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-1 w-full md:w-auto">   {/* <— ADDED w-full on mobile */}
                      <Plus className="w-4 h-4" /> Mark Attendance
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-6xl h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                      <DialogTitle>Mark Attendance for {selectedMonth}</DialogTitle>
                    </DialogHeader>

                    <div className="flex flex-col flex-1 p-4 gap-4 overflow-hidden">
                      <div className="flex gap-3">
                        <Input
                          placeholder="Search employee by name or emp_no..."
                          value={searchEmp}
                          onChange={(e) => setSearchEmp(e.target.value)}
                          className="flex-1"
                        />
                      </div>

                      <div className="border rounded-md bg-white flex-1 grid grid-cols-1 md:grid-cols-3 gap-2 p-3 overflow-y-auto">
                        {employees
                          .filter(
                            (emp) =>
                              emp.name.toLowerCase().includes(searchEmp.toLowerCase()) ||
                              emp.emp_no.toLowerCase().includes(searchEmp.toLowerCase())
                          )
                          .map((emp) => (
                            <div
                              key={emp.emp_no}
                              onClick={async () => {
                                setSelectedEmployee(emp);
                                // Fetch employee existing attendance and load into UI
                                const res = await fetch(`${API_URL}/attendance/${emp.emp_no}?month=${selectedMonth}`, {
                                  credentials: "include"
                                });
                                const data = await res.json();
                                if (res.ok && data.attendance) {
                                  const mapped = {};
                                  for (const [backendDate, code] of Object.entries(data.attendance)) {
                                    const [dd, mm, yyyy] = backendDate.split("-");
                                    const uiKey = `${dd}-${mm}-${yyyy}`; // UI format
                                    mapped[uiKey] = code;
                                  }
                                  setAttendanceRecords(mapped);
                                } else {
                                  setAttendanceRecords({});
                                }
                              }}

                              className={`p-3 cursor-pointer border rounded-md transition-colors ${selectedEmployee?.emp_no === emp.emp_no
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
                            Marking for{" "}
                            <span className="text-blue-600">
                              {selectedEmployee.name} ({selectedEmployee.emp_no})
                            </span>
                          </h4>

                          <div className="flex-1 grid grid-cols-7 gap-2 overflow-y-auto p-2">
                            {(() => {
                              const [year, month] = selectedMonth.split("-").map(Number);
                              const totalDays = new Date(year, month, 0).getDate();
                              const legendCodes =
                                selectedEmployee.type === "regular"
                                  ? legend.regular
                                  : legend.apprentice;

                              return Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
                                const uiKey = buildUiDateKey(day);
                                return (
                                  <div
                                    key={day}
                                    className="flex flex-col items-center border rounded-md p-2 bg-white shadow-sm"
                                  >
                                    <span className="text-xs font-medium mb-1 text-gray-600">
                                      Day {day}
                                    </span>
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

                          <div className="mt-4 flex justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setAttendanceRecords({});
                                setSelectedEmployee(null);
                              }}
                            >
                              Clear
                            </Button>
                            <Button
                              onClick={handleMarkAttendance}
                              disabled={loading || Object.keys(attendanceRecords).length === 0}
                              className="px-8"
                            >
                              {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                `Submit (${Object.keys(attendanceRecords).length} days)`
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              {/* Row 3: Export buttons (side-by-side equal width on mobile) */}
              <div className="flex gap-2 w-full md:w-auto">
                <Button
                  variant="outline"
                  onClick={() => handleExport("regular")}
                  disabled={loading}
                  className="flex-1 md:flex-none"   // equal width on mobile
                >
                  <Download className="w-4 h-4 mr-2" /> Regular
                </Button>

                <Button
                  variant="outline"
                  onClick={() => handleExport("apprentice")}
                  disabled={loading}
                  className="flex-1 md:flex-none"   // equal width on mobile
                >
                  <Download className="w-4 h-4 mr-2" /> Apprentice
                </Button>
              </div>
            </div>


            {/* Table + Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Table */}
              <div className="lg:col-span-2 bg-white rounded-lg shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-700">
                    Employee Attendance
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchAttendance}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[600px]">
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
                    <Table className="text-sm">
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead>Emp No</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Days</TableHead>
                          <TableHead>Summary</TableHead>
                          <TableHead>View</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendanceData.map((row) => (
                          <TableRow key={row.emp_no}>
                            <TableCell>{row.emp_no}</TableCell>
                            <TableCell>{row.emp_name}</TableCell>
                            <TableCell className="capitalize">{row.type}</TableCell>
                            <TableCell>{row.summary?.total_days || 0}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(row.summary || {})
                                  .filter(([code]) => code !== "total_days")
                                  .map(([code, count]) => (
                                    <span
                                      key={code}
                                      className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md text-xs"
                                    >
                                      {code}:{count}
                                    </span>
                                  ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewEmployee(row)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>

              {/* Summary Card */}
              <div className="bg-white rounded-lg shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b">
                  <h3 className="text-lg font-semibold text-gray-700">
                    Monthly Summary
                  </h3>
                </div>
                <div className="flex-1 p-4">
                  {pieData.length === 0 ? (
                    <div className="text-gray-400 text-sm text-center">No data</div>
                  ) : (
                    <div className="space-y-2">
                      {pieData.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                          <span className="font-medium text-gray-700">{item.code}</span>
                          <span className="text-gray-600">{item.count} days</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* View Dialog */}
            <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle>
                    {viewEmployee?.emp_name} ({viewEmployee?.emp_no}) - {selectedMonth}
                  </DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto p-4">
                  {viewEmployee ? (
                    <>
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2">Summary</h4>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(viewEmployee.summary || {}).map(([code, count]) => (
                            <span
                              key={code}
                              className="bg-gray-100 px-3 py-1 rounded-md text-sm"
                            >
                              {code}: {count}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-2">Daily Records</h4>
                        <div className="grid grid-cols-7 gap-2">
                          {Object.entries(viewEmployee.attendance || {})
                            .sort((a, b) => {
                              const [d1, m1, y1] = a[0].split("-");
                              const [d2, m2, y2] = b[0].split("-");
                              return new Date(y1, m1 - 1, d1) - new Date(y2, m2 - 1, d2);
                            })
                            .map(([date, code]) => (
                              <div
                                key={date}
                                className="border rounded p-2 text-center text-sm"
                              >
                                <div className="text-xs text-gray-500 mb-1">
                                  {date.split("-")[0]}
                                </div>
                                <div className="font-semibold">{code}</div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-center items-center h-64">
                      <Loader2 className="animate-spin h-8 w-8" />
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </motion.div>
        </AuroraBackground>
      </div>
    </div>
  );
}
