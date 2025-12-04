"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/layouts/Sidebar";
import { AuroraBackground } from "@/components/ui/aurora-background";
import {
  Download,
  UserCheck,
  Users,
  TrendingUp,
  BarChart3,
  Search,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  PieChart as PieChartIcon,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ChartTooltipContent,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const COLORS = [
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
];

export default function AttendancePage() {
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [monthlyData, setMonthlyData] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [legends, setLegends] = useState(null);
  const [loading, setLoading] = useState(false);
  const [markAttendanceOpen, setMarkAttendanceOpen] = useState(false);
  const [searchEmpNo, setSearchEmpNo] = useState("");
  const [employeeData, setEmployeeData] = useState(null);

  const [attendanceForm, setAttendanceForm] = useState({
    emp_no: "",
    date: new Date().toISOString().slice(0, 10),
    code: "",
  });

  useEffect(() => {
    fetchLegends();
    fetchMonthlyData();
    fetchDailyData();
  }, [selectedMonth, selectedDate]);

  const fetchLegends = async () => {
    try {
      const res = await fetch(`${API_URL}/attendance/legend`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setLegends(data);
      }
    } catch (error) {
      console.error("Error fetching legends:", error);
    }
  };

  const fetchMonthlyData = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/attendance/monthly?month=${selectedMonth}`,
        {
          credentials: "include",
        }
      );
      if (res.ok) {
        const data = await res.json();
        setMonthlyData(data);
      } else {
        toast.error("Failed to fetch monthly data");
      }
    } catch (error) {
      toast.error("Error fetching monthly data");
    } finally {
      setLoading(false);
    }
  };

  const fetchDailyData = async () => {
    try {
      const res = await fetch(
        `${API_URL}/attendance/daily_summary?date=${selectedDate}`,
        {
          credentials: "include",
        }
      );
      if (res.ok) {
        const data = await res.json();
        setDailyData(data);
      }
    } catch (error) {
      console.error("Error fetching daily data:", error);
    }
  };

  const fetchEmployeeAttendance = async () => {
    if (!searchEmpNo) {
      toast.error("Please enter employee number");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/attendance/${searchEmpNo}?month=${selectedMonth}`,
        {
          credentials: "include",
        }
      );
      if (res.ok) {
        const data = await res.json();
        setEmployeeData(data);
        toast.success("Employee data loaded");
      } else {
        toast.error("Employee not found");
      }
    } catch (error) {
      toast.error("Error fetching employee data");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAttendance = async () => {
    if (!attendanceForm.emp_no || !attendanceForm.date || !attendanceForm.code) {
      toast.error("Please fill all fields");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(attendanceForm),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message);
        setMarkAttendanceOpen(false);
        setAttendanceForm({
          emp_no: "",
          date: new Date().toISOString().slice(0, 10),
          code: "",
        });
        fetchMonthlyData();
        fetchDailyData();
      } else {
        const error = await res.json();
        toast.error(error.detail || "Failed to mark attendance");
      }
    } catch (error) {
      toast.error("Error marking attendance");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (type) => {
    try {
      const res = await fetch(
        `${API_URL}/export_${type}?month=${selectedMonth}`,
        {
          credentials: "include",
        }
      );
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${type}_attendance_${selectedMonth}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success(`${type} attendance exported successfully`);
      } else {
        toast.error("Export failed");
      }
    } catch (error) {
      toast.error("Error exporting data");
    }
  };

  const pieChartData =
    dailyData?.breakdown &&
    Object.entries(dailyData.breakdown).map(([key, value]) => ({
      name: key,
      value: value,
    }));

  const barChartData =
    monthlyData?.employees &&
    monthlyData.employees.slice(0, 10).map((emp) => ({
      name: emp.emp_no,
      ...emp.summary,
    }));

  const changeMonth = (direction) => {
    const date = new Date(selectedMonth + "-01");
    date.setMonth(date.getMonth() + direction);
    setSelectedMonth(date.toISOString().slice(0, 7));
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

      <div className="flex-1 w-full flex flex-col overflow-y-auto">
        <AuroraBackground>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 pb-24 flex flex-col w-full min-h-screen"
          >
            <Toaster position="top-right" richColors closeButton />

            <motion.h2
              className="text-2xl sm:text-3xl font-semibold mb-6 flex-shrink-0"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              Attendance Management
            </motion.h2>

            {/* Action Bar */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap gap-4 mb-6 items-center justify-between"
            >
              <div className="flex flex-wrap gap-4">
                <Dialog
                  open={markAttendanceOpen}
                  onOpenChange={setMarkAttendanceOpen}
                >
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <UserCheck className="w-4 h-4" />
                      Mark Attendance
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Mark Attendance</DialogTitle>
                      <DialogDescription>
                        Enter employee details to mark attendance
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-medium mb-2">Employee Number</div>
                        <Input
                          value={attendanceForm.emp_no}
                          onChange={(e) =>
                            setAttendanceForm({
                              ...attendanceForm,
                              emp_no: e.target.value,
                            })
                          }
                          placeholder="Enter employee number"
                        />
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">Date</div>
                        <Input
                          type="date"
                          value={attendanceForm.date}
                          onChange={(e) =>
                            setAttendanceForm({
                              ...attendanceForm,
                              date: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">Attendance Code</div>
                        <Select
                          value={attendanceForm.code}
                          onValueChange={(value) =>
                            setAttendanceForm({ ...attendanceForm, code: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select code" />
                          </SelectTrigger>
                          <SelectContent>
                            {legends?.regular &&
                              Object.keys(legends.regular).map((code) => (
                                <SelectItem key={code} value={code}>
                                  {code} - {legends.regular[code]}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={handleMarkAttendance}
                        className="w-full"
                        disabled={loading}
                      >
                        {loading ? "Submitting..." : "Submit Attendance"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => handleExport("regular")}
                >
                  <Download className="w-4 h-4" />
                  Export Regular
                </Button>

                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => handleExport("apprentice")}
                >
                  <Download className="w-4 h-4" />
                  Export Apprentice
                </Button>
              </div>

              {/* Month Selector */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => changeMonth(-1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-40"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => changeMonth(1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>


            {/* Employee Search */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="w-5 h-5" />
                    Search Employee Attendance
                  </CardTitle>
                  <CardDescription>
                    Enter employee number to view detailed attendance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 mb-4">
                    <Input
                      placeholder="Employee Number"
                      value={searchEmpNo}
                      onChange={(e) => setSearchEmpNo(e.target.value)}
                      onKeyPress={(e) =>
                        e.key === "Enter" && fetchEmployeeAttendance()
                      }
                    />
                    <Button onClick={fetchEmployeeAttendance}>
                      <Search className="w-4 h-4" />
                    </Button>
                  </div>

                  {employeeData && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-4"
                    >
                      <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
                        <div>
                          <h3 className="font-semibold">
                            {employeeData.emp_name || "N/A"}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {employeeData.emp_no} - {employeeData.type}
                          </p>
                        </div>
                        <Badge>{employeeData.summary.total_days} days</Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {Object.entries(employeeData.summary)
                          .filter(([key]) => key !== "total_days")
                          .map(([code, count]) => (
                            <div
                              key={code}
                              className="p-3 bg-secondary rounded-lg text-center"
                            >
                              <div className="text-2xl font-bold">{count}</div>
                              <div className="text-sm text-muted-foreground">
                                {code}
                              </div>
                            </div>
                          ))}
                      </div>

                      <div className="grid grid-cols-7 gap-2">
                        {Object.entries(employeeData.attendance).map(
                          ([date, code]) => (
                            <div
                              key={date}
                              className="p-2 bg-secondary rounded text-center hover:bg-secondary/80 transition-colors"
                            >
                              <div className="text-xs font-medium">
                                {date.split("-")[0]}
                              </div>
                              <Badge
                                variant={
                                  code.startsWith("P")
                                    ? "default"
                                    : code.startsWith("A")
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="text-xs mt-1"
                              >
                                {code}
                              </Badge>
                            </div>
                          )
                        )}
                      </div>
                    </motion.div>
                  )}
                </CardContent>
              </Card>
            </motion.div>


            {/* Stats Cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
            >
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Daily Marked
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {dailyData?.total_marked || 0}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedDate}
                  </p>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-purple-500" />
                    Attendance Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {monthlyData?.employees
                      ? (
                        (monthlyData.employees.reduce(
                          (acc, emp) => acc + (emp.summary.P || 0),
                          0
                        ) /
                          monthlyData.employees.reduce(
                            (acc, emp) => acc + emp.summary.total_days,
                            1
                          )) *
                        100
                      ).toFixed(1)
                      : 0}
                    %
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Present days
                  </p>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-500" />
                    Avg Days/Employee
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {monthlyData?.employees
                      ? (
                        monthlyData.employees.reduce(
                          (acc, emp) => acc + emp.summary.total_days,
                          0
                        ) / monthlyData.employees.length
                      ).toFixed(1)
                      : 0}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Days marked
                  </p>
                </CardContent>
              </Card>
            </motion.div>


            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Daily Pie Chart */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <PieChartIcon className="w-5 h-5" />
                      Daily Attendance Distribution
                    </CardTitle>
                    <CardDescription>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">For:</span>
                        <Input
                          type="date"
                          value={selectedDate}
                          onChange={(e) => setSelectedDate(e.target.value)}
                          className="w-40 h-7 text-xs"
                        />
                      </div>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {pieChartData && pieChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={pieChartData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, percent }) =>
                              `${name}: ${(percent * 100).toFixed(0)}%`
                            }
                            outerRadius={100}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {pieChartData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={COLORS[index % COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltipContent />} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        No data available for selected date
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              {/* Monthly Bar Chart */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 }}
              >
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5" />
                      Top 10 Employees - Monthly Summary
                    </CardTitle>
                    <CardDescription>
                      Attendance breakdown for {selectedMonth}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {barChartData && barChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={barChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip content={<ChartTooltipContent />} />
                          <Legend content={<ChartLegendContent />} />
                          <Bar dataKey="P" fill="#10b981" name="Present" />
                          <Bar dataKey="A" fill="#ef4444" name="Absent" />
                          <Bar dataKey="L" fill="#f59e0b" name="Leave" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        No data available for selected month
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Legends */}
            {legends && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6"
              >
                <Card>
                  <CardHeader>
                    <CardTitle>Regular Employee Codes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(legends.regular).map(([code, desc]) => (
                        <div
                          key={code}
                          className="flex items-center justify-between p-2 rounded bg-secondary"
                        >
                          <Badge>{code}</Badge>
                          <span className="text-sm">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Apprentice Employee Codes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(legends.apprentice).map(
                        ([code, desc]) => (
                          <div
                            key={code}
                            className="flex items-center justify-between p-2 rounded bg-secondary"
                          >
                            <Badge>{code}</Badge>
                            <span className="text-sm">{desc}</span>
                          </div>
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </motion.div>
        </AuroraBackground>
      </div>
    </div>
  );
}
