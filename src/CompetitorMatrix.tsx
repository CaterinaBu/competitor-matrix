import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Maximize2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Plus,
  EyeOff,
  ChevronLeft,
} from "lucide-react";

/**
 * ===========================================================
 *  Competitor Matrix (Sheets-driven)
 *  — грузим данные из Google Sheets (GViz);
 *  — пишем правки в Apps Script (только text/plain!);
 *  — добавление критерия: upsertCriterion + upsertCell для курсов.
 * ===========================================================
 */

/** ===== Конфигурация ===== */
function getSheetId(): string {
  // 1) URL-параметр: ?sheetId=... или ?sheet=...
  try {
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      const p = u.searchParams.get("sheetId") || u.searchParams.get("sheet");
      if (p && p.trim()) return p.trim();
    }
  } catch {}

  // 2) localStorage
  try {
    if (typeof window !== "undefined") {
      const ls = localStorage.getItem("sheet_id");
      if (ls && ls.trim()) return ls.trim();
    }
  } catch {}

  // 3) ENV (Vite)
  // @ts-expect-error import.meta.env может не быть типизирован
  const envId = (import.meta?.env?.VITE_SHEET_ID as string) || "";
  if (envId && envId.trim()) return envId.trim();

  // 4) Фолбек — пусто, чтобы явно попросить указать
  return "";
}
const SHEET_ID = getSheetId();

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/library/d/1A6LAp-4_zpnmBRv3RsAZ8yRY5imq7TO7XwSLm76fiR5Yy7Oy1QeOxRUe/6";

const TABS_INDEX_SHEET = "__tabs"; // лист с колонками: sheet, label

/** ===== Константы матрицы ===== */
const COURSE_CRIT_ID = "course_meta";
const COURSE_GROUP = "0. Курс";
const MISC_GROUP = "Прочие критерии";

/** ===== Типы ===== */
type Course = { id: string; name: string };
type Criterion = {
  id: string;
  name: string;
  description?: string;
  group?: string;
  filledBy?: string;
};
type Img = { url: string; caption?: string };
type Cell = {
  courseId: string;
  criterionId: string;
  text: string;
  images: Img[];
};
type MatrixData = { criteria: Criterion[]; courses: Course[]; cells: Cell[] };
type SheetRow = Record<string, string>;
type Tab = { id: string; label: string };

