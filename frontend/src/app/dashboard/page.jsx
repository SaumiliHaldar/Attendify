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

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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
    fetch(`${API_URL}/notifications`)
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
      try {
        const res = await fetch(`${API_URL}/employees/count`);
        const data = await res.json();
        setOverview((prev) => ({ ...prev, employees: data.count }));
      } catch (err) {
        console.error("Error fetching employees count:", err);
      }
    };

    fetchEmployeeCount();
    const interval = setInterval(fetchEmployeeCount, 5000);
    return () => clearInterval(interval);
  }, [API_URL]);

  // Fetch holidays
  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const res = await fetch(`${API_URL}/holidays`);
        const data = await res.json();
        if (Array.isArray(data.holidays)) {
          setHolidays(data.holidays);
        }
      } catch (err) {
        console.error("Error fetching holidays:", err);
      }
    };

    fetchHolidays();
  }, [API_URL]);

  const markAsRead = async (id) => {
    try {
      await fetch(`${API_URL}/notifications/read/${id}`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, status: "read" } : n))
      );
    } catch (e) {
      console.error(e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch(`${API_URL}/notifications/read-all`, { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, status: "read" })));
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") localStorage.removeItem("user");
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

  const [overview, setOverview] = useState({
    employees: 0,
    attendanceToday: 0,
    pendingNotifications: 0,
    pendingAttendance: 0,
    weeklyAvgPresent: 0,
  });

  return (
    <div className="flex h-screen w-full" ref={sidebarRef}>
      {/* Sidebar */}
      <motion.div
        animate={{ width: open ? 240 : 72 }}
        className={cn(
          "relative bg-neutral-100 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-700 flex flex-col justify-between transition-all duration-300"
        )}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setOpen(!open)}
          className="absolute -right-3 top-8 z-50 flex items-center justify-center h-6 w-6 rounded-full bg-neutral-200 dark:bg-neutral-700 shadow-md"
        >
          {open ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>

        {/* Top Section */}
        <div>
          {/* Logo */}
          <a href="/">
            <div className="flex items-center gap-2 p-4">
              <img
                src="https://assets.aceternity.com/logo-dark.png"
                alt="logo"
                width={30}
                height={30}
              />
              {open && <span className="font-semibold">Attendify</span>}
            </div>
          </a>

          {/* Notifications */}
          {user?.role === "superadmin" && (
            <div className="px-2 mt-6 relative" ref={notifRef}>
              <div
                className="flex items-center gap-2 p-2 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded relative"
                onClick={() => setNotifOpen(!notifOpen)}
                title="Notifications"
                aria-label="Notifications"
              >
                <div className="relative">
                  <Bell size={20} />
                  {notifications.some((n) => n.status === "unread") && (
                    <span className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full animate-ping" />
                  )}
                </div>
                {open && (
                  <>
                    <span>Notifications</span>
                    <div className="ml-auto flex items-center gap-1">
                      {notifOpen ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Notifications dropdown */}
              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className={cn(
                      "absolute top-full mt-1 w-full max-h-64 overflow-y-auto bg-white dark:bg-neutral-900 shadow-lg rounded-md z-50",
                      !open && "left-full ml-2 w-64" // float outside when collapsed
                    )}
                  >
                    {notifications.length > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-sm text-blue-500 hover:underline p-2 w-full text-left border-b border-neutral-200 dark:border-neutral-700 sticky top-0 bg-white dark:bg-neutral-900 z-10"
                      >
                        Mark all as read
                      </button>
                    )}

                    {/* Notifications list */}
                    {notifications.length === 0 ? (
                      <p className="text-sm text-gray-500 p-2">
                        No notifications
                      </p>
                    ) : (
                      notifications.map((notif) => (
                        <div
                          key={notif._id}
                          className={cn(
                            "p-2 mb-1 rounded text-sm leading-snug",
                            notif.status === "unread"
                              ? "bg-green-50 dark:bg-green-900/20"
                              : "bg-neutral-100 dark:bg-neutral-700"
                          )}
                        >
                          <div className="flex flex-col">
                            <span>{notif.message}</span>
                            <span className="text-sm text-gray-500 mt-1">
                              {new Date(notif.timestamp).toLocaleString()}
                            </span>
                          </div>
                          {notif.status === "unread" && (
                            <button
                              onClick={() => markAsRead(notif._id)}
                              className="text-[10px] text-blue-500 hover:underline mt-1"
                            >
                              Mark as read
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Bottom Section (Profile/Login) */}
        <div className="p-4" ref={profileRef}>
          {user ? (
            <div className="flex items-center gap-3 relative">
              <img
                src={user.picture || "/default-avatar.png"}
                className="h-10 w-10 rounded-full border cursor-pointer"
                alt="profile"
                title="Profile"
                aria-label="Profile"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              />
              {open && (
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{user.name}</span>
                  <span className="text-xs text-gray-500">{user.role}</span>
                </div>
              )}

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute bottom-14 left-4 w-56 bg-white dark:bg-neutral-900 shadow-lg rounded-lg p-4 z-50"
                  >
                    <p className="font-semibold mb-2">{user.name}</p>
                    <p className="text-xs text-gray-500 mb-4">{user.role}</p>
                    <a
                      href="/profile"
                      className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 mb-2"
                    >
                      Manage Profile
                    </a>
                    <button
                      onClick={handleLogout}
                      className="w-full py-2 rounded-md bg-red-500 text-white hover:bg-red-600 flex items-center justify-center gap-2"
                    >
                      <LogOut size={16} /> Logout
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <NavbarButton
              variant="dark"
              href={`${API_URL}/auth/google`}
              className="w-full flex justify-center items-center min-h-[44px] min-w-[44px]"
            >
              {open ? "Login" : <User size={24} />}
            </NavbarButton>
          )}
        </div>
      </motion.div>

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

            {/* 4. Upcoming Holidays (static, full-row width) */}
            {!user && (
              <Card className="w-full max-w-3xl mx-auto">
                <CardHeader className="flex items-center gap-2">
                  <CalendarDays className="w-6 h-6 text-red-500" />
                  <CardTitle>Upcoming Holidays</CardTitle>
                </CardHeader>
                <CardContent className="max-h-72 overflow-y-auto">
                  {holidays.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No upcoming holidays
                    </p>
                  ) : (
                    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {holidays.map((h, idx) => (
                        <li
                          key={idx}
                          className="py-3 flex items-center justify-between gap-3"
                        >
                          <span className="font-medium truncate">{h.name}</span>
                          <span className="text-sm text-gray-500">
                            {h.date}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
