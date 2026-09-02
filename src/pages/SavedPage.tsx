import { useCallback, useEffect, useMemo, useState } from "react";
import type { NicheListItem } from "../../shared/types";
import { api } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Badge, Button, Card, CardHead, Empty, Kpi, Meter, Skeleton } from "../components/ui";
import { downloadCsv, toCsv } from "../lib/csv";
import { fmtInt, relativeTime, toneForCompetition, toneForScore } from "../lib/format";
import { Link } from "../router";
import { useApp } from "../state";

export function SavedPage() {
  const { toast } = useApp();
  const [niches, setNiches] = useState<NicheListItem[] | null>(null);
  const [sort, setSort] = useState<"score" | "date" | "keyword">("score");

  const load = useCallback(async () => {
    try { setNiches(await api.listNiches()); }
    catch { setNiches([]); toast("No se pudieron cargar los nichos", "bad"); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function toggleStar(niche: NicheListItem) {
    await api.updateNiche(niche.id, { starred: !niche.starred });
    await load();
  }

  async function remove(niche: NicheListItem) {
    await api.deleteNiche(niche.id);
    await load();
    toast("Análisis eliminado");
  }

  const rows = useMemo(() => {
    const list = [...(niches ?? [])];
    list.sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      if (sort === "date") return b.createdAt - a.createdAt;
      if (sort === "keyword") return a.keyword.localeCompare(b.keyword, "es");
      return b.opportunityScore - a.opportunityScore;
    });
    return list;
  }, [niches, sort]);

  const best = rows.filter((niche) => niche.opportunityScore >= 65).length;
  const avg = rows.length
    ? Math.round(rows.reduce((sum, niche) => sum + niche.opportunityScore, 0) / rows.length)
    : 0;

  return (
    <Layout
      title="Nichos guardados"
      subtitle="Tu banco de ideas comparadas con el mismo criterio."
      actions={
        rows.length ? (
          <Button
            size="sm" icon={<Icon.Download size={15} />}
            onClick={() => downloadCsv("kdplook-nichos", toCsv(rows.map((niche) => ({
              palabra_clave: niche.keyword,
              tienda: niche.marketplace,
              oportunidad: niche.opportunityScore,
              demanda: niche.demandScore,
              competencia: niche.competitionScore,
              veredicto: niche.verdict,
              analizados: niche.analysed,
              favorito: niche.starred ? "si" : "no",
              fecha: new Date(niche.createdAt).toISOString(),
            }))))}
          >
            CSV
          </Button>
        ) : null
      }
    >
      <div className="stack-lg">
        {niches === null ? (
          <Card pad><Skeleton height={70} /></Card>
        ) : rows.length === 0 ? (
          <Card>
            <Empty icon="🔖" title="Todavía no has guardado ningún análisis">
              Cuando termines un escaneo en <Link to="/nicho">Explorar nicho</Link>, pulsa
              <strong> Guardar</strong>. Aquí podrás comparar todas tus ideas con la misma vara de medir.
            </Empty>
          </Card>
        ) : (
          <>
            <div className="grid grid-4">
              <Kpi label="Nichos guardados" value={rows.length} tone="neutral" />
              <Kpi label="Con oportunidad alta" value={best} tone={best ? "good" : "neutral"} sub="puntuación ≥ 65" />
              <Kpi label="Oportunidad media" value={avg} tone={toneForScore(avg)} />
              <Kpi label="Favoritos" value={rows.filter((n) => n.starred).length} tone="accent" />
            </div>

            <Card>
              <CardHead title="Comparativa">
                <select className="select" style={{ width: 150 }} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                  <option value="score">Por oportunidad</option>
                  <option value="date">Por fecha</option>
                  <option value="keyword">Alfabético</option>
                </select>
              </CardHead>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}></th>
                      <th>Palabra clave</th>
                      <th>Veredicto</th>
                      <th className="num" style={{ width: 150 }}>Oportunidad</th>
                      <th className="num">Demanda</th>
                      <th className="num">Competencia</th>
                      <th className="num">Libros</th>
                      <th>Guardado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((niche) => (
                      <tr key={niche.id}>
                        <td>
                          <button
                            className="btn btn-ghost btn-icon" onClick={() => toggleStar(niche)}
                            title={niche.starred ? "Quitar de favoritos" : "Marcar como favorito"}
                            style={{ color: niche.starred ? "var(--accent)" : "var(--text-faint)" }}
                          >
                            <Icon.Star size={15} />
                          </button>
                        </td>
                        <td>
                          <Link to={`/nicho?id=${niche.id}`} style={{ color: "inherit", fontWeight: 550 }}>{niche.keyword}</Link>
                          <div className="tiny faint">{niche.marketplace}</div>
                        </td>
                        <td>
                          <Badge tone={niche.tone === "great" ? "good" : niche.tone === "good" ? "info" : niche.tone === "mixed" ? "warn" : "bad"}>
                            {niche.verdict}
                          </Badge>
                        </td>
                        <td className="num">
                          <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                            <span style={{ width: 26 }}>{niche.opportunityScore}</span>
                            <div style={{ width: 74 }}><Meter value={niche.opportunityScore} tone={toneForScore(niche.opportunityScore)} /></div>
                          </div>
                        </td>
                        <td className="num">{niche.demandScore}</td>
                        <td className="num">
                          <Badge tone={toneForCompetition(niche.competitionScore)}>{niche.competitionScore}</Badge>
                        </td>
                        <td className="num faint">{fmtInt(niche.analysed)}</td>
                        <td className="small faint">{relativeTime(niche.createdAt)}</td>
                        <td>
                          <div className="row-tight" style={{ flexWrap: "nowrap" }}>
                            <Link to={`/nicho?id=${niche.id}`} className="btn btn-ghost btn-sm">Abrir</Link>
                            <Button size="sm" variant="ghost" onClick={() => remove(niche)} title="Eliminar">
                              <Icon.Trash size={14} />
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
