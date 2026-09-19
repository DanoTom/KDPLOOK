import { useMemo, useRef, useState } from "react";
import type { KeywordRecord, MarketplaceId } from "../../shared/types";
import { keywordOpportunity, type KeywordOpportunity } from "../../shared/analytics/keyword";
import { ApiError, api, type KeywordScoreDto } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Progress, SegmentedControl } from "../components/ui";
import { fmtInt, fmtMoney } from "../lib/format";
import { useRoute } from "../router";
import { useApp } from "../state";

/**
 * Finding a niche the way a person actually finds one.
 *
 * This replaces two screens that each did half the job badly. The keyword lab
 * produced four hundred rows and no decision; the idea finder made you walk
 * down a category tree, a slow click at a time, from the most generic shelf in
 * the shop — the opposite of where niches live.
 *
 * What works is what the publisher was already doing by hand: type "sopa de
 * letras" into Amazon and watch what it offers. It suggests "asesinatos", and
 * that is a niche. Then type one more letter — "sopa de letras m" — and
 * "mini para niños" appears, which was nowhere in the first list. Amazon only
 * ever shows ten suggestions, so the interesting ones hide behind a letter.
 *
 * So: sweep the alphabet over the seed, separate what Amazon volunteers from
 * what it only admits when pushed, and then go and check which of those
 * actually have books selling behind them. Demand and supply in one pass,
 * ending in a short list of phrases worth a full report — not a spreadsheet.
 */

/** How many phrases get a supply check. Each one costs a search page. */
const TO_SCORE = 12;
/** Half the budget is reserved for phrases only a letter revealed. */
const HIDDEN_SHARE = 6;

type Department = "print" | "kindle" | "all";

interface Row {
  record: KeywordRecord;
  score?: KeywordScoreDto;
  verdict?: KeywordOpportunity | null;
}

