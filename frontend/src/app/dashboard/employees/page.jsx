"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/layouts/Sidebar";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, Plus, Loader2, RefreshCcw } from "lucide-react";
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

export default function Employees() {
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

  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 25;

  // Debug state
  const [debugInfo, setDebugInfo] = useState(null);

  const abortControllerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const fetchEmployees = useCallback(async (signal) => {
    const token = localStorage.getItem("token");
    if (!token) {
      console.error("❌ No token found");
      toast.error("Please login first");
      return;
    }

    setLoading(true);

    try {
      const query = new URLSearchParams({
        limit: limit.toString(),
        skip: (page * limit).toString(),
        ...(type !== "all" ? { emp_type: type } : {}),
        ...(search ? { search } : {}),
      });

      const url = `${API_URL}/employees?${query}`;
      console.log("🔍 Fetching from:", url);
      console.log("📋 Query params:", {
        limit,
        skip: page * limit,
        emp_type: type !== "all" ? type : "not set",
        search: search || "not set",
      });

      const res = await fetch(url, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        signal,
      });

      console.log("📊 Response status:", res.status);
      console.log("📊 Response headers:", Object.fromEntries(res.headers.entries()));

      const data = await res.json();
      console.log("📦 Response data:", data);

      // Set debug info
      setDebugInfo({
        status: res.status,
        url,
        data,
        timestamp: new Date().toISOString(),
      });

      if (res.ok) {
        // Check different possible response structures
        let employeeList = [];
        let totalCount = 0;

        if (Array.isArray(data)) {
          // Response is directly an array
          employeeList = data;
          totalCount = data.length;
          console.log("✅ Data is array, length:", data.length);
        } else if (data.employees && Array.isArray(data.employees)) {
          // Response has employees property
          employeeList = data.employees;
          totalCount = data.pagination?.total || data.total || data.employees.length;
          console.log("✅ Data has employees property, length:", employeeList.length);
        } else if (data.data && Array.isArray(data.data)) {
          // Response has data property
          employeeList = data.data;
          totalCount = data.total || data.data.length;
          console.log("✅ Data has data property, length:", employeeList.length);
        } else {
          console.warn("⚠️ Unexpected response structure:", data);
        }

        console.log("✅ Setting employees:", employeeList.length);
        console.log("✅ Setting total:", totalCount);

        setEmployees(employeeList);
        setTotal(totalCount);

        if (employeeList.length === 0) {
          toast.info("No employees found with current filters");
        }
      } else {
        console.error("❌ Response not OK:", data);
        toast.error(data.detail || data.message || "Failed to load employees");
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error("❌ Fetch error:", err);
        console.error("Error details:", {
          name: err.name,
          message: err.message,
          stack: err.stack,
        });
        toast.error(`Network error: ${err.message}`);
        
        setDebugInfo({
          error: err.message,
          errorType: err.name,
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      setLoading(false);
    }
  }, [search, type, page, limit]);

  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) setUser(JSON.parse(saved));

    // Log API_URL on mount
    console.log("🌐 API_URL:", API_URL);
    console.log("🔑 Token exists:", !!localStorage.getItem("token"));
  }, []);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    abortControllerRef.current = new AbortController();

    const delay = search ? 200 : 0;

    debounceTimerRef.current = setTimeout(() => {
      fetchEmployees(abortControllerRef.current.signal);
    }, delay);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [fetchEmployees]);

  const totalPages = Math.ceil(total / limit);

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
      console.log("➕ Add employee response:", data);

      if (res.ok) {
        toast.success("Employee added successfully!");
        setAddOpen(false);
        setForm({ emp_no: "", name: "", designation: "", type: "regular" });
        
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
        fetchEmployees(abortControllerRef.current.signal);
      } else {
        toast.error(data.detail || "Failed to add employee");
      }
    } catch (err) {
      console.error("❌ Add employee error:", err);
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return toast.error("Please select a file");
    setLoading(true);
    const token = localStorage.getItem("token");
    if (!token) return toast.error("Unauthorized.");

    try {
      const formData = new FormData();
      formData.append("file", file);
      
      console.log("📤 Uploading file:", file.name);
      
      const res = await fetch(`${API_URL}/employees`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      
      console.log("📤 Upload response:", data);

      if (res.ok) {
        toast.success("File uploaded successfully!");
        setUploadOpen(false);
        setFile(null);
        
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
        fetchEmployees(abortControllerRef.current.signal);
      } else {
        toast.error(data.detail || "Upload failed");
      }
    } catch (err) {
      console.error("❌ Upload error:", err);
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    console.log("🔄 Manual refresh triggered");
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    fetchEmployees(abortControllerRef.current.signal);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={user}
        setUser={setUser}
        notifications={notifications}
        setNotifications={setNotifications}
        API_URL={API_URL}
      />

      <div className="flex-1 flex flex-col h-full">
        <AuroraBackground>
          <Toaster position="top-right" richColors closeButton />

          <motion.div
            className="relative z-10 flex flex-col p-6 gap-6 w-full h-full"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <motion.h2
                className="text-3xl font-bold tracking-tight"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                Employee Management
              </motion.h2>

              <div className="flex gap-2">
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

            <Card className="flex flex-col flex-1 border border-gray-200 shadow-sm bg-white/70 backdrop-blur">
              <CardHeader className="flex flex-col md:flex-row justify-between items-center gap-3">
                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <Input
                    placeholder="Search by name or designation..."
                    className="flex-1"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                  />
                  <Select 
                    value={type} 
                    onValueChange={(v) => {
                      setType(v);
                      setPage(0);
                    }}
                  >
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
                    onClick={handleRefresh}
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
                  <div className="flex flex-col justify-center items-center h-full text-gray-500 gap-4 p-8">
                    <p className="text-lg">No employees found.</p>
                    
                    {/* Debug info */}
                    {debugInfo && (
                      <details className="text-xs text-left bg-gray-100 p-4 rounded w-full max-w-2xl">
                        <summary className="cursor-pointer font-semibold mb-2">
                          🐛 Debug Info (Click to expand)
                        </summary>
                        <pre className="overflow-auto">
                          {JSON.stringify(debugInfo, null, 2)}
                        </pre>
                        <div className="mt-2 space-y-1">
                          <p><strong>API URL:</strong> {API_URL}</p>
                          <p><strong>Token Present:</strong> {localStorage.getItem("token") ? "✅ Yes" : "❌ No"}</p>
                          <p><strong>Current Filters:</strong></p>
                          <ul className="ml-4">
                            <li>Type: {type}</li>
                            <li>Search: {search || "(empty)"}</li>
                            <li>Page: {page}</li>
                            <li>Limit: {limit}</li>
                          </ul>
                        </div>
                      </details>
                    )}
                    
                    <p className="text-sm">Check the browser console (F12) for detailed logs</p>
                  </div>
                ) : (
                  <motion.div layout className="min-h-full overflow-x-auto">
                    <Table className="min-w-full text-sm">
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
                            key={emp.emp_no || emp._id || idx}
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
                              {emp.created_at 
                                ? new Date(emp.created_at).toLocaleDateString("en-IN")
                                : "N/A"
                              }
                            </TableCell>
                          </motion.tr>
                        ))}
                      </TableBody>
                    </Table>
                  </motion.div>
                )}
              </CardContent>

              <div className="flex justify-between items-center p-4 border-t bg-gray-50">
                <div className="text-sm text-gray-600">
                  Showing {employees.length > 0 ? page * limit + 1 : 0}–
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