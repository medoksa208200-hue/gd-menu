// Fleet analytics computed from raw rows: consumption against each vehicle type's expectation, costs,
// service status and alerts. Pure functions (no I/O) so the workspace and the tests share one source of truth.

export const REPEAT_PART_DAYS = 90;
export const UNLOGGED_GAP_KM = 50;
export const SERVICE_CATEGORIES = ['oil_change','maintenance','spare_part','tires','battery'];

const DAY = 86400000;
const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// Part names are typed freely; fold common Arabic spelling variants so "فلتر زيت" and "فلتر  الزيت" still match.
export function normalizePart(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/(^|\s)ال/g, '$1').replace(/\s+/g, ' ');
}

// "high" = the vehicle burns more fuel than its type should (fewer km per litre than the tolerance allows).
export function verdict(kmPerLiter, type) {
  if (!type || !Number.isFinite(kmPerLiter) || kmPerLiter <= 0) return 'none';
  const expected = n(type.expected_km_per_liter), tol = n(type.tolerance_percent) / 100;
  if (kmPerLiter < expected * (1 - tol)) return 'high';
  if (kmPerLiter > expected * (1 + tol * 2)) return 'suspicious';
  return kmPerLiter > expected * (1 + tol) ? 'low' : 'normal';
}

export function inPeriod(date, period) {
  return (!period?.from || date >= period.from) && (!period?.to || date <= period.to);
}

