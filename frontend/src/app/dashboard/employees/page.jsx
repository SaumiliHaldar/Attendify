"use client";

import React from "react";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";
import { API_URL } from "@/lib/api";

export default function Employees() {
  return (
    <AuroraBackground>
      <div className="min-h-screen p-8">
        <h2 className="text-3xl font-semibold mb-6">Employee Management</h2>

        <Card className="max-w-3xl">
          <CardHeader className="flex items-center gap-2">
            <Users className="w-6 h-6 text-green-500" />
            <CardTitle>Employees</CardTitle>
          </CardHeader>

          <CardContent>
            <p className="text-gray-500 mb-2">
              Manage, view, and add employees in the system.
            </p>

            <p className="text-sm text-gray-400">
              API Endpoint: <code>{`${API_URL}/employees`}</code>
            </p>
          </CardContent>
        </Card>
      </div>
    </AuroraBackground>
  );
}
