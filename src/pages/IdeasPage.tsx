import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookRecord, CategoryChild, MarketplaceId } from "../../shared/types";
import { discoverIdeas } from "../../shared/analytics/discover";
import { deriveMetrics } from "../../shared/analytics/score";
import { ApiError, api } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Progress, SegmentedControl } from "../components/ui";
import { bookFromDetail } from "../lib/book";
import { fmtInt, fmtMoney } from "../lib/format";
import { Link, useRoute } from "../router";
import { useApp } from "../state";

/**
 * The screen for the day nothing comes to mind.
 *
 * Every other screen starts with an empty text box, which is the worst possible
 * thing to hand someone who has no idea. This one starts with a list of places
 * and ends with phrases to go and check — the same phrases the bestsellers are
 * already using, plus the recent books whose ranks prove those doors are open.
 *
 * The rule the layout follows: every click produces ideas, never just more
 * branches. A category tree that only leads to more tree is exactly what made
 * the browser useless for this.
 */

interface Crumb {
  node: string;
  name: string;
}

/** Enough titles for a phrase to repeat, few enough to finish in a minute. */
const SAMPLE = 30;

export function IdeasPage() {
  const { settings } = useApp();
  const marketplace: MarketplaceId = settings?.marketplace ?? "com";
  const { navigate } = useRoute();

  const [department, setDepartment] = useState<"print" | "kindle">("print");
  const [node, setNode] = useState("");
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [children, setChildren] = useState<CategoryChild[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const analyse = useCallback(async (target: string, targetName: string | null) => {
    setError(null);
    setWarning(null);
    setBooks([]);
    setProgress({ label: "Buscando por dónde empezar…", done: 0, total: 1 });

    let listing;
    try {
      listing = await api.categoryList({ node: target, marketplace, department });
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setProgress(null);
      setError({ message: apiError?.message ?? "No se pudo leer la lista", hint: apiError?.hint });
      return;
    }

    setName(listing.name ?? targetName);
    setChildren(listing.children);

    // The department root is every book in the shop: its bestsellers are the
    // most generic titles there are and mining them would cost thirty requests
    // to learn nothing. At the root this screen only offers the doors.
    if (!target) {
      setProgress(null);
      return;
    }

    const targets = listing.asins.slice(0, SAMPLE);
    if (!targets.length) {
      setProgress(null);
      setWarning("Amazon devolvió la rama pero sin libros. Prueba una subcategoría.");
      return;
    }

    const collected: BookRecord[] = [];
    const readBatch = async (asins: string[]): Promise<string[]> => {
      const failed: string[] = [];
      for (let i = 0; i < asins.length; i += 8) {
        setProgress({ label: `Leyendo portadas (${collected.length}/${targets.length})`, done: collected.length, total: targets.length });
        try {
          const response = await api.enrich({ asins: asins.slice(i, i + 8), marketplace });
          for (const detail of response.details) {
            collected.push(bookFromDetail(detail, marketplace, targets.indexOf(detail.asin) + 1));
          }
          failed.push(...response.failed);
        } catch (err) {
          const apiError = err instanceof ApiError ? err : null;
          setWarning(`Muestra incompleta: ${apiError?.message ?? "fallo de red"}`);
          return failed.concat(asins.slice(i));
        }
      }
      return failed;
    };

    const pending = await readBatch(targets);
    if (pending.length) {
      setWarning(`${pending.length} de ${targets.length} fichas no se leyeron. Las ideas salen de las que sí.`);
    }
    collected.sort((a, b) => a.position - b.position);
    setBooks(collected);
    setProgress(null);
  }, [marketplace, department]);

  useEffect(() => {
    setNode("");
    setTrail([]);
    void analyse("", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplace, department]);

  function openChild(child: CategoryChild) {
    setTrail((current) => [...current, { node, name: name ?? "Todo" }]);
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
  const ideas = useMemo(() => discoverIdeas(derived), [derived]);

  const atRoot = !node;

  return (
    <Layout
      title="De dónde salen las ideas"
      subtitle="Los libros que ya venden llevan el subnicho escrito en la portada. Esto lee esas portadas por ti."
      actions={
        <SegmentedControl
          value={department}
          onChange={setDepartment}
          options={[{ value: "print", label: "Papel" }, { value: "kindle", label: "Kindle" }]}
        />
      }
    >
      {error ? (
        <Alert tone="bad">
          <strong>{error.message}</strong>
          {error.hint ? <div className="small" style={{ marginTop: 4 }}>{error.hint}</div> : null}
        </Alert>
      ) : null}
      {warning ? <Alert tone="warn">{warning}</Alert> : null}

      {trail.length ? (
        <div className="row-tight" style={{ marginBottom: 12, alignItems: "center" }}>
          <Button onClick={goBack}>← Volver</Button>
          <span className="small faint">{[...trail.map((c) => c.name), name ?? ""].filter(Boolean).join(" › ")}</span>
        </div>
      ) : null}

      {progress ? (
        <Card>
          <div className="card-pad stack">
            <div className="small">{progress.label}</div>
            <Progress value={progress.done} max={Math.max(1, progress.total)} />
          </div>
        </Card>
      ) : null}

      {atRoot && !progress ? (
        <Card>
          <CardHead
            title="Elige por dónde empezar"
            note="Son las secciones de la tienda, con sus nombres. No hace falta que aciertes: en cada paso te doy ideas, no más ramas."
          />
          <div className="card-pad">
            {children.length ? (
              <div className="row-tight">
                {children.map((child) => (
                  <Button key={child.node} onClick={() => openChild(child)}>{child.name}</Button>
                ))}
              </div>
            ) : (
              <Empty icon="🧭" title="Amazon no devolvió las secciones">
                Suele ser un bloqueo temporal. Vuelve a entrar en un minuto.
              </Empty>
            )}
          </div>
        </Card>
      ) : null}

      {!atRoot && !progress && ideas.analysed > 0 ? (
        <>
          <IdeasCard ideas={ideas} department={department} navigate={navigate} />
          <OpenDoorsCard ideas={ideas} marketplace={marketplace} />
        </>
      ) : null}

      {!atRoot && children.length && !progress ? (
        <Card>
          <CardHead
            title="Afinar dentro de esta rama"
            note="Cuanto más abajo, más concreto el subnicho y menos gente compitiendo."
          />
          <div className="card-pad row-tight">
            {children.map((child) => (
              <Button key={child.node} onClick={() => openChild(child)}>{child.name}</Button>
            ))}
          </div>
        </Card>
      ) : null}
    </Layout>
  );
}

function IdeasCard({
  ideas, department, navigate,
}: {
  ideas: ReturnType<typeof discoverIdeas>;
  department: "print" | "kindle";
  navigate: (to: string) => void;
}) {
  if (!ideas.phrases.length) {
    return (
      <Card>
        <CardHead title="Ideas de esta rama" />
        <div className="card-pad">
          <Empty icon="🔍" title="Ninguna frase se repite lo suficiente">
            De {ideas.analysed} portadas leídas, ninguna comparte una frase con otras dos. Suele
            pasar en ramas muy amplias: baja un nivel más y vuelve a mirar.
          </Empty>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title="Lo que repiten los que venden"
        note={`De ${ideas.analysed} portadas leídas. Cada frase la usan varios más vendidos: eso es un subnicho que la categoría te está señalando.`}
      />
      <div className="card-pad stack">
        {ideas.phrases.map((phrase) => (
          <div key={phrase.term} className="signal" style={{ alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{phrase.term}</div>
              <div className="row-tight" style={{ marginBottom: 6 }}>
                <Badge tone="neutral">{phrase.books} libros</Badge>
                {phrase.medianBsr !== null ? (
                  <Badge tone="neutral">BSR {fmtInt(phrase.medianBsr)} de mediana</Badge>
                ) : null}
                {phrase.young > 0 ? (
                  <Badge tone="good">{phrase.young} reciente{phrase.young === 1 ? "" : "s"}</Badge>
                ) : null}
              </div>
              <div className="small faint" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {phrase.examples.join(" · ")}
              </div>
            </div>
            <Button
              onClick={() => navigate(`/nicho?keyword=${encodeURIComponent(phrase.term)}&dept=${department}`)}
            >
              Analizar
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * The strongest single signal on the screen: a book published months ago that
 * is already on a bestseller list. Somebody entered recently and it worked, and
 * that is a far better argument than any score this app computes.
 */
function OpenDoorsCard({
  ideas, marketplace,
}: {
  ideas: ReturnType<typeof discoverIdeas>;
  marketplace: MarketplaceId;
}) {
  const { currencySymbol } = useApp();

  if (!ideas.dated) {
    return (
      <Card>
        <CardHead title="Puertas abiertas ahora mismo" />
        <div className="card-pad">
          <Empty icon="🚪" title="Ninguna ficha traía fecha de publicación">
            Sin fecha no se puede saber cuál es reciente. Vuelve a intentarlo: suele ser que
            Amazon devolvió las fichas recortadas.
          </Empty>
        </div>
      </Card>
    );
  }

  if (!ideas.young.length) {
    return (
      <Card>
        <CardHead title="Puertas abiertas ahora mismo" />
        <div className="card-pad">
          <Empty icon="🚪" title="Aquí no ha entrado nadie nuevo">
            De {ideas.dated} libros con fecha, ninguno tiene menos de un año. Una lista sin
            caras nuevas suele significar que los de arriba llevan tiempo y no se mueven.
          </Empty>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title="Puertas abiertas ahora mismo"
        note={`${ideas.young.length} de ${ideas.dated} más vendidos se publicaron hace menos de un año. Alguien entró hace poco y le funcionó.`}
      />
      <div className="card-pad stack">
        {ideas.young.map(({ book, ageMonths, launching }) => (
          <div key={book.asin} className="signal" style={{ alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{book.title}</div>
              <div className="row-tight">
                <Badge tone="neutral">{describeAge(ageMonths)}</Badge>
                {book.bsr !== null ? <Badge tone="good">BSR {fmtInt(book.bsr)}</Badge> : null}
                {book.price !== null ? (
                  <Badge tone="neutral">{fmtMoney(book.price, currencySymbol)}</Badge>
                ) : null}
                {book.reviews !== null ? <Badge tone="neutral">{book.reviews} reseñas</Badge> : null}
                {launching ? <Badge tone="warn">recién salido</Badge> : null}
              </div>
              {launching ? (
                <div className="small faint" style={{ marginTop: 6 }}>
                  Lleva tan poco que su puesto puede venir de la publicidad del lanzamiento y no
                  de un ritmo de ventas.
                </div>
              ) : null}
            </div>
            <Link to={`/libro?asin=${book.asin}&marketplace=${marketplace}`}>
              <Button>Ver ficha <Icon.External className="icon" /></Button>
            </Link>
          </div>
        ))}
      </div>
    </Card>
  );
}

function describeAge(months: number): string {
  if (months < 1) {
    const days = Math.max(1, Math.round(months * 30.44));
    return `hace ${days} ${days === 1 ? "día" : "días"}`;
  }
  const rounded = Math.round(months);
  return `hace ${rounded} ${rounded === 1 ? "mes" : "meses"}`;
}
