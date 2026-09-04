import { useEffect, useMemo, useState } from "react";
import type { BookRecord, NicheSummary } from "../../shared/types";
import { api } from "../api";
import { BookTable } from "../components/BookTable";
import { BarChart, Donut, Gauge, histogram } from "../components/charts";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Disclosure, Empty, Field, Kpi, Progress, SegmentedControl } from "../components/ui";
import { downloadCsv, toCsv } from "../lib/csv";
import { fmtCompact, fmtDate, fmtInt, fmtMoney, fmtNum, fmtPct, slug, toneForCompetition, toneForScore } from "../lib/format";
import { buildEntryPlan } from "../../shared/analytics/entry";
import { reviewExpertise } from "../../shared/analytics/checklist";
import { monthNames, seasonInsight } from "../../shared/analytics/season";
import { findAngles } from "../../shared/analytics/angles";
import { isPublishableBook } from "../../shared/analytics/book";
import { useNicheScan, type Department } from "../lib/scan";
import { Link, useRoute } from "../router";
import { useApp, useSettings } from "../state";

export function NichePage() {
  const { settings, marketplaces, updateSettings, toast, currencySymbol } = useApp();
  const { query, navigate } = useRoute();
  const scan = useNicheScan(settings!);

  const [keyword, setKeyword] = useState(query.get("keyword") ?? "");
  const [department, setDepartment] = useState<Department>((query.get("dept") as Department) ?? "print");
  const [pages, setPages] = useState(settings?.searchPages ?? 3);
  const [enrich, setEnrich] = useState(settings?.enrichCount ?? 20);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [savedId, setSavedId] = useState<string | null>(null);

  const marketplace = settings?.marketplace ?? "com";

  useEffect(() => {
    api.listWatch().then((items) => setWatched(new Set(items.map((item) => item.asin)))).catch(() => undefined);
  }, []);

  // Deep links: /nicho?id=… opens a saved analysis, ?keyword=… runs a new one.
  useEffect(() => {
    const id = query.get("id");
    if (id) {
      api.getNiche(id)
        .then((niche) => { scan.loadSaved(niche.summary, niche.items); setKeyword(niche.summary.keyword); setSavedId(id); })
        .catch(() => toast("No se pudo abrir el análisis guardado", "bad"));
      return;
    }
    const seed = query.get("keyword");
    if (seed && !scan.result && !scan.busy) {
      setKeyword(seed);
      void scan.run({ keyword: seed, marketplace, department, pages, enrich });
    }
    // Deliberately keyed on the query string only: this is a deep-link handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.toString()]);

  function start(noCache = false) {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    setSavedId(null);
    navigate(`/nicho?keyword=${encodeURIComponent(trimmed)}&dept=${department}`, { replace: true });
    void scan.run({ keyword: trimmed, marketplace, department, pages, enrich, noCache });
  }

  async function save() {
    if (!scan.result) return;
    try {
      const { id } = await api.saveNiche({ summary: scan.result.summary, items: scan.result.items });
      setSavedId(id);
      toast("Análisis guardado en tu biblioteca", "good");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo guardar", "bad");
    }
  }

  async function watch(book: BookRecord) {
    try {
      await api.addWatch({
        asin: book.asin, marketplace, title: book.title, author: book.author,
        format: book.formatLabel, image: book.image,
      });
      setWatched((current) => new Set(current).add(book.asin));
      toast(`"${book.title.slice(0, 40)}…" añadido al seguimiento`, "good");
    } catch {
      toast("No se pudo añadir al seguimiento", "bad");
    }
  }

  function exportCsv() {
    if (!scan.result) return;
    downloadCsv(
      `kdplook-${slug(scan.result.summary.keyword)}`,
      toCsv(scan.result.items.map((book) => ({
        posicion: book.sponsored ? "patrocinado" : book.position,
        asin: book.asin,
        titulo: book.title,
        autor: book.author,
        formato: book.formatLabel,
        precio: book.price ?? "",
        valoracion: book.rating ?? "",
        resenas: book.reviews ?? "",
        bsr: book.bsr ?? "",
        ventas_mes_est: book.salesPerMonth ?? "",
        regalia_unidad_est: book.royaltyPerUnit ?? "",
        regalia_mes_est: book.revenuePerMonth ?? "",
        paginas: book.pages ?? "",
        editorial: book.publisher ?? "",
        autopublicado: book.selfPublished === null ? "" : book.selfPublished ? "si" : "no",
        es_libro_kdp: isPublishableBook(book) ? "si" : "no",
        publicado: book.publishedAt ?? "",
        batible: book.weakness ?? "",
        url: book.url,
      }))),
    );
  }

  const summary = scan.result?.summary ?? null;

  return (
    <Layout
      title="Explorar nicho"
      subtitle="Analiza una palabra clave como si fueras el comprador: quién está arriba, cuánto vende y cuánto cuesta entrar."
      actions={
        scan.result ? (
          <>
            <Button size="sm" icon={<Icon.Download size={15} />} onClick={exportCsv}>CSV</Button>
            <Button
              size="sm" variant={savedId ? "default" : "primary"}
              icon={savedId ? <Icon.Check size={15} /> : <Icon.Save size={15} />}
              onClick={save} disabled={Boolean(savedId)}
            >
              {savedId ? "Guardado" : "Guardar"}
            </Button>
          </>
        ) : null
      }
    >
      <div className="stack-lg">
        <Card pad>
          <form
            className="search-bar"
            onSubmit={(event) => { event.preventDefault(); start(false); }}
          >
            <input
              className="input input-lg"
              placeholder="p. ej. mandala coloring book for adults"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              autoFocus
            />
            <select
              className="select select-market"
              value={marketplace}
              onChange={(event) => updateSettings({ marketplace: event.target.value as typeof marketplace })}
            >
              {marketplaces.map((market) => (
                <option key={market.id} value={market.id}>{market.flag} {market.label}</option>
              ))}
            </select>
            <SegmentedControl
              value={department}
              onChange={setDepartment}
              options={[{ value: "print", label: "Papel" }, { value: "kindle", label: "Kindle" }, { value: "all", label: "Todo" }]}
            />
            <Button type="submit" variant="primary" loading={scan.busy} icon={<Icon.Search size={16} />}>
              Analizar
            </Button>
            {scan.busy ? <Button type="button" variant="ghost" onClick={scan.cancel}>Cancelar</Button> : null}
          </form>

          <div style={{ marginTop: 12 }}>
            <Disclosure
              summary="Ajustes de esta búsqueda"
              note={`${pages * 48} resultados · ${enrich} fichas al detalle`}
            >
              <div className="row" style={{ gap: 18 }}>
                <Field label={`Cuántos resultados mirar: ${pages * 48}`} style={{ width: 210 }}>
                  <input type="range" min={1} max={7} value={pages} onChange={(event) => setPages(Number(event.target.value))} />
                </Field>
                <Field label={`Cuántos libros analizar a fondo: ${enrich}`} style={{ width: 210 }}>
                  <input type="range" min={0} max={40} step={4} value={enrich} onChange={(event) => setEnrich(Number(event.target.value))} />
                </Field>
                <div className="small faint" style={{ maxWidth: 380, lineHeight: 1.6 }}>
                  Analizar a fondo abre la ficha de cada libro para saber cuánto vende. Es de donde salen
                  las estimaciones de ventas y regalías, y también lo que hace lenta la búsqueda. Con 20
                  basta para hacerse una idea del nicho.
                </div>
              </div>
            </Disclosure>
          </div>
        </Card>

        {scan.busy ? (
          <Card pad>
            <div className="row small" style={{ marginBottom: 8 }}>
              <span className="spinner" />
              <strong>{scan.progress.label}</strong>
              <span className="spacer faint">{scan.progress.done}/{scan.progress.total}</span>
            </div>
            <Progress value={scan.progress.done} max={Math.max(1, scan.progress.total)} />
          </Card>
        ) : null}

        {scan.error ? (
          <Alert tone={scan.error.blocked ? "warn" : "bad"}>
            <strong>{scan.error.message}</strong>
            {scan.error.hint ? <div className="small" style={{ marginTop: 4 }}>{scan.error.hint}</div> : null}
            <div className="small" style={{ marginTop: 8 }}>
              Cuando Amazon no deja leer desde el servidor, el camino que siempre funciona es tu propio
              navegador: actívalo en <Link to="/ajustes">Ajustes → Leer Amazon desde tu navegador</Link>.
            </div>
          </Alert>
        ) : null}

        {scan.result?.diagnostics.warnings.length ? (
          <Alert tone="warn">
            <strong>Datos parciales</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }} className="small">
              {scan.result.diagnostics.warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </Alert>
        ) : null}

        {summary && scan.result ? (
          <NicheReport
            summary={summary}
            items={scan.result.items}
            currency={currencySymbol}
            marketplace={marketplace}
            onWatch={watch}
            watched={watched}
          />
        ) : null}

        {!scan.busy && !scan.error && !summary ? (
          <>
            <Card>
              <Empty icon="📚" title="Escribe una palabra clave para empezar">
                Piensa como el comprador: “coloring book for kids ages 4-8”, “sudoku large print”,
                “planificador semanal 2026”. Cuanto más concreta, más útil el resultado.
              </Empty>
            </Card>
            <ImportCapture />
          </>
        ) : null}
      </div>
    </Layout>
  );
}

function NicheReport({
  summary, items, currency, marketplace, onWatch, watched,
}: {
  summary: NicheSummary;
  items: BookRecord[];
  currency: string;
  marketplace: string;
  onWatch: (book: BookRecord) => void;
  watched: Set<string>;
}) {
  const organic = useMemo(() => items.filter((item) => !item.sponsored), [items]);

  const reviewHistogram = useMemo(
    () => histogram(organic.map((book) => book.reviews ?? 0), [
      { label: "0-9", max: 9, tone: "good" },
      { label: "10-49", max: 49, tone: "good" },
      { label: "50-199", max: 199, tone: "warn" },
      { label: "200-999", max: 999, tone: "warn" },
      { label: "1k+", max: Infinity, tone: "bad" },
    ]),
    [organic],
  );

  const priceHistogram = useMemo(() => {
    const prices = organic.map((book) => book.price).filter((p): p is number => p !== null);
    return histogram(prices, [
      { label: `<${currency}6`, max: 5.99, tone: "bad" },
      { label: `${currency}6-9`, max: 9.99, tone: "warn" },
      { label: `${currency}10-14`, max: 14.99, tone: "good" },
      { label: `${currency}15-24`, max: 24.99, tone: "good" },
      { label: `${currency}25+`, max: Infinity, tone: "accent" },
    ]);
  }, [organic, currency]);

  const yearChart = useMemo(() => {
    const years = organic
      .map((book) => (book.publishedAt ? Number(book.publishedAt.slice(0, 4)) : null))
      .filter((y): y is number => y !== null && y > 1990);
    if (!years.length) return [];
    const thisYear = new Date().getFullYear();
    const buckets = new Map<string, number>();
    for (let y = thisYear - 5; y <= thisYear; y++) buckets.set(String(y), 0);
    buckets.set(`≤${thisYear - 6}`, 0);
    for (const year of years) {
      const key = year >= thisYear - 5 ? String(year) : `≤${thisYear - 6}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const entries = Array.from(buckets.entries());
    // Oldest bucket first so the chart reads left-to-right in time.
    const tail = entries.pop();
    return [tail!, ...entries].map(([label, value]) => ({
      label, value,
      tone: label.startsWith("≤") ? ("neutral" as const) : ("info" as const),
    }));
  }, [organic]);

  const topEarners = useMemo(
    () => organic
      .filter((book) => book.revenuePerMonth !== null)
      .sort((a, b) => (b.revenuePerMonth ?? 0) - (a.revenuePerMonth ?? 0))
      .slice(0, 8)
      .map((book) => ({
        label: book.title.slice(0, 34),
        value: book.revenuePerMonth ?? 0,
        tone: "accent" as const,
        hint: `${book.title} · ${fmtMoney(book.revenuePerMonth, currency)}/mes estimados`,
      })),
    [organic, currency],
  );

  const knownPublisher = organic.filter((book) => book.selfPublished !== null);

  return (
    <div className="stack-lg">
      <SeasonBanner keyword={summary.keyword} />

      <ExpertGates items={items} summary={summary} />

      <div className="report-head">
        <Card pad className={`verdict tone-${summary.verdict.tone}`}>
          <Gauge value={summary.opportunityScore} label="Oportunidad" tone={toneForScore(summary.opportunityScore)} />
          <h2 style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {summary.verdict.label}
            <Badge tone={summary.confidence === "high" ? "good" : summary.confidence === "medium" ? "warn" : "neutral"}>
              confianza {summary.confidence === "high" ? "alta" : summary.confidence === "medium" ? "media" : "baja"}
            </Badge>
          </h2>
          <p className="muted small" style={{ marginTop: 6 }}>{summary.verdict.headline}</p>
          <ul>
            {summary.verdict.reasoning.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </Card>

        <div className="grid grid-3" style={{ alignContent: "start" }}>
          <Kpi
            label="Se vende" value={summary.demandScore} tone={toneForScore(summary.demandScore)}
            sub={summary.medianSalesPerMonth !== null
              ? `${fmtInt(summary.medianSalesPerMonth)} ventas/mes (mediana) · ${fmtInt(summary.avgSalesPerMonth)} de media`
              : "sin datos de BSR"}
          />
          <Kpi
            label="Competencia" value={summary.competitionScore} tone={toneForCompetition(summary.competitionScore)}
            sub={`mediana ${fmtInt(summary.medianReviews)} reseñas`}
          />
          {/* One of the two hard gates in the entry criteria, and it was buried
              among the signals while the headline score barely used it. */}
          <Kpi
            label="Libros compitiendo"
            value={summary.totalResults !== null ? fmtCompact(summary.totalResults) : "—"}
            tone={summary.totalResults === null ? "neutral"
              : summary.totalResults <= 1000 ? "good"
              : summary.totalResults <= 2000 ? "warn" : "bad"}
            sub={summary.totalResults === null ? "Amazon no dio el recuento"
              : summary.totalResults <= 1000 ? "nicho verde: se entra orgánicamente"
              : summary.totalResults <= 2000 ? "viable con algo de publicidad"
              : "por encima de tu límite de 2.000"}
          />
          <Kpi
            label="Regalías del top" value={fmtMoney(summary.totalRevenuePerMonth, currency)} tone="accent"
            sub="suma mensual estimada del top 20"
          />
          <Kpi
            label="Precio mediano" value={fmtMoney(summary.medianPrice, currency)} tone="neutral"
            sub={`media ${fmtMoney(summary.avgPrice, currency)}`}
          />
          <Kpi
            label="BSR mediano" value={fmtCompact(summary.medianBsr)} tone="neutral"
            sub={`${summary.enriched} fichas leídas de ${summary.analysed}`}
          />
          <Kpi
            label="Autopublicados" value={fmtPct(summary.selfPublishedShare)}
            tone={summary.selfPublishedShare !== null && summary.selfPublishedShare >= 0.5 ? "good" : "warn"}
            sub={`${fmtPct(summary.lowReviewShare)} con pocas reseñas`}
          />
        </div>
      </div>

      <EntryPlanCard items={items} currency={currency} />

      <AnglesCard items={items} keyword={summary.keyword} />

      <Card>
        <CardHead title="Señales del nicho" note="Cada indicador con su lectura práctica." />
        <div className="card-pad grid grid-3">
          {summary.signals.map((signal) => (
            <div key={signal.id} className="signal">
              <span className={`dot dot-${signal.tone === "neutral" ? "neutral" : signal.tone}`} />
              <div className="signal-body">
                <div className="signal-label">{signal.label}</div>
                <div className="signal-value">{signal.value}</div>
                <div className="signal-hint">{signal.hint}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Reseñas del top" note="Cuántos rivales son alcanzables por volumen social." />
          <div className="card-pad"><BarChart data={reviewHistogram} /></div>
        </Card>
        <Card>
          <CardHead title="Precios" note="Dónde se concentra el precio de lista." />
          <div className="card-pad"><BarChart data={priceHistogram} /></div>
        </Card>
        <Card>
          <CardHead title="Año de publicación" note="Si el top es antiguo, hay hueco para algo actual." />
          <div className="card-pad">
            {yearChart.length ? <BarChart data={yearChart} /> : <Empty title="Sin fechas" >Enriquece más fichas para ver esta distribución.</Empty>}
          </div>
        </Card>
        <Card>
          <CardHead title="Quién publica" note="Indie contra editorial en la primera página." />
          <div className="card-pad">
            {knownPublisher.length ? (
              <Donut
                size={116}
                centerValue={fmtPct(summary.selfPublishedShare)}
                centerLabel="indie"
                segments={[
                  { label: "Autopublicados", value: knownPublisher.filter((b) => b.selfPublished).length, tone: "good" },
                  { label: "Editoriales", value: knownPublisher.filter((b) => !b.selfPublished).length, tone: "info" },
                ]}
              />
            ) : <Empty title="Sin datos de editorial">Enriquece fichas para conocer quién publica.</Empty>}
          </div>
        </Card>
      </div>

      {topEarners.length ? (
        <Card>
          <CardHead title="Quién se lleva el dinero" note={`Regalía mensual estimada · ${currency}`} />
          <div className="card-pad"><BarChart data={topEarners} horizontal format={(v) => fmtMoney(v, currency)} /></div>
        </Card>
      ) : null}

      <Card>
        <CardHead
          title={`Resultados (${organic.length})`}
          note={summary.resultsCountText ?? (summary.totalResults ? `${fmtInt(summary.totalResults)} resultados en Amazon` : undefined)}
        >
          <span className="tiny faint">Analizado {fmtDate(summary.scannedAt)} · media {fmtNum(summary.avgRating, 2)}★</span>
        </CardHead>
        <BookTable items={items} currency={currency} marketplace={marketplace} onWatch={onWatch} watched={watched} />
      </Card>
    </div>
  );
}


/**
 * The report answers "what is happening here"; this answers "should I publish
 * here, and what would my book have to be". Every figure is arithmetic over
 * numbers already on screen, so nothing new is estimated — the one assumption,
 * the review rate, is adjustable and labelled as an assumption.
 */
function EntryPlanCard({ items, currency }: { items: BookRecord[]; currency: string }) {
  const settings = useSettings();
  const [targetIncome, setTargetIncome] = useState(300);
  const [reviewRate, setReviewRate] = useState(1);
  const [aim, setAim] = useState(10);

  const plan = useMemo(
    () => buildEntryPlan({
      items,
      settings,
      marketplace: settings.marketplace,
      targetIncome,
      reviewsPerHundredSales: reviewRate,
      aimPosition: aim,
    }),
    [items, settings, targetIncome, reviewRate, aim],
  );

  const tone = plan.feasibility === "alcanzable" ? "good"
    : plan.feasibility === "exigente" ? "warn"
    : plan.feasibility === "duro" ? "bad" : "neutral";

  return (
    <Card>
      <CardHead title="¿Y ahora qué?" note="Lo que tendría que hacer tu libro para entrar aquí.">
        <SegmentedControl
          value={String(aim)}
          onChange={(value) => setAim(Number(value))}
          options={[{ value: "5", label: "Top 5" }, { value: "10", label: "Top 10" }, { value: "20", label: "Top 20" }]}
        />
      </CardHead>

      <div className="card-pad stack">
        <Alert tone={tone === "neutral" ? "info" : tone}>
          <strong>{plan.headline}</strong>
        </Alert>

        <div className="grid grid-4">
          <Kpi
            label="Ventas para entrar" tone={tone}
            value={plan.targetSalesPerMonth !== null ? fmtInt(plan.targetSalesPerMonth) : "—"}
            sub={plan.targetSalesPerDay !== null ? `al mes · ${fmtNum(plan.targetSalesPerDay, 2)} al día` : "sin datos de BSR"}
            title={plan.targetTitle ? `Puesto ${plan.targetPosition}: ${plan.targetTitle}` : undefined}
          />
          <Kpi
            label="Reseñas a superar" tone={plan.reviewsToBeat !== null && plan.reviewsToBeat < 50 ? "good" : "warn"}
            value={fmtInt(plan.reviewsToBeat)}
            sub={plan.targetPosition ? `las del puesto ${plan.targetPosition}` : "mediana del top"}
          />
          <Kpi
            label="Tu regalía por unidad" tone={plan.royaltyPerUnit !== null && plan.royaltyPerUnit >= 3 ? "good" : "warn"}
            value={fmtMoney(plan.royaltyPerUnit, currency)}
            sub={plan.suggestedPrice !== null ? `a ${fmtMoney(plan.suggestedPrice, currency)} con ${fmtInt(plan.suggestedPages)} págs.` : "sin precio de referencia"}
          />
          <Kpi
            label={`Para ${fmtMoney(targetIncome, currency)}/mes`} tone="accent"
            value={plan.unitsForTarget !== null ? fmtInt(plan.unitsForTarget) : "—"}
            sub="ejemplares al mes"
          />
        </div>

        <div className="grid grid-2">
          <Field label={`Objetivo de ingresos: ${fmtMoney(targetIncome, currency)}/mes`}>
            <input type="range" min={50} max={2000} step={50} value={targetIncome} onChange={(e) => setTargetIncome(Number(e.target.value))} />
          </Field>
          <Field
            label={`Reseñas por cada 100 ventas: ${reviewRate}`}
            help="Suposición del sector, no un dato medido. Si conoces tu tasa real, ponla aquí."
          >
            <input type="range" min={0.5} max={5} step={0.5} value={reviewRate} onChange={(e) => setReviewRate(Number(e.target.value))} />
          </Field>
        </div>

        {plan.monthsToReviews !== null ? (
          <Alert tone={plan.monthsToReviews > 24 ? "warn" : "info"}>
            {plan.monthsToReviews > 36 ? (
              <>
                <strong>Las reseñas son la barrera aquí, no las ventas.</strong> Vendiendo al ritmo de
                entrada harían falta más de {Math.round(plan.monthsToReviews / 12)} años para igualar
                las {fmtInt(plan.reviewsToBeat)} reseñas del puesto {plan.targetPosition}. Entrar es
                posible; desbancarlos por prueba social, no. Compite por ángulo y portada, o busca una
                consulta más específica donde el líder tenga pocas reseñas.
              </>
            ) : (
              <>
                Al ritmo de entrada tardarías unos <strong>{fmtNum(plan.monthsToReviews, 1)} meses</strong> en
                acumular las {fmtInt(plan.reviewsToBeat)} reseñas del puesto {plan.targetPosition}.
              </>
            )}
          </Alert>
        ) : null}

        {plan.unitsForTarget !== null && plan.targetSalesPerMonth !== null ? (
          <div className="small muted" style={{ lineHeight: 1.7 }}>
            <strong>En resumen.</strong> Un libro de unas {fmtInt(plan.suggestedPages)} páginas a{" "}
            {fmtMoney(plan.suggestedPrice, currency)} te dejaría {fmtMoney(plan.royaltyPerUnit, currency)} por
            ejemplar. Para ganar {fmtMoney(targetIncome, currency)} al mes necesitas{" "}
            <strong>{fmtInt(plan.unitsForTarget)} ventas mensuales</strong>
            {plan.unitsForTarget > plan.targetSalesPerMonth
              ? `, que es ${fmtNum(plan.unitsForTarget / plan.targetSalesPerMonth, 1)} veces lo que vende el puesto ${plan.targetPosition}: ese objetivo pide varios títulos, no uno.`
              : `, menos de lo que vende el puesto ${plan.targetPosition}: un solo título bien colocado puede llegar.`}
          </div>
        ) : null}

        {plan.golden ? (
          <div className="signal" style={{ alignItems: "flex-start" }}>
            <span className={`badge badge-${plan.golden.fits ? "good" : "warn"}`} style={{ borderRadius: 7, minWidth: 26, justifyContent: "center" }}>
              {plan.golden.fits ? "✓" : "!"}
            </span>
            <div className="signal-body">
              <div className="signal-label">Combinación dorada</div>
              <div className="signal-value">
                {plan.golden.pages} págs. B/N a {fmtMoney(plan.golden.priceLow, currency)}–{fmtMoney(plan.golden.priceHigh, currency)}
                {" → "}{fmtMoney(plan.golden.royaltyLow, currency)}–{fmtMoney(plan.golden.royaltyHigh, currency)} por ejemplar
              </div>
              <div className="signal-hint">{plan.golden.advice}</div>
            </div>
          </div>
        ) : null}

        {plan.notes.length ? (
          <ul className="small faint" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {plan.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}


/**
 * The publisher's own entry criteria, shown before any score.
 *
 * A 0-100 number is an opinion with the reasoning removed. These three gates
 * come from the field guide the publisher works to, and each one states the
 * threshold it applied, so the verdict can be argued with rather than trusted.
 */
function ExpertGates({ items, summary }: { items: BookRecord[]; summary: NicheSummary }) {
  const settings = useSettings();
  const review = useMemo(
    () => reviewExpertise(items, {
      marketplace: summary.marketplace,
      totalResults: summary.totalResults,
      settings,
    }),
    [items, summary, settings],
  );

  return (
    <Card>
      <CardHead
        title="Criterios de entrada"
        note="Los tres filtros objetivos antes de comprometer un título."
      >
        <Badge tone={review.tone === "great" ? "good" : review.tone === "good" ? "info" : review.tone === "mixed" ? "warn" : review.tone === "bad" ? "bad" : "neutral"}>
          {review.passed}/{review.evaluated || 3} · {review.headline}
        </Badge>
      </CardHead>

      <div className="card-pad stack">
        {/* Which of the three businesses this is decides the price floor, the
            page count that earns most, and when a rival becomes reachable. */}
        <Alert tone="info">
          <strong>{review.profile.label}</strong> — {review.profile.note}
          <div className="small" style={{ marginTop: 6 }}>
            Los criterios de abajo usan sus números: precio desde{" "}
            {review.profile.priceFloor.toFixed(2)}, {review.profile.sweetSpotPages} páginas como punto
            dulce, y un rival alcanzable por debajo de {review.profile.beatableReviews} reseñas.
          </div>
        </Alert>

        <div className="grid grid-3">
          {review.gates.map((gate) => (
            <div key={gate.id} className="signal" style={{ alignItems: "flex-start" }}>
              <span
                className={`badge badge-${gate.pass === true ? "good" : gate.pass === false ? "bad" : "neutral"}`}
                style={{ borderRadius: 7, minWidth: 26, justifyContent: "center" }}
              >
                {gate.pass === true ? "✓" : gate.pass === false ? "✗" : "?"}
              </span>
              <div className="signal-body">
                <div className="signal-label">{gate.label}</div>
                <div className="signal-value">{gate.value}</div>
                <div className="tiny faint" style={{ marginTop: 2 }}>Requisito: {gate.requirement}</div>
                <div className="signal-hint">{gate.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {review.flags.map((flag) => (
          <Alert key={flag.id} tone={flag.severity === "alto" ? "bad" : "warn"}>
            <strong>{flag.label}</strong>
            <div className="small" style={{ marginTop: 3 }}>{flag.detail}</div>
          </Alert>
        ))}

        {/* The only check here with an irreversible penalty, and it was a
            footnote. No API answers it, so the app cannot pass or fail it —
            but it can take the operator straight to the register. */}
        <Alert tone="warn">
          <strong>Antes que ningún número: ¿es marca registrada?</strong>
          <div className="small" style={{ marginTop: 4, lineHeight: 1.7 }}>
            Una palabra clave con una marca o una celebridad puede costarte la cuenta de KDP, y eso no
            se recupera. Es el único filtro que ninguna herramienta puede resolver por ti — se
            comprueba en el registro, clase 16 (impresos).{" "}
            <a
              href={`https://branddb.wipo.int/en/quicksearch?q=${encodeURIComponent(summary.keyword)}`}
              target="_blank" rel="noreferrer noopener"
            >
              Buscar «{summary.keyword}» en la base de la WIPO <Icon.External size={12} />
            </a>
          </div>
        </Alert>

        <div className="tiny faint" style={{ lineHeight: 1.6 }}>
          Un criterio que no se puede evaluar aparece como «?» y no cuenta ni a favor ni en contra.
        </div>
      </div>
    </Card>
  );
}


/**
 * A scan is a photograph, and a seasonal niche looks like a different market
 * depending on the month it is taken. Saying so up front stops every figure
 * below from being read as a yearly average.
 */
function SeasonBanner({ keyword }: { keyword: string }) {
  const insight = useMemo(() => seasonInsight(keyword), [keyword]);
  if (!insight.profile) return null;

  const tone = insight.phase === "pico" ? "warn" : insight.phase === "entrando" ? "good" : "info";

  return (
    <Alert tone={tone}>
      <strong>{insight.headline}</strong>
      <div className="small" style={{ marginTop: 4, lineHeight: 1.6 }}>{insight.advice}</div>
      <div className="tiny faint" style={{ marginTop: 6 }}>
        {insight.profile.label} · pico en {monthNames(insight.profile.peak)}
        {insight.profile.trough.length ? ` · flojo en ${monthNames(insight.profile.trough)}` : ""}
        {insight.profile.source === "inferido"
          ? " · este grupo no está en tu guía, lo deduje yo: corrígeme si no encaja"
          : " · según tu guía"}
      </div>
    </Alert>
  );
}


/**
 * Where to differentiate, not just whether to enter.
 *
 * A niche entered with a commodity product competes only on cover and ad
 * budget, which is the fight an independent publisher loses. Each angle shows
 * the evidence behind it so it can be judged rather than followed.
 */
function AnglesCard({ items, keyword }: { items: BookRecord[]; keyword: string }) {
  const angles = useMemo(() => findAngles({ items, keyword }), [items, keyword]);
  if (!angles.length) return null;

  return (
    <Card>
      <CardHead
        title="Por dónde diferenciarte"
        note="«Dato» sale de lo que muestran estos competidores; «hueco» es una variación que nadie cubre."
      />
      <div className="card-pad grid grid-2">
        {angles.map((angle) => (
          <div key={angle.id} className="signal" style={{ alignItems: "flex-start" }}>
            <span
              className={`badge badge-${angle.source === "dato" ? "good" : angle.strength === "fuerte" ? "info" : "neutral"}`}
              style={{ borderRadius: 7, whiteSpace: "nowrap" }}
              title={angle.source === "dato"
                ? "Deducido de los datos de este nicho"
                : "Variación de producto que nadie cubre aquí"}
            >
              {angle.source === "dato" ? "dato" : "hueco"}
            </span>
            <div className="signal-body">
              <div className="signal-value" style={{ fontSize: 13.5 }}>{angle.label}</div>
              <div className="tiny faint" style={{ marginTop: 2 }}>{angle.evidence}</div>
              <div className="signal-hint">{angle.action}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}


/**
 * The other half of the browser capture.
 *
 * The bookmarklet posts its bundle straight here, but Amazon's content policy
 * can block that post. When it does, the capture is already in hand and gets
 * copied to the clipboard instead — so there has to be somewhere to put it.
 */
function ImportCapture() {
  const { toast } = useApp();
  const { navigate } = useRoute();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      const result = await api.importCapture(payload);
      toast(`${result.analysed} libros importados`, "good");
      navigate(`/nicho?id=${result.id}`);
    } catch (error) {
      toast(error instanceof SyntaxError
        ? "Eso no parece una captura. Copia otra vez desde el marcador."
        : error instanceof Error ? error.message : "No se pudo importar", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="row-tight">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Importar captura del navegador</Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHead
        title="Importar captura"
        note="Solo hace falta si Amazon bloqueó el envío y el marcador te dijo que la había copiado."
      >
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
      </CardHead>
      <div className="card-pad stack">
        <textarea
          className="input mono" rows={3} placeholder="Pega aquí lo que copió el marcador"
          value={text} onChange={(event) => setText(event.target.value)}
        />
        <div className="row">
          <Button variant="primary" loading={busy} disabled={text.trim().length < 50} onClick={() => void send()}>
            Importar
          </Button>
          {text ? <span className="small faint">{(text.length / 1024).toFixed(0)} KB</span> : null}
        </div>
      </div>
    </Card>
  );
}
