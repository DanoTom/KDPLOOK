import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookRecord, MarketplaceId } from "../../shared/types";
import { reviewsPerMonth } from "../../shared/analytics/book";
import { deriveMetrics } from "../../shared/analytics/score";
import { ApiError, api } from "../api";
import { bookFromDetail } from "../lib/book";
import { BookTable } from "../components/BookTable";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Button, Card, CardHead, Empty, Field, Kpi, Progress } from "../components/ui";
import { fmtInt, fmtMoney } from "../lib/format";
import { useRoute } from "../router";
import { useApp } from "../state";

/**
 * What one publisher is actually doing.
 *
 * A competitor's catalogue answers questions a niche report cannot. Whether
 * somebody is making a living here, or published once and stopped. Whether
 * their recent books beat their old ones, which says the niche is still
 * opening rather than closing. What they charge, how long their books are, and
 * how fast their newest title gathered reviews — that last one being the
 * closest thing available to "what would happen to me if I published this".
 *
 * Amazon has no catalogue endpoint, so this searches the author's name and
 * keeps the rows whose author really matches. Cheap, and it reuses the scan
 * pipeline whole; the cost is that a prolific author under a common name comes
 * back partial, which the screen says rather than hides.
 */

/** Enough of a catalogue to see a pattern without a long wait. */
const MAX_BOOKS = 24;

/** Books newer than this are "what they are doing now" rather than history. */
const RECENT_MONTHS = 18;

export function AuthorPage() {
  const { settings, currencySymbol } = useApp();
  const marketplace: MarketplaceId = settings?.marketplace ?? "com";
  const { query, navigate } = useRoute();

  const [input, setInput] = useState(query.get("nombre") ?? "");
  const [author, setAuthor] = useState<string | null>(null);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [others, setOthers] = useState(0);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = useCallback(async (name: string) => {
    const clean = name.trim();
    if (clean.length < 3) {
      setError("Escribe el nombre completo del autor.");
      return;
    }
    setError(null);
    setNote(null);
    setBooks([]);
    setAuthor(clean);
    setProgress({ label: `Buscando los libros de ${clean}…`, done: 0, total: 2 });

    let found: BookRecord[] = [];
    let offTarget = 0;
    try {
      // Two pages: a working self-publisher rarely has more than that on one
      // name, and it keeps the wait honest.
      for (const page of [1, 2]) {
        const response = await api.searchPage({ keyword: clean, marketplace, page, department: "all" });
        const mine = response.items.filter((item) => !item.sponsored && matchesAuthor(item.author, clean));
        offTarget += response.items.filter((i) => !i.sponsored).length - mine.length;
        found = dedupe([...found, ...(mine as BookRecord[])]);
        if (!response.items.length) break;
      }
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err.message : "No se pudo leer la búsqueda");
      return;
    }

    if (!found.length) {
      setProgress(null);
      setNote(
        offTarget > 0
          ? `La búsqueda devolvió ${offTarget} libros, pero ninguno firmado por «${clean}». Comprueba cómo aparece escrito el nombre en la ficha de uno de sus libros: Amazon distingue «Ana G. Pérez» de «Ana Garcia Perez».`
          : `Amazon no devolvió nada para «${clean}».`,
      );
      return;
    }

    const targets = found.slice(0, MAX_BOOKS);
    const collected: BookRecord[] = [];
    for (let i = 0; i < targets.length; i += 8) {
      setProgress({ label: `Leyendo fichas (${collected.length}/${targets.length})`, done: collected.length, total: targets.length });
      try {
        const response = await api.enrich({ asins: targets.slice(i, i + 8).map((b) => b.asin), marketplace });
        for (const detail of response.details) {
          const base = targets.find((b) => b.asin === detail.asin);
          // The detail page carries everything the card had and more, so the
          // shared converter does the work; only the shelf position is ours.
          collected.push(bookFromDetail(detail, marketplace, base?.position ?? collected.length + 1));
        }
      } catch {
        setNote("Amazon rechazó parte de las fichas: el catálogo sale incompleto.");
      }
    }

    setOthers(Math.max(0, found.length - targets.length));
    setBooks(collected.length ? collected : targets);
    setProgress(null);
  }, [marketplace]);

  useEffect(() => {
    const preset = query.get("nombre");
    if (preset) void run(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derived = useMemo(
    () => (settings ? books.map((b) => deriveMetrics(b, marketplace, settings)) : []),
    [books, marketplace, settings],
  );

  const stats = useMemo(() => summarise(derived), [derived]);

  return (
    <Layout
      title="Explorar un autor"
      subtitle="El catálogo de un competidor dice cosas que un informe de nicho no: si vive de esto, si sigue publicando, y si sus libros nuevos le van mejor que los viejos."
    >
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {note ? <Alert tone="warn">{note}</Alert> : null}

      <Card>
        <div className="card-pad">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Nombre del autor" help="Tal como aparece firmado en la ficha del libro.">
              <input
                className="input input-lg" value={input} placeholder="Nombre Apellido"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    navigate(`/autor?nombre=${encodeURIComponent(input.trim())}`, { replace: true });
                    void run(input);
                  }
                }}
              />
            </Field>
            <Button
              variant="primary" loading={Boolean(progress)} icon={<Icon.Search size={16} />}
              onClick={() => {
                navigate(`/autor?nombre=${encodeURIComponent(input.trim())}`, { replace: true });
                void run(input);
              }}
            >
              Ver catálogo
            </Button>
          </div>
          {progress ? (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="small">{progress.label}</div>
              <Progress value={progress.done} max={Math.max(1, progress.total)} />
            </div>
          ) : null}
        </div>
      </Card>

      {stats ? (
        <>
          <Card>
            <CardHead
              title={author ?? "Catálogo"}
              note={
                `${derived.length} libros leídos` +
                (others ? ` de ${derived.length + others} encontrados` : "") +
                ". Las estimaciones salen de la misma curva que el resto de la app."
              }
            />
            <div className="card-pad grid grid-4">
              <Kpi
                label="Ingreso estimado / mes"
                value={stats.revenue !== null ? fmtMoney(stats.revenue, currencySymbol) : "—"}
                sub="Suma de todo el catálogo leído"
                tone={stats.revenue !== null && stats.revenue > 300 ? "good" : "neutral"}
              />
              <Kpi
                label="Su mejor libro"
                value={stats.best?.bsr !== null && stats.best ? `BSR ${fmtInt(stats.best.bsr)}` : "—"}
                sub={stats.best?.title ?? ""}
              />
              <Kpi
                label="Publicando ahora"
                value={`${stats.recent} de ${derived.length}`}
                sub={`Publicados en los últimos ${RECENT_MONTHS} meses`}
                tone={stats.recent >= 2 ? "good" : "warn"}
              />
              <Kpi
                label="Reseñas al mes"
                value={stats.velocity !== null ? String(stats.velocity) : "—"}
                sub="Mediana de sus libros recientes"
              />
            </div>
            {/* The reading a list of numbers does not give on its own. */}
            <div className="card-pad">
              <Alert tone="info">{verdict(stats, derived.length)}</Alert>
            </div>
          </Card>

          <Card>
            <CardHead title="Sus libros" note="Ordenados como los devolvió Amazon. Pulsa un título para inspeccionarlo." />
            <BookTable items={derived} marketplace={marketplace} currency={currencySymbol} />
          </Card>
        </>
      ) : !progress ? (
        <Empty icon="👤" title="Escribe el nombre de un autor">
          Sale de la ficha de cualquier libro de la competencia. Desde el informe de un nicho,
          el nombre de cada autor te trae aquí.
        </Empty>
      ) : null}
    </Layout>
  );
}

