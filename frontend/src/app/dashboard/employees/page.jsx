"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/layouts/Sidebar";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
  Users,
  Upload,
  Plus,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { API_URL } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export default function EmployeesPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    emp_no: "",
    name: "",
    designation: "",
    type: "regular",
  });

  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);

  // Table states
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 25;

  // ✅ Optimized + cancellable fetch
  const fetchEmployees = useCallback(async (signal) => {
    const token = localStorage.getItem("token");
    if (!token) {
      toast.error("Please login first");
      return;
    }

    setLoading(true);
    try {
      const query = new URLSearchParams({
        limit,
        skip: page * limit,
        ...(type !== "all" ? { emp_type: type } : {}),
        ...(search ? { search } : {}),
      });

      const res = await fetch(`${API_URL}/employees?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });

      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      setEmployees(data.employees || []);
      setTotal(data.pagination?.total || 0);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Error fetching employees:", err);
        toast.error("Failed to load employees");
      }
    } finally {
      setLoading(false);
    }
  }, [page, type, search]);

  // ✅ Abortable effect for responsiveness
  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) setUser(JSON.parse(saved));

    const controller = new AbortController();
    fetchEmployees(controller.signal);
    return () => controller.abort();
  }, [fetchEmployees]);

  const totalPages = Math.ceil(total / limit);

  // Add employee manually
  const handleAddEmployee = async () => {
    setLoading(true);
    const token = localStorage.getItem("token");
    if (!token) return toast.error("Unauthorized.");

    try {
      const res = await fetch(`${API_URL}/employees/manual`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success("Employee added successfully!");
        setAddOpen(false);
        setForm({ emp_no: "", name: "", designation: "", type: "regular" });
        fetchEmployees();
      } else toast.error(data.detail || "Failed to add employee");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  // Upload Excel
  const handleUpload = async () => {
    if (!file) return toast.error("Please select a file");
    setLoading(true);
    const token = localStorage.getItem("token");
    if (!token) return toast.error("Unauthorized.");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/employees`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        toast.success("File uploaded successfully!");
        setUploadOpen(false);
        setFile(null);
        fetchEmployees();
      } else toast.error(data.detail || "Upload failed");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        user={user}
        setUser={setUser}
        notifications={notifications}
        setNotifications={setNotifications}
        API_URL={API_URL}
      />

      {/* Main */}
      <div className="flex-1 overflow-y-auto">
        <AuroraBackground>
          <Toaster position="top-right" richColors closeButton />

          <motion.div
            className="relative z-10 p-8 space-y-6 w-full h-full flex flex-col"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* HEADER */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <motion.h2
                className="text-3xl font-bold"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                Employee Management
              </motion.h2>

              <div className="flex gap-2">
                {/* Upload */}
                <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="gap-1">
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
                        onChange={(e) => setFile(e.target.files[0])}
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
                    <Button className="gap-1">
                      <Plus className="w-4 h-4" /> Add
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Employee</DialogTitle>
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
                      <Select
                        value={form.type}
                        onValueChange={(v) => setForm({ ...form, type: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="regular">Regular</SelectItem>
                          <SelectItem value="apprentice">Apprentice</SelectItem>
                        </SelectContent>
                      </Select>
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
            </div>

            {/* TABLE */}
            <Card className="flex-1 w-full border border-gray-200 shadow-sm backdrop-blur bg-white/70 flex flex-col">
              <CardHeader className="flex flex-col md:flex-row justify-between items-center gap-3">
                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <Input
                    placeholder="Search by name or designation..."
                    className="flex-1"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Filter by Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="regular">Regular</SelectItem>
                      <SelectItem value="apprentice">Apprentice</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => fetchEmployees()}
                    disabled={loading}
                  >
                    <RefreshCcw className="w-4 h-4" /> Refresh
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex-1 overflow-auto p-0">
                {loading ? (
                  <div className="flex justify-center items-center h-full">
                    <Loader2 className="animate-spin w-8 h-8 text-gray-400" />
                  </div>
                ) : employees.length === 0 ? (
                  <div className="flex justify-center items-center h-full text-gray-500">
                    No employees found.
                  </div>
                ) : (
                  <motion.div layout className="overflow-x-auto">
                    <Table className="min-w-full text-sm">
                      <TableHeader>
                        <TableRow className="bg-gray-100">
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
                            whileHover={{
                              scale: 1.01,
                              backgroundColor: "#f9fafb",
                            }}
                            transition={{
                              type: "spring",
                              stiffness: 200,
                              damping: 15,
                            }}
                            className="border-b cursor-pointer"
                          >
                            <TableCell>{emp.emp_no}</TableCell>
                            <TableCell className="font-medium">
                              {emp.name}
                            </TableCell>
                            <TableCell>{emp.designation}</TableCell>
                            <TableCell className="capitalize">
                              {emp.type}
                            </TableCell>
                            <TableCell>
                              {new Date(emp.created_at).toLocaleDateString(
                                "en-IN"
                              )}
                            </TableCell>
                          </motion.tr>
                        ))}
                      </TableBody>
                    </Table>
                  </motion.div>
                )}
              </CardContent>

              {/* Pagination */}
              <div className="flex justify-between items-center p-4 border-t bg-gray-50">
                <div className="text-sm text-gray-600">
                  Showing {page * limit + 1}–
                  {Math.min((page + 1) * limit, total)} of {total}
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
