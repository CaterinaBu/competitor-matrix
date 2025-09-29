import React, { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Maximize2, Edit3, ChevronDown, ChevronRight, ChevronLeft, Plus, EyeOff } from "lucide-react";

// =================================================
// Sheets‑driven прототип (упрощённая версия)
// — всё загружается из Google Sheets
// — никаких top‑level return/JSX, лишних dev‑вставок и незакрытых тегов
// — просмотр изображений: большая картинка + ползунок + стрелки + «Открыть оригинал»
// =================================================

// === Конфигурация ===
const SHEET_ID = "1IouEV_O2wnycNDzl3Xlu56cCbQT40kaPwyJSxAbipiU"; // Google Sheet
const APPS_SCRIPT_URL: string | null = "https://script.google.com/macros/s/AKfycby5gReVgdiNccemwb2ekntoOzWclhDKwO0zLyGQ88B9X2ZeAU8xV0PYRzJnoV7BUfIR/exec"; // WebApp для записи
const TABS_INDEX_SHEET = "__tabs"; // индекс вкладок (колонки: sheet, label[, id])

// === Типы ===
type Criterion = { id: string; name: string; group?: string; description?: string; filledBy?: string };
type Course = { id: string; name: string };
type Cell = { courseId: string; criterionId: string; text?: string; images?: { url: string; caption?: string }[] };

type MatrixData = { criteria: Criterion[]; courses: Course[]; cells: Cell[] };

type Tab = { id: string; label: string };

type SheetRow = Record<string, string>;

// === Константы матрицы ===
const COURSE_CRIT_ID = "course_meta"; // несворачиваемый «Курс»
const COURSE_GROUP = "0. Курс";      // группа для «Курс» (заголовок не показываем в UI)
const MISC_GROUP   = "Прочие критерии"; // куда падают новые критерии

// === Утилиты ===
const getApiKey = () => (typeof window !== "undefined" && localStorage.getItem("gs_api_key")) || "";
const setApiKey = (v: string) => { try { if (typeof window !== "undefined") localStorage.setItem("gs_api_key", v || ""); } catch { /* no‑op */ } };

function gvizUrl(sheet: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheet)}`;
}

async function fetchWithTimeout(resource: string, opts: RequestInit = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(resource, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function fetchGViz(sheet: string): Promise<SheetRow[]> {
  const res = await fetchWithTimeout(gvizUrl(sheet), { credentials: "omit" });
  if (!res.ok) throw new Error(`Failed to fetch sheet ${sheet}: ${res.status}`);
  const txt = await res.text();
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("GViz: JSON not found");
  const json = JSON.parse(txt.slice(start, end + 1));
  const rows: any[] = json.table?.rows || [];
  const matrix: string[][] = rows.map((r: any) => (r.c || []).map((c: any) => (c && (c.f ?? c.v)) ?? ""));
  const header = (matrix[0] || []).map((h) => String(h).trim());
  const dataRows = matrix.slice(1).filter((r) => r.some((v) => String(v).trim().length > 0));
  return dataRows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""]) as [string, string][]));
}

function extractDriveId(u: string): string | null {
  try {
    const m1 = u.match(/\/file\/d\/([^/]+)/); if (m1) return m1[1];
    const m2 = u.match(/[?&]id=([^&]+)/);      if (m2) return m2[1];
  } catch { /* no‑op */ }
  return null;
}
function normalizeImageUrl(u: string): string {
  if (!u) return u;
  const id = extractDriveId(u);
  return id ? `https://drive.google.com/uc?export=view&id=${id}` : u;
}