/** ===== Утилиты ===== */
const gvizUrl = (sheet: string) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(
    sheet
  )}`;

async function fetchWithTimeout(
  resource: string,
  opts: RequestInit = {},
  timeoutMs = 12000
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchGViz(sheet: string): Promise<SheetRow[]> {
  const res = await fetchWithTimeout(gvizUrl(sheet), { credentials: "omit" });
  if (!res.ok) throw new Error(`Failed to fetch sheet ${sheet}: ${res.status}`);
  const text = await res.text();

  // GViz JSON завернут в вызов функции — достаём JSON
  const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\)/);
  if (!m) return [];
  const parsed = JSON.parse(m[1]);
  const cols = (parsed.table.cols || []).map((c: any) => c.label || c.id || "");
  const rows = (parsed.table.rows || []).map((r: any) => {
    const obj: Record<string, string> = {};
    (r.c || []).forEach((cell: any, i: number) => {
      obj[cols[i] || `col_${i}`] =
        cell && cell.v != null ? String(cell.v) : "";
    });
    return obj as SheetRow;
  });
  return rows;
}

function getApiKey() {
  try {
    if (typeof window !== "undefined") {
      return localStorage.getItem("gs_api_key") || "";
    }
  } catch {}
  return "";
}
function setApiKey(v: string) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem("gs_api_key", v || "");
    }
  } catch {}
}

function extractDriveId(u: string) {
  try {
    const m1 = u.match(/\/file\/d\/([^/]+)/);
    if (m1) return m1[1];
    const m2 = u.match(/[?&]id=([^&]+)/);
    if (m2) return m2[1];
  } catch {}
  return null;
}

/** Единственный normalizeImageUrl в файле */
function normalizeImageUrl(u: string): string {
  if (!u) return u;
  const id = extractDriveId(u);
  if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  try {
    const url = new URL(u);
    if (/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(url.pathname)) return u;
  } catch {}
  return u;
}

/** Преобразование строк GViz в структуру матрицы */
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

  const courses: Course[] = courseIds.map((cid, i) => ({
    id: cid,
    name: `Курс ${i + 1}`,
  }));

  const criteria: Criterion[] = [];
  const cells: Cell[] = [];

  rows.forEach((r, idx) => {
    const group = String(r.section || "").trim();
    const name = String(r.criterion || "").trim();
    const description = String(r.description || "").trim();
    const filledBy = String(r.filled_by || r.filledBy || "").trim();
    const criterionId = String(r.criterion_id || r.criterionId || "").trim();

    if (!criterionId && !name && !group && !description) return;

    const id = criterionId || `row_${idx}`;
    criteria.push({
      id,
      name: name || `Критерий ${idx + 1}`,
      description,
      filledBy,
      group: group || MISC_GROUP,
    });

    courseIds.forEach((cid) => {
      const text = String(r[`${cid}_text`] || "").trim();
      const imagesRaw = String(r[`${cid}_images`] || "").trim();
      const images: Img[] = imagesRaw
        ? imagesRaw
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((url) => ({ url: normalizeImageUrl(url) }))
        : [];
      cells.push({ courseId: cid, criterionId: id, text, images });
    });
  });

  // Добавим «курс» как несворачиваемую «квази-строку»
  if (!criteria.find((c) => c.id === COURSE_CRIT_ID)) {
    criteria.unshift({
      id: COURSE_CRIT_ID,
      name: "Курс",
      group: COURSE_GROUP,
    });
  }

  return { criteria, courses, cells };
}

/** ===== Вьюшные помощники ===== */
function Img({ url, alt, className }: { url: string; alt: string; className?: string }) {
  return <img src={normalizeImageUrl(url)} alt={alt} className={className} />;
}

function CriterionHeader({ k }: { k: Criterion }) {
  return (
    <div className="font-medium border-b px-2 py-2">
      <div className="text-sm">{k.name}</div>
      {k.description ? (
        <div className="text-xs text-muted-foreground">{k.description}</div>
      ) : null}
      {k.filledBy ? (
        <div className="text-[11px] text-muted-foreground mt-1">
          Кто заполняет: {k.filledBy}
        </div>
      ) : null}
    </div>
  );
}

function CellCardView({
  cell,
  onOpen,
  onEdit,
}: {
  cell: Cell | undefined;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const imgs = cell?.images || [];
  return (
    <div className="px-2 py-2 border-b">
      <Card className="shadow-none">
        <CardContent className="p-3">
          <div className="text-sm whitespace-pre-wrap">
            {cell?.text?.trim() || <span className="text-muted-foreground">—</span>}
          </div>
          {imgs.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {imgs.map((img, i) => (
                <Img
                  key={i}
                  url={img.url}
                  alt={img.caption || "preview"}
                  className="h-12 w-12 object-cover rounded"
                />
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={onOpen}>
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Edit3 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CourseHeaderCell({
  cLabel,
  onHide,
}: {
  cLabel: string;
  onHide: () => void;
}) {
  return (
    <div className="font-medium border-b px-2 py-2 flex items-center justify-between gap-2">
      <span>{cLabel}</span>
      <Button size="sm" variant="ghost" title="Скрыть курс" onClick={onHide}>
        <EyeOff className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** ===== Компонент ===== */
export default function CompetitorMatrix() {
  /** вкладки */
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabToSheet, setTabToSheet] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>("");

  /** матрица */
  const [data, setData] = useState<MatrixData>({
    criteria: [],
    courses: [],
    cells: [],
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** просмотр/редактирование ячейки */
  const [open, setOpen] = useState<{ courseId: string; criterionId: string } | null>(
    null
  );
  const [edit, setEdit] = useState<{ courseId: string; criterionId: string } | null>(
    null
  );
  const [draftText, setDraftText] = useState("");
  const [draftImages, setDraftImages] = useState("");

  /** добавление критерия */
  const [addCriterionOpen, setAddCriterionOpen] = useState(false);
  const [newCriterion, setNewCriterion] = useState<{
    name: string;
    description: string;
    filledBy: string;
  }>({ name: "", description: "", filledBy: "" });

  /** скрытие курсов */
  const [hiddenCourses, setHiddenCourses] = useState<string[]>(() => {
    try {
      if (typeof window !== "undefined") {
        return JSON.parse(localStorage.getItem("hiddenCourseIds") || "[]") || [];
      }
    } catch {}
    return [];
  });

  const visibleCourses = useMemo(
    () => data.courses.filter((c) => !hiddenCourses.includes(c.id)),
    [data.courses, hiddenCourses]
  );

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {}
  );

  const [viewerIndex, setViewerIndex] = useState(0);

  /** загрузка вкладок */
  useEffect(() => {
    (async () => {
      try {
        if (!SHEET_ID) {
          throw new Error(
            "Не указан SHEET_ID. Передайте ?sheetId=<ID_таблицы> в URL, сохраните его в localStorage.sheet_id или задайте VITE_SHEET_ID."
          );
        }
        const rows = await fetchGViz(TABS_INDEX_SHEET);
        if (!rows.length) {
          throw new Error("Нет вкладок (__tabs) — проверь лист и его доступность");
        }

        const t: Tab[] = [];
        const map: Record<string, string> = {};

        rows.forEach((r, idx) => {
          // допускаем разные заголовки колонок
          const keys = Object.fromEntries(
            Object.keys(r).map((k) => [k.toLowerCase().trim(), k])
          );
          const sheetKey =
            keys.sheet ?? keys["лист"] ?? keys["tab"] ?? keys["sheet_name"] ?? "sheet";
          const labelKey =
            keys.label ?? keys["вкладка"] ?? keys["название"] ?? "label";

          const sheet = String(r[sheetKey] || "").trim();
          const label = String(r[labelKey] || "").trim() || sheet || `Tab ${idx + 1}`;
          if (!sheet) return;

          const id = label;
          t.push({ id, label });
          map[id] = sheet;
        });

        setTabs(t);
        setTabToSheet(map);
        if (!t.length) throw new Error("Нет вкладок (__tabs)");
        setActiveTab((prev) => (prev && map[prev] ? prev : t[0].id));
      } catch (e: any) {
        setLoadError(e?.message || String(e));
      }
    })();
  }, []);

  /** загрузка данных активной вкладки */
  useEffect(() => {
    if (!activeTab) return;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const sheet = tabToSheet[activeTab];
        if (!sheet) throw new Error("Лист не найден для вкладки");
        const rows = await fetchGViz(sheet);
        const matrix = rowsToMatrix(rows);
        setData(matrix);
        // раскрыть все группы по умолчанию
        const nextGroups: Record<string, boolean> = {};
        matrix.criteria.forEach((c) => {
          const g =
            c.group && c.group !== "XI. Прочее" ? c.group : MISC_GROUP;
          nextGroups[g] = false;
        });
        setCollapsedGroups(nextGroups);
      } catch (e: any) {
        setLoadError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [activeTab, tabToSheet]);

  /** геттер ячейки */
  const getCell = (courseId: string, criterionId: string): Cell | undefined =>
    data.cells.find((x) => x.courseId === courseId && x.criterionId === criterionId);

  /** сохранить ячейку в Таблицу */
  async function saveCell(courseId: string, criterionId: string) {
    const imagesLines = draftImages || "";
    const text = draftText || "";
    const sheetName = tabToSheet[activeTab];
    const crit = data.criteria.find((c) => c.id === criterionId);

    // локально
    setData((prev) => {
      const next = { ...prev, cells: [...prev.cells] };
      const idx = next.cells.findIndex(
        (c) => c.courseId === courseId && c.criterionId === criterionId
      );
      const cell: Cell = {
        courseId,
        criterionId,
        text,
        images: imagesLines
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((url) => ({ url: normalizeImageUrl(url) })),
      };
      if (idx >= 0) next.cells[idx] = cell;
      else next.cells.push(cell);
      return next;
    });

    // сброс модалки
    setEdit(null);

    if (!APPS_SCRIPT_URL) return;
    const payload = {
      action: "upsertCell",
      apiKey: getApiKey(),
      tab: sheetName,
      courseId,
      criterionId,
      criterion: crit?.name || "",
      text,
      images: imagesLines
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      updatedBy:
        (typeof window !== "undefined" &&
          (localStorage.getItem("user_name") || "anonymous")) ||
        "anonymous",
    } as const;

    try {
      let res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" }, // ВАЖНО: только text/plain
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(raw);
      } catch {}
      const unauthorized =
        !!(json &&
          typeof json.error === "string" &&
          json.error.toUpperCase().includes("UNAUTHORIZED"));
      if (unauthorized) {
        const key =
          typeof window !== "undefined"
            ? window.prompt("Введите API_KEY для записи в таблицу", "")
            : null;
        if (key) {
          setApiKey(key);
          await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ ...payload, apiKey: key }),
          });
        }
      }
    } catch (e) {
      console.warn("Apps Script недоступен, данные только локально", e);
    }
  }

  /** скрыть курс */
  function hideCourse(id: string) {
    setHiddenCourses((prev) => {
      const next = [...prev, id];
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem("hiddenCourseIds", JSON.stringify(next));
        }
      } catch {}
      return next;
    });
  }

  /** сгруппированные критерии */
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

  function toggleGroup(g: string) {
    setCollapsedGroups((prev) => ({ ...prev, [g]: !prev[g] }));
  }

  /** добавление критерия — исправленная версия */
  async function addCriterionLocal() {
    const name = newCriterion.name.trim();
    if (!name) return;

    const id = `cr-${Date.now()}`;
    const description = newCriterion.description.trim();
    const filledBy = newCriterion.filledBy.trim();

    // локально добавим критерий в «Прочие критерии»
    const newC: Criterion = {
      id,
      name,
      description,
      filledBy,
      group: MISC_GROUP,
    };
    setData((prev) => ({ ...prev, criteria: [...prev.criteria, newC] }));

    // сброс формы
    setNewCriterion({ name: "", description: "", filledBy: "" });
    setAddCriterionOpen(false);

    if (!APPS_SCRIPT_URL) return;
    const sheetName = tabToSheet[activeTab];

    // 1) метаданные критерия
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action: "upsertCriterion",
          apiKey: getApiKey(),
          tab: sheetName,
          criterionId: id,
          section: "Прочие критерии",
          criterion: name,
          description,
          filled_by: filledBy,
        }),
      });
    } catch (e) {
      console.warn("Не удалось записать метаданные критерия", e);
    }

    // 2) пропраймить пустые ячейки под все курсы — чтобы строка сразу появилась
    try {
      await Promise.all(
        (data.courses || []).map((c) =>
          fetch(APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({
              action: "upsertCell",
              apiKey: getApiKey(),
              tab: sheetName,
              courseId: c.id,
              criterionId: id,
              text: "",
              images: [],
            }),
          })
        )
      );
    } catch (e) {
      console.warn("Не удалось создать пустые ячейки для нового критерия", e);
    }
  }

  /** ===== Рендер ===== */
  if (loadError) {
    return (
      <div className="p-4 text-sm text-red-600">
        Ошибка загрузки: {String(loadError)}
      </div>
    );
  }
  if (loading && !data.criteria.length) {
    return <div className="p-4 text-sm text-muted-foreground">Загрузка…</div>;
  }

  return (
    <div className="w-full h-full p-4">
      {/* Вкладки */}
      <div className="flex gap-2 overflow-x-auto pb-3 -mt-1">
        {tabs.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Нет вкладок. Создайте лист <code>__tabs</code> с колонками{" "}
            <code>sheet</code>, <code>label</code>. Убедитесь, что указан правильный{" "}
            <code>sheetId</code>.
          </span>
        ) : (
          tabs.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={activeTab === t.id ? "default" : "outline"}
              onClick={() => setActiveTab(t.id)}
              className="whitespace-nowrap"
            >
              {t.label}
            </Button>
          ))
        )}
      </div>

      {/* Кнопки действий */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold">
          Матрица анализа конкурентов —{" "}
          <span className="font-normal">
            {tabs.find((t) => t.id === activeTab)?.label || "—"}
          </span>
        </h1>
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCollapsedGroups((prev) => {
                const allClosed = Object.values(prev).every((v) => v === true);
                const next: Record<string, boolean> = {};
                Object.keys(prev).forEach((g) => (next[g] = !allClosed));
                return next;
              })
            }
            disabled={!activeTab}
          >
            Сменить разворот групп
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => setAddCriterionOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" /> Добавить критерий
          </Button>
        </div>
      </div>

      {/* Таблица */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `minmax(220px, 1fr) repeat(${visibleCourses.length}, minmax(240px, 1fr))`,
          gap: "0px",
        }}
      >
        {/* Заголовки курсов */}
        <div className="px-2 py-2 border-b font-semibold">Критерий</div>
        {visibleCourses.map((c, i) => (
          <CourseHeaderCell
            key={c.id}
            cLabel={`Курс ${i + 1}`}
            onHide={() => hideCourse(c.id)}
          />
        ))}

        {/* Группы и строки */}
        {Object.entries(groupedCriteria).map(([group, criteria]) => (
          <React.Fragment key={group}>
            <div className="col-span-full flex items-center bg-gray-100 px-2 py-2 border-t">
              <div
                className="flex items-center gap-1 flex-1 cursor-pointer"
                onClick={() => toggleGroup(group)}
              >
                {collapsedGroups[group] ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                <span className="font-semibold text-sm">{group}</span>
              </div>
              {group === MISC_GROUP && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddCriterionOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" /> Добавить критерий
                </Button>
              )}
            </div>

            {!collapsedGroups[group] &&
              criteria.map((k) => (
                <React.Fragment key={k.id}>
                  <CriterionHeader k={k} />
                  {visibleCourses.map((c) => {
                    const cell = getCell(c.id, k.id);
                    return (
                      <CellCardView
                        key={c.id + k.id}
                        cell={cell}
                        onOpen={() => setOpen({ courseId: c.id, criterionId: k.id })}
                        onEdit={() => {
                          setEdit({ courseId: c.id, criterionId: k.id });
                          setDraftText(cell?.text || "");
                          setDraftImages(
                            (cell?.images || []).map((i) => i.url).join("\n")
                          );
                        }}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
          </React.Fragment>
        ))}
      </div>

      {/* Просмотр ячейки */}
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-5xl w-[min(96vw,1200px)] max-h-[85vh] overflow-auto p-4">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Просмотр:{" "}
                  {getCell(open.courseId, COURSE_CRIT_ID)?.text?.trim() ||
                    `Курс ${
                      Math.max(
                        1,
                        data.courses.findIndex((x) => x.id === open.courseId) + 1
                      )
                    }`}
                </DialogTitle>
              </DialogHeader>
              <div className="text-sm whitespace-pre-wrap mb-4">
                {getCell(open.courseId, open.criterionId)?.text || "—"}
              </div>
              {(() => {
                const cell = getCell(open.courseId, open.criterionId);
                const imgs = cell?.images || [];
                if (!imgs.length) return null;
                const clampedIndex = Math.min(
                  Math.max(0, viewerIndex),
                  imgs.length - 1
                );
                const current = imgs[clampedIndex];
                return (
                  <div className="flex flex-col gap-3 items-center">
                    <div className="w-full flex items-center justify-center">
                      <Img
                        url={current.url}
                        alt={current.caption || "image"}
                        className="max-h-[78vh] w-full object-contain rounded border bg-black/5"
                      />
                    </div>
                    <div className="w-full flex items-center gap-3">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() =>
                          setViewerIndex((i) => Math.max(0, i - 1))
                        }
                        disabled={clampedIndex <= 0}
                        title="Назад"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <div className="text-xs">
                        {clampedIndex + 1} / {imgs.length}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() =>
                          setViewerIndex((i) =>
                            Math.min(imgs.length - 1, i + 1)
                          )
                        }
                        disabled={clampedIndex >= imgs.length - 1}
                        title="Вперёд"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <a
                        className="ml-auto underline text-xs"
                        href={current.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть оригинал
                      </a>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Редактирование ячейки */}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <DialogContent className="sm:max-w-4xl">
          {edit && (
            <>
              <DialogHeader>
                <DialogTitle>Редактирование</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div>
                  <Label>Текст</Label>
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    className="border rounded-md p-2 text-sm min-h-[160px] w-full mt-1 resize-y"
                  />
                </div>
                <div>
                  <Label>Ссылки на изображения (по одной в строке)</Label>
                  <textarea
                    value={draftImages}
                    onChange={(e) => setDraftImages(e.target.value)}
                    className="border rounded-md p-2 text-sm min-h-[140px] w-full mt-1 resize-y"
                  />
                  <div className="text-xs text-muted-foreground">
                    Поддерживаются прямые ссылки (jpg/png/webp/…) и Google Drive
                    в форматах <code>/file/d/FILE_ID</code>,{" "}
                    <code>?id=FILE_ID</code>; конвертируются в{" "}
                    <code>uc?export=view</code>.
                  </div>
                </div>
              </div>
              <DialogFooter className="pt-2">
                <Button onClick={() => saveCell(edit.courseId, edit.criterionId)}>
                  Сохранить
                </Button>
                <Button variant="outline" onClick={() => setEdit(null)}>
                  Отмена
                </Button>
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
            <div>
              <Label>Название критерия</Label>
              <input
                value={newCriterion.name}
                onChange={(e) =>
                  setNewCriterion((s) => ({ ...s, name: e.target.value }))
                }
                className="border rounded-md p-2 text-sm w-full mt-1"
                placeholder="например, Наличие практикума"
              />
            </div>
            <div>
              <Label>Описание</Label>
              <input
                value={newCriterion.description}
                onChange={(e) =>
                  setNewCriterion((s) => ({ ...s, description: e.target.value }))
                }
                className="border rounded-md p-2 text-sm w-full mt-1"
                placeholder="как измеряем или что подразумевается"
              />
            </div>
            <div>
              <Label>Кто заполняет</Label>
              <input
                value={newCriterion.filledBy}
                onChange={(e) =>
                  setNewCriterion((s) => ({ ...s, filledBy: e.target.value }))
                }
                className="border rounded-md p-2 text-sm w-full mt-1"
                placeholder="роль/отдел/ФИО"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button onClick={addCriterionLocal}>Добавить</Button>
            <Button variant="outline" onClick={() => setAddCriterionOpen(false)}>
              Отмена
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
