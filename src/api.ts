// src/api.ts
export const API = import.meta.env.VITE_GAS_URL as string;

function must(url?: string) {
  if (!url) throw new Error('VITE_GAS_URL не задан. Добавь его в .env');
  return url;
}

// чтение ячеек
export async function getCells(tab: string) {
  const r = await fetch(`${must(API)}?action=cells&tab=${encodeURIComponent(tab)}`);
  if (!r.ok) throw new Error(`GET ${r.status}`);
  return r.json();
}

// сохранение ячейки (text/images/courseId — опционально)
export async function saveCell(payload: {
  tab: string;
  criterionId: string;
  text?: string;
  images?: string[] | string;
  courseId?: string; // вида c1, c2...
}) {
  const r = await fetch(must(API), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // под твой parseBody()
    body: JSON.stringify({ action: 'savecell', ...payload }),
  });
  if (!r.ok) throw new Error(`POST ${r.status}`);
  return r.json();
}

// запись метаданных критерия (если используешь)
export async function upsertCriterion(payload: {
  tab: string;
  criterionId: string;
  section?: string;
  criterion?: string;
  description?: string;
  filled_by?: string;
}) {
  const r = await fetch(must(API), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'upsertcriterion', ...payload }),
  });
  if (!r.ok) throw new Error(`POST ${r.status}`);
  return r.json();
}
