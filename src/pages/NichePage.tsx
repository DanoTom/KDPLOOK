import { useEffect, useMemo, useState } from "react";
import type { BookRecord, NicheSummary } from "../../shared/types";
import { api } from "../api";
import { BookTable } from "../components/BookTable";
import { BarChart, Donut, Gauge, histogram } from "../components/charts";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Kpi, Progress, SegmentedControl } from "../components/ui";
import { downloadCsv, toCsv } from "../lib/csv";
import { fmtCompact, fmtDate, fmtInt, fmtMoney, fmtNum, fmtPct, slug, toneForCompetition, toneForScore } from "../lib/format";
import { useNicheScan, type Department } from "../lib/scan";
import { useRoute } from "../router";
import { useApp } from "../state";

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
              className="select" style={{ width: 190 }}
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

          <div className="row" style={{ marginTop: 12, gap: 18 }}>
            <Field label={`Páginas de resultados: ${pages}`} style={{ width: 190 }}>
              <input type="range" min={1} max={7} value={pages} onChange={(event) => setPages(Number(event.target.value))} />
            </Field>
            <Field label={`Fichas a enriquecer: ${enrich}`} style={{ width: 190 }}>
              <input type="range" min={0} max={40} step={4} value={enrich} onChange={(event) => setEnrich(Number(event.target.value))} />
            </Field>
            <div className="small faint" style={{ maxWidth: 420 }}>
              Enriquecer abre la ficha de cada libro para leer BSR, páginas y editorial. Es lo que da
              las estimaciones de ventas, y también lo más lento — 8 fichas por petición.
            </div>
            {scan.result ? (
              <Button size="sm" variant="ghost" className="spacer" icon={<Icon.Refresh size={15} />} onClick={() => start(true)}>
                Ignorar caché
              </Button>
            ) : null}
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
        ) : !scan.busy && !scan.error ? (
          <Card>
            <Empty icon="📚" title="Escribe una palabra clave para empezar">
              Piensa como el comprador: “coloring book for kids ages 4-8”, “sudoku large print”,
              “planificador semanal 2026”. Cuanto más concreta, más útil el resultado.
            </Empty>
          </Card>
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
      <div className="grid" style={{ gridTemplateColumns: "minmax(280px, 380px) 1fr", alignItems: "stretch" }}>
        <Card pad className={`verdict tone-${summary.verdict.tone}`}>
          <Gauge value={summary.opportunityScore} label="Oportunidad" tone={toneForScore(summary.opportunityScore)} />
          <h2 style={{ marginTop: 14 }}>
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
            label="Demanda" value={summary.demandScore} tone={toneForScore(summary.demandScore)}
            sub={summary.avgSalesPerMonth !== null ? `${fmtInt(summary.avgSalesPerMonth)} ventas/mes de media` : "sin datos de BSR"}
          />
          <Kpi
            label="Competencia" value={summary.competitionScore} tone={toneForCompetition(summary.competitionScore)}
            sub={`mediana ${fmtInt(summary.medianReviews)} reseñas`}
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
