"use client";

import React from "react";
import { Copyright } from "lucide-react";

export default function Footer() {
  return (
    <footer className="w-full bg-gray-50 dark:bg-gray-900 py-6 mt-auto">
      <div className="max-w-7xl mx-auto px-4 flex flex-col items-center justify-center text-center gap-4">
        
        {/* Centered Content */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Copyright className="w-4 h-4" />
          <span>2025</span>
          <a href="/" className="text-blue-500 hover:underline">
            Attendify
          </a>
          Built by Saumili Haldar. All Rights Reserved.
        </div>

      </div>
    </footer>
  );
}
