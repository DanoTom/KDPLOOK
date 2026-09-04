import { useEffect, useState } from "react";
import type { HealthInfo, NicheListItem, WatchItem } from "../../shared/types";
import { api } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Kpi, Meter, Skeleton } from "../components/ui";
import { fmtCompact, fmtMoney, relativeTime, toneForScore } from "../lib/format";
import { Link, useRoute } from "../router";
import { useApp } from "../state";

export function Dashboard() {
  const { settings, marketplaces, currencySymbol } = useApp();
  const { navigate } = useRoute();
  const [niches, setNiches] = useState<NicheListItem[] | null>(null);
  const [watch, setWatch] = useState<WatchItem[] | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    Promise.allSettled([api.listNiches(), api.listWatch(), api.health()]).then(([n, w, h]) => {
      setNiches(n.status === "fulfilled" ? n.value : []);
      setWatch(w.status === "fulfilled" ? w.value : []);
      setHealth(h.status === "fulfilled" ? h.value : null);
    });
  }, []);

  const market = marketplaces.find((m) => m.id === settings?.marketplace);
  const topNiches = (niches ?? []).slice().sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 6);
  const movers = (watch ?? [])
    .filter((item) => item.change7d !== null && item.change7d !== undefined)
    .sort((a, b) => (a.change7d ?? 0) - (b.change7d ?? 0))
    .slice(0, 5);
  const totalRevenue = (watch ?? []).reduce((sum, item) => sum + (item.latest?.revenueEst ?? 0), 0);

  const setupIssues: string[] = [];
  if (health && !health.dbReady) setupIssues.push("La base de datos D1 no responde: falta aplicar las migraciones.");
  if (health && !health.authEnabled) setupIssues.push("No hay contraseña configurada: cualquiera con la URL puede entrar.");
  if (health && !health.provider.configured) setupIssues.push(`Falta la clave del proveedor «${health.provider.provider}».`);

  return (
    <Layout
      title="Panel"
      subtitle={market ? `Tienda activa: ${market.flag} ${market.label}` : undefined}
    >
      <div className="stack-lg">
        <Card pad>
          <form
            className="search-bar"
            onSubmit={(event) => {
              event.preventDefault();
              if (keyword.trim()) navigate(`/nicho?keyword=${encodeURIComponent(keyword.trim())}`);
            }}
          >
            <input
              className="input input-lg"
              placeholder="Analiza una palabra clave… p. ej. “gratitude journal for teens”"
              value={keyword} onChange={(event) => setKeyword(event.target.value)}
            />
            <Button type="submit" variant="primary" icon={<Icon.Search size={16} />}>Analizar nicho</Button>
            {/* This pointed at the keyword lab, which also needs a phrase to
                start from — so on the day nothing comes to mind both halves of
                this box were the same dead end. */}
            <Link to="/ideas" className="btn"><Icon.Compass size={15} /> No sé por dónde empezar</Link>
          </form>
          <div className="small faint" style={{ marginTop: 8 }}>
            La caja es para cuando ya tienes la frase. Si no la tienes, el otro botón lee las
            portadas de los que ya venden y te dice de qué van.
          </div>
        </Card>

        {setupIssues.length ? (
          <Alert tone="warn">
            <strong>Quedan cosas por configurar</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }} className="small">
              {setupIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            <div className="small" style={{ marginTop: 6 }}>
              El <Link to="/diagnostico">panel de diagnóstico</Link> explica cada paso.
            </div>
          </Alert>
        ) : null}

        <div className="grid grid-4">
          <Kpi label="Nichos analizados" value={niches?.length ?? "…"} tone="neutral" sub="guardados en tu biblioteca" />
          <Kpi
            label="Mejor oportunidad"
            value={topNiches[0]?.opportunityScore ?? "—"}
            tone={topNiches[0] ? toneForScore(topNiches[0].opportunityScore) : "neutral"}
            sub={topNiches[0]?.keyword ?? "aún sin datos"}
          />
          <Kpi label="Libros en seguimiento" value={watch?.length ?? "…"} tone="neutral" sub="muestra diaria del BSR" />
          <Kpi label="Regalías seguidas" value={fmtMoney(totalRevenue, currencySymbol)} tone="accent" sub="estimación mensual del conjunto" />
        </div>

        <div className="grid grid-2">
          <Card>
            <CardHead title="Tus mejores nichos" note="Ordenados por puntuación de oportunidad.">
              <Link to="/guardados" className="btn btn-ghost btn-sm">Ver todos</Link>
            </CardHead>
            {niches === null ? (
              <div className="card-pad stack-sm"><Skeleton height={18} /><Skeleton height={18} /><Skeleton height={18} /></div>
            ) : topNiches.length === 0 ? (
              <Empty icon="🧭" title="Sin análisis guardados">
                Analiza una palabra clave y pulsa Guardar: aquí verás tus ideas ordenadas por potencial.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {topNiches.map((niche) => (
                      <tr key={niche.id}>
                        <td>
                          <Link to={`/nicho?id=${niche.id}`} style={{ color: "inherit", fontWeight: 550 }}>{niche.keyword}</Link>
                          <div className="tiny faint">{niche.marketplace} · {relativeTime(niche.createdAt)}</div>
                        </td>
                        <td style={{ width: 120 }}>
                          <div className="row-tight">
                            <span className="num" style={{ width: 22 }}>{niche.opportunityScore}</span>
                            <div style={{ flex: 1 }}><Meter value={niche.opportunityScore} tone={toneForScore(niche.opportunityScore)} /></div>
                          </div>
                        </td>
                        <td style={{ width: 96 }}>
                          <Badge tone={niche.tone === "great" ? "good" : niche.tone === "good" ? "info" : niche.tone === "mixed" ? "warn" : "bad"}>
                            {niche.verdict}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Movimientos de la semana" note="Variación del BSR en los últimos 7 días.">
              <Link to="/seguimiento" className="btn btn-ghost btn-sm">Seguimiento</Link>
            </CardHead>
            {watch === null ? (
              <div className="card-pad stack-sm"><Skeleton height={18} /><Skeleton height={18} /><Skeleton height={18} /></div>
            ) : movers.length === 0 ? (
              <Empty icon="📉" title="Sin histórico todavía">
                Añade libros al seguimiento. Tras un par de muestras diarias aparecerán aquí sus movimientos.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {movers.map((item) => (
                      <tr key={`${item.asin}-${item.marketplace}`}>
                        <td>
                          <div className="book-cell" style={{ minWidth: 0 }}>
                            {item.image ? <img className="cover" src={item.image} alt="" loading="lazy" /> : <div className="cover" />}
                            <div style={{ minWidth: 0 }}>
                              <div className="book-title clamp-2">{item.title || item.asin}</div>
                              <div className="book-meta truncate">BSR {fmtCompact(item.latest?.bsr ?? null)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num" style={{ width: 92 }}>
                          <Badge tone={(item.change7d ?? 0) < 0 ? "good" : "bad"}>
                            {(item.change7d ?? 0) < 0 ? "▼" : "▲"} {Math.abs(Math.round(item.change7d ?? 0))}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card pad>
          <h3>Un flujo de trabajo que funciona</h3>
          <div className="grid grid-4" style={{ marginTop: 12 }}>
            <Step n={1} title="Amplía" to="/keywords">
              Parte de una semilla amplia y deja que el autocompletado de Amazon te dé las frases que la gente escribe de verdad.
            </Step>
            <Step n={2} title="Filtra" to="/keywords">
              Puntúa las 8 mejores. Busca demanda alta con reseñas medianas bajas: ahí está el hueco.
            </Step>
            <Step n={3} title="Analiza" to="/nicho">
              Escanea las finalistas al completo. El veredicto te dice si el nicho aguanta un título más.
            </Step>
            <Step n={4} title="Vigila" to="/seguimiento">
              Sigue a los tres primeros. Si su BSR se degrada con el tiempo, el nicho se está enfriando.
            </Step>
          </div>
        </Card>
      </div>
    </Layout>
  );
}

function Step({ n, title, to, children }: { n: number; title: string; to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="signal" style={{ alignItems: "flex-start", color: "inherit", textDecoration: "none" }}>
      <span className="badge badge-accent" style={{ borderRadius: 7, minWidth: 22, justifyContent: "center" }}>{n}</span>
      <div className="signal-body">
        <div className="signal-value" style={{ fontSize: 13.5 }}>{title}</div>
        <div className="signal-hint">{children}</div>
      </div>
    </Link>
  );
}
