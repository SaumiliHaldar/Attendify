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

export default function Header() {
  const navItems = [
    { name: "Home", link: "/" },
    { name: "About", link: "#about" },
    { name: "Contact", link: "#contact" },
  ];

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const dropdownRef = useRef(null);
  const notifRef = useRef(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  // --------------------------------------------
  // SECURE LOGIN — Get user from /auth/me
  // --------------------------------------------
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("user");
      if (saved) setUser(JSON.parse(saved));

      const sessionId = localStorage.getItem("session_id");

      if (sessionId) {
        fetch(`${API_URL}/auth/me`, {
          headers: {
            Authorization: `Bearer ${sessionId}`,
          },
        })
          .then((res) => {
            if (!res.ok) throw new Error();
            return res.json();
          })
          .then((data) => {
            setUser(data);
            localStorage.setItem("user", JSON.stringify(data));
          })
          .catch(() => {
            localStorage.removeItem("session_id");
            localStorage.removeItem("user");
          });
      }
    }
  }, []);

  // Close dropdowns on outside click
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

  // Fetch notifications on open
  useEffect(() => {
    if (notifOpen && user?.role === "superadmin") {
      fetch(`${API_URL}/notifications`)
        .then((res) => res.json())
        .then((data) => setNotifications(data))
        .catch((err) => console.error("Error fetching notifications:", err));
    }
  }, [notifOpen, user]);

  // WebSocket Live Notifications
  useEffect(() => {
    if (user?.role === "superadmin") {
      let wsUrl =
        API_URL.startsWith("https")
          ? API_URL.replace("https", "wss") + "/notifications/ws"
          : API_URL.replace("http", "ws") + "/notifications/ws";

      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const notif = JSON.parse(event.data);
          setNotifications((prev) => [notif, ...prev]);
        } catch (err) {
          console.error("Invalid WS message:", err);
        }
      };

      ws.onerror = (err) => console.error("WS error:", err);

      return () => ws.close();
    }
  }, [user]);

  // Mark a notification as read
  const markAsRead = async (id) => {
    try {
      await fetch(`${API_URL}/notifications/read/${id}`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, status: "read" } : n))
      );
    } catch (e) {
      console.error("Error marking read:", e);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      await fetch(`${API_URL}/notifications/read-all`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, status: "read" }))
      );
    } catch (e) {
      console.error("Error marking all read:", e);
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("session_id");
    setUser(null);
    setDropdownOpen(false);
    window.location.href = "/";
  };

  return (
    <div className="relative w-full">
      <Navbar className="fixed top-0 z-50">
        <NavBody>
          <NavbarLogo />

          {/* Right side */}
          <div className="flex items-center gap-4 relative">
            {/* Notification Bell */}
            {user?.role === "superadmin" && (
              <div ref={notifRef} className="relative">
                <Bell
                  className="w-6 h-6 cursor-pointer text-gray-600 dark:text-gray-300"
                  onClick={() => setNotifOpen(!notifOpen)}
                />
                {notifications.some((n) => n.status === "unread") && !notifOpen && (
                  <span className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full animate-ping" />
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
              </div>
            ) : (
              <NavbarButton variant="dark" href={`${API_URL}/auth/google`}>
                Login
              </NavbarButton>
            )}
          </div>
        </NavBody>
      </Navbar>
    </div>
  );
}