export function ExplorePage() {
  const { settings, currencySymbol } = useApp();
  const marketplace: MarketplaceId = settings?.marketplace ?? "com";
  const { navigate } = useRoute();

  const [seed, setSeed] = useState("");
  const [department, setDepartment] = useState<Department>("print");
  const [records, setRecords] = useState<KeywordRecord[]>([]);
  const [scores, setScores] = useState<Record<string, KeywordScoreDto>>({});
  const [phase, setPhase] = useState<"idle" | "sweep" | "score" | "done">("idle");
  const [progress, setProgress] = useState({ label: "", done: 0, total: 1 });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cancelled = useRef(false);

  async function explore() {
    const phrase = seed.trim().toLowerCase();
    if (phrase.length < 3) {
      setError("Escribe al menos tres letras.");
      return;
    }
    cancelled.current = false;
    setError(null);
    setNote(null);
    setRecords([]);
    setScores({});

    // --- 1. What does Amazon offer, and what does it hide behind a letter ---
    setPhase("sweep");
    const collected = new Map<string, KeywordRecord>();
    const groups = ["base", "alphabetA", "alphabetB"] as const;
    for (let i = 0; i < groups.length; i++) {
      if (cancelled.current) return;
      setProgress({
        label: i === 0 ? `Preguntando a Amazon por «${phrase}»…` : "Probando letra por letra…",
        done: i, total: groups.length,
      });
      try {
        const response = await api.expand({ seed: phrase, marketplace, group: groups[i], department });
        for (const record of response.keywords) {
          const existing = collected.get(record.keyword);
          // First sighting wins the source: a phrase Amazon volunteers for the
          // bare seed is not a discovery just because a letter found it again.
          if (existing) existing.hits += record.hits;
          else collected.set(record.keyword, { ...record });
        }
      } catch (err) {
        const apiError = err instanceof ApiError ? err : null;
        if (i === 0) {
          setPhase("idle");
          setError(apiError?.message ?? "Amazon no respondió al autocompletado");
          return;
        }
        setNote("Alguna tanda de letras no respondió: la lista sale algo más corta.");
      }
    }

    const found = [...collected.values()].filter((r) => r.keyword !== phrase);
    setRecords(found);
    if (!found.length) {
      setPhase("done");
      setNote(`El autocompletado no devolvió nada alrededor de «${phrase}». Apunta a poco volumen —no a que nadie la escriba—: prueba una frase más común y baja desde ahí.`);
      return;
    }

    // --- 2. Which of those have books selling behind them ------------------
    // The budget is split on purpose. Ranking purely by the demand proxy buys
    // the obvious phrases, and the whole point of the sweep is the ones that
    // only surfaced under a letter — those are where a niche is still open.
    const hidden = found.filter((r) => r.source === "alphabet").sort(byDemand).slice(0, HIDDEN_SHARE);
    const open = found.filter((r) => !hidden.includes(r)).sort(byDemand);
    const shortlist = [...hidden, ...open].slice(0, TO_SCORE);

    await check(shortlist.map((r) => r.keyword));
  }

  /**
   * Score a set of phrases, merging into whatever is already known. Amazon
   * refuses a share of requests on any pass and the same one usually answers
   * moments later, so this is reusable rather than one-shot: a row that came
   * back empty is a row to try again, not a verdict.
   */
  async function check(phrases: string[]) {
    setPhase("score");
    for (let i = 0; i < phrases.length; i += 8) {
      if (cancelled.current) break;
      const batch = phrases.slice(i, i + 8);
      setProgress({ label: `Mirando quién vende en ${batch.length} de esas frases…`, done: i, total: phrases.length });
      try {
        const response = await api.scoreKeywords({ keywords: batch, marketplace, department });
        setScores((current) => {
          const next = { ...current };
          for (const entry of response.scored) next[entry.keyword] = entry;
          return next;
        });
      } catch {
        setNote("Amazon rechazó parte de la comprobación. Puedes reintentarla abajo.");
      }
    }
    setPhase("done");
  }

  const rows = useMemo<Row[]>(() => {
    const built = records.map((record) => {
      const score = scores[record.keyword];
      const verdict = score && !score.error
        ? keywordOpportunity({
            demandProxy: record.demandProxy,
            totalResults: score.totalResults ?? null,
            medianReviews: score.medianReviews ?? null,
            lowReviewShare: score.lowReviewShare ?? null,
          })
        : null;
      return { record, score, verdict };
    });
    // Checked phrases first and best verdict on top; the unchecked tail keeps
    // its demand order so it still reads as a ranking rather than a dump.
    return built.sort((a, b) => {
      const av = a.verdict?.score ?? -1;
      const bv = b.verdict?.score ?? -1;
      return bv - av || b.record.demandProxy - a.record.demandProxy;
    });
  }, [records, scores]);

  // Two different kinds of blank: never tried, and tried and refused. Both
  // used to show a dash, which made a flaky answer look like a finished one.
  const pending = rows.filter((r) => !r.score).map((r) => r.record.keyword);
  const failed = rows.filter((r) => r.score?.error).map((r) => r.record.keyword);
  const hiddenRows = rows.filter((r) => r.record.source === "alphabet");
  const openRows = rows.filter((r) => r.record.source !== "alphabet");
  const busy = phase === "sweep" || phase === "score";

  return (
    <Layout
      title="Buscar ideas"
      subtitle="Escribe una frase y mira qué hay alrededor: lo que Amazon sugiere, lo que solo enseña si sigues escribiendo, y cuál de todo eso tiene libros vendiendo detrás."
      actions={
        <SegmentedControl
          value={department}
          onChange={setDepartment}
          options={[{ value: "print", label: "Papel" }, { value: "kindle", label: "Kindle" }, { value: "all", label: "Todo" }]}
        />
      }
    >
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {note ? <Alert tone="warn">{note}</Alert> : null}

      <Card>
        <div className="card-pad">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Por dónde empezar" help="Una frase corta y común. «sopa de letras», no «sopa de letras de crimen para adultos».">
              <input
                className="input input-lg" value={seed} placeholder="sopa de letras"
                onChange={(event) => setSeed(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !busy) void explore(); }}
              />
            </Field>
            <Button variant="primary" loading={busy} icon={<Icon.Search size={16} />} onClick={() => void explore()}>
              Explorar
            </Button>
            {busy ? (
              <Button onClick={() => { cancelled.current = true; setPhase("done"); }}>Parar</Button>
            ) : null}
          </div>
          {busy ? (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="small">{progress.label}</div>
              <Progress value={progress.done} max={Math.max(1, progress.total)} />
            </div>
          ) : null}
        </div>
      </Card>

      {phase === "idle" && !records.length ? (
        <Empty icon="🔎" title="Empieza por lo genérico y deja que Amazon te lleve">
          Amazon solo enseña diez sugerencias por vez, así que las frases interesantes se esconden
          detrás de una letra. Esto las saca todas y luego comprueba cuáles tienen mercado.
        </Empty>
      ) : null}

      {hiddenRows.length ? (
        <PhraseCard
          title="Lo que solo aparece si sigues escribiendo"
          note={`Amazon no las ofrece para «${seed.trim()}» a secas: salieron al añadir una letra. Aquí es donde suele quedar sitio.`}
          rows={hiddenRows} department={department} navigate={navigate} currency={currencySymbol}
        />
      ) : null}

      {openRows.length ? (
        <PhraseCard
          title="Lo que Amazon sugiere de entrada"
          note="Las que ve todo el mundo. Suelen tener más volumen y más competencia."
          rows={openRows} department={department} navigate={navigate} currency={currencySymbol}
        />
      ) : null}

      {!busy && (pending.length || failed.length) ? (
        <div className="row-tight" style={{ padding: "0 4px" }}>
          {failed.length ? (
            <Button icon={<Icon.Refresh size={15} />} onClick={() => void check(failed)}>
              Reintentar {failed.length === 1 ? "la que falló" : `las ${failed.length} que fallaron`}
            </Button>
          ) : null}
          {pending.length ? (
            <Button onClick={() => void check(pending.slice(0, 8))}>
              Comprobar {Math.min(8, pending.length)} más de las {pending.length} que faltan
            </Button>
          ) : null}
        </div>
      ) : null}

      {rows.length ? (
        <div className="small faint" style={{ padding: "0 4px" }}>
          «Se busca» es la posición en el autocompletado de Amazon, no volumen de búsquedas: dice
          que la frase se teclea, no cuánto. Las filas «sin comprobar» son las que quedaron fuera
          del presupuesto de esta pasada.
        </div>
      ) : null}
    </Layout>
  );
}

