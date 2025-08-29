"use client";

import React, { useState, useEffect, useRef } from "react";
import { Spotlight } from "../ui/spotlight-new";
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

export default function Header() {
  const navItems = [
    { name: "Features", link: "#features" },
    { name: "Pricing", link: "#pricing" },
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
        localStorage.setItem("user", JSON.stringify({ email, name, picture, role }));
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
        <Navbar className ="fixed top-0 z-50">
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
                  variant="secondary"
                  href={`${process.env.NEXT_PUBLIC_API_URL}/auth/google`}
                >
                  Login
                </NavbarButton>
              )}
              <NavbarButton variant="primary">Book a call</NavbarButton>
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
                <NavbarButton
                  onClick={() => setIsMobileMenuOpen(false)}
                  variant="primary"
                  className="w-full"
                >
                  Book a call
                </NavbarButton>
              </div>
            </MobileNavMenu>
          </MobileNav>
        </Navbar>
      </div>

      {/* Spotlight section */}
      <div className="h-[40rem] w-full flex md:items-center md:justify-center bg-black/[0.96] antialiased bg-grid-white/[0.02] relative overflow-hidden">
        <Spotlight />
        <div className=" p-4 max-w-7xl  mx-auto relative z-10  w-full pt-20 md:pt-0">
          <h1 className="text-4xl md:text-7xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400 bg-opacity-50">
            Spotlight <br /> which is not overused.
          </h1>
          <p className="mt-4 font-normal text-base text-neutral-300 max-w-lg text-center mx-auto">
            A subtle yet effective spotlight effect, because the previous
            version is used a bit too much these days.
          </p>
        </div>
      </div>
      
    </>
  );
}
