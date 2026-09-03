import { useEffect, useMemo, useState } from "react";
import type { KeywordRecord } from "../../shared/types";
import { api, type KeywordScoreDto } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Meter, Progress, SegmentedControl } from "../components/ui";
import { downloadCsv, toCsv } from "../lib/csv";
import { fmtCompact, fmtInt, fmtPct, relativeTime, slug } from "../lib/format";
import { keywordOpportunity, type KeywordOpportunity } from "../../shared/analytics/keyword";
import { DEEP_GROUPS, GROUP_LABELS, QUICK_GROUPS, type ProbeGroup } from "../lib/groups";
import type { Department } from "../lib/scan";
import { Link, useRoute } from "../router";
import { useApp } from "../state";

type ScoreMap = Record<string, KeywordScoreDto>;

function sortByDemand(merged: Map<string, KeywordRecord>): KeywordRecord[] {
  return Array.from(merged.values()).sort((a, b) => b.demandProxy - a.demandProxy);
}

/** The joining word this storefront's shoppers actually type, for the message. */
function connectorHint(marketplace: string): string {
  if (marketplace === "es" || marketplace === "com.mx") return "para";
  if (marketplace === "de") return "für";
  if (marketplace === "fr") return "pour";
  if (marketplace === "it") return "per";
  if (marketplace === "com.br") return "para";
  return "for";
}