function byDemand(a: KeywordRecord, b: KeywordRecord): number {
  return b.demandProxy - a.demandProxy;
}

function PhraseCard({
  title, note, rows, department, navigate, currency,
}: {
  title: string; note: string; rows: Row[]; department: Department;
  navigate: (to: string) => void; currency: string;
}) {
  return (
    <Card>
      <CardHead title={title} note={note} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Frase</th>
              <th className="num">Se busca</th>
              <th className="num">Competidores</th>
              <th className="num">Reseñas</th>
              <th className="num">Precio</th>
              <th>Veredicto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ record, score, verdict }) => (
              <tr key={record.keyword}>
                <td>{record.keyword}</td>
                <td className="num">{record.demandProxy}</td>
                <td className="num">{score?.totalResults != null ? fmtInt(score.totalResults) : "—"}</td>
                <td className="num">{score?.medianReviews != null ? fmtInt(score.medianReviews) : "—"}</td>
                <td className="num">{score?.avgPrice != null ? fmtMoney(score.avgPrice, currency) : "—"}</td>
                <td>
                  {verdict ? (
                    <span title={verdict.reason}>
                      <Badge tone={verdict.tone}>{verdict.label} · {verdict.score}</Badge>
                    </span>
                  ) : score?.error === "empty" ? (
                    <span title="Amazon devolvió la página sin libros. Suele ser el recorte que sirve a un servidor, no un nicho vacío.">
                      <Badge tone="warn">página vacía</Badge>
                    </span>
                  ) : score?.error ? (
                    <Badge tone="bad">bloqueada</Badge>
                  ) : (
                    <span className="small faint">sin comprobar</span>
                  )}
                </td>
                <td>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => navigate(`/nicho?keyword=${encodeURIComponent(record.keyword)}&dept=${department}`)}
                  >
                    Informe
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
