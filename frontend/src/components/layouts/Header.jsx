"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Navbar,
  NavBody,
  MobileNav,
  NavbarLogo,
  NavbarButton,
  MobileNavHeader,
  MobileNavToggle,
  MobileNavMenu,
} from "@/components/ui/resizable-navbar";
import { Bell } from "lucide-react";

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);

  const dropdownRef = useRef(null);
  const notifRef = useRef(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  // Detect superadmin
  const isSuperadmin =
    user?.is_admin === true && (user?.manager_id === undefined || user?.manager_id === null);

  // Fetch user after mount
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          method: "GET",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });

        if (res.ok) {
          const data = await res.json();
          setUser(data);
          localStorage.setItem("user", JSON.stringify(data));
        } else {
          setUser(null);
          localStorage.removeItem("user");
        }
      } catch (err) {
        console.error("Failed to fetch user:", err);
        setUser(null);
      }
    }

    if (typeof window !== "undefined") fetchUser();
  }, []);

  // Close dropdown / notif popups
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch notifications
  useEffect(() => {
    if (notifOpen && isSuperadmin) {
      fetch(`${API_URL}/notifications`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => setNotifications(data))
        .catch((err) => console.error("Error fetching notifications:", err));
    }
  }, [notifOpen, user]);

  // WebSocket realtime notifications
  useEffect(() => {
    if (isSuperadmin) {
      let wsUrl = API_URL;

      wsUrl = wsUrl.startsWith("https")
        ? wsUrl.replace("https", "wss")
        : wsUrl.replace("http", "ws");

      wsUrl += "/notifications/ws";

      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const notif = JSON.parse(event.data);
          setNotifications((prev) => [notif, ...prev]);
        } catch (e) {
          console.error("Invalid WS message:", e);
        }
      };

      ws.onerror = (err) => console.error("WebSocket error:", err);

      return () => ws.close();
    }
  }, [user]);

  // Mark one notification as read
  const markAsRead = async (id) => {
    try {
      await fetch(`${API_URL}/notifications/read/${id}`, {
        method: "POST",
        credentials: "include",
      });

      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, status: "read" } : n))
      );
    } catch (e) {
      console.error("Error marking as read:", e);
    }
  };

  // Mark all notifications
  const markAllAsRead = async () => {
    try {
      await fetch(`${API_URL}/notifications/read-all`, {
        method: "POST",
        credentials: "include",
      });

      setNotifications((prev) => prev.map((n) => ({ ...n, status: "read" })));
    } catch (e) {
      console.error("Error marking all as read:", e);
    }
  };

  // Logout
  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}

    localStorage.removeItem("user");
    setUser(null);
    window.location.href = "/";
  };

  return (
    <div className="relative w-full">
      <Navbar className="fixed top-0 z-50">
        <NavBody>
          <NavbarLogo />

          <div className="flex items-center gap-4 relative">
            {/* Superadmin Notification Bell */}
            {isSuperadmin && (
              <div ref={notifRef} className="relative">
                <Bell
                  className="w-6 h-6 cursor-pointer text-gray-600 dark:text-gray-300"
                  onClick={() => setNotifOpen(!notifOpen)}
                />

                {notifications.some((n) => n.status === "unread") && !notifOpen && (
                  <span className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full animate-ping" />
                )}

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white dark:bg-neutral-900 shadow-lg rounded-xl p-4 z-50">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold">Notifications</p>

                      {notifications.length > 0 && (
                        <button
                          onClick={markAllAsRead}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>

                    {notifications.length === 0 ? (
                      <p className="text-sm text-gray-500">No new notifications</p>
                    ) : (
                      <ul className="space-y-3">
                        {notifications.map((notif) => (
                          <li
                            key={notif._id}
                            className={`p-2 rounded-md ${
                              notif.status === "unread"
                                ? "bg-green-50 dark:bg-green-900/20"
                                : "bg-neutral-50 dark:bg-neutral-800"
                            }`}
                          >
                            <p className="text-sm">{notif.message}</p>

                            <div className="flex justify-between items-center mt-1">
                              <span className="text-xs text-gray-500">
                                {notif.timestamp}
                              </span>

                              {notif.status === "unread" && (
                                <button
                                  onClick={() => markAsRead(notif._id)}
                                  className="text-xs text-blue-500 hover:underline"
                                >
                                  Mark as read
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* User Profile */}
            {user ? (
              <div ref={dropdownRef} className="relative">
                <img
                  src={user.picture || "/default-avatar.png"}
                  alt="profile"
                  className="w-10 h-10 rounded-full border cursor-pointer"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                />

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-neutral-900 shadow-lg rounded-xl p-4 z-50">
                    <div className="flex items-center gap-3 mb-4">
                      <img
                        src={user.picture || "/default-avatar.png"}
                        alt="profile"
                        className="w-12 h-12 rounded-full border"
                      />
                      <div>
                        <p className="font-semibold">{user.name || user.email}</p>
                        <p className="text-sm text-neutral-500">
                          {isSuperadmin
                            ? "Superadmin"
                            : user.is_admin
                            ? "Admin"
                            : "Employee"}
                        </p>
                      </div>
                    </div>

                    <a
                      href="/profile"
                      className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200"
                    >
                      Manage Profile
                    </a>

                    <a
                      href="/dashboard"
                      className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 mt-2"
                    >
                      Dashboard
                    </a>

                    <button
                      onClick={handleLogout}
                      className="w-full py-2 rounded-md bg-red-500 text-white hover:bg-red-600 mt-3"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <NavbarButton variant="dark" href={`${API_URL}/auth/google`}>
                Login
              </NavbarButton>
            )}
          </div>
        </NavBody>

        {/* MOBILE NAV */}
        <MobileNav>
          <MobileNavHeader>
            <NavbarLogo />
            <MobileNavToggle
              isOpen={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            />
          </MobileNavHeader>

          <MobileNavMenu
            isOpen={isMobileMenuOpen}
            onClose={() => setIsMobileMenuOpen(false)}
          >
            <div className="flex w-full flex-col gap-4">
              {user ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={user.picture || "/default-avatar.png"}
                        alt="profile"
                        className="w-12 h-12 rounded-full border"
                      />
                      <div>
                        <p className="font-semibold">{user.name || user.email}</p>
                        <p className="text-sm text-neutral-500">
                          {isSuperadmin
                            ? "Superadmin"
                            : user.is_admin
                            ? "Admin"
                            : "Employee"}
                        </p>
                      </div>
                    </div>

                    {isSuperadmin && (
                      <div ref={notifRef} className="relative">
                        <Bell
                          className="w-6 h-6 cursor-pointer text-gray-600 dark:text-gray-300"
                          onClick={() => setNotifOpen(!notifOpen)}
                        />

                        {notifications.some((n) => n.status === "unread") &&
                          !notifOpen && (
                            <span className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full animate-ping" />
                          )}

                        {notifOpen && (
                          <div className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto bg-white dark:bg-neutral-900 shadow-lg rounded-xl p-4 z-50">
                            <div className="flex items-center justify-between mb-2">
                              <p className="font-semibold">Notifications</p>
                              {notifications.length > 0 && (
                                <button
                                  onClick={markAllAsRead}
                                  className="text-xs text-blue-500 hover:underline"
                                >
                                  Mark all as read
                                </button>
                              )}
                            </div>

                            {notifications.length === 0 ? (
                              <p className="text-sm text-gray-500">
                                No new notifications
                              </p>
                            ) : (
                              <ul className="space-y-3">
                                {notifications.map((notif) => (
                                  <li
                                    key={notif._id}
                                    className={`p-2 rounded-md ${
                                      notif.status === "unread"
                                        ? "bg-green-50 dark:bg-green-900/20"
                                        : "bg-neutral-50 dark:bg-neutral-800"
                                    }`}
                                  >
                                    <p className="text-sm">{notif.message}</p>

                                    <div className="flex justify-between items-center mt-1">
                                      <span className="text-xs text-gray-500">
                                        {notif.timestamp}
                                      </span>

                                      {notif.status === "unread" && (
                                        <button
                                          onClick={() => markAsRead(notif._id)}
                                          className="text-xs text-blue-500 hover:underline"
                                        >
                                          Mark as read
                                        </button>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <a
                    href="/profile"
                    className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200"
                  >
                    Manage Profile
                  </a>

                  <a
                    href="/dashboard"
                    className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 mt-2"
                  >
                    Dashboard
                  </a>

                  <button
                    onClick={handleLogout}
                    className="w-full py-2 rounded-md bg-red-500 text-white hover:bg-red-600 mt-3"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <NavbarButton
                  onClick={() => setIsMobileMenuOpen(false)}
                  variant="primary"
                  className="w-full"
                  href={`${API_URL}/auth/google`}
                >
                  Login
                </NavbarButton>
              )}
            </div>
          </MobileNavMenu>
        </MobileNav>
      </Navbar>
    </div>
  );
}
