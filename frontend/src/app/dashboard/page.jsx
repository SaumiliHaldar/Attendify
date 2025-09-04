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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { NavbarButton } from "@/components/ui/resizable-navbar";

export default function SidebarLayout({ children }) {
  const [open, setOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const sidebarRef = useRef(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  // Load user on client-side only
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("user");
      if (saved) setUser(JSON.parse(saved));
    }
  }, []);

  // WebSocket for realtime notifications (client-side only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (user?.role !== "superadmin") return;

    let wsUrl = "";
    if (API_URL.startsWith("https")) {
      wsUrl = API_URL.replace("https", "wss") + "/notifications/ws";
    } else {
      wsUrl = API_URL.replace("http", "ws") + "/notifications/ws";
    }

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

  // Fetch notifications when opened
  useEffect(() => {
    if (!notifOpen || !user?.role) return;
    fetch(`${API_URL}/notifications`)
      .then((res) => res.json())
      .then((data) => setNotifications(data))
      .catch((err) => console.error("Error fetching notifications:", err));
  }, [notifOpen, user, API_URL]);

  // Click outside to close notifications & profile dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setNotifOpen(false);
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
            <div className="px-2 mt-6 relative">
              <div
                className="flex items-center gap-2 p-2 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded relative"
                onClick={() => setNotifOpen(!notifOpen)}
              >
                {/* Bell with ping for collapsed sidebar */}
                <div className="relative">
                  <Bell size={20} />
                  {!open && notifications.some((n) => n.status === "unread") && (
                    <span className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full animate-ping" />
                  )}
                </div>

                {/* Only show text & chevron if sidebar open */}
                {open && (
                  <>
                    <span>Notifications</span>
                    <div className="ml-auto flex items-center gap-1">
                      {notifications.some((n) => n.status === "unread") && (
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
                      )}
                      {notifOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </>
                )}
              </div>

              {/* Notifications dropdown */}
              <AnimatePresence>
                {notifOpen && open && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute left-0 top-full mt-2 w-64 max-h-64 overflow-y-auto bg-white dark:bg-neutral-900 shadow-lg rounded-md z-50"
                  >
                    {notifications.length === 0 ? (
                      <p className="text-xs text-gray-500 p-2">No notifications</p>
                    ) : (
                      notifications.map((notif) => (
                        <div
                          key={notif._id}
                          className={cn(
                            "p-1 mb-1 rounded text-xs leading-snug",
                            notif.status === "unread"
                              ? "bg-green-50 dark:bg-green-900/20"
                              : "bg-neutral-100 dark:bg-neutral-700"
                          )}
                        >
                          <div className="flex justify-between items-start">
                            <span className="block">{notif.message}</span>
                            {notif.status === "unread" && (
                              <button
                                onClick={() => markAsRead(notif._id)}
                                className="text-[10px] text-blue-500 hover:underline ml-2"
                              >
                                Mark
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    {notifications.length > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-xs text-blue-500 hover:underline p-1 w-full text-left"
                      >
                        Mark all as read
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Bottom Section (Profile/Login) */}
        <div className="p-4">
          {user ? (
            <div className="flex items-center gap-3 relative">
              <img
                src={user.picture || "/default-avatar.png"}
                className="h-10 w-10 rounded-full border cursor-pointer"
                alt="profile"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              />
              {open && (
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{user.name}</span>
                  <span className="text-xs text-gray-500">{user.role}</span>
                </div>
              )}

              {/* Profile dropdown */}
              <AnimatePresence>
                {dropdownOpen && open && (
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
      <div className="flex-1 overflow-y-auto relative">
        <AuroraBackground className="absolute inset-0 -z-10" />
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}
