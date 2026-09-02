import { useEffect, useMemo, useState } from "react";
import type { KeywordRecord } from "../../shared/types";
import { api, type KeywordScoreDto } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Meter, Progress, SegmentedControl } from "../components/ui";
import { downloadCsv, toCsv } from "../lib/csv";
import { fmtCompact, fmtInt, fmtPct, relativeTime, slug } from "../lib/format";
import { DEEP_GROUPS, GROUP_LABELS, QUICK_GROUPS, type ProbeGroup } from "../lib/groups";
import type { Department } from "../lib/scan";
import { Link, useRoute } from "../router";
import { useApp } from "../state";

type ScoreMap = Record<string, KeywordScoreDto>;

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
  const [runs, setRuns] = useState<Array<{ id: string; seed: string; createdAt: number; count: number }>>([]);
  const [filter, setFilter] = useState("");
  const [minWords, setMinWords] = useState(0);

  const marketplace = settings?.marketplace ?? "com";

  useEffect(() => { void refreshRuns(); }, []);

  async function refreshRuns() {
    try { setRuns(await api.listKeywordRuns()); } catch { /* the list is optional */ }
  }

  async function expand() {
    const trimmed = seed.trim();
    if (!trimmed) return;
    setError(null);
    setKeywords([]);
    setScores({});
    setSelected(new Set());

    const groups: ProbeGroup[] = mode === "quick" ? QUICK_GROUPS : DEEP_GROUPS;
    const merged = new Map<string, KeywordRecord>();
    let answered = 0;
    let probes = 0;

    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      setProgress({ label: `Sondeando: ${GROUP_LABELS[group]}`, done: index, total: groups.length });
      try {
        const response = await api.expand({ seed: trimmed, marketplace, group, department });
        answered += response.answered;
        probes += response.probes;
        for (const record of response.keywords) {
          const existing = merged.get(record.keyword);
          if (!existing) { merged.set(record.keyword, { ...record }); continue; }
          existing.hits += record.hits;
          existing.bestRank = Math.min(existing.bestRank, record.bestRank);
          existing.demandProxy = Math.max(existing.demandProxy, record.demandProxy);
        }
        setKeywords(Array.from(merged.values()).sort((a, b) => b.demandProxy - a.demandProxy));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al expandir");
        break;
      }
    }

    setProgress(null);
    if (probes > 0 && answered === 0) {
      setError("Ninguna sonda obtuvo respuesta. Amazon puede estar limitando el autocompletado desde este servidor.");
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
    } catch {
      toast("No se pudo abrir la lista", "bad");
    }
  }

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return keywords.filter((record) => {
      if (needle && !record.keyword.includes(needle)) return false;
      if (minWords && record.depth < minWords) return false;
      return true;
    });
  }, [keywords, filter, minWords]);

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
              ? "Rápido: la semilla más el barrido alfabético (≈54 sondas al autocompletado)."
              : "Profundo: añade sufijos, prefijos, preguntas y dígitos (≈100 sondas). Tarda más y devuelve cola larga."}
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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 400).map((record) => {
                    const score = scores[record.keyword];
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
                          <Button
                            size="sm" variant="ghost" icon={<Icon.Search size={14} />}
                            onClick={() => navigate(`/nicho?keyword=${encodeURIComponent(record.keyword)}&dept=${department}`)}
                          >
                            Analizar
                          </Button>
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
              tu medida de saturación. La combinación que buscas es demanda alta con reseñas medianas bajas.
              Para el veredicto completo de una frase, pulsa <Link to="/nicho">Analizar</Link>.
            </div>
          </Field>
        </Card>
      </div>
    </Layout>
  );
}
