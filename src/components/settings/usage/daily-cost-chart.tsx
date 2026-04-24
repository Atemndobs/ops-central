"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDayLabel, formatUsd } from "./format";

export type DailyCostPoint = {
  dayStart: number;
  totalCostUsd: number;
};

export function DailyCostChart({
  data,
  height = 220,
}: {
  data: DailyCostPoint[];
  height?: number;
}) {
  const chartData = data.map((point) => ({
    day: formatDayLabel(point.dayStart),
    dayStart: point.dayStart,
    cost: Number(point.totalCostUsd.toFixed(4)),
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart
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
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            width={48}
            tickFormatter={(v: number) => formatUsd(v)}
          />
          <Tooltip
            formatter={(value: number) => formatUsd(value, { precise: true })}
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
          <Line
            type="monotone"
            dataKey="cost"
            stroke="var(--primary, #3b82f6)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
