"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, ClipboardList, CalendarCheck } from "lucide-react";

export default function AdminDashboard() {
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold">Admin Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Employee Management */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Users className="w-6 h-6 text-green-500" />
            <CardTitle>Manage Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500">
              Add, view, and edit employee records.
            </p>
            <a
              href="/dashboard/employees"
              className="text-blue-600 hover:underline text-sm"
            >
              Go to Employee Management →
            </a>
          </CardContent>
        </Card>

        {/* Attendance */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-blue-500" />
            <CardTitle>Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500">
              Verify or update attendance records.
            </p>
            <a
              href="/dashboard/admin/attendance"
              className="text-blue-600 hover:underline text-sm"
            >
              View Attendance →
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
