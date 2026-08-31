'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { SUBSCRIPTION_PLANS } from '@/lib/constants';
import { PLAN_ORDER, CUSTOM_PRICING_PLANS } from '@/lib/utils/plan-display';
import { formatCurrency } from '@/lib/utils/helpers';

/**
 * Coût cumulé réel des forfaits Kafora à prix fixe sur 5 ans — calculé
 * directement depuis SUBSCRIPTION_PLANS (même source que la page Tarifs et
 * l'assistant d'inscription), aucun chiffre recopié à la main. Pas de
 * comparaison à un concurrent ou à une estimation de "coût sans logiciel" :
 * on n'a aucune donnée fiable là-dessus, mieux vaut ne rien avancer que
 * d'inventer un chiffre présenté comme un fait.
 *
 * Enterprise (CUSTOM_PRICING_PLANS) est exclu : "Sur devis" n'a pas de
 * montant fixe à projeter sur 5 ans, et l'afficher comme les autres
 * laisserait croire à un prix catalogue qui n'existe plus.
 */
const CHART_PLAN_ORDER = PLAN_ORDER.filter((id) => !CUSTOM_PRICING_PLANS.includes(id));

const PLAN_COLORS: Record<string, string> = {
  STARTER: '#2563eb',
  BUSINESS: '#16a34a',
  ENTERPRISE: '#d97706',
};

const shortFcfa = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v);

interface YearPoint { year: string; [planName: string]: string | number }

function buildCostData(): YearPoint[] {
  return [1, 2, 3, 4, 5].map((year) => {
    const point: YearPoint = { year: `An ${year}` };
    for (const planId of CHART_PLAN_ORDER) {
      const plan = SUBSCRIPTION_PLANS[planId];
      point[plan.name] = plan.price * 12 * year;
    }
    return point;
  });
}

const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm min-w-[180px]">
      <p className="font-semibold text-gray-800 mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-gray-600">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-bold text-gray-900">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export function CostComparisonChart() {
  const data = buildCostData();

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={shortFcfa} />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="circle" iconSize={10} />
        {CHART_PLAN_ORDER.map((planId) => (
          <Line
            key={planId}
            type="monotone"
            dataKey={SUBSCRIPTION_PLANS[planId].name}
            stroke={PLAN_COLORS[planId]}
            strokeWidth={2.5}
            dot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
