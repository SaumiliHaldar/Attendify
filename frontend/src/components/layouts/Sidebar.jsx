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
import { NavbarButton } from "@/components/ui/resizable-navbar";
import { getNotificationsService, NotificationsService } from "@/lib/notifications";


export default function Sidebar({
  user,
  setUser,
  notifications,
  setNotifications,
  API_URL,
}) {

  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("sidebar-open");

    // First time user
    if (!saved) {
      // collapse automatically if screen width < 768px
      return window.innerWidth >= 768;
    }

    return saved === "true";
  });
  const [notifOpen, setNotifOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const sidebarRef = useRef(null);
  const notifRef = useRef(null);
  const profileRef = useRef(null);

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

  // Close dropdowns on outside click
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

  // WebSocket: Real-time notifications
  useEffect(() => {
    if (!user) return;
    if (user.role !== "superadmin") return;

    let ws;
    let heartbeat;

    const connectWS = () => {
      const wsUrl = API_URL.startsWith("https")
        ? API_URL.replace("https", "wss") + `/notifications/ws?email=${user.email}`
        : API_URL.replace("http", "ws") + `/notifications/ws?email=${user.email}`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(" WebSocket connected");
        heartbeat = setInterval(() => {
          ws.send(JSON.stringify({ type: "ping" }));
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Expecting notif object returned from API
          setNotifications((prev) => [data, ...prev]);
        } catch (e) {
          console.error("WS parse error:", e);
        }
      };

      ws.onerror = () => {
        console.warn(" WS error — reconnecting in 3s");
        ws.close();
      };

      ws.onclose = () => {
        clearInterval(heartbeat);
        console.warn(" WS closed — reconnecting in 3s");
        setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      if (ws) ws.close();
      clearInterval(heartbeat);
    };
  }, [user, API_URL, setNotifications]);

  // Auto toggle sidebar based on screen size
  useEffect(() => {
    const handleResize = () => {
      const shouldBeOpen = window.innerWidth >= 768;
      setOpen(shouldBeOpen);
      localStorage.setItem("sidebar-open", shouldBeOpen);
    };

    handleResize(); // Run on load
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);


  return (
    <motion.div
      ref={sidebarRef}
      animate={{ width: open ? 240 : 72 }}
      className={cn(
        "relative bg-neutral-100 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-700 flex flex-col justify-between transition-all duration-300"
      )}
    >
      {/* Toggle Button */}
      <button
        onClick={() => {
          const newState = !open;
          setOpen(newState);
          localStorage.setItem("sidebar-open", newState);
        }}

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

        {/* Notifications (Superadmin only) */}
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
                    {notifOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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
                    !open && "left-full ml-2 w-64"
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

                  {notifications.length === 0 ? (
                    <p className="text-sm text-gray-500 p-2">No notifications</p>
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
                            {notif.formattedTime}
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
  );
}
