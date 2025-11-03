"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/layouts/Sidebar";
import { AuroraBackground } from "@/components/ui/aurora-background";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
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
import { Users, Upload, Plus, Loader2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { API_URL } from "@/lib/api";

export default function Employees() {
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    emp_no: "",
    name: "",
    designation: "",
    type: "regular",
  });

  const [user, setUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [search, setSearch] = useState("");
  const [empType, setEmpType] = useState("all");
  const [page, setPage] = useState(0);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);

  const totalPages = Math.ceil(total / limit);

  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) setUser(JSON.parse(saved));
  }, []);

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  // Fetch Employees (auto-refresh)
  const fetchEmployees = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: search || "",
        emp_type: empType === "all" ? "" : empType,
        skip: (page * limit).toString(),
        limit: limit.toString(),
      });

      const res = await fetch(`${API_URL}/employees?${params.toString()}`, {
        headers: { Authorization: token },
      });
      const data = await res.json();

      if (res.ok) {
        setEmployees(data.employees || []);
        setTotal(data.pagination?.total || 0);
      } else {
        toast.error(data.detail || "Failed to fetch employees");
      }
    } catch (err) {
      console.error(err);
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch & refetch when filters/pagination change
  useEffect(() => {
    if (token) fetchEmployees();
  }, [page, empType]);

  // Refetch when token becomes available
  useEffect(() => {
    if (token) fetchEmployees();
  }, [token]);

  // Add Employee
  const handleAddEmployee = async () => {
    if (!form.emp_no || !form.name || !form.designation)
      return toast.error("Please fill all fields");

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/employees/manual`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Employee added successfully!");
        setAddOpen(false);
        setForm({ emp_no: "", name: "", designation: "", type: "regular" });

        // Instantly add new employee in UI
        setEmployees((prev) => [data.employee || form, ...prev]);
        setTotal((prev) => prev + 1);
      } else {
        toast.error(data.detail || "Failed to add employee");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  // Upload Excel (auto refresh)
  const handleUpload = async () => {
    if (!file) return toast.error("Please select a file");

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_URL}/employees`, {
        method: "POST",
        headers: { Authorization: token },
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(
          data.message ||
            `Uploaded successfully (Added: ${data.summary?.added || 0}, Updated: ${
              data.summary?.updated || 0
            })`
        );
        setUploadOpen(false);
        setFile(null);
        fetchEmployees(); // 🔁 Refresh table
      } else {
        toast.error(data.detail || "Upload failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
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

      <div className="flex-1 w-full">
        <AuroraBackground>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 flex flex-col w-full"
          >
            <Toaster position="top-right" richColors closeButton />

            <motion.h2
              className="text-2xl sm:text-3xl font-semibold mb-6"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              Employee Management
            </motion.h2>

            {/* Header */}
            <Card className="w-full shadow-lg bg-white border border-gray-200 mb-6">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="w-6 h-6 text-green-600" />
                  <CardTitle>Employees</CardTitle>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  {/* Upload */}
                  <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="gap-1 w-full sm:w-auto">
                        <Upload className="w-4 h-4" /> Upload
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Upload Employee Excel</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-3">
                        <Input
                          type="file"
                          accept=".xlsx"
                          onChange={(e) =>
                            setFile(e.target.files ? e.target.files[0] : null)
                          }
                        />
                        <Button onClick={handleUpload} disabled={loading}>
                          {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Upload File"
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* Add */}
                  <Dialog open={addOpen} onOpenChange={setAddOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-1 w-full sm:w-auto">
                        <Plus className="w-4 h-4" /> Add
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add New Employee</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-3">
                        <Input
                          placeholder="Employee No"
                          value={form.emp_no}
                          onChange={(e) =>
                            setForm({ ...form, emp_no: e.target.value })
                          }
                        />
                        <Input
                          placeholder="Full Name"
                          value={form.name}
                          onChange={(e) =>
                            setForm({ ...form, name: e.target.value })
                          }
                        />
                        <Input
                          placeholder="Designation"
                          value={form.designation}
                          onChange={(e) =>
                            setForm({ ...form, designation: e.target.value })
                          }
                        />
                        <select
                          className="rounded-md border border-gray-300 p-2 text-gray-700"
                          value={form.type}
                          onChange={(e) =>
                            setForm({ ...form, type: e.target.value })
                          }
                        >
                          <option value="regular">Regular</option>
                          <option value="apprentice">Apprentice</option>
                        </select>
                        <Button onClick={handleAddEmployee} disabled={loading}>
                          {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Add Employee"
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
            </Card>

            {/* Table */}
            <Card className="flex-1 flex flex-col overflow-hidden w-full">
              <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex flex-wrap gap-2 w-full">
                  <Input
                    placeholder="Search by name, number, or designation..."
                    className="flex-1 min-w-[200px]"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Select value={empType} onValueChange={setEmpType}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="regular">Regular</SelectItem>
                      <SelectItem value="apprentice">Apprentice</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={fetchEmployees} variant="outline">
                    Search
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex-1 overflow-auto p-0">
                {loading ? (
                  <div className="flex justify-center items-center h-64">
                    <Loader2 className="animate-spin h-8 w-8 text-gray-500" />
                  </div>
                ) : employees.length === 0 ? (
                  <div className="flex justify-center items-center h-64 text-gray-500">
                    No employees found.
                  </div>
                ) : (
                  <motion.div layout className="overflow-x-auto w-full">
                    <Table className="min-w-[600px] text-sm w-full">
                      <TableHeader>
                        <TableRow className="bg-gray-100 sticky top-0">
                          <TableHead>Emp No</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Designation</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Created At</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employees.map((emp, idx) => (
                          <motion.tr
                            key={emp.emp_no || idx}
                            layout
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.01 }}
                            className="hover:bg-gray-50 border-b"
                          >
                            <TableCell>{emp.emp_no}</TableCell>
                            <TableCell>{emp.name}</TableCell>
                            <TableCell>{emp.designation}</TableCell>
                            <TableCell className="capitalize">
                              {emp.type}
                            </TableCell>
                            <TableCell>
                              {emp.created_at
                                ? new Date(emp.created_at).toLocaleDateString(
                                    "en-IN"
                                  )
                                : "-"}
                            </TableCell>
                          </motion.tr>
                        ))}
                      </TableBody>
                    </Table>
                  </motion.div>
                )}
              </CardContent>

              {/* Pagination */}
              <div className="flex flex-col sm:flex-row justify-between items-center gap-2 p-4 border-t bg-gray-50">
                <div className="text-sm text-gray-600">
                  Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </AuroraBackground>
      </div>
    </div>
  );
}
