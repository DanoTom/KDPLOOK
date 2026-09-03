import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookRecord, CategoryChild, CategoryStats, MarketplaceId } from "../../shared/types";
import { deriveMetrics } from "../../shared/analytics/score";
import { summariseCategory } from "../../shared/analytics/category";
import { ApiError, api, type ProductDetailDto } from "../api";
import { BookTable } from "../components/BookTable";
import { Gauge } from "../components/charts";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Kpi, Progress, SegmentedControl } from "../components/ui";
import { downloadCsv, toCsv } from "../lib/csv";
import { fmtCompact, fmtInt, fmtMoney, fmtPct, slug } from "../lib/format";
import { useApp } from "../state";

interface Crumb {
  node: string;
  name: string;
}

export function CategoryPage() {
  const { settings, marketplaces, updateSettings, currencySymbol } = useApp();
  const marketplace: MarketplaceId = settings?.marketplace ?? "com";

  const [department, setDepartment] = useState<"print" | "kindle">("print");
  const [node, setNode] = useState("");
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [children, setChildren] = useState<CategoryChild[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [listed, setListed] = useState(0);
  const [sample, setSample] = useState(20);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const analyse = useCallback(async (target: string, targetName: string | null, noCache = false) => {
    setError(null);
    setWarning(null);
    setBooks([]);
    setProgress({ label: "Leyendo la lista de más vendidos…", done: 0, total: 1 });

    let listing;
    try {
      listing = await api.categoryList({ node: target, marketplace, department, noCache });
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setProgress(null);
      setError({ message: apiError?.message ?? "No se pudo leer la categoría", hint: apiError?.hint });
      return;
    }

    setName(listing.name ?? targetName);
    setChildren(listing.children);
    setListed(listing.asins.length);
    if (listing.warning) setWarning(listing.warning);

    const targets = listing.asins.slice(0, Math.max(0, Math.min(40, sample)));
    if (!targets.length) {
      setProgress(null);
      return;
    }

    // Enrich in the same batches a niche scan uses, so the Worker budgets hold.
    const collected: BookRecord[] = [];
    let aborted = false;

    const readBatch = async (asins: string[], label: (done: number) => string): Promise<string[]> => {
      const failed: string[] = [];
      for (let i = 0; i < asins.length; i += 8) {
        setProgress({ label: label(collected.length), done: collected.length, total: targets.length });
        try {
          const response = await api.enrich({ asins: asins.slice(i, i + 8), marketplace });
          for (const detail of response.details) {
            collected.push(bookFromDetail(detail, marketplace, targets.indexOf(detail.asin) + 1));
          }
          failed.push(...response.failed);
        } catch (err) {
          const apiError = err instanceof ApiError ? err : null;
          setWarning(`Muestra incompleta: ${apiError?.message ?? "fallo de red"}`);
          aborted = true;
          return failed.concat(asins.slice(i));
        }
      }
      return failed;
    };

    let pending = await readBatch(targets, (done) => `Leyendo fichas (${done}/${targets.length})`);

    // The same pages usually load moments later, so retry only the refused ones.
    for (let round = 1; round <= 2 && pending.length > 0 && !aborted; round++) {
      setProgress({ label: `Amazon rechazó ${pending.length} fichas · reintento ${round} de 2`, done: collected.length, total: targets.length });
      await new Promise((resolve) => setTimeout(resolve, 2500 * round));
      pending = await readBatch(pending, (done) => `Reintentando fichas bloqueadas (${done}/${targets.length})`);
    }

    if (pending.length) {
      setWarning(`${pending.length} de ${targets.length} fichas siguen sin leerse tras dos reintentos. Las métricas usan la muestra disponible.`);
    }

    // Keep bestseller order; a book whose page failed simply leaves a gap.
    collected.sort((a, b) => a.position - b.position);
    setBooks(collected);
    setProgress(null);
  }, [marketplace, department, sample]);

  useEffect(() => {
    void analyse("", null);
    // Reload the root whenever the store or department changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplace, department]);

  function openChild(child: CategoryChild) {
    setTrail((current) => [...current, { node, name: name ?? "Raíz" }]);
    setNode(child.node);
    void analyse(child.node, child.name);
  }

  function goBack() {
    const previous = trail[trail.length - 1];
    if (!previous) return;
    setTrail((current) => current.slice(0, -1));
    setNode(previous.node);
    void analyse(previous.node, previous.name);
  }

  const derived = useMemo(
    () => (settings ? books.map((book) => deriveMetrics(book, marketplace, settings)) : []),
    [books, marketplace, settings],
  );

  const stats = useMemo<CategoryStats | null>(() => {
    if (!settings || !derived.length) return null;
    return summariseCategory(derived, { node, name, marketplace, department, listed, settings });
  }, [derived, node, name, marketplace, department, listed, settings]);

  return (
    <Layout
      title="Categorías"
      subtitle="Cuánto hay que vender para llegar al #1 de cada categoría, y quién ocupa hoy esos puestos."
      actions={
        derived.length ? (
          <Button
            size="sm" icon={<Icon.Download size={15} />}
            onClick={() => downloadCsv(`kdplook-categoria-${slug(name ?? node ?? "raiz")}`, toCsv(derived.map((b) => ({
              puesto: b.position, asin: b.asin, titulo: b.title, autor: b.author,
              precio: b.price ?? "", resenas: b.reviews ?? "", bsr: b.bsr ?? "",
              ventas_mes_est: b.salesPerMonth ?? "", regalia_mes_est: b.revenuePerMonth ?? "",
              paginas: b.pages ?? "", editorial: b.publisher ?? "",
              autopublicado: b.selfPublished === null ? "" : b.selfPublished ? "si" : "no",
            }))))}
          >
            CSV
          </Button>
        ) : null
      }
    >
      <div className="stack-lg">
        <Card pad>
          <div className="row">
            <select
              className="select select-market" value={marketplace}
              onChange={(event) => updateSettings({ marketplace: event.target.value as MarketplaceId })}
            >
              {marketplaces.map((market) => <option key={market.id} value={market.id}>{market.flag} {market.label}</option>)}
            </select>
            <SegmentedControl
              value={department} onChange={setDepartment}
              options={[{ value: "print", label: "Papel" }, { value: "kindle", label: "Kindle" }]}
            />
            <Field label={`Fichas a leer: ${sample}`} style={{ width: 180 }}>
              <input type="range" min={8} max={40} step={4} value={sample} onChange={(e) => setSample(Number(e.target.value))} />
            </Field>
            <div className="spacer row-tight">
              {trail.length ? <Button size="sm" variant="ghost" onClick={goBack}>← Volver</Button> : null}
              <Button
                size="sm" icon={<Icon.Refresh size={15} />}
                loading={Boolean(progress)}
                onClick={() => analyse(node, name, true)}
              >
                Reanalizar
              </Button>
            </div>
          </div>

          <div className="row small faint" style={{ marginTop: 10 }}>
            <Icon.Compass size={14} />
            {trail.map((crumb) => <span key={crumb.node || "root"}>{crumb.name} ›</span>)}
            <strong style={{ color: "var(--text)" }}>{name ?? "Más vendidos"}</strong>
          </div>
        </Card>

        {progress ? (
          <Card pad>
            <div className="row small" style={{ marginBottom: 8 }}>
              <span className="spinner" /><strong>{progress.label}</strong>
              <span className="spacer faint">{progress.done}/{progress.total}</span>
            </div>
            <Progress value={progress.done} max={Math.max(1, progress.total)} />
          </Card>
        ) : null}

        {error ? <Alert tone="bad"><strong>{error.message}</strong>{error.hint ? <div className="small">{error.hint}</div> : null}</Alert> : null}
        {warning ? <Alert tone="warn">{warning}</Alert> : null}

        {stats ? (
          <>
            <div className="report-head">
              <Card pad className={`verdict tone-${stats.verdict.tone}`}>
                <Gauge
                  value={100 - stats.difficulty} label="Accesibilidad"
                  tone={stats.difficulty <= 30 ? "good" : stats.difficulty <= 55 ? "warn" : "bad"}
                />
                <h2 style={{ marginTop: 14 }}>{stats.verdict.label}</h2>
                <p className="muted small" style={{ marginTop: 6 }}>{stats.verdict.headline}</p>
                <ul>{stats.verdict.reasoning.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </Card>

              <div className="grid grid-3" style={{ alignContent: "start" }}>
                <Kpi
                  label="Ventas para el #1" value={stats.salesToNumber1 !== null ? fmtInt(stats.salesToNumber1) : "—"}
                  tone="accent" sub={`al mes · BSR ${fmtCompact(stats.bsrNumber1)}`}
                  title="Lo que vende hoy el primero: la vara para el badge de bestseller."
                />
                <Kpi
                  label="Ventas para el top 10" value={stats.salesToNumber10 !== null ? fmtInt(stats.salesToNumber10) : "—"}
                  tone={stats.salesToNumber10 !== null && stats.salesToNumber10 < 60 ? "good" : "warn"}
                  sub={stats.salesToNumber10 !== null ? `≈ ${Math.max(1, Math.round(stats.salesToNumber10 / 30.44))} al día` : "sin datos"}
                />
                <Kpi
                  label="Autopublicados" value={fmtPct(stats.selfPublishedShare)}
                  tone={stats.selfPublishedShare !== null && stats.selfPublishedShare >= 0.5 ? "good" : "warn"}
                  sub="de la lista de más vendidos"
                />
                <Kpi label="Precio mediano" value={fmtMoney(stats.medianPrice, currencySymbol)} tone="neutral" sub={`media ${fmtMoney(stats.avgPrice, currencySymbol)}`} />
                <Kpi
                  label="Reseñas medianas" value={fmtInt(stats.medianReviews)}
                  tone={stats.medianReviews !== null && stats.medianReviews < 150 ? "good" : "warn"}
                  sub={`${stats.sampled} fichas leídas de ${stats.listed}`}
                />
                <Kpi
                  label={department === "kindle" ? "En Kindle Unlimited" : "Páginas medianas"}
                  value={department === "kindle" ? fmtPct(stats.kindleUnlimitedShare) : fmtInt(stats.avgPages)}
                  tone="neutral"
                  sub={department === "kindle" ? "de la muestra" : "extensión típica"}
                />
              </div>
            </div>

            <Card>
              <CardHead title={`Más vendidos (${derived.length})`} note="En el orden en que Amazon los lista hoy." />
              <BookTable items={derived} currency={currencySymbol} marketplace={marketplace} />
            </Card>
          </>
        ) : null}

        {children.length ? (
          <Card>
            <CardHead
              title="Explorar dentro de esta rama"
              note="Cuanto más específica la categoría, más fácil el badge. Baja hasta donde el nicho siga teniendo demanda."
            />
            <div className="card-pad row">
              {children.map((child) => (
                <button key={child.node} className="chip" onClick={() => openChild(child)} style={{ cursor: "pointer" }}>
                  {child.name}
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {!progress && !stats && !error ? (
          <Card>
            <Empty icon="🗂" title="Elige una categoría para analizar">
              Empieza por la raíz y baja por las subcategorías. La pregunta que responde esta pantalla es
              dónde puedes conseguir el badge naranja de bestseller sin necesitar cifras de venta imposibles.
            </Empty>
          </Card>
        ) : null}

        <Card pad>
          <div className="small muted" style={{ lineHeight: 1.65 }}>
            <strong>Cómo leerlo.</strong> «Ventas para el #1» son las unidades mensuales estimadas del libro que
            hoy ocupa ese puesto — lo que tendrías que superar. Sale de su BSR global pasado por la curva de
            ventas, así que hereda sus mismas limitaciones: es un orden de magnitud, no una cifra contable.
            La lista de más vendidos solo aporta el orden; el resto de los datos se leen de cada ficha.
            <Badge tone="neutral">muestra: {stats?.sampled ?? 0} libros</Badge>
          </div>
        </Card>
      </div>
    </Layout>
  );
}

/** A bestseller entry known only from its detail page. */
function bookFromDetail(detail: ProductDetailDto, marketplace: MarketplaceId, position: number): BookRecord {
  return {
    asin: detail.asin,
    title: detail.title ?? detail.asin,
    author: detail.author ?? "",
    url: `https://www.amazon.${marketplace}/dp/${detail.asin}`,
    image: detail.image ?? "",
    format: detail.format ?? "paperback",
    formatLabel: detail.formatLabel ?? "",
    price: detail.price,
    rating: detail.rating,
    reviews: detail.reviews,
    sponsored: false,
    kindleUnlimited: Boolean((detail as { kindleUnlimited?: boolean }).kindleUnlimited),
    position,
    bsr: detail.bsr,
    categoryRanks: detail.categoryRanks ?? [],
    pages: detail.pages,
    publisher: detail.publisher,
    publishedAt: detail.publishedAt,
    language: detail.language,
    isbn: detail.isbn,
    dimensions: detail.dimensions,
    selfPublished: detail.selfPublished,
    enriched: true,
    salesPerMonth: null,
    revenuePerMonth: null,
    royaltyPerUnit: null,
    ageMonths: null,
    weakness: null,
  };
}
