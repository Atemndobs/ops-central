"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDayLabel } from "./format";

export type DailyTrafficPoint = {
  dayStart: number;
  successCount: number;
  errorCount: number;
};

export function DailyTrafficChart({
  data,
  height = 260,
}: {
  data: DailyTrafficPoint[];
  height?: number;
}) {
  const chartData = data.map((point) => ({
    day: formatDayLabel(point.dayStart),
    dayStart: point.dayStart,
    Success: point.successCount,
    Errors: point.errorCount,
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelFormatter={(_, payload) => {
              const row = payload?.[0]?.payload as
                | { dayStart?: number }
                | undefined;
              if (!row?.dayStart) return "";
              return new Date(row.dayStart).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
          />
          <Bar dataKey="Success" stackId="a" fill="#10b981" />
          <Bar dataKey="Errors" stackId="a" fill="#ef4444" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
