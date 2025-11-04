"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Users,
  CalendarCheck,
  Calendar,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { NavbarButton } from "@/components/ui/resizable-navbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import SuperadminDashboard from "@/app/dashboard/superadmin/page";
import AdminDashboard from "@/app/dashboard/admin/page";
import Sidebar from "@/components/layouts/Sidebar";


function LiveClockCard() {
  const [time, setTime] = React.useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours();
  let currentShift = "";
  if (hours >= 6 && hours < 14) currentShift = "Morning Shift (6 AM – 2 PM)";
  else if (hours >= 14 && hours < 22)
    currentShift = "Evening Shift (2 PM – 10 PM)";
  else currentShift = "Night Shift (10 PM – 6 AM)";

  return (
    <div className="space-y-4">
      {/* Live Clock */}
      <div className="flex items-center justify-between bg-neutral-100 dark:bg-neutral-800 p-4 rounded-lg">
        <div>
          <p className="text-sm text-gray-500">Current Time</p>
          <p className="text-2xl font-semibold text-blue-600">
            {time.toLocaleTimeString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Date</p>
          <p className="text-md font-medium">
            {time.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Shift Info */}
      <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
        <p className="text-sm font-medium mb-1">🕒 Current Shift</p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {currentShift}
        </p>
      </div>

      {/* Static Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <p className="text-sm font-medium mb-1">🏢 Operation Mode</p>
          <p className="text-xs text-gray-500">24×7 - Shift Based</p>
        </div>
        <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <p className="text-sm font-medium mb-1">📍 Location</p>
          <p className="text-xs text-gray-500">Kharagpur - 721301, Paschim Medinipur</p>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ children }) {
  const [open, setOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const sidebarRef = useRef(null);
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://attendify-tv8w.onrender.com";

  const [overview, setOverview] = useState({
    employees: 0,
    attendanceToday: 0,
    pendingNotifications: 0,
    pendingAttendance: 0,
    weeklyAvgPresent: 0,
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("user");
      if (saved) setUser(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (user?.role !== "superadmin") return;

    const wsUrl = API_URL.startsWith("https")
      ? API_URL.replace("https", "wss") + "/notifications/ws"
      : API_URL.replace("http", "ws") + "/notifications/ws";

    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const newNotif = JSON.parse(event.data);
        setNotifications((prev) => [newNotif, ...prev]);
      } catch (e) {
        console.error("Invalid WS message:", e);
      }
    };

    ws.onerror = (err) => console.error("WebSocket error:", err);

    return () => ws.close();
  }, [user, API_URL]);

  useEffect(() => {
    if (!notifOpen || !user?.role) return;
    
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    
    fetch(`${API_URL}/notifications`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => res.json())
      .then((data) => setNotifications(data))
      .catch((err) => console.error("Error fetching notifications:", err));
  }, [notifOpen, user, API_URL]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch employee count
  useEffect(() => {
    const fetchEmployeeCount = async () => {
      if (!user) return;
      
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      
      try {
        const res = await fetch(`${API_URL}/employees/count`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        setOverview((prev) => ({ ...prev, employees: data.count }));
      } catch (err) {
        console.error("Error fetching employees count:", err);
      }
    };

    fetchEmployeeCount();
    const interval = setInterval(fetchEmployeeCount, 30000);
    return () => clearInterval(interval);
  }, [API_URL, user]);

  // Fetch ALL holidays from /holidays endpoint
  useEffect(() => {
    const fetchAllHolidays = async () => {
      try {
        const res = await fetch(`${API_URL}/holidays`);
        const data = await res.json();
        
        if (data.holidays && Array.isArray(data.holidays)) {
          setHolidays(data.holidays);
        }
      } catch (err) {
        console.error("Error fetching holidays:", err);
      }
    };

    fetchAllHolidays();
    // Refresh holidays every hour (they don't change often)
    const interval = setInterval(fetchAllHolidays, 3600000);
    return () => clearInterval(interval);
  }, [API_URL]);

  // Fetch dashboard data from home endpoint for weekly average
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const res = await fetch(`${API_URL}/`);
        const data = await res.json();
        
        // Update overview with weekly average
        if (data.attendance_snapshot?.weekly_avg) {
          setOverview((prev) => ({
            ...prev,
            weeklyAvgPresent: Math.round(data.attendance_snapshot.weekly_avg.avg_present),
          }));
        }
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
      }
    };

    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(interval);
  }, [API_URL]);

  const markAsRead = async (id) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    
    try {
      await fetch(`${API_URL}/notifications/read/${id}`, { 
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, status: "read" } : n))
      );
    } catch (e) {
      console.error(e);
    }
  };

  const markAllAsRead = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    
    try {
      await fetch(`${API_URL}/notifications/read-all`, { 
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, status: "read" })));
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    
    try {
      await fetch(`${API_URL}/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
    } catch (e) {
      console.error("Logout error:", e);
    }
    
    if (typeof window !== "undefined") {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
    }
    setUser(null);
    setDropdownOpen(false);
    window.location.href = "/";
  };

  const dashboardTitle =
    user?.role === "superadmin"
      ? "Superadmin Dashboard"
      : user?.role === "admin"
        ? "Admin Dashboard"
        : "Dashboard";

  return (
    <div className="flex h-screen w-full" ref={sidebarRef}>
      {/* Sidebar */}

      <Sidebar
        user={user}
        setUser={setUser}
        notifications={notifications}
        setNotifications={setNotifications}
        API_URL={API_URL}
      />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto relative p-8">
        <AuroraBackground className="absolute inset-0 -z-10" />
        <div className="relative z-10 space-y-8">
          <h1 className="text-3xl font-bold">{dashboardTitle}</h1>
          {/* {user && (
            <p className="text-center text-gray-600 dark:text-gray-300">
              Logged in as <span className="font-semibold">{user.name}</span> ({user.role})
            </p>
          )} */}
          <p className="text-gray-500 dark:text-gray-400">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          {/* Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {/* 1. Employees Count */}
            <Card>
              <CardHeader className="flex items-center gap-2">
                <Users className="w-6 h-6 text-green-500" />
                <CardTitle>No. of Employees</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{overview.employees}</p>
              </CardContent>
            </Card>

            {/* 2. Pending Attendance Today */}
            <Card>
              <CardHeader className="flex items-center gap-2">
                <CalendarCheck className="w-6 h-6 text-blue-500" />
                <CardTitle>Pending Attendance</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {overview.pendingAttendance}
                </p>
              </CardContent>
            </Card>

            {/* 3. Weekly Average Attendance */}
            <Card>
              <CardHeader className="flex items-center gap-2">
                <Calendar className="w-6 h-6 text-purple-500" />
                <CardTitle>Weekly Avg Present</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {overview.weeklyAvgPresent}
                </p>
              </CardContent>
            </Card>

            {/* 4. Upcoming Holidays (ALL HOLIDAYS) */}
            {!user && (
              <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="w-full max-w-3xl mx-auto">
                  <CardHeader className="flex items-center gap-2">
                    <CalendarDays className="w-6 h-6 text-red-500" />
                    <CardTitle>All Holidays ({holidays.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="max-h-72 overflow-y-auto">
                    {holidays.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        No holidays found in database
                      </p>
                    ) : (
                      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                        {holidays.map((h, idx) => (
                          <li
                            key={idx}
                            className="py-3 flex items-center justify-between gap-3"
                          >
                            <span className="font-medium truncate">{h.name}</span>
                            <span className="text-sm text-gray-500 whitespace-nowrap">
                              {h.date}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>


                <Card className="col-span-2">
                  <CardHeader className="flex items-center gap-2">
                    <Calendar className="w-6 h-6 text-blue-500" />
                    <CardTitle>Office Info</CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-6">
                    {/* Live Clock */}
                    <LiveClockCard />
                  </CardContent>
                </Card>

              </div>
            )}
          </div>

          {/* {children} */}

          {user ? (
            user.role === "superadmin" ? (
              <SuperadminDashboard />
            ) : user.role === "admin" ? (
              <AdminDashboard />
            ) : null
          ) : (
            <>
            </>
          )}


        </div>
      </div>
    </div>
  );
}