"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, User, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { NavbarButton } from "@/components/ui/resizable-navbar";

export default function SidebarLayout({ children }) {
  const [open, setOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const notifRef = useRef(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) setUser(JSON.parse(saved));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("user");
    setUser(null);
    setDropdownOpen(false);
    window.location.href = "/";
  };

  return (
    <div className="flex h-screen w-full">
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
          {open ? (
            <ChevronLeft
              size={16}
              className="text-neutral-700 dark:text-neutral-200"
            />
          ) : (
            <ChevronRight
              size={16}
              className="text-neutral-700 dark:text-neutral-200"
            />
          )}
        </button>

        {/* Top */}
        <div>
          {/* Logo */}
          <div className="flex items-center gap-2 p-4">
            <img
              src="https://assets.aceternity.com/logo-dark.png"
              alt="logo"
              width={30}
              height={30}
            />
            {open && <span className="font-semibold">Attendify</span>}
          </div>

          {/* Notifications */}
          {user?.role === "superadmin" && (
            <div className="px-2 mt-6">
              {/* Bell Button */}
              <div
                className={cn(
                  "flex items-center p-2 rounded cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-800",
                  open ? "justify-start gap-2" : "justify-center"
                )}
                onClick={() => setNotifOpen(!notifOpen)}
              >
                <Bell size={20} />
                {open && <span>Notifications</span>}
              </div>

              {/* Dropdown inside sidebar */}
              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="ml-2 mt-2 overflow-hidden"
                  >
                    {notifications.length === 0 ? (
                      <p className="text-xs text-gray-500 px-2">
                        No notifications
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {notifications.map((notif) => (
                          <li
                            key={notif._id}
                            className="text-sm p-2 rounded bg-neutral-100 dark:bg-neutral-700"
                          >
                            {notif.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Bottom (Profile/Login) */}
        <div className="p-4">
          {user ? (
            <div className="flex items-center gap-3">
              <img
                src={user.picture || "/default-avatar.png"}
                className="h-10 w-10 rounded-full border cursor-pointer"
                alt="profile"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              />
              {/* Show details only when sidebar is expanded */}
              {open && (
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{user.name}</span>
                  <span className="text-xs text-gray-500">{user.role}</span>
                </div>
              )}

              {/* Dropdown for Manage Profile + Logout */}
              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
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

      {/* Main content with Aurora background */}
      <div className="flex-1 overflow-y-auto relative">
        <AuroraBackground className="absolute inset-0 -z-10" />
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}