/** Same person, allowing for accents, middle initials and casing. */
function matchesAuthor(found: string, wanted: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const a = norm(found);
  const b = norm(wanted);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Surname plus first name is enough: catalogues print "Ana G. Pérez" and
  // "Ana Perez" for the same person, and requiring every token loses her.
  const wantedParts = b.split(" ").filter((w) => w.length > 2);
  const foundParts = new Set(a.split(" "));
  const shared = wantedParts.filter((w) => foundParts.has(w)).length;
  return wantedParts.length >= 2 && shared >= 2;
}

function dedupe(items: BookRecord[]): BookRecord[] {
  const seen = new Map<string, BookRecord>();
  for (const item of items) if (!seen.has(item.asin)) seen.set(item.asin, item);
  return [...seen.values()];
}

interface AuthorStats {
  revenue: number | null;
  best: { title: string; bsr: number } | null;
  recent: number;
  velocity: number | null;
  sellingRecent: number;
}

function summarise(books: BookRecord[]): AuthorStats | null {
  if (!books.length) return null;
  const revenues = books.map((b) => b.revenuePerMonth).filter((v): v is number => v !== null);
  const ranked = books.filter((b) => b.bsr !== null).sort((a, b) => (a.bsr as number) - (b.bsr as number));
  const recent = books.filter((b) => b.ageMonths !== null && b.ageMonths <= RECENT_MONTHS);
  const velocities = recent.map(reviewsPerMonth).filter((v): v is number => v !== null).sort((a, b) => a - b);

  return {
    revenue: revenues.length ? Math.round(revenues.reduce((a, b) => a + b, 0)) : null,
    best: ranked.length ? { title: ranked[0].title, bsr: ranked[0].bsr as number } : null,
    recent: recent.length,
    velocity: velocities.length ? velocities[Math.floor(velocities.length / 2)] : null,
    sellingRecent: recent.filter((b) => (b.salesPerMonth ?? 0) >= 1).length,
  };
}

/**
 * The question a catalogue answers and a single book cannot: is this a
 * business, an experiment, or something abandoned.
 */
function verdict(stats: AuthorStats, total: number): string {
  if (stats.recent === 0) {
    return "No ha publicado nada en año y medio. Su catálogo es historia: sirve para ver qué funcionó, no para saber si el nicho sigue abierto.";
  }
  if (stats.recent >= 3 && stats.sellingRecent >= 2) {
    return `Sigue publicando y le funciona: ${stats.recent} títulos en año y medio y ${stats.sellingRecent} de ellos vendiendo. Es un competidor activo, y también la prueba de que aquí se puede.`;
  }
  if (stats.sellingRecent === 0) {
    return `Ha publicado ${stats.recent} de sus ${total} libros hace poco y ninguno de esos vende todavía. O es demasiado pronto para saberlo, o está probando sin acertar.`;
  }
  return `Publica de vez en cuando: ${stats.recent} de ${total} títulos son recientes. Se puede competir con alguien así.`;
}
