"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Navbar,
  NavBody,
  NavItems,
  MobileNav,
  NavbarLogo,
  NavbarButton,
  MobileNavHeader,
  MobileNavToggle,
  MobileNavMenu,
} from "@/components/ui/resizable-navbar";
import { Bell } from "lucide-react";
import { getNotificationsService } from "@/lib/notifications";

export default function Header() {
  const navItems = [
    { name: "Home", link: "/" },
    { name: "About", link: "#about" },
    { name: "Contact", link: "#contact" },
  ];

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [desktopNotifOpen, setDesktopNotifOpen] = useState(false);
  const [mobileNotifOpen, setMobileNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const dropdownRef = useRef(null);
  const desktopNotifRef = useRef(null);
  const mobileNotifRef = useRef(null);
  const hasAttemptedFetch = useRef(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  // Get Notifications Service
  const notifService = getNotificationsService();

  // Fetch user from backend
  const fetchUser = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        localStorage.setItem("user", JSON.stringify(userData));
      } else {
        setUser(null);
        localStorage.removeItem("user");
      }
    } catch (err) {
      console.error("Failed to fetch user info:", err);
      setUser(null);
      localStorage.removeItem("user");
    }
  };

  
  // Format date & time
  const formatDateTime = (ts) => {
    if (!ts) return ""; // prevent crashes if missing
    const [date, time] = ts.split(" ");
    const [hours, mins] = time.split(":");

    let h = parseInt(hours, 10);
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;

    return `${date} ${h}:${mins} ${suffix}`;
  };


  // Load user on mount AND when window regains focus (after OAuth redirect)
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Try loading from localStorage first for instant UI
    const cachedUser = localStorage.getItem("user");
    if (cachedUser) {
      try {
        setUser(JSON.parse(cachedUser));
      } catch (e) {
        console.error("Failed to parse cached user:", e);
      }
    }

    // Always fetch fresh data from backend
    fetchUser();
    hasAttemptedFetch.current = true;

    // Re-fetch when user returns to tab (after OAuth)
    const handleFocus = () => {
      if (hasAttemptedFetch.current) fetchUser();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // Subscribe to notifications if user is superadmin
  useEffect(() => {
    if (!user || user.role !== "superadmin") return;

    // Fetch initial notifications
    notifService.fetch();

    // Subscribe to updates
    const unsubscribe = notifService.subscribe((data) => {
      setNotifications(data);
    });

    // Connect WebSocket
    notifService.connect(user.role);

    return () => {
      unsubscribe();
      notifService.disconnect();
    };
  }, [user]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (desktopNotifRef.current && !desktopNotifRef.current.contains(event.target)) {
        setDesktopNotifOpen(false);
      }
      if (mobileNotifRef.current && !mobileNotifRef.current.contains(event.target)) {
        setMobileNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAsRead = (id) => {
    notifService.markAsRead(id);
  };

  const markAllAsRead = () => {
    notifService.markAllAsRead();
  };

  const handleLogout = async () => {
    try {
      // Call backend logout endpoint
      await fetch(`${API_URL}/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (e) {
      console.error("Logout error:", e);
    } finally {
      localStorage.removeItem("user");
      setUser(null);
      setDropdownOpen(false);
      window.location.href = "/";
    }
  };

  return (
    <div className="relative w-full">
      <Navbar className="fixed top-0 z-50">
        {/* Desktop Navigation */}
        <NavBody>
          <NavbarLogo />
          <div className="flex items-center gap-4 relative">
            {/* Desktop Notification Bell */}
            {user?.role === "superadmin" && (
              <div ref={desktopNotifRef} className="relative">
                <Bell
                  className="w-6 h-6 cursor-pointer text-gray-600 dark:text-gray-300"
                  onClick={() => setDesktopNotifOpen(!desktopNotifOpen)}
                />
                {notifications.some((n) => n.status === "unread") && !desktopNotifOpen && (
                  <span className="absolute top-0 right-0 inline-block w-2 h-2 bg-green-500 rounded-full animate-ping" />
                )}
                {desktopNotifOpen && (
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
                            className={`p-2 rounded-md ${notif.status === "unread"
                              ? "bg-green-50 dark:bg-green-900/20"
                              : "bg-neutral-50 dark:bg-neutral-800"
                              }`}
                          >
                            <p className="text-sm">{notif.message}</p>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-xs text-gray-500">{formatDateTime(notif.timestamp)}</span>
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

            {/* Profile */}
            {user ? (
              <div ref={dropdownRef} className="relative">
                <img
                  src={user.picture || "/default-avatar.png"}
                  alt="profile"
                  className="w-10 h-10 rounded-full border border-gray-300 cursor-pointer"
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
                        <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                          {user.name || user.email}
                        </p>
                        <p className="text-sm text-neutral-500">{user.role || "User"}</p>
                      </div>
                    </div>
                    <a
                      href="/profile"
                      className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 mb-2"
                    >
                      Manage Profile
                    </a>
                    <a
                      href="/dashboard"
                      className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 mb-2"
                    >
                      Dashboard
                    </a>
                    <button
                      onClick={handleLogout}
                      className="w-full py-2 rounded-md bg-red-500 text-white hover:bg-red-600"
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

        {/* Mobile Navigation */}
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
                <div className="w-full">
                  {/* Profile section */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={user.picture || "/default-avatar.png"}
                        alt="profile"
                        className="w-12 h-12 rounded-full border"
                      />
                      <div>
                        <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                          {user.name || user.email}
                        </p>
                        <p className="text-sm text-neutral-500">{user.role || "User"}</p>
                      </div>
                    </div>

                    {/* Mobile Notification Bell */}
                    {user?.role === "superadmin" && (
                      <div ref={mobileNotifRef} className="relative">
                        <Bell
                          className="w-6 h-6 cursor-pointer text-gray-600 dark:text-gray-300"
                          onClick={() => setMobileNotifOpen(!mobileNotifOpen)}
                        />
                        {notifications.some((n) => n.status === "unread") && !mobileNotifOpen && (
                          <span className="absolute top-0 right-0 inline-block w-2 h-2 bg-green-500 rounded-full animate-ping" />
                        )}
                        {mobileNotifOpen && (
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
                              <p className="text-sm text-gray-500">No new notifications</p>
                            ) : (
                              <ul className="space-y-3">
                                {notifications.map((notif) => (
                                  <li
                                    key={notif._id}
                                    className={`p-2 rounded-md ${notif.status === "unread"
                                      ? "bg-green-50 dark:bg-green-900/20"
                                      : "bg-neutral-50 dark:bg-neutral-800"
                                      }`}
                                  >
                                    <p className="text-sm">{notif.message}</p>
                                    <div className="flex justify-between items-center mt-1">
                                      <span className="text-xs text-gray-500"> {formatDateTime(notif.timestamp)}</span>
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

                  {/* Actions */}
                  <a
                    href="/profile"
                    className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 mb-2"
                  >
                    Manage Profile
                  </a>
                  <a
                    href="/dashboard"
                    className="block w-full text-center py-2 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 mb-2"
                  >
                    Dashboard
                  </a>
                  <button
                    onClick={handleLogout}
                    className="w-full py-2 rounded-md bg-red-500 text-white hover:bg-red-600"
                  >
                    Logout
                  </button>
                </div>
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
