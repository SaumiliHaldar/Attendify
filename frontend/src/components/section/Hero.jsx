"use client";

import React, { useEffect, useState } from "react";
import { AuroraBackground } from "../ui/aurora-background";
import { motion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Calendar } from "../ui/calendar";
import { CalendarDays, Users, CalendarCheck, Calendar1 } from "lucide-react";
import { LoaderFive } from "../ui/loader";

// helper to parse dd-mm-yyyy into Date object
function parseDate(str) {
  const [day, month, year] = str.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function Hero() {
  const [data, setData] = useState(null);
  const [holidayDates, setHolidayDates] = useState([]);
  const [sundays, setSundays] = useState([]);
  const [today, setToday] = useState(new Date());

  useEffect(() => {
    fetch("https://attendify-tv8w.onrender.com")
      .then((res) => res.json())
      .then((json) => {
        setData(json);

        // Parse holidays
        if (json.holidays) {
          const parsedHolidays = json.holidays.map((h) => parseDate(h.date));
          setHolidayDates(parsedHolidays);
        }

        // Parse Sundays
        if (json.sundays) {
          const parsedSundays = json.sundays.map((d) => parseDate(d));
          setSundays(parsedSundays);
        }

        // Parse today
        if (json.today) {
          const todayStr = json.today.split(" ")[0];
          setToday(parseDate(todayStr));
        }
      });
  }, []);

  return (
    <AuroraBackground className="h-full flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.8, ease: "easeInOut" }}
        className="relative flex flex-col gap-8 items-center justify-center px-4 py-8"
      >
        {/* Heading */}
        <div className="text-3xl md:text-6xl mt-20 font-bold dark:text-white text-center">
          South Eastern Railways <br /> Electrical Department, Kharagpur
        </div>
        <div className="font-extralight text-base md:text-2xl dark:text-neutral-200">
          An eMuster Platform
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-6xl">
          {/* Left column */}
          <div className="flex flex-col gap-6 h-full">
            <Card>
              <CardHeader className="flex items-center gap-2">
                <CalendarDays className="w-6 h-6 text-blue-500" />
                <CardTitle>Holidays of the Month</CardTitle>
              </CardHeader>
              <CardContent>
                {data ? (
                  data.holidays.length > 0 ? (
                    <ul className="space-y-1">
                      {data.holidays.map((h, i) => (
                        <li key={i}>
                          <span className="font-semibold">{h.date}</span> —{" "}
                          {h.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">
                      No holidays this month.
                    </p>
                  )
                ) : (
                  <LoaderFive text="Loading Data..." />
                )}
              </CardContent>
            </Card>

            <Card className="flex-1">
              <CardHeader className="flex items-center gap-2">
                <Users className="w-6 h-6 text-green-500" />
                <CardTitle>Yesterday's Attendance</CardTitle>
              </CardHeader>
              <CardContent>
                {data ? (
                  <>
                    <p>Date: {data.attendance_snapshot.yesterday.date}</p>
                    <p>
                      Present:{" "}
                      {data.attendance_snapshot.yesterday.present_count}
                    </p>
                    <p>
                      Marked: {data.attendance_snapshot.yesterday.total_marked}
                    </p>
                  </>
                ) : (
                  <LoaderFive text="Loading Data..." />
                )}
              </CardContent>
            </Card>

            <Card className="flex-1">
              <CardHeader className="flex items-center gap-2">
                <CalendarCheck className="w-6 h-6 text-purple-500" />
                <CardTitle>Weekly Average</CardTitle>
              </CardHeader>
              <CardContent>
                {data ? (
                  <>
                    <p>
                      Present:{" "}
                      {data.attendance_snapshot.weekly_avg.avg_present}
                    </p>
                    <p>
                      Marked:{" "}
                      {data.attendance_snapshot.weekly_avg.avg_total_marked}
                    </p>
                    <p>
                      Days Counted:{" "}
                      {data.attendance_snapshot.weekly_avg.days_counted}
                    </p>
                  </>
                ) : (
                  <LoaderFive text="Loading Data..." />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right column with calendar */}
          <Card className="h-full flex flex-col justify-center items-center">
            <CardHeader className="w-full">
              <CardTitle className="flex items-center gap-2 justify-start md:justify-center">
                <Calendar1 className="w-6 h-6 text-amber-500" />
                Calendar at a Glance
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col items-center justify-center">
              {data ? (
                <>
                  <Calendar
                    className="w-full max-w-lg"
                    modifiers={{
                      holiday: holidayDates,
                      sunday: sundays,
                      today: today,
                    }}
                    modifiersClassNames={{
                      holiday:
                        "bg-rose-200 text-rose-800 rounded-md font-semibold",
                      sunday:
                        "bg-amber-200 text-amber-800 rounded-md font-semibold",
                      today:
                        "bg-sky-200 text-sky-800 rounded-md font-semibold",
                    }}
                  />
                  <div className="flex gap-6 text-sm mt-6">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-md bg-amber-200 border border-amber-400"></span>
                      <span className="text-muted-foreground">Sunday</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-md bg-rose-200 border border-rose-400"></span>
                      <span className="text-muted-foreground">Holiday</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-md bg-sky-200 border border-sky-400"></span>
                      <span className="text-muted-foreground">Today</span>
                    </div>
                  </div>
                </>
              ) : (
                <LoaderFive text="Loading Calendar..." />
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </AuroraBackground>
  );
}
