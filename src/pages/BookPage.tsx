import { useCallback, useEffect, useState } from "react";
import type { MarketplaceId, RankPoint } from "../../shared/types";
import { api, type ProductDetailDto } from "../api";
import { LineChart } from "../components/charts";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Kpi, Skeleton } from "../components/ui";
import { fmtCompact, fmtDate, fmtInt, fmtMoney, fmtNum, relativeTime } from "../lib/format";
import { useMemo } from "react";
import { useRoute } from "../router";
import { useApp } from "../state";

interface BookData {
  detail: ProductDetailDto;
  history: RankPoint[];
  estimates: { salesPerMonth: number | null; royaltyPerUnit: number | null; revenuePerMonth: number | null };
}

/** Accepts a bare ASIN or any Amazon URL that contains one. */
function extractAsin(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Z0-9]{10}$/i.test(trimmed)) return trimmed.toUpperCase();
  const match = /\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i.exec(trimmed);
  return match ? match[1].toUpperCase() : null;
}

export function BookPage() {
  const { settings, marketplaces, toast, currencySymbol } = useApp();
  const { query, navigate } = useRoute();

  const [input, setInput] = useState(query.get("asin") ?? "");
  const [data, setData] = useState<BookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);

  const marketplace: MarketplaceId = (query.get("marketplace") as MarketplaceId | null) ?? settings?.marketplace ?? "com";

  const load = useCallback(async (asin: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.book(asin, marketplace, refresh);
      setData({ detail: response.detail, history: response.history, estimates: response.estimates });
      const watchlist = await api.listWatch();
      setWatched(watchlist.some((item) => item.asin === asin && item.marketplace === marketplace));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la ficha");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [marketplace]);

  useEffect(() => {
    const asin = query.get("asin");
    if (asin) { setInput(asin); void load(asin); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.toString()]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const asin = extractAsin(input);
    if (!asin) { setError("No se reconoció un ASIN. Pega el código de 10 caracteres o la URL del libro."); return; }
    navigate(`/libro?asin=${asin}&marketplace=${marketplace}`);
  }

  async function toggleWatch() {
    if (!data) return;
    try {
      if (watched) {
        await api.removeWatch(data.detail.asin, marketplace);
        setWatched(false);
        toast("Quitado del seguimiento");
      } else {
        await api.addWatch({
          asin: data.detail.asin, marketplace,
          title: data.detail.title ?? "", author: data.detail.author ?? "",
          format: data.detail.formatLabel ?? "", image: data.detail.image ?? "",
        });
        setWatched(true);
        toast("Añadido al seguimiento. El BSR se registrará a diario.", "good");
      }
    } catch {
      toast("No se pudo actualizar el seguimiento", "bad");
    }
  }

  const detail = data?.detail;
  const marketLabel = marketplaces.find((m) => m.id === marketplace)?.label ?? marketplace;

  return (
    <Layout
      title="Inspector de libro"
      subtitle="Todo lo que Amazon publica de un título, más la estimación de lo que factura."
      actions={
        detail ? (
          <>
            <Button size="sm" icon={<Icon.Refresh size={15} />} onClick={() => load(detail.asin, true)}>Actualizar</Button>
            <Button size="sm" variant={watched ? "default" : "primary"} icon={<Icon.Eye size={15} />} onClick={toggleWatch}>
              {watched ? "Siguiendo" : "Seguir"}
            </Button>
          </>
        ) : null
      }
    >
      <div className="stack-lg">
        <Card pad>
          <form className="search-bar" onSubmit={submit}>
            <input
              className="input input-lg"
              placeholder="ASIN (B0XXXXXXXX) o URL de Amazon"
              value={input} onChange={(event) => setInput(event.target.value)} autoFocus
            />
            <Button type="submit" variant="primary" loading={loading} icon={<Icon.Book size={16} />}>Inspeccionar</Button>
          </form>
          <div className="small faint" style={{ marginTop: 8 }}>Tienda: {marketLabel}</div>
        </Card>

        {error ? <Alert tone="bad">{error}</Alert> : null}

        {loading && !data ? (
          <Card pad><div className="stack-sm"><Skeleton height={22} width="45%" /><Skeleton height={14} /><Skeleton height={14} width="70%" /></div></Card>
        ) : null}

        {detail && data ? (
          <>
            <Card pad>
              <div className="row" style={{ alignItems: "flex-start", gap: 20, flexWrap: "nowrap" }}>
                {detail.image
                  ? <img className="cover cover-xl" src={detail.image} alt="" />
                  : <div className="cover cover-xl" />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2>{detail.title ?? detail.asin}</h2>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {detail.author ?? "Autor desconocido"}
                    {detail.formatLabel ? ` · ${detail.formatLabel}` : ""}
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    {detail.selfPublished !== null ? (
                      <Badge tone={detail.selfPublished ? "good" : "info"}>
                        {detail.selfPublished ? "Autopublicado" : "Editorial"}
                      </Badge>
                    ) : null}
                    {detail.rating !== null ? <Badge tone="neutral">{fmtNum(detail.rating, 1)}★ · {fmtInt(detail.reviews)} reseñas</Badge> : null}
                    {detail.publishedAt ? <Badge tone="neutral">Publicado {fmtDate(detail.publishedAt)}</Badge> : null}
                    <a className="badge badge-neutral" href={`https://www.amazon.${marketplace}/dp/${detail.asin}`} target="_blank" rel="noreferrer noopener">
                      Ver en Amazon <Icon.External size={12} />
                    </a>
                  </div>

                  <dl className="kv" style={{ marginTop: 16 }}>
                    <dt>ASIN</dt><dd className="mono">{detail.asin}</dd>
                    {detail.isbn ? <><dt>ISBN</dt><dd className="mono">{detail.isbn}</dd></> : null}
                    {detail.publisher ? <><dt>Editorial</dt><dd>{detail.publisher}</dd></> : null}
                    {detail.pages ? <><dt>Páginas</dt><dd>{fmtInt(detail.pages)}</dd></> : null}
                    {detail.language ? <><dt>Idioma</dt><dd>{detail.language}</dd></> : null}
                    {detail.dimensions ? <><dt>Dimensiones</dt><dd>{detail.dimensions}</dd></> : null}
                  </dl>
                </div>
              </div>
            </Card>

            <div className="grid grid-4">
              <Kpi label="Precio" value={fmtMoney(detail.price, currencySymbol)} tone="neutral" />
              <Kpi
                label="BSR" value={detail.bsr !== null ? fmtCompact(detail.bsr) : "—"}
                tone={detail.bsr === null ? "neutral" : detail.bsr < 100_000 ? "good" : detail.bsr < 500_000 ? "warn" : "bad"}
                sub="Best Sellers Rank de la tienda"
              />
              <Kpi
                label="Ventas/mes est." value={data.estimates.salesPerMonth !== null ? fmtInt(data.estimates.salesPerMonth) : "—"}
                tone="accent" sub="derivado del BSR"
              />
              <Kpi
                label="Regalía/mes est." value={fmtMoney(data.estimates.revenuePerMonth, currencySymbol)}
                tone="accent" sub={`${fmtMoney(data.estimates.royaltyPerUnit, currencySymbol)} por unidad`}
              />
            </div>

            {detail.categoryRanks.length ? (
              <Card>
                <CardHead title="Categorías" note="Dónde rankea dentro del árbol de Amazon: la vía rápida a un badge de bestseller." />
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Categoría</th><th className="num">Puesto</th></tr></thead>
                    <tbody>
                      {detail.categoryRanks.map((rank) => (
                        <tr key={rank.name}>
                          <td>{rank.name}</td>
                          <td className="num">
                            <Badge tone={rank.rank <= 100 ? "good" : rank.rank <= 1000 ? "warn" : "neutral"}>#{fmtInt(rank.rank)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}

            <RankCheck asin={detail.asin} title={detail.title ?? ""} marketplace={marketplace} />

            <Card>
              <CardHead
                title="Histórico de BSR"
                note={data.history.length ? `${data.history.length} muestras · última ${relativeTime(data.history[data.history.length - 1]?.capturedAt)}` : "Añádelo al seguimiento para empezar a registrar"}
              />
              <div className="card-pad">
                {data.history.length >= 2 ? (
                  <LineChart
                    points={data.history.map((point) => ({ x: point.capturedAt, y: point.bsr }))}
                    invert  /* lower rank sits higher on the chart */
                    tone="accent"
                    formatY={(value) => fmtCompact(value)}
                    label="Evolución del Best Sellers Rank"
                  />
                ) : (
                  <Empty icon="📈" title="Sin histórico aún">
                    Sigue este libro y KDPLOOK tomará una muestra diaria de su BSR. En una semana
                    verás si sube, baja o es un pico puntual.
                  </Empty>
                )}
              </div>
            </Card>
          </>
        ) : !loading && !error ? (
          <Card>
            <Empty icon="🔎" title="Pega un ASIN o una URL de Amazon">
              Sirve para desmontar a un competidor: cuánto vende, con cuántas páginas, a qué precio y
              con qué margen. También es la puerta de entrada al seguimiento diario.
            </Empty>
          </Card>
        ) : null}
      </div>
    </Layout>
  );
}


/**
 * Whether the book actually turns up when someone searches for it.
 *
 * A title that does not sell has two causes that need opposite fixes: nobody
 * is searching for the subject, or people search and the book never appears.
 * Guessing between them is what makes a quiet listing stay quiet, so this
 * measures it directly instead — the book is looked up in each search and the
 * position it holds is reported, ads excluded, since a paid slot is bought
 * rather than earned.
 */
function RankCheck({ asin, title, marketplace }: { asin: string; title: string; marketplace: MarketplaceId }) {
  const { toast } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.rankCheck>> | null>(null);

  // The title is where the publisher's own keyword bet is written down.
  const suggestion = useMemo(() => {
    const clean = title.split(/[:|–—]/)[0].trim().toLowerCase();
    return clean.split(/\s+/).slice(0, 6).join(" ");
  }, [title]);

  async function run() {
    const keywords = input.split("\n").map((k) => k.trim()).filter(Boolean).slice(0, 6);
    if (!keywords.length) return;
    setBusy(true);
    try {
      setResults(await api.rankCheck({ asin, keywords, marketplace, department: "print", pages: 2 }));
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo comprobar", "bad");
    } finally {
      setBusy(false);
    }
  }

  const rows = results?.results ?? [];
  const found = rows.filter((r) => r.found);
  const missing = rows.filter((r) => !r.found && !r.error);
  // A refused request is not an absence. Counting it as one would turn a
  // temporary block into "your book is invisible", which is the opposite of
  // what this panel exists to establish.
  const errored = rows.filter((r) => r.error);

  return (
    <Card>
      <CardHead
        title="¿Aparece en las búsquedas?"
        note="Comprueba en qué puesto sale el libro, sin contar anuncios."
      >
        {suggestion ? (
          <Button size="sm" variant="ghost" onClick={() => setInput((v) => (v ? v : suggestion))}>
            Usar el título
          </Button>
        ) : null}
      </CardHead>

      <div className="card-pad stack">
        <Field
          label="Búsquedas a comprobar (una por línea, hasta 6)"
          help="Escribe lo que teclearía tu lector, no cómo se titula el libro."
        >
          <textarea
            className="input" rows={4} value={input}
            placeholder={"escucha activa\ncomo escuchar mejor\nhabilidades de comunicacion"}
            onChange={(event) => setInput(event.target.value)}
          />
        </Field>

        <div className="row">
          <Button variant="primary" loading={busy} icon={<Icon.Search size={15} />} onClick={run}>
            Comprobar posición
          </Button>
          <span className="small faint">Se revisan los ~96 primeros resultados orgánicos de cada búsqueda.</span>
        </div>

        {results ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Búsqueda</th><th className="num">Puesto</th><th className="num">Resultados</th><th>Lectura</th></tr>
                </thead>
                <tbody>
                  {results.results.map((row) => (
                    <tr key={row.keyword}>
                      <td>{row.keyword}</td>
                      <td className="num">
                        {row.error ? <Badge tone="warn">{row.error}</Badge>
                          : row.found ? <Badge tone={row.position !== null && row.position <= 16 ? "good" : "warn"}>#{row.position}</Badge>
                          : <Badge tone="bad">no aparece</Badge>}
                      </td>
                      <td className="num faint">{fmtCompact(row.totalResults)}</td>
                      <td className="small muted">
                        {row.error ? "Amazon rechazó la petición; reinténtalo en unos minutos."
                          : row.found && row.position !== null && row.position <= 16
                            ? "Sale en la primera pantalla: aquí sí compites."
                          : row.found ? "Está indexado pero demasiado abajo para recibir clics."
                          : `No aparece en los ${row.scanned} primeros. O no estás indexado para este término, o estás muy por detrás.`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Alert tone={errored.length === rows.length ? "warn" : found.length ? "info" : "warn"}>
              {errored.length === rows.length ? (
                <>
                  <strong>No se pudo comprobar ninguna búsqueda.</strong> Amazon rechazó las
                  peticiones, así que esto no dice nada sobre tu libro. Reinténtalo en unos minutos.
                </>
              ) : found.length === 0 ? (
                <>
                  <strong>No apareces en ninguna de estas búsquedas.</strong> Antes de tocar el
                  producto, revisa la indexación: título, subtítulo y las 7 casillas de palabras clave
                  de KDP. Si el término no está en ninguno de esos sitios, Amazon no tiene motivo para
                  mostrarte.
                </>
              ) : missing.length ? (
                <>
                  Apareces en {found.length} de {results.results.length}. Las {missing.length} en las
                  que no sales son las candidatas a entrar en tus casillas de palabras clave.
                </>
              ) : (
                <>Estás indexado en todas. Si aun así no vende, el problema está en la conversión —
                portada, precio o descripción— no en la visibilidad.</>
              )}
              {errored.length && errored.length < rows.length ? (
                <div className="small faint" style={{ marginTop: 6 }}>
                  {errored.length} búsqueda(s) no se pudieron comprobar y quedan fuera de esta cuenta.
                </div>
              ) : null}
            </Alert>
          </>
        ) : null}
      </div>
    </Card>
  );
}
