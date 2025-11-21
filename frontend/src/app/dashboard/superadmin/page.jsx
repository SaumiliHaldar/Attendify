"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Building2, Shield, Database, Users } from "lucide-react";

export default function SuperadminDashboard() {
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold">Superadmin Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Organization Management */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-red-500" />
            <CardTitle>Organization Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500">
              Manage branches, departments, and overall attendance data.
            </p>
            <a
              href="/dashboard/superadmin/organization"
              className="text-blue-600 hover:underline text-sm"
            >
              Manage Organization →
            </a>
          </CardContent>
        </Card>

        {/* Admin Management */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-500" />
            <CardTitle>Admin Management</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500">
              Add, remove, or modify admin roles and privileges.
            </p>
            <a
              href="/dashboard/superadmin/admins"
              className="text-blue-600 hover:underline text-sm"
            >
              Manage Admins →
            </a>
          </CardContent>
        </Card>

        {/* System Logs */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Database className="w-6 h-6 text-green-500" />
            <CardTitle>System Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500">
              View logs of all admin actions and backend activity.
            </p>
            <a
              href="/dashboard/superadmin/logs"
              className="text-blue-600 hover:underline text-sm"
            >
              View Logs →
            </a>
          </CardContent>
        </Card>

        {/* Employees Summary (shared with admin) */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-500" />
            <CardTitle>Employee Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500">
              Monitor all employees across departments.
            </p>
            <a
              href="/dashboard/employees"
              className="text-blue-600 hover:underline text-sm"
            >
              View Employees →
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