export function analyzeFleet({ types = [], vehicles = [], fuel = [], expenses = [], period = {}, today }) {
  const now = today || new Date().toISOString().slice(0, 10);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const alerts = [];
  const rows = vehicles.map((v) => {
    const type = typeById.get(v.type_id);
    const fills = fuel.filter((f) => f.vehicle_id === v.id).sort((a, b) => n(a.odometer_start) - n(b.odometer_start) || (a.log_date < b.log_date ? -1 : 1));
    const costs = expenses.filter((e) => e.vehicle_id === v.id).sort((a, b) => (a.expense_date < b.expense_date ? -1 : a.expense_date > b.expense_date ? 1 : 0));
    const periodFills = fills.filter((f) => inPeriod(f.log_date, period));
    const periodCosts = costs.filter((e) => inPeriod(e.expense_date, period));
    const distance = periodFills.reduce((s, f) => s + n(f.odometer_end) - n(f.odometer_start), 0);
    const liters = periodFills.reduce((s, f) => s + n(f.liters), 0);
    const fuelCost = periodFills.reduce((s, f) => s + n(f.total_cost), 0);
    const otherCost = periodCosts.reduce((s, e) => s + n(e.amount), 0);
    const kmPerLiter = liters > 0 ? distance / liters : null;
    const odometer = Math.max(n(v.initial_odometer), ...fills.map((f) => n(f.odometer_end)), ...costs.map((e) => n(e.odometer)));
    const oil = [...costs].reverse().find((e) => e.category === 'oil_change');
    const kmSinceOil = oil ? odometer - n(oil.odometer) : null;
    const daysSinceOil = oil ? days(oil.expense_date, now) : null;
    const lastFill = fills[fills.length - 1] || null;
    const row = {
      vehicle: v, type, fills: periodFills.length, distance: round(distance, 1), liters: round(liters), fuelCost: round(fuelCost),
      otherCost: round(otherCost), totalCost: round(fuelCost + otherCost), kmPerLiter: round(kmPerLiter),
      expected: type ? n(type.expected_km_per_liter) : null,
      deviation: kmPerLiter && type ? round((kmPerLiter / n(type.expected_km_per_liter) - 1) * 100, 1) : null,
      verdict: verdict(kmPerLiter, type), costPerKm: distance > 0 ? round((fuelCost + otherCost) / distance) : null,
      odometer: round(odometer, 1), lastFill, lastOil: oil || null, kmSinceOil: round(kmSinceOil, 1), daysSinceOil, oilStatus: 'ok',
    };
    if (v.status === 'inactive') return row;
    const alert = (kind, severity, extra = {}) => alerts.push({ kind, severity, vehicle_id: v.id, plate: v.plate_number, ...extra });

    // Consumption: judge each fill in the period on its own, and report the latest one that is off.
    const offHigh = periodFills.filter((f) => verdict(n(f.km_per_liter), type) === 'high');
    if (offHigh.length) {
      const f = offHigh[offHigh.length - 1];
      const severe = n(f.km_per_liter) < row.expected * (1 - (2 * n(type.tolerance_percent)) / 100);
      alert('consumption_high', severe ? 'high' : 'medium', { date: f.log_date, km_per_liter: n(f.km_per_liter), expected: row.expected, count: offHigh.length, record_id: f.id });
    }
    const odd = periodFills.filter((f) => verdict(n(f.km_per_liter), type) === 'suspicious');
    if (odd.length) { const f = odd[odd.length - 1]; alert('consumption_suspicious', 'medium', { date: f.log_date, km_per_liter: n(f.km_per_liter), expected: row.expected, record_id: f.id }); }

    // Odometer continuity between consecutive fills: going backwards is an error; a jump is distance driven without a fuel log.
    for (let i = 1; i < fills.length; i++) {
      const gap = n(fills[i].odometer_start) - n(fills[i - 1].odometer_end);
      if (!inPeriod(fills[i].log_date, period)) continue;
      if (gap < 0) alert('odometer_back', 'high', { date: fills[i].log_date, km: round(-gap, 1), record_id: fills[i].id });
      else if (gap > UNLOGGED_GAP_KM) alert('unlogged_distance', 'medium', { date: fills[i].log_date, km: round(gap, 1), record_id: fills[i].id });
    }

    // The same part replaced again within REPEAT_PART_DAYS.
    const parts = new Map();
    for (const e of costs.filter((x) => x.category === 'spare_part' && x.part_name)) {
      const key = normalizePart(e.part_name);
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key).push(e);
    }
    for (const list of parts.values()) {
      const recent = list.filter((e) => days(e.expense_date, now) <= REPEAT_PART_DAYS);
      for (let i = recent.length - 1; i > 0; i--) {
        const gapDays = days(recent[i - 1].expense_date, recent[i].expense_date);
        if (gapDays <= REPEAT_PART_DAYS) {
          alert('repeated_part', recent.length >= 3 ? 'high' : 'medium', { part: recent[i].part_name, count: recent.length, days: gapDays, date: recent[i].expense_date, amount: round(recent.reduce((s, e) => s + n(e.amount), 0)), record_id: recent[i].id });
          break;
        }
      }
    }

    // Oil change due by distance or by time, against the type's interval.
    if (type) {
      const kmLimit = n(type.oil_change_km), dayLimit = n(type.oil_change_days);
      if (!oil) {
        if (fills.length) { row.oilStatus = 'unknown'; alert('oil_unknown', 'low', {}); }
      } else if (kmSinceOil >= kmLimit || daysSinceOil >= dayLimit) {
        row.oilStatus = 'due'; alert('oil_due', 'high', { km: round(kmSinceOil, 1), days: daysSinceOil, km_limit: kmLimit, day_limit: dayLimit });
      } else if (kmSinceOil >= kmLimit * 0.9 || daysSinceOil >= dayLimit * 0.9) {
        row.oilStatus = 'soon'; alert('oil_soon', 'low', { km_left: round(kmLimit - kmSinceOil, 1), days_left: dayLimit - daysSinceOil });
      }
    }
    return row;
  });

  const order = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity] || String(b.date || '').localeCompare(String(a.date || '')));

  const active = rows.filter((r) => r.vehicle.status !== 'inactive');
  const sum = (k) => round(rows.reduce((s, r) => s + n(r[k]), 0));
  const distance = sum('distance'), liters = sum('liters');
  const totals = {
    vehicles: active.length, distance, liters, fuelCost: sum('fuelCost'), otherCost: sum('otherCost'), totalCost: sum('totalCost'),
    kmPerLiter: liters > 0 ? round(distance / liters) : null, costPerKm: distance > 0 ? round(sum('totalCost') / distance) : null,
    alerts: alerts.length, highAlerts: alerts.filter((a) => a.severity === 'high').length,
  };

  const byCategory = {};
  for (const e of expenses.filter((x) => inPeriod(x.expense_date, period))) byCategory[e.category] = round((byCategory[e.category] || 0) + n(e.amount));

  // The monthly chart covers the chosen range (1–12 months, ending at its last day), or the last 6 months.
  const end = period?.to && period.to < now ? period.to : now;
  const span = period?.from ? (Number(end.slice(0, 4)) - Number(period.from.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(period.from.slice(5, 7)) + 1 : 6;
  return { rows, alerts, totals, byCategory, monthly: monthlySeries(fuel, expenses, end, Math.min(12, Math.max(1, span))) };
}

// Fuel cost, other costs, distance and litres for each of the last `count` calendar months (oldest first).
export function monthlySeries(fuel, expenses, today, count = 6) {
  const [y, m] = today.split('-').map(Number);
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push({ month: d.toISOString().slice(0, 7), fuelCost: 0, otherCost: 0, distance: 0, liters: 0 });
  }
  const at = new Map(months.map((x) => [x.month, x]));
  for (const f of fuel) { const x = at.get(String(f.log_date).slice(0, 7)); if (x) { x.fuelCost += n(f.total_cost); x.distance += n(f.odometer_end) - n(f.odometer_start); x.liters += n(f.liters); } }
  for (const e of expenses) { const x = at.get(String(e.expense_date).slice(0, 7)); if (x) x.otherCost += n(e.amount); }
  return months.map((x) => ({ ...x, fuelCost: round(x.fuelCost), otherCost: round(x.otherCost), distance: round(x.distance, 1), liters: round(x.liters), kmPerLiter: x.liters > 0 ? round(x.distance / x.liters) : null }));
}
