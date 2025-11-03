"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/layouts/Sidebar"; // ✅ same sidebar with notif logic
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
  const [notifications, setNotifications] = useState([]);

  // ✅ Fetch logged-in user from localStorage (like Dashboard)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("user");
      if (saved) setUser(JSON.parse(saved));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    toast.info("Logged out successfully");
    window.location.href = "/login";
  };

  const handleAddEmployee = async () => {
    setLoading(true);
    const token = localStorage.getItem("token");
    if (!token) {
      toast.error("Unauthorized. Please log in again.");
      setLoading(false);
      return;
    }

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
      } else {
        toast.error(data.detail || "Failed to add employee");
      }
    } catch (e) {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return toast.error("Please select a file");

    setLoading(true);
    const token = localStorage.getItem("token");
    if (!token) {
      toast.error("Unauthorized. Please log in again.");
      setLoading(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_URL}/employees`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        toast.success("File uploaded successfully!");
        setUploadOpen(false);
        setFile(null);
      } else {
        toast.error(data.detail || "Upload failed");
      }
    } catch (e) {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* ✅ Sidebar (with full notification logic) */}
      <Sidebar
        user={user}
        setUser={setUser}
        notifications={notifications}
        setNotifications={setNotifications}
        API_URL={API_URL}
      />

      {/* Main content */}
      <div className="flex-1">
        <AuroraBackground>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative z-10 p-8 flex flex-col items-center"
          >
            <Toaster position="top-right" richColors closeButton />

            <motion.h2
              className="text-3xl font-semibold mb-8"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              Employee Management
            </motion.h2>

            <motion.div
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
            >
              <Card className="max-w-3xl w-full shadow-lg bg-white border border-gray-200">
                <CardHeader className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-6 h-6 text-green-600" />
                    <CardTitle>Employees</CardTitle>
                  </div>

                  <div className="flex gap-2">
                    {/* Upload Excel Modal */}
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

                    {/* Add Employee Modal */}
                    <Dialog open={addOpen} onOpenChange={setAddOpen}>
                      <DialogTrigger asChild>
                        <Button className="gap-1">
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
                          <Button
                            onClick={handleAddEmployee}
                            disabled={loading}
                            className="mt-2"
                          >
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

                <CardContent>
                  <motion.p
                    className="text-gray-600 mb-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    Manage, view, and add employees in the system.
                  </motion.p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </AuroraBackground>
      </div>
    </div>
  );
}
