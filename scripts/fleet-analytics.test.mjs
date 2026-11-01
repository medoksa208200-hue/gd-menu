import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFleet, verdict, normalizePart, monthlySeries } from '../lib/fleet-analytics.mjs';

const double = { id: 't1', expected_km_per_liter: 9, tolerance_percent: 15, oil_change_km: 5000, oil_change_days: 120 };
const dababa = { id: 't2', expected_km_per_liter: 25, tolerance_percent: 20, oil_change_km: 3000, oil_change_days: 90 };
const car = { id: 'v1', plate_number: 'ن ص ر 1234', type_id: 't1', status: 'active', initial_odometer: 0 };
const bike = { id: 'v2', plate_number: 'د ب 55', type_id: 't2', status: 'active', initial_odometer: 0 };
const fill = (id, vehicle_id, log_date, start, end, liters, price = 15) => ({ id, vehicle_id, log_date, odometer_start: start, odometer_end: end, liters, total_cost: liters * price, km_per_liter: Math.round(((end - start) / liters) * 100) / 100 });

test('consumption is judged against the vehicle type', () => {
  assert.equal(verdict(9, double), 'normal');
  assert.equal(verdict(7.4, double), 'high');
  assert.equal(verdict(10, double), 'normal');
  assert.equal(verdict(10.5, double), 'low');
  assert.equal(verdict(13, double), 'suspicious');
  assert.equal(verdict(9, dababa), 'high');
  assert.equal(verdict(null, double), 'none');
});

test('part names match across spelling variants', () => {
  assert.equal(normalizePart(' فلتر  الزيت '), normalizePart('فلتر زيت'));
  assert.equal(normalizePart('بوجيه'), normalizePart('بوجية'));
  assert.notEqual(normalizePart('فلتر هواء'), normalizePart('فلتر زيت'));
});

test('per-vehicle totals, consumption and alerts', () => {
  const fuel = [
    fill('f1', 'v1', '2026-10-01', 1000, 1450, 50),
    fill('f2', 'v1', '2026-10-10', 1450, 1750, 50), // 6 km/L on a 9 km/L type: severe
    fill('f3', 'v1', '2026-10-20', 1700, 2150, 50), // odometer went back 50 km
    fill('f4', 'v2', '2026-10-05', 100, 600, 20),
    fill('f5', 'v2', '2026-10-15', 900, 1400, 20), // 300 km never logged
  ];
  const expenses = [
    { id: 'e1', vehicle_id: 'v1', expense_date: '2026-09-01', category: 'oil_change', amount: 900, odometer: 0 },
    { id: 'e2', vehicle_id: 'v1', expense_date: '2026-10-02', category: 'spare_part', part_name: 'فلتر الزيت', amount: 200 },
    { id: 'e3', vehicle_id: 'v1', expense_date: '2026-10-25', category: 'spare_part', part_name: 'فلتر زيت', amount: 250 },
    { id: 'e4', vehicle_id: 'v2', expense_date: '2026-10-03', category: 'washing', amount: 50 },
  ];
  const report = analyzeFleet({ types: [double, dababa], vehicles: [car, bike], fuel, expenses, period: { from: '2026-10-01', to: '2026-10-31' }, today: '2026-10-31' });
  const v1 = report.rows.find((r) => r.vehicle.id === 'v1');
  assert.equal(v1.distance, 1200);
  assert.equal(v1.liters, 150);
  assert.equal(v1.kmPerLiter, 8);
  assert.equal(v1.verdict, 'normal'); // the period average is fine; the single bad fill is still flagged below
  assert.equal(v1.fuelCost, 2250);
  assert.equal(v1.otherCost, 450);
  assert.equal(v1.odometer, 2150);
  assert.equal(v1.kmSinceOil, 2150);
  const kinds = (id) => report.alerts.filter((a) => a.vehicle_id === id).map((a) => a.kind).sort();
  assert.deepEqual(kinds('v1'), ['consumption_high', 'odometer_back', 'repeated_part']);
  assert.equal(report.alerts.find((a) => a.kind === 'consumption_high').severity, 'high');
  assert.equal(report.alerts.find((a) => a.kind === 'repeated_part').days, 23);
  assert.deepEqual(kinds('v2'), ['oil_unknown', 'unlogged_distance']);
  assert.equal(report.alerts[0].severity, 'high');
  assert.equal(report.totals.distance, 2200);
  assert.equal(report.totals.otherCost, 500);
  assert.deepEqual(report.byCategory, { spare_part: 450, washing: 50 });
});

test('oil change becomes due by distance or by time, and inactive vehicles raise nothing', () => {
  const fuel = [fill('f1', 'v1', '2026-10-01', 0, 4600, 500)];
  const oil = { id: 'e1', vehicle_id: 'v1', expense_date: '2026-09-01', category: 'oil_change', amount: 900, odometer: 0 };
  const soon = analyzeFleet({ types: [double], vehicles: [car], fuel, expenses: [oil], today: '2026-10-01' });
  assert.equal(soon.rows[0].oilStatus, 'soon');
  const late = analyzeFleet({ types: [double], vehicles: [car], fuel: [], expenses: [oil], today: '2027-01-15' });
  assert.equal(late.rows[0].oilStatus, 'due');
  assert.equal(late.alerts[0].kind, 'oil_due');
  const parked = analyzeFleet({ types: [double], vehicles: [{ ...car, status: 'inactive' }], fuel, expenses: [oil], today: '2027-01-15' });
  assert.equal(parked.alerts.length, 0);
  assert.equal(parked.totals.vehicles, 0);
});

test('monthly series covers the last months in order', () => {
  const series = monthlySeries([fill('f1', 'v1', '2026-10-01', 0, 90, 10)], [{ expense_date: '2026-08-15', amount: 100 }], '2026-10-31', 3);
  assert.deepEqual(series.map((m) => m.month), ['2026-08', '2026-09', '2026-10']);
  assert.equal(series[0].otherCost, 100);
  assert.equal(series[2].kmPerLiter, 9);
});

test('the monthly chart follows the chosen date range', () => {
  const fuel = [fill('f1', 'v1', '2026-03-10', 0, 90, 10), fill('f2', 'v1', '2026-05-02', 90, 180, 10)];
  const ranged = analyzeFleet({ types: [double], vehicles: [car], fuel, expenses: [], period: { from: '2026-03-01', to: '2026-05-31' }, today: '2026-10-31' });
  assert.deepEqual(ranged.monthly.map((m) => m.month), ['2026-03', '2026-04', '2026-05']);
  assert.equal(ranged.rows[0].distance, 180);
  const defaults = analyzeFleet({ types: [double], vehicles: [car], fuel, expenses: [], today: '2026-10-31' });
  assert.equal(defaults.monthly.length, 6);
  const long = analyzeFleet({ types: [double], vehicles: [car], fuel, expenses: [], period: { from: '2020-01-01' }, today: '2026-10-31' });
  assert.equal(long.monthly.length, 12);
});
