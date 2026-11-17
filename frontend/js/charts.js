/**
 * Chart.js helpers (Chart.js is served locally from /vendor/chart.js).
 * Charts always receive real aggregates from the backend.
 */
import { DISEASES, FINDINGS } from './constants.js';

const instances = new Map();

export function chartAvailable() {
  return typeof window.Chart === 'function';
}

function base() {
  const C = window.Chart;
  C.defaults.font.family = "'Sarabun', 'Noto Sans Thai', sans-serif";
  C.defaults.font.size = 13;
  C.defaults.color = '#3d5670';
  // entrance / data-update animation (eases like the rest of the UI); none with reduced motion
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  C.defaults.animation = reduced ? false : { duration: 900, easing: 'easeOutQuart' };
}

export function destroy(id) {
  instances.get(id)?.destroy();
  instances.delete(id);
}

/** Pie/doughnut of disease distribution (+ "no abnormality" slice). */
export function diseasePie(canvas, distribution, { countBy }) {
  if (!chartAvailable()) return null;
  base();
  destroy(canvas.id);
  const items = distribution.filter((d) => d.count > 0);
  const labels = distribution.map((d) => (DISEASES[d.key] ? `${DISEASES[d.key].th} (${DISEASES[d.key].en})` : FINDINGS.negative.th));
  const colors = distribution.map((d) => DISEASES[d.key]?.color ?? FINDINGS.negative.color);
  const unit = countBy === 'person' ? 'คน' : 'ผลตรวจ';
  const chart = new window.Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: distribution.map((d) => d.count), backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d = distribution[ctx.dataIndex];
              return ` ${ctx.label}: ${d.count.toLocaleString('th-TH')} ${unit} (${d.percent}%)`;
            },
          },
        },
      },
    },
  });
  if (!items.length) chart.options.plugins.legend.display = true;
  instances.set(canvas.id, chart);
  return chart;
}

/** Line chart: total screenings and referrals per day. */
export function trendLine(canvas, rows, series = [{ key: 'total', label: 'จำนวนการตรวจ', color: '#0b8fd8' }, { key: 'referrals', label: 'ต้องส่งต่อพบจักษุแพทย์', color: '#c62828' }]) {
  if (!chartAvailable()) return null;
  base();
  destroy(canvas.id);
  const fmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' });
  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels: rows.map((r) => fmt.format(new Date(`${r.date}T00:00:00+07:00`))),
      datasets: series.map((s) => ({
        label: s.label, data: rows.map((r) => r[s.key] ?? 0), borderColor: s.color, backgroundColor: `${s.color}22`,
        tension: 0.3, fill: s.fill ?? false, pointRadius: rows.length > 40 ? 0 : 3, borderWidth: 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef2f6' } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } },
    },
  });
  instances.set(canvas.id, chart);
  return chart;
}
