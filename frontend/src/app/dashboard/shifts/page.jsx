"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

import {
  Users,
  Calendar,
  Clock,
  Plus,
  Loader2,
  Search as SearchIcon,
  Check,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// common shifts - adjust to your actual shift keys/names if different
const SHIFT_OPTIONS = [
  "Day",
  "Night",
  "A",
  "B",
  "C",
  "General",
  "Holiday",
];

export default function ShiftsPage() {
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);

  // pagination / filters
  const [page, setPage] = useState(0);
  const [limit] = useState(12);
  const [total, setTotal] = useState(0);
  const [dateFilter, setDateFilter] = useState("");
  const [empNoFilter, setEmpNoFilter] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // assign shift modal
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({
    emp_no: "",
    name: "",
    shift: SHIFT_OPTIONS[0],
    date: new Date().toISOString().slice(0, 10),
  });
  const [assignLoading, setAssignLoading] = useState(false);

  // if backend returns 409 with matches, store matches and show selection dialog
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [matchCandidates, setMatchCandidates] = useState([]);

  // highlight newly added row
  const [recentAddedId, setRecentAddedId] = useState(null);

  const fetchIntervalRef = useRef(null);

  useEffect(() => {
    // load saved user if present (your app stores user in localStorage as your emp page)
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("user");
      if (saved) setUser(JSON.parse(saved));
    }
  }, []);

  // fetch shifts
  const fetchShifts = async (silent = false) => {
    if (!user) {
      if (!silent) setLoading(false);
      return;
    }
    if (!silent) setLoading(true);

    try {
      const params = new URLSearchParams();
      if (dateFilter) params.append("date", dateFilter);
      if (empNoFilter) params.append("emp_no", empNoFilter);
      params.append("skip", String(page * limit));
      params.append("limit", String(limit));

      const res = await fetch(`${API_URL}/shift?${params.toString()}`, {
        credentials: "include",
      });
      const json = await res.json();

      if (res.ok) {
        setShifts(json.shifts || []);
        setTotal(json.total || 0);
      } else {
        // handle 403 session expiry
        if (res.status === 403) {
          localStorage.removeItem("user");
          setUser(null);
          if (!silent) toast.error("Session expired. Please log in again.");
        } else {
          if (!silent) toast.error(json.detail || "Failed to fetch shifts");
        }
      }
    } catch (err) {
      console.error("fetchShifts:", err);
      if (!silent) toast.error("Network error while fetching shifts");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchShifts();

      // silent refresh every 5s (only when not interacting with dialogs)
      fetchIntervalRef.current = setInterval(() => {
        if (!assignOpen && !matchDialogOpen) {
          fetchShifts(true);
        }
      }, 5000);
    }
    return () => {
      if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, user, dateFilter, empNoFilter, assignOpen, matchDialogOpen]);

  // Helpers to decide whether search input is emp_no or name
  const isProbablyEmpNo = (s) => /^[0-9]+$/.test(String(s).trim());

  // Assign shift POST
  const submitAssignShift = async (payload) => {
    setAssignLoading(true);
    try {
      const res = await fetch(`${API_URL}/shift`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        toast.success(data.message || "Shift assigned");
        setAssignOpen(false);

        // refresh and highlight new row if available
        await fetchShifts();
        if (data.shift_record) {
          // backend returns doc with emp_no & date
          setRecentAddedId(`${data.shift_record.emp_no}::${data.shift_record.date}`);
          // clear highlight after 3s
          setTimeout(() => setRecentAddedId(null), 3000);
        }
        return { ok: true, data };
      } else {
        // handle 409 multiple matches (backend returns {detail, matches})
        if (res.status === 409 && data.matches) {
          setMatchCandidates(data.matches);
          setMatchDialogOpen(true);
          return { ok: false, type: "multiple", data };
        }
        // other errors (403, 404)
        toast.error(data.detail || `Failed to assign shift (${res.status})`);
        return { ok: false, data };
      }
    } catch (err) {
      console.error("submitAssignShift:", err);
      toast.error("Network error while assigning shift");
      return { ok: false, error: err };
    } finally {
      setAssignLoading(false);
    }
  };

  // User clicked "Assign" in modal
  const handleAssign = async () => {
    // require shift + date and either emp_no or name
    if (!assignForm.shift || !assignForm.date) {
      return toast.error("Shift and date are required");
    }
    if (!assignForm.emp_no && !assignForm.name) {
      return toast.error("Provide employee number or name");
    }

    // prepare payload - backend accepts emp_no OR name
    const payload = {
      shift: assignForm.shift,
      date: assignForm.date,
    };
    if (assignForm.emp_no) payload.emp_no = String(assignForm.emp_no).split(".")[0];
    else payload.name = assignForm.name;

    const result = await submitAssignShift(payload);

    // if multiple matches handled by match dialog — we stop here and let user pick
    if (result.ok) {
      // reset form
      setAssignForm({
        emp_no: "",
        name: "",
        shift: SHIFT_OPTIONS[0],
        date: new Date().toISOString().slice(0, 10),
      });
    }
  };

  // Called when the user picks a candidate from the match dialog
  const handlePickCandidate = async (candidate) => {
    // candidate contains emp_no, name, designation
    setMatchDialogOpen(false);

    // retry using emp_no now
    const payload = {
      emp_no: candidate.emp_no,
      shift: assignForm.shift,
      date: assignForm.date,
    };

    const result = await submitAssignShift(payload);
    if (result.ok) {
      setAssignForm({
        emp_no: "",
        name: "",
        shift: SHIFT_OPTIONS[0],
        date: new Date().toISOString().slice(0, 10),
      });
    }
  };

  // UI helpers
  const highlightKey = (rec) => `${rec.emp_no}::${rec.date}`;

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
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 flex flex-col w-full min-h-screen"
          >
            <Toaster position="top-right" richColors closeButton />

            <motion.h2
              className="text-2xl sm:text-3xl font-semibold mb-4"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              Shift Management
            </motion.h2>

            {/* Controls card */}
            <Card className="w-full shadow-md bg-white border border-gray-200 mb-6">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Users className="w-6 h-6 text-slate-700" />
                  <CardTitle>Manage Shifts</CardTitle>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => {
                      setDateFilter(e.target.value);
                      setPage(0);
                    }}
                    className="max-w-[220px]"
                    placeholder="Filter by date"
                  />

                  <Input
                    placeholder="Filter by emp no."
                    value={empNoFilter}
                    onChange={(e) => {
                      setEmpNoFilter(e.target.value);
                      setPage(0);
                    }}
                    className="max-w-[220px]"
                  />

                  <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
                    <DialogTrigger asChild>
                      <Button className="ml-2 gap-2">
                        <Plus className="w-4 h-4" /> Assign Shift
                      </Button>
                    </DialogTrigger>

                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Assign Shift</DialogTitle>
                      </DialogHeader>

                      <div className="flex flex-col gap-3">
                        <div className="text-sm text-slate-600">
                          Provide employee number or full/partial name. If multiple employees match a name, you'll be asked to choose.
                        </div>

                        <Input
                          placeholder="Employee No (numeric preferred)"
                          value={assignForm.emp_no}
                          onChange={(e) =>
                            setAssignForm({ ...assignForm, emp_no: e.target.value, name: "" })
                          }
                        />

                        <Input
                          placeholder="Or search by name"
                          value={assignForm.name}
                          onChange={(e) =>
                            setAssignForm({ ...assignForm, name: e.target.value, emp_no: "" })
                          }
                        />

                        <Select
                          value={assignForm.shift}
                          onValueChange={(val) => setAssignForm({ ...assignForm, shift: val })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select shift" />
                          </SelectTrigger>
                          <SelectContent>
                            {SHIFT_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          type="date"
                          value={assignForm.date}
                          onChange={(e) => setAssignForm({ ...assignForm, date: e.target.value })}
                        />

                        <div className="flex gap-2">
                          <Button onClick={handleAssign} disabled={assignLoading}>
                            {assignLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "Assign Shift"
                            )}
                          </Button>
                          <Button variant="outline" onClick={() => setAssignOpen(false)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
            </Card>

            {/* Table card */}
            <Card className="flex-1 flex flex-col overflow-hidden w-full">
              <CardHeader className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-slate-600" />
                  <CardTitle className="text-base">Recent Shifts</CardTitle>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDateFilter("");
                      setEmpNoFilter("");
                      setPage(0);
                      fetchShifts();
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex-1 p-0 overflow-auto">
                {loading && shifts.length === 0 ? (
                  <div className="flex items-center justify-center h-48">
                    <Loader2 className="animate-spin h-8 w-8 text-gray-500" />
                  </div>
                ) : shifts.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-gray-600">
                    No shifts found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[720px] w-full text-sm">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="text-left p-3">Date</th>
                          <th className="text-left p-3">Emp No</th>
                          <th className="text-left p-3">Name</th>
                          <th className="text-left p-3">Designation</th>
                          <th className="text-left p-3">Shift</th>
                          <th className="text-left p-3">Updated By</th>
                        </tr>
                      </thead>

                      <tbody>
                        <AnimatePresence mode="popLayout">
                          {shifts.map((r, idx) => {
                            const key = highlightKey(r);
                            const isRecent = recentAddedId === key;
                            return (
                              <motion.tr
                                key={key}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6, height: 0 }}
                                transition={{ delay: idx * 0.02 }}
                                className={`border-b ${isRecent ? "bg-emerald-50" : "bg-white"}`}
                              >
                                <td className="p-3">{r.date}</td>
                                <td className="p-3">{r.emp_no}</td>
                                <td className="p-3">{r.name}</td>
                                <td className="p-3">{r.designation}</td>
                                <td className="p-3 font-medium">{r.shift}</td>
                                <td className="p-3">{r.updated_by}</td>
                              </motion.tr>
                            );
                          })}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>

              <div className="flex items-center justify-between gap-2 p-4 border-t bg-gray-50">
                <div className="text-sm text-gray-600">
                  Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of{" "}
                  {total}
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

            {/* Match Candidates Dialog (only appears when backend returns 409 with matches) */}
            <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Multiple employees matched</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                  <div className="text-sm text-slate-600">
                    Multiple employees matched the name you provided. Please choose the correct employee to assign the shift:
                  </div>

                  <div className="flex flex-col gap-2 max-h-64 overflow-auto">
                    {matchCandidates.map((c) => (
                      <motion.div
                        key={c.emp_no}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center justify-between p-2 rounded border"
                      >
                        <div>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-gray-600">{c.emp_no} • {c.designation}</div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            onClick={() => handlePickCandidate(c)}
                            disabled={assignLoading}
                            className="flex items-center gap-2"
                          >
                            <Check className="w-4 h-4" />
                            Pick
                          </Button>

                          <Button variant="ghost" onClick={() => setMatchDialogOpen(false)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </motion.div>
        </AuroraBackground>
      </div>
    </div>
  );
}
