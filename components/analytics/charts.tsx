'use client';

import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils/helpers';

/**
 * Graphiques de la page Analytics, isolés dans leur propre module.
 *
 * POURQUOI CE FICHIER : `recharts` pèse ~120 ko et était importé directement
 * par la page, donc téléchargé avant même le premier affichage. En le
 * séparant ici, la page peut le charger à la demande (voir le `dynamic()`
 * côté page) : le squelette et les indicateurs s'affichent tout de suite, les
 * courbes arrivent juste après.
 *
 * Sur une connexion mobile malienne, cette différence est très visible : on
 * voit son chiffre d'affaires immédiatement au lieu d'attendre une page
 * blanche le temps du téléchargement.
 */

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#4f46e5'];

const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm min-w-[160px]">
      <p className="font-semibold text-gray-800 mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-gray-600">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-bold text-gray-900">
            {p.value > 999 ? formatCurrency(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const shortNumber = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v);

export interface MonthlyPoint { month: string; ca: number; marge: number; ventes: number }
export interface WeeklyPoint { day: string; ca: number; ventes: number }
export interface PaymentSlice { name: string; value: number }

export function RevenueChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <defs>
          <linearGradient id="colorCA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorMarge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#16a34a" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={shortNumber} />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="circle" iconSize={10} />
        <Area type="monotone" dataKey="ca" name="CA" stroke="#2563eb" strokeWidth={2.5} fill="url(#colorCA)" />
        <Area type="monotone" dataKey="marge" name="Marge" stroke="#16a34a" strokeWidth={2.5} fill="url(#colorMarge)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function WeeklyChart({ data }: { data: WeeklyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={shortNumber} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="ca" name="CA" fill="#2563eb" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PaymentChart({ data }: { data: PaymentSlice[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Aucune donnée</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Legend
          iconType="circle" iconSize={10}
          formatter={v => <span className="text-sm text-gray-700">{v}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function VolumeChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone" dataKey="ventes" name="Ventes" stroke="#7c3aed" strokeWidth={2.5}
          dot={{ fill: '#7c3aed', r: 4 }} activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
