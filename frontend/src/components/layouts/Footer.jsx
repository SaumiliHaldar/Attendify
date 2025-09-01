"use client";

import React from "react";
import { Copyright } from "lucide-react";

export default function Footer() {
  return (
    <footer className="w-full bg-gray-50 dark:bg-gray-900 py-6 mt-auto">
      <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left side */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400 justify-center">
          <Copyright className="w-4 h-4" />
          <span>2025</span>
          <a href="/" className="text-blue-500 hover:underline">
            Attendify
          </a>{" "}
          Built by Saumili Haldar. All Rights Reserved.
        </div>

        {/* Right side (optional links) */}
        {/* <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <a href="/" className="hover:underline">Home</a>
          <a href="#" className="hover:underline">About</a>
          <a href="#" className="hover:underline">Contact</a>
        </div> */}
      </div>
    </footer>
  );
}