function rowsToMatrix(rows: SheetRow[]): MatrixData {
  const allKeys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const courseIds = Array.from(allKeys)
    .filter((k) => k.endsWith("_text"))
    .map((k) => k.slice(0, -"_text".length))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D+/g, "")) || 0;
      const nb = parseInt(b.replace(/\D+/g, "")) || 0;
      return na - nb || a.localeCompare(b);
    });
  const courses: Course[] = courseIds.map((cid, i) => ({ id: cid, name: `Курс ${i + 1}` }));

  const criteria: Criterion[] = [];
  const cells: Cell[] = [];
  rows.forEach((r, idx) => {
    const group = String(r.section || "").trim();
    const name = String(r.criterion || "").trim();
    const description = String(r.description || "").trim() || undefined;
    const filledBy = String(r.filled_by || "").trim() || undefined;
    let id = String(r.criterion_id || "").trim();
    if (!name) return;
    const isCourseRow = group === COURSE_GROUP && name === "Курс";
    if (isCourseRow) id = COURSE_CRIT_ID; else if (!id) id = `gen-${idx + 1}`;
    criteria.push({ id, name, group: isCourseRow ? COURSE_GROUP : (group || undefined), description, filledBy });

    courseIds.forEach((cid) => {
      const text = String((r as any)[`${cid}_text`] || "");
      const imagesRaw = String((r as any)[`${cid}_images`] || "");
      const images = imagesRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((url) => ({ url: normalizeImageUrl(url) }));
      if (text || images.length) cells.push({ courseId: cid, criterionId: id, text: text || undefined, images });
    });
  });
  return { criteria, courses, cells };
}

function rowsToTabs(rows: SheetRow[]): { tabs: Tab[]; mapping: Record<string, string> } {
  const out: Tab[] = [];
  const map: Record<string, string> = {};
  for (const r of rows) {
    const sheet = String(r.sheet || "").trim();
    const label = String(r.label || sheet || "").trim();
    if (!sheet || !label) continue;
    const id = String((r as any).id || sheet);
    out.push({ id, label });
    map[id] = sheet;
  }
  return { tabs: out, mapping: map };
}

function CriterionHeader({ k }: { k: Criterion }) {
  return (
    <div className="border-r px-2 py-3 text-sm">
      <div className="font-medium">{k.name}</div>
      {k.description && <div className="text-muted-foreground text-xs whitespace-pre-line">{k.description}</div>}
      {k.filledBy && <div className="text-xs italic">Заполняет: {k.filledBy}</div>}
    </div>
  );
}

function Img({ url, alt, className }: { url: string; alt?: string; className?: string }) {
  const [ok, setOk] = React.useState(true);
  const src = normalizeImageUrl(url);
  return ok ? (
    <img src={src} alt={alt || "image"} className={className || "max-w-full max-h-64 rounded border"} loading="lazy" decoding="async" onError={() => setOk(false)} />
  ) : (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded border px-2 py-1 text-[11px] leading-4 bg-red-50 text-red-700 hover:bg-red-100">⚠︎ Открыть оригинал</a>
  );
}

