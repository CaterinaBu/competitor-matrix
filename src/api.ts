// src/api.ts
export const API = import.meta.env.VITE_GAS_URL as string;

function must(url?: string) {
  if (!url) throw new Error('VITE_GAS_URL не задан. Добавь его в .env');
  return url;
}

// типы данных, которые отдаёт Apps Script для action=cells
export type Criterion = {
  id: string;
  name: string;
  group?: string;
  description?: string;
  filledBy?: string;
};

export type Course = {
  id: string;
  name: string;
};

export type Cell = {
  courseId: string;
  criterionId: string;
  text?: string;
  images?: string[];
};

export type MatrixData = {
  criteria: Criterion[];
  courses: Course[];
  cells: Cell[];
};

type CellsResponse = {
  ok: boolean;
  data: MatrixData;
  error?: string;
};

// чтение ячеек
export async function getCells(tab: string): Promise<MatrixData> {
  const r = await fetch(`${must(API)}?action=cells&tab=${encodeURIComponent(tab)}`);
  if (!r.ok) throw new Error(`GET ${r.status}`);

  const json: CellsResponse = await r.json();
  if (!json.ok) throw new Error(json.error || "cells error");

  return json.data;
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