export function KeywordsPage() {
  const { settings, marketplaces, updateSettings, toast } = useApp();
  const { navigate } = useRoute();

  const [seed, setSeed] = useState("");
  const [department, setDepartment] = useState<Department>("print");
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [keywords, setKeywords] = useState<KeywordRecord[]>([]);
  const [scores, setScores] = useState<ScoreMap>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Where the exploration has been, so a dead end is one click from the last
  // place that had something in it.
  const [trail, setTrail] = useState<string[]>([]);
  const [runs, setRuns] = useState<Array<{ id: string; seed: string; createdAt: number; count: number }>>([]);
  const [filter, setFilter] = useState("");
  const [minWords, setMinWords] = useState(0);

  const marketplace = settings?.marketplace ?? "com";

  useEffect(() => { void refreshRuns(); }, []);

  async function refreshRuns() {
    try { setRuns(await api.listKeywordRuns()); } catch { /* the list is optional */ }
  }

  /**
   * Walk a list of probe groups, folding every answer into `merged`.
   *
   * Returns the tallies rather than rendering them: `reachable` (Amazon
   * answered) and `answered` (Amazon had something to say) mean different
   * things, and conflating them is what turned a real finding — "nobody
   * completes this phrase" — into a false alarm about being rate-limited.
   */
  async function runGroups(
    seedText: string,
    groups: ProbeGroup[],
    merged: Map<string, KeywordRecord>,
    offset = 0,
    total = groups.length,
  ): Promise<{ probes: number; answered: number; reachable: number; failed: string | null }> {
    let probes = 0;
    let answered = 0;
    let reachable = 0;

    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      setProgress({ label: `Sondeando: ${GROUP_LABELS[group]}`, done: offset + index, total });
      try {
        const response = await api.expand({ seed: seedText, marketplace, group, department });
        probes += response.probes;
        answered += response.answered;
        reachable += response.reachable ?? 0;
        for (const record of response.keywords) {
          const existing = merged.get(record.keyword);
          if (!existing) { merged.set(record.keyword, { ...record }); continue; }
          existing.hits += record.hits;
          existing.bestRank = Math.min(existing.bestRank, record.bestRank);
          existing.demandProxy = Math.max(existing.demandProxy, record.demandProxy);
        }
        setKeywords(sortByDemand(merged));
      } catch (err) {
        return { probes, answered, reachable, failed: err instanceof Error ? err.message : "Error al expandir" };
      }
    }
    return { probes, answered, reachable, failed: null };
  }

  /**
   * @param nextSeed the phrase to expand; defaults to whatever is in the box.
   * @param how      "new" restarts the trail (a fresh seed from the box),
   *                 "drill" grows it (a result clicked), "back" truncates it to
   *                 the step chosen — going back is not the same as starting
   *                 over, and losing the path to get here would make the trail
   *                 pointless.
   */
  async function expand(nextSeed?: string, how: "new" | "drill" | "back" = "new") {
    const trimmed = (nextSeed ?? seed).trim();
    if (!trimmed) return;
    setSeed(trimmed);
    setError(null);
    setNote(null);
    setKeywords([]);
    setScores({});
    setSelected(new Set());
    setTrail((current) => {
      if (how === "new") return [trimmed];
      // Both cases are the same walk: a step already on the path truncates back
      // to it, a new one extends. That is what makes going back keep the route
      // that led here instead of starting over.
      const index = current.indexOf(trimmed);
      return index >= 0 ? current.slice(0, index + 1) : [...current, trimmed];
    });

    const groups: ProbeGroup[] = mode === "quick" ? QUICK_GROUPS : DEEP_GROUPS;
    const merged = new Map<string, KeywordRecord>();
    // One extra step in the bar for the fallback that may or may not run.
    const first = await runGroups(trimmed, groups, merged, 0, groups.length + 1);

    if (first.failed) {
      setProgress(null);
      setError(first.failed);
      return;
    }

    // The phrase itself completes into nothing. That is usually not a failure
    // but the answer: autocomplete matches a prefix, so it only knows about
    // these exact words in this exact order. The neighbourhood is where the
    // phrasing people actually type lives.
    if (!merged.size && first.reachable > 0) {
      const rescue = await runGroups(trimmed, ["related"], merged, groups.length, groups.length + 1);
      setProgress(null);
      if (merged.size) {
        setNote(
          `Amazon no completa «${trimmed}»: nadie la escribe así. Estas ${merged.size} salen de rutas cercanas ` +
          `—la frase al revés, en plural y con «${connectorHint(marketplace)}»—, que es como sí la teclean.`,
        );
      } else if (rescue.reachable > 0) {
        setError(
          `Amazon respondió pero no sugiere nada, ni para «${trimmed}» ni para sus variantes cercanas. ` +
          `No es un bloqueo: es que esa frase no se busca. Prueba una semilla más corta y baja desde ahí.`,
        );
      } else {
        setError("Amazon no respondió a ninguna sonda. Puede estar limitando el autocompletado desde este servidor; espera unos minutos.");
      }
      return;
    }

    setProgress(null);
    if (first.probes > 0 && first.reachable === 0) {
      setError("Amazon no respondió a ninguna sonda. Puede estar limitando el autocompletado desde este servidor; espera unos minutos.");
    }
  }

  async function scoreSelected() {
    const targets = Array.from(selected);
    if (!targets.length) return;
    setScoring(true);
    try {
      for (let i = 0; i < targets.length; i += 8) {
        const batch = targets.slice(i, i + 8);
        setProgress({ label: `Puntuando competencia (${i}/${targets.length})`, done: i, total: targets.length });
        const response = await api.scoreKeywords({ keywords: batch, marketplace, department });
        setScores((current) => {
          const next = { ...current };
          for (const item of response.scored) next[item.keyword] = item;
          return next;
        });
      }
      toast(`${targets.length} palabras clave puntuadas`, "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo puntuar", "bad");
    } finally {
      setScoring(false);
      setProgress(null);
    }
  }

  async function saveRun() {
    if (!keywords.length) return;
    try {
      await api.saveKeywordRun({ seed: seed.trim(), marketplace, keywords });
      toast("Lista guardada", "good");
      await refreshRuns();
    } catch {
      toast("No se pudo guardar la lista", "bad");
    }
  }

  async function openRun(id: string) {
    try {
      const run = await api.getKeywordRun(id);
      setSeed(run.seed);
      setKeywords(run.keywords);
      setScores({});
      setSelected(new Set());
      setTrail([run.seed]);
      setError(null);
      setNote(null);
    } catch {
      toast("No se pudo abrir la lista", "bad");
    }
  }

  const opportunities = useMemo(() => {
    const map = new Map<string, KeywordOpportunity>();
    for (const record of keywords) {
      const score = scores[record.keyword];
      if (!score) continue;
      const verdict = keywordOpportunity({
        demandProxy: record.demandProxy,
        totalResults: score.totalResults ?? null,
        medianReviews: score.medianReviews ?? null,
        lowReviewShare: score.lowReviewShare ?? null,
      });
      if (verdict) map.set(record.keyword, verdict);
    }
    return map;
  }, [keywords, scores]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = keywords.filter((record) => {
      if (needle && !record.keyword.includes(needle)) return false;
      if (minWords && record.depth < minWords) return false;
      return true;
    });
    // Before anything is scored, demand is all there is to rank by. Once the
    // competition has been measured, that is the better answer and it goes on
    // top — the unscored keep their own order below rather than being mixed in
    // on a number they do not have.
    if (!opportunities.size) return rows;
    return [...rows].sort((a, b) => {
      const oa = opportunities.get(a.keyword);
      const ob = opportunities.get(b.keyword);
      if (oa && ob) return ob.score - oa.score;
      if (oa) return -1;
      if (ob) return 1;
      return b.demandProxy - a.demandProxy;
    });
  }, [keywords, filter, minWords, opportunities]);

  function toggle(keyword: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyword)) next.delete(keyword); else next.add(keyword);
      return next;
    });
  }

  function selectTop(count: number) {
    setSelected(new Set(visible.slice(0, count).map((record) => record.keyword)));
  }

  function exportCsv() {
    downloadCsv(
      `kdplook-keywords-${slug(seed || "lista")}`,
      toCsv(visible.map((record) => {
        const score = scores[record.keyword];
        return {
          keyword: record.keyword,
          demanda_proxy: record.demandProxy,
          apariciones: record.hits,
          mejor_posicion: record.bestRank,
          palabras: record.depth,
          origen: record.source,
          resultados_totales: score?.totalResults ?? "",
          resenas_medianas: score?.medianReviews ?? "",
          resenas_media: score?.avgReviews ?? "",
          rivales_flojos: score?.lowReviewShare ?? "",
          precio_medio: score?.avgPrice ?? "",
          oportunidad: opportunities.get(record.keyword)?.score ?? "",
          veredicto: opportunities.get(record.keyword)?.label ?? "",
        };
      })),
    );
  }

  return (
    <Layout
      title="Laboratorio de keywords"
      subtitle="Expande una semilla con el autocompletado real de Amazon y mide la competencia de las mejores."
      actions={
        keywords.length ? (
          <>
            <Button size="sm" icon={<Icon.Download size={15} />} onClick={exportCsv}>CSV</Button>
            <Button size="sm" icon={<Icon.Save size={15} />} onClick={saveRun}>Guardar lista</Button>
          </>
        ) : null
      }
    >
      <div className="stack-lg">
        <Card pad>
          <form className="search-bar" onSubmit={(event) => { event.preventDefault(); void expand(); }}>

            <input
              className="input input-lg" placeholder="semilla: coloring book, sudoku, planner…"
              value={seed} onChange={(event) => setSeed(event.target.value)} autoFocus
            />
            <select
              className="select select-market" value={marketplace}
              onChange={(event) => updateSettings({ marketplace: event.target.value as typeof marketplace })}
            >
              {marketplaces.map((market) => <option key={market.id} value={market.id}>{market.flag} {market.label}</option>)}
            </select>
            <SegmentedControl
              value={department} onChange={setDepartment}
              options={[{ value: "print", label: "Papel" }, { value: "kindle", label: "Kindle" }, { value: "all", label: "Todo" }]}
            />
            <SegmentedControl
              value={mode} onChange={setMode}
              options={[{ value: "quick", label: "Rápido" }, { value: "deep", label: "Profundo" }]}
            />
            <Button type="submit" variant="primary" loading={Boolean(progress)} icon={<Icon.Tag size={16} />}>
              Expandir
            </Button>
          </form>
          <div className="small faint" style={{ marginTop: 10 }}>
            {mode === "quick"
              ? "Rápido: la semilla más el barrido alfabético (≈54 sondas al autocompletado). Si la frase no completa, prueba sola las rutas cercanas."
              : "Profundo: añade rutas cercanas, sufijos, prefijos, preguntas y dígitos (≈110 sondas). Tarda más y devuelve cola larga."}
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

        {error ? <Alert tone="warn">{error}</Alert> : null}
        {note ? <Alert tone="info">{note}</Alert> : null}

        {trail.length > 1 ? (
          <Card pad>
            <div className="row-tight small">
              <span className="faint">Ruta:</span>
              {trail.map((step, index) => (
                <span key={step} className="row-tight">
                  {index ? <span className="faint">›</span> : null}
                  <Button
                    size="sm" variant={step === seed ? "default" : "ghost"}
                    onClick={() => void expand(step, "back")}
                  >
                    {step}
                  </Button>
                </span>
              ))}
            </div>
          </Card>
        ) : null}

        {keywords.length ? (
          <Card>
            <CardHead title={`${visible.length} palabras clave`} note={`Semilla: “${seed}”`}>
              <input
                className="input" style={{ width: 180 }} placeholder="filtrar…"
                value={filter} onChange={(event) => setFilter(event.target.value)}
              />
              <select className="select" style={{ width: 130 }} value={minWords} onChange={(event) => setMinWords(Number(event.target.value))}>
                <option value={0}>Todas</option>
                <option value={3}>3+ palabras</option>
                <option value={4}>4+ palabras</option>
                <option value={5}>5+ palabras</option>
              </select>
              <Button size="sm" onClick={() => selectTop(8)}>Top 8</Button>
              <Button
                size="sm" variant="primary" loading={scoring} disabled={!selected.size}
                onClick={scoreSelected} icon={<Icon.Activity size={15} />}
              >
                Puntuar {selected.size || ""}
              </Button>
            </CardHead>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Palabra clave</th>
                    <th className="num" title="Proxy de demanda: cuántas sondas la sugieren y en qué posición">Demanda</th>
                    <th className="num">Apariciones</th>
                    <th className="num">Palabras</th>
                    <th className="num" title="Libros compitiendo por esta consulta">Resultados</th>
                    <th className="num" title="Mediana de reseñas del top orgánico">Reseñas med.</th>
                    <th className="num" title="Porcentaje del top con pocas reseñas">Flojos</th>
                    <th title="Demanda y competencia en un solo número. Aparece al puntuar.">Oportunidad</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 400).map((record) => {
                    const score = scores[record.keyword];
                    const opportunity = opportunities.get(record.keyword);
                    return (
                      <tr key={record.keyword}>
                        <td>
                          <input
                            type="checkbox" checked={selected.has(record.keyword)}
                            onChange={() => toggle(record.keyword)}
                          />
                        </td>
                        <td>
                          <div className="row-tight">
                            <span>{record.keyword}</span>
                            {record.source !== "alphabet" && record.source !== "seed"
                              ? <Badge tone="neutral">{record.source}</Badge> : null}
                          </div>
                        </td>
                        <td className="num" style={{ width: 110 }}>
                          <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                            <span className="num" style={{ width: 24 }}>{record.demandProxy}</span>
                            <div style={{ width: 56 }}>
                              <Meter
                                value={record.demandProxy}
                                tone={record.demandProxy >= 60 ? "good" : record.demandProxy >= 35 ? "warn" : "neutral"}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="num faint">{record.hits}</td>
                        <td className="num faint">{record.depth}</td>
                        <td className="num">{score ? fmtCompact(score.totalResults ?? null) : <span className="faint">—</span>}</td>
                        <td className="num">{score ? fmtInt(score.medianReviews ?? null) : <span className="faint">—</span>}</td>
                        <td className="num">
                          {score?.lowReviewShare !== undefined && score?.lowReviewShare !== null ? (
                            <Badge tone={score.lowReviewShare >= 0.5 ? "good" : score.lowReviewShare >= 0.3 ? "warn" : "bad"}>
                              {fmtPct(score.lowReviewShare)}
                            </Badge>
                          ) : <span className="faint">—</span>}
                        </td>
                        <td>
                          {opportunity ? (
                            <div className="row-tight" title={opportunity.reason}>
                              <Badge tone={opportunity.tone}>{opportunity.label}</Badge>
                              <span className="num faint">{opportunity.score}</span>
                            </div>
                          ) : <span className="faint">—</span>}
                        </td>
                        <td>
                          <div className="row-tight" style={{ flexWrap: "nowrap" }}>
                            <Button
                              size="sm" variant="ghost" icon={<Icon.Tag size={14} />}
                              title="Usar esta frase como nueva semilla y seguir bajando"
                              onClick={() => void expand(record.keyword, "drill")}
                            >
                              Explorar
                            </Button>
                            <Button
                              size="sm" variant="ghost" icon={<Icon.Search size={14} />}
                              onClick={() => navigate(`/nicho?keyword=${encodeURIComponent(record.keyword)}&dept=${department}`)}
                            >
                              Analizar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ) : !progress ? (
          <Card>
            <Empty icon="🔤" title="Sin resultados todavía">
              El autocompletado de Amazon es la fuente más honesta de intención de búsqueda que existe sin pagar:
              son las consultas que sus propios usuarios escriben. Empieza con una semilla amplia.
            </Empty>
          </Card>
        ) : null}

        {runs.length ? (
          <Card>
            <CardHead title="Listas guardadas" />
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Semilla</th><th className="num">Palabras</th><th>Creada</th><th></th></tr></thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>{run.seed}</td>
                      <td className="num">{run.count}</td>
                      <td className="small faint">{relativeTime(run.createdAt)}</td>
                      <td>
                        <div className="row-tight">
                          <Button size="sm" variant="ghost" onClick={() => openRun(run.id)}>Abrir</Button>
                          <Button
                            size="sm" variant="ghost"
                            onClick={async () => { await api.deleteKeywordRun(run.id); await refreshRuns(); }}
                          >
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
        ) : null}

        <Card pad>
          <Field label="Cómo leer estas columnas">
            <div className="small muted" style={{ lineHeight: 1.65 }}>
              <strong>Demanda</strong> no es volumen de búsqueda real —nadie fuera de Amazon lo tiene—, sino cuántas
              sondas distintas del autocompletado devuelven esa frase y en qué posición. Una frase que aparece bajo
              muchas letras y siempre arriba es una consulta que Amazon considera fuerte.{" "}
              <strong>Resultados</strong> y <strong>Reseñas medianas</strong> sí son datos duros del buscador: son
              tu medida de saturación. <strong>Oportunidad</strong> junta las dos mitades en un número y aparece
              en cuanto puntúas: demanda alta con pocos competidores y pocas reseñas es lo que se busca, y ordena
              la lista por él. <strong>Explorar</strong> convierte una frase en la nueva semilla para seguir bajando
              —la ruta queda arriba para volver—, y <Link to="/nicho">Analizar</Link> da el veredicto completo,
              ya con ventas y regalías.
            </div>
          </Field>
        </Card>
      </div>
    </Layout>
  );
}