function CellCardView({ cell, onOpen, onEdit }: { cell?: Cell; onOpen: () => void; onEdit: () => void }) {
  return (
    <div className="p-2 border">
      <Card>
        <CardContent className="p-2 text-sm">
          {cell?.text ? <div className="mb-2 line-clamp-3">{cell.text}</div> : <span className="text-muted-foreground">Нет данных</span>}
          {cell?.images && cell.images.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {cell.images.map((img, i) => (
                <Img key={i} url={img.url} alt={img.caption || "preview"} className="h-12 w-12 object-cover rounded" />
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={onOpen}><Maximize2 className="h-4 w-4" /></Button>
            <Button size="sm" variant="secondary" onClick={onEdit}><Edit3 className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CourseHeaderCell({ cLabel, onHide }: { cLabel: string; onHide: () => void }) {
  return (
    <div className="font-medium border-b px-2 py-2 flex items-center justify-between gap-2">
      <span>{cLabel}</span>
      <Button size="sm" variant="ghost" title="Скрыть курс" onClick={onHide}>
        <EyeOff className="h-4 w-4" />
      </Button>
    </div>
  );
}

// --- helper: нормализация ссылок на изображения (Drive и прямые URL)
function normalizeImageUrl(u) {
  try {
    const url = new URL(u);
    if (/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(url.pathname)) return u;
    const m1 = url.pathname.match(/\/file\/d\/([^/]+)/);
    const m2 = url.search.match(/(?:\?|&)id=([^&]+)/);
    const id = (m1 && m1[1]) || (m2 && m2[1]);
    if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w2000`;
    return u;
  } catch { return u; }
}

export default function CompetitorMatrix() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabToSheet, setTabToSheet] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>("");

  const [data, setData] = useState<MatrixData>({ criteria: [], courses: [], cells: [] });
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState<{ courseId: string; criterionId: string } | null>(null);
  const [edit, setEdit] = useState<{ courseId: string; criterionId: string } | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftImages, setDraftImages] = useState<string>("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [addCriterionOpen, setAddCriterionOpen] = useState(false);
  const [newCriterion, setNewCriterion] = useState({ name: "", description: "", filledBy: "" });
  const [hiddenCourses, setHiddenCourses] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const storageKey = (base: string) => `${base}:${activeTab || "__na__"}`;

  // === Загрузка вкладок ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchGViz(TABS_INDEX_SHEET);
        if (cancelled) return;
        const { tabs: t, mapping } = rowsToTabs(rows);
        if (t.length === 0) throw new Error("Лист __tabs пустой");
        setTabs(t);
        setTabToSheet(mapping);
        if (!activeTab) setActiveTab(t[0].id);
      } catch (e: any) {
        setLoadError(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // === Загрузка данных активной вкладки ===
  useEffect(() => {
    if (!activeTab) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setLoadError(null);
      try {
        const sheetName = tabToSheet[activeTab];
        if (!sheetName) throw new Error(`Для вкладки ${activeTab} не найден лист в __tabs`);
        const rows = await fetchGViz(sheetName);
        if (cancelled) return;
        setData(rowsToMatrix(rows));
        const savedHidden = localStorage.getItem(storageKey("hiddenCourseIds"));
        setHiddenCourses(savedHidden ? JSON.parse(savedHidden) : []);
        setCollapsedGroups({}); setOpen(null); setEdit(null);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, tabToSheet]);

  // Сброс индекса просмотрщика при смене ячейки
  useEffect(() => { setViewerIndex(0); }, [open?.courseId, open?.criterionId]);

  // === Индексы/геттеры ===
  const cellIndex = useMemo(() => {
    const byCourse: Record<string, Record<string, Cell>> = {};
    for (const cell of data.cells) {
      if (!byCourse[cell.courseId]) byCourse[cell.courseId] = {};
      byCourse[cell.courseId][cell.criterionId] = cell;
    }
    return byCourse;
  }, [data.cells]);
  const getCell = (courseId: string, criterionId: string): Cell | undefined => (cellIndex as any)[courseId]?.[criterionId];

  // === Запись ячейки ===
  async function writeCell(courseId: string, criterionId: string, text: string, imagesLines: string) {
    const sheetName = tabToSheet[activeTab];
    const crit = data.criteria.find((c) => c.id === criterionId);
    const payload = {
      action: "upsertCell",
      apiKey: getApiKey(),
      tab: sheetName,
      courseId,
      criterionId,
      criterion: crit?.name || "",
      text,
      images: imagesLines.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      updatedBy: (typeof window !== "undefined" && (localStorage.getItem("user_name") || "anonymous")) || "anonymous",
    } as const;

    if (!APPS_SCRIPT_URL) return;
    try {
      let res = await fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const raw = await res.text();
      let json: any = null; try { json = JSON.parse(raw); } catch { /* not JSON */ }
      const unauthorized = !!(json && typeof json.error === "string" && json.error.toUpperCase().includes("UNAUTHORIZED"));
      if (unauthorized) {
        const key = typeof window !== "undefined" ? window.prompt("Введите API_KEY для записи в таблицу", "") : null;
        if (key) {
          setApiKey(key);
          await fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, apiKey: key }) });
        }
      }
    } catch (e) {
      console.warn("Apps Script недоступен, данные только локально", e);
    }
  }

  const saveCell = async (courseId: string, criterionId: string) => {
    const images = draftImages.split(/\r?\n/).map((u) => u.trim()).filter(Boolean).map((u) => ({ url: normalizeImageUrl(u) }));
    const newCell: Cell = { courseId, criterionId, text: draftText, images };
    setData((prev) => {
      const filtered = prev.cells.filter((c) => !(c.courseId === courseId && c.criterionId === criterionId));
      return { ...prev, cells: [...filtered, newCell] };
    });
    await writeCell(courseId, criterionId, draftText, draftImages);
    setEdit(null);
  };

  async function addCourse() {
    const nextIndex = data.courses.length + 1;
    const newCourseId = `c${nextIndex}`;
    if (APPS_SCRIPT_URL) {
      try {
        const res = await fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "addCourse", tab: tabToSheet[activeTab], courseId: newCourseId }) });
        if (!res.ok) throw new Error("Не удалось добавить курс в таблицу");
      } catch (e) {
        console.warn("Apps Script недоступен, добавление только локально", e);
      }
    }
    setData((prev) => ({ ...prev, courses: [...prev.courses, { id: newCourseId, name: `Курс ${nextIndex}` }] }));
  }

  function addCriterionLocal() {
    if (!newCriterion.name.trim()) return;
    const id = `cr-${Date.now()}`;
    const newC: Criterion = { id, name: newCriterion.name, description: newCriterion.description, group: MISC_GROUP, filledBy: newCriterion.filledBy };
    setData((prev) => ({ ...prev, criteria: [...prev.criteria, newC] }));
    setNewCriterion({ name: "", description: "", filledBy: "" });
    setAddCriterionOpen(false);
    if (APPS_SCRIPT_URL) {
      fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "addCriterion", tab: tabToSheet[activeTab], criterion: newC }) }).catch(() => console.warn("Не удалось записать критерий в таблицу"));
    }
  }

  const toggleGroup = (group: string) => setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));

  const visibleCourses = useMemo(() => data.courses.filter((c) => !hiddenCourses.includes(c.id)), [data.courses, hiddenCourses]);
  const hiddenCourseObjs = useMemo(() => data.courses.filter((c) => hiddenCourses.includes(c.id)), [data.courses, hiddenCourses]);

  const courseMetaCriteria = useMemo(() => data.criteria.filter((c) => c.id === COURSE_CRIT_ID || c.group === COURSE_GROUP), [data.criteria]);

  const groupedCriteria = useMemo(() => {
    const groups: Record<string, Criterion[]> = {};
    for (const c of data.criteria) {
      if (c.id === COURSE_CRIT_ID || c.group === COURSE_GROUP) continue;
      const g = c.group ? (c.group === "XI. Прочее" ? MISC_GROUP : c.group) : MISC_GROUP;
      if (!groups[g]) groups[g] = [];
      groups[g].push(c);
    }
    if (!groups[MISC_GROUP]) groups[MISC_GROUP] = [];
    return groups;
  }, [data.criteria]);

  return (
    <div className="w-full h-full p-4">
      {/* Вкладки */}
      <div className="flex gap-2 overflow-x-auto pb-3 -mt-1">
        {tabs.length === 0 ? (
          <span className="text-xs text-muted-foreground">Нет вкладок. Создайте лист <code>__tabs</code> с колонками <code>sheet</code>, <code>label</code>.</span>
        ) : (
          tabs.map((t) => (
            <Button key={t.id} size="sm" variant={activeTab === t.id ? "secondary" : "outline"} onClick={() => setActiveTab(t.id)} className="whitespace-nowrap">
              {t.label}
            </Button>
          ))
        )}
      </div>

      {/* Кнопки действий */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold">Матрица анализа конкурентов — <span className="font-normal">{tabs.find(t => t.id === activeTab)?.label || "—"}</span></h1>
        <div className="flex gap-2 items-center">
          <Button variant="default" size="sm" onClick={addCourse} disabled={!activeTab}><Plus className="h-4 w-4 mr-1" /> Добавить курс</Button>
          <Button variant="outline" size="sm" onClick={() => Object.keys(groupedCriteria).forEach((g) => setCollapsedGroups((prev) => ({ ...prev, [g]: false })))} disabled={!activeTab}>Развернуть все</Button>
          <Button variant="outline" size="sm" onClick={() => Object.keys(groupedCriteria).forEach((g) => setCollapsedGroups((prev) => ({ ...prev, [g]: true })))} disabled={!activeTab}>Свернуть все</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Загружаю данные…</div>
      ) : loadError ? (
        <div className="text-sm text-red-600">Ошибка загрузки: {loadError}</div>
      ) : !activeTab ? (
        <div className="text-sm text-muted-foreground">Выберите вкладку (или заполните лист <code>__tabs</code>).</div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* Табличная сетка */}
          <div className="grid flex-1" style={{ gridTemplateColumns: `280px repeat(${visibleCourses.length}, minmax(260px, 1fr))` }}>
            <div className="font-medium border-b px-2 py-2">Критерии / Курсы</div>
            {visibleCourses.map((c, idx) => (
              <CourseHeaderCell key={c.id} cLabel={`Курс ${idx + 1}`} onHide={() => {
                setHiddenCourses((prev) => { const next = [...prev, c.id]; localStorage.setItem(storageKey("hiddenCourseIds"), JSON.stringify(next)); return next; });
              }} />
            ))}

            {/* Несворачиваемый блок: 0. Курс */}
            {courseMetaCriteria.map((k) => (
              <React.Fragment key={k.id}>
                <CriterionHeader k={k} />
                {visibleCourses.map((c) => {
                  const cell = getCell(c.id, k.id);
                  return (
                    <CellCardView
                      key={c.id + k.id}
                      cell={cell}
                      onOpen={() => setOpen({ courseId: c.id, criterionId: k.id })}
                      onEdit={() => { setEdit({ courseId: c.id, criterionId: k.id }); setDraftText(cell?.text || ""); setDraftImages((cell?.images || []).map((i) => i.url).join("\n")); }}
                    />
                  );
                })}
              </React.Fragment>
            ))}

            {/* Остальные группы */}
            {Object.entries(groupedCriteria).map(([group, criteria]) => (
              <React.Fragment key={group}>
                <div className="col-span-full flex items-center bg-gray-100 px-2 py-2 border-t">
                  <div className="flex items-center gap-1 flex-1 cursor-pointer" onClick={() => toggleGroup(group)}>
                    {collapsedGroups[group] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className="font-semibold text-sm">{group}</span>
                  </div>
                  {group === MISC_GROUP && (
                    <Button size="sm" variant="outline" onClick={() => setAddCriterionOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" /> Добавить критерий
                    </Button>
                  )}
                </div>

                {!collapsedGroups[group] && criteria.map((k) => (
                  <React.Fragment key={k.id}>
                    <CriterionHeader k={k} />
                    {visibleCourses.map((c) => {
                      const cell = getCell(c.id, k.id);
                      return (
                        <CellCardView
                          key={c.id + k.id}
                          cell={cell}
                          onOpen={() => setOpen({ courseId: c.id, criterionId: k.id })}
                          onEdit={() => { setEdit({ courseId: c.id, criterionId: k.id }); setDraftText(cell?.text || ""); setDraftImages((cell?.images || []).map((i) => i.url).join("\n")); }}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </div>

          {/* Сайдбар: скрытые курсы */}
          <div className="w-[220px] shrink-0 border rounded-md p-2">
            <div className="font-medium mb-2">Скрытые курсы</div>
            {hiddenCourseObjs.length > 0 ? (
              <div className="flex flex-col gap-2">
                {hiddenCourseObjs.map((c) => {
                  const meta = getCell(c.id, COURSE_CRIT_ID)?.text?.trim();
                  const number = data.courses.findIndex((x) => x.id === c.id) + 1;
                  const label = meta && meta.length > 0 ? meta : `Курс ${number}`;
                  return (
                    <Button key={c.id} size="sm" variant="secondary" onClick={() => {
                      setHiddenCourses((prev) => { const next = prev.filter((x) => x !== c.id); localStorage.setItem(storageKey("hiddenCourseIds"), JSON.stringify(next)); return next; });
                    }} className="justify-start text-left whitespace-pre-wrap">
                      {label}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Нет скрытых</div>
            )}
          </div>
        </div>
      )}

      {/* Просмотр */}
      <Dialog open={!!open} onOpenChange={() => setOpen(null)}>
        <DialogContent className="sm:max-w-5xl w-[min(96vw,1200px)] max-h-[85vh] overflow-auto p-4">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Просмотр: {(
                    getCell(open.courseId, COURSE_CRIT_ID)?.text?.trim() ||
                    `Курс ${Math.max(1, data.courses.findIndex(x => x.id === open.courseId) + 1)}`
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="text-sm whitespace-pre-wrap mb-4">{getCell(open.courseId, open.criterionId)?.text || "—"}</div>
              {(() => {
                const cell = getCell(open.courseId, open.criterionId);
                const imgs = cell?.images || [];
                if (!imgs.length) return null;
                const clampedIndex = Math.min(Math.max(0, viewerIndex), imgs.length - 1);
                const current = imgs[clampedIndex];
                return (
                  <div className="flex flex-col gap-3 items-center">
                    <div className="w-full flex items-center justify-center">
                      <Img url={current.url} alt={current.caption || "screenshot"} className="max-h-[78vh] w-full object-contain rounded border bg-black/5" />
                    </div>
                    <div className="w-full flex items-center gap-3">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => setViewerIndex((i) => Math.max(0, i - 1))}
                        disabled={clampedIndex <= 0}
                        aria-label="Предыдущее изображение"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, imgs.length - 1)}
                        value={clampedIndex}
                        onChange={(e) => setViewerIndex(Number(e.target.value))}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => setViewerIndex((i) => Math.min(imgs.length - 1, i + 1))}
                        disabled={clampedIndex >= imgs.length - 1}
                        aria-label="Следующее изображение"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <span className="text-xs whitespace-nowrap">{clampedIndex + 1} / {imgs.length}</span>
                    </div>
                    <a href={current.url} target="_blank" rel="noreferrer" className="text-xs underline text-blue-600 hover:text-blue-800 self-start">Открыть оригинал</a>
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Редактирование */}
      <Dialog open={!!edit} onOpenChange={() => setEdit(null)}>
        <DialogContent className="max-w-xl">
          {edit && (
            <>
              <DialogHeader>
                <DialogTitle>Редактировать: {edit.courseId} / {edit.criterionId}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Label>Текст</Label>
                <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} className="border rounded-md p-2 text-sm min-h-[120px]" />
                <div>
                  <Label className="block">Скриншоты (ссылки, по одной в строке)</Label>
                  <textarea value={draftImages} onChange={(e) => setDraftImages(e.target.value)} className="border rounded-md p-2 text-sm min-h-[140px] w-full mt-1 resize-y" />
                </div>
                <div className="text-xs text-muted-foreground">Для Google Drive вставляйте ссылку вида <code>https://drive.google.com/file/d/FILE_ID/view</code> (включите доступ «У кого есть ссылка: Просмотр»). Также работают <code>uc?export=download</code> и <code>thumbnail?id=FILE_ID&sz=w2000</code>.</div>
              </div>
              <DialogFooter className="pt-2">
                <Button onClick={() => saveCell(edit.courseId, edit.criterionId)}>Сохранить</Button>
                <Button variant="outline" onClick={() => setEdit(null)}>Отмена</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Добавить критерий */}
      <Dialog open={addCriterionOpen} onOpenChange={setAddCriterionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить новый критерий</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Label>Название критерия</Label>
            <input value={newCriterion.name} onChange={(e) => setNewCriterion({ ...newCriterion, name: e.target.value })} className="border rounded-md p-2 text-sm" />
            <Label>Описание</Label>
            <input value={newCriterion.description} onChange={(e) => setNewCriterion({ ...newCriterion, description: e.target.value })} className="border rounded-md p-2 text-sm" />
            <Label>Кто заполняет</Label>
            <input value={newCriterion.filledBy} onChange={(e) => setNewCriterion({ ...newCriterion, filledBy: e.target.value })} className="border rounded-md p-2 text-sm" />
          </div>
          <DialogFooter className="pt-2">
            <Button onClick={addCriterionLocal}>Добавить</Button>
            <Button variant="outline" onClick={() => setAddCriterionOpen(false)}>Отмена</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
