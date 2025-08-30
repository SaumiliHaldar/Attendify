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
import { motion } from "framer-motion";

export default function Header() {
  const navItems = [
    { name: "Home", link: "/" },
    { name: "About", link: "#about" },
    { name: "Contact", link: "#contact" },
  ];

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Parse query params or load from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const email = params.get("email");
      const name = params.get("name");
      const picture = params.get("picture");
      const role = params.get("role");

      if (email) {
        setUser({ email, name, picture, role });
        localStorage.setItem(
          "user",
          JSON.stringify({ email, name, picture, role })
        );
      } else {
        const saved = localStorage.getItem("user");
        if (saved) setUser(JSON.parse(saved));
      }
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Logout function
  const handleLogout = () => {
    localStorage.removeItem("user");
    setUser(null);
    setDropdownOpen(false);
    window.location.href = "/"; // redirect to home after logout
  };

  return (
    <>
      <div className="relative w-full">
        <Navbar className="fixed top-0 z-50">
          {/* Desktop Navigation */}
          <NavBody>
            <NavbarLogo />
            <NavItems items={navItems} />
            <div className="flex items-center gap-4 relative">
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
                          <p className="text-sm text-neutral-500">
                            {user.role || "User"}
                          </p>
                        </div>
                      </div>
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
                <NavbarButton
                  variant="dark"
                  href={`${process.env.NEXT_PUBLIC_API_URL}/auth/google`}
                >
                  Login
                </NavbarButton>
              )}
              {/* <NavbarButton variant="primary">Book a call</NavbarButton> */}
            </div>
          </NavBody>

          {/* Mobile Navigation (unchanged except avatar section) */}
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
              {navItems.map((item, idx) => (
                <a
                  key={`mobile-link-${idx}`}
                  href={item.link}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="relative text-neutral-600 dark:text-neutral-300"
                >
                  <span className="block">{item.name}</span>
                </a>
              ))}
              <div className="flex w-full flex-col gap-4">
                {user ? (
                  <div className="flex items-center gap-2">
                    <img
                      src={user.picture || "/default-avatar.png"}
                      alt="profile"
                      className="w-10 h-10 rounded-full border border-gray-300"
                    />
                    <span className="text-neutral-200">{user.email}</span>
                  </div>
                ) : (
                  <NavbarButton
                    onClick={() => setIsMobileMenuOpen(false)}
                    variant="primary"
                    className="w-full"
                    href={`${process.env.NEXT_PUBLIC_API_URL}/auth/google`}
                  >
                    Login
                  </NavbarButton>
                )}
                {/* <NavbarButton
                  onClick={() => setIsMobileMenuOpen(false)}
                  variant="primary"
                  className="w-full"
                >
                  Book a call
                </NavbarButton> */}
              </div>
            </MobileNavMenu>
          </MobileNav>
        </Navbar>
      </div>

    </>
  );
}
