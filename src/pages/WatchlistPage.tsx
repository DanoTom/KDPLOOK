import { useCallback, useEffect, useState } from "react";
import type { WatchItem } from "../../shared/types";
import { api } from "../api";
import { Sparkline } from "../components/charts";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Kpi, Skeleton } from "../components/ui";
import { downloadCsv, toCsv } from "../lib/csv";
import { fmtCompact, fmtInt, fmtMoney, fmtNum, relativeTime } from "../lib/format";
import { Link } from "../router";
import { useApp } from "../state";

export function WatchlistPage() {
  const { toast, currencySymbol } = useApp();
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.listWatch()); }
    catch { toast("No se pudo cargar el seguimiento", "bad"); setItems([]); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function refreshAll() {
    setRefreshing(true);
    try {
      // The Worker snapshots 8 books per call, so walk the list in chunks.
      const active = (items ?? []).filter((item) => item.active);
      for (let i = 0; i < active.length; i += 8) {
        const batch = active.slice(i, i + 8).map((item) => item.asin);
        await api.refreshWatch(batch);
      }
      await load();
      toast("Seguimiento actualizado", "good");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo actualizar", "bad");
    } finally {
      setRefreshing(false);
    }
  }

  async function remove(item: WatchItem) {
    await api.removeWatch(item.asin, item.marketplace);
    await load();
    toast("Eliminado del seguimiento");
  }

  function exportCsv() {
    downloadCsv("kdplook-seguimiento", toCsv((items ?? []).map((item) => ({
      asin: item.asin,
      titulo: item.title,
      autor: item.author,
      tienda: item.marketplace,
      bsr_actual: item.latest?.bsr ?? "",
      precio: item.latest?.price ?? "",
      resenas: item.latest?.reviews ?? "",
      ventas_mes_est: item.latest?.salesEst ?? "",
      regalia_mes_est: item.latest?.revenueEst ?? "",
      cambio_7d_pct: item.change7d ?? "",
      cambio_30d_pct: item.change30d ?? "",
      muestras: item.history?.length ?? 0,
    }))));
  }

  const tracked = items ?? [];
  const withData = tracked.filter((item) => item.latest?.bsr);
  const totalRevenue = tracked.reduce((sum, item) => sum + (item.latest?.revenueEst ?? 0), 0);
  const improving = tracked.filter((item) => (item.change7d ?? 0) < -5).length;
  const declining = tracked.filter((item) => (item.change7d ?? 0) > 5).length;

  return (
    <Layout
      title="Seguimiento"
      subtitle="Vigila competidores o tus propios títulos. Se toma una muestra automática cada día."
      actions={
        tracked.length ? (
          <>
            <Button size="sm" icon={<Icon.Download size={15} />} onClick={exportCsv}>CSV</Button>
            <Button size="sm" variant="primary" loading={refreshing} icon={<Icon.Refresh size={15} />} onClick={refreshAll}>
              Actualizar ahora
            </Button>
          </>
        ) : null
      }
    >
      <div className="stack-lg">
        {items === null ? (
          <Card pad><Skeleton height={80} /></Card>
        ) : tracked.length === 0 ? (
          <Card>
            <Empty icon="👁" title="Todavía no sigues ningún libro">
              Desde <Link to="/nicho">Explorar nicho</Link> o el <Link to="/libro">Inspector</Link> puedes añadir
              cualquier título. KDPLOOK guardará su BSR una vez al día y verás la tendencia real en vez de una foto fija.
            </Empty>
          </Card>
        ) : (
          <>
            <div className="grid grid-4">
              <Kpi label="Libros seguidos" value={tracked.length} tone="neutral" sub={`${withData.length} con datos`} />
              <Kpi label="Regalías/mes est." value={fmtMoney(totalRevenue, currencySymbol)} tone="accent" sub="suma del conjunto" />
              <Kpi label="Mejorando (7 d)" value={improving} tone="good" sub="su BSR ha bajado" />
              <Kpi label="Empeorando (7 d)" value={declining} tone={declining ? "bad" : "neutral"} sub="su BSR ha subido" />
            </div>

            {withData.length === 0 ? (
              <Alert tone="info">
                Aún no hay muestras. Pulsa <strong>Actualizar ahora</strong> para tomar la primera, o espera al
                barrido automático de las 06:10 UTC.
              </Alert>
            ) : null}

            <Card>
              <CardHead title="Libros seguidos" note="El BSR más bajo es mejor: una flecha verde significa que sube en ventas." />
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Libro</th>
                      <th className="num">BSR</th>
                      <th className="num">7 d</th>
                      <th className="num">30 d</th>
                      <th>Tendencia</th>
                      <th className="num">Precio</th>
                      <th className="num">Reseñas</th>
                      <th className="num">Ventas/mes</th>
                      <th className="num">Regalía/mes</th>
                      <th>Última muestra</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracked.map((item) => (
                      <tr key={`${item.asin}-${item.marketplace}`}>
                        <td>
                          <div className="book-cell">
                            {item.image ? <img className="cover" src={item.image} alt="" loading="lazy" /> : <div className="cover" />}
                            <div style={{ minWidth: 0 }}>
                              <div className="book-title clamp-2">{item.title || item.asin}</div>
                              <div className="book-meta truncate">{item.author || "—"} · {item.marketplace}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num">{item.latest?.bsr ? fmtCompact(item.latest.bsr) : <span className="faint">—</span>}</td>
                        <td className="num"><Change value={item.change7d} /></td>
                        <td className="num"><Change value={item.change30d} /></td>
                        <td>
                          <Sparkline
                            points={(item.history ?? []).map((point) => ({ x: point.capturedAt, y: point.bsr }))}
                            invert tone="accent"
                          />
                        </td>
                        <td className="num">{fmtMoney(item.latest?.price ?? null, currencySymbol)}</td>
                        <td className="num">{fmtInt(item.latest?.reviews ?? null)}</td>
                        <td className="num">{item.latest?.salesEst !== null && item.latest?.salesEst !== undefined ? fmtNum(item.latest.salesEst, 0) : "—"}</td>
                        <td className="num">{fmtMoney(item.latest?.revenueEst ?? null, currencySymbol)}</td>
                        <td className="small faint">{relativeTime(item.latest?.capturedAt)}</td>
                        <td>
                          <div className="row-tight" style={{ flexWrap: "nowrap" }}>
                            <Link to={`/libro?asin=${item.asin}&marketplace=${item.marketplace}`} className="btn btn-ghost btn-icon" title="Abrir ficha">
                              <Icon.Search size={15} />
                            </Link>
                            <Button size="sm" variant="ghost" onClick={() => remove(item)} title="Dejar de seguir">
                              <Icon.Trash size={15} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}

/** A drop in BSR is a rise in sales, so the sign is deliberately inverted. */
function Change({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="faint">—</span>;
  if (Math.abs(value) < 3) return <Badge tone="neutral">estable</Badge>;
  const improving = value < 0;
  return (
    <Badge tone={improving ? "good" : "bad"}>
      {improving ? "▼" : "▲"} {Math.abs(Math.round(value))}%
    </Badge>
  );
}
