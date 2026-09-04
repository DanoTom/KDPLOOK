import { useCallback, useMemo, useState } from "react";
import type { BookRecord, CategoryChild, MarketplaceId } from "../../shared/types";
import { summariseCategory } from "../../shared/analytics/category";
import {
  HIDDEN_CATEGORY_SLOTS, TOTAL_CATEGORY_SLOTS, categoryRequestEmail,
  readPlacements, type PlacementCandidate, type PlacementRead,
} from "../../shared/analytics/placement";
import { deriveMetrics } from "../../shared/analytics/score";
import { ApiError, api } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Progress } from "../components/ui";
import { bookFromDetail } from "../lib/book";
import { fmtInt } from "../lib/format";
import { useApp } from "../state";

/**
 * Where to ask KDP to put the book.
 *
 * The only screen here that makes money out of a book that already exists: two
 * categories come with publication, support adds up to eight more on request,
 * and each one is another bestseller list where the orange badge might be
 * winnable. The work it saves is the measuring — the right eight are the ones
 * whose #1 sells least, and finding those by hand is a hundred page loads.
 *
 * Reading only the top three of each list is deliberate: the badge bar is what
 * the #1 does, so three books per category buys the answer for two requests
 * instead of eleven, and twenty categories stay inside a coffee's worth of
 * waiting.
 */

/** Enough of each list to read the bar without paying for the whole list. */
const PROBE = 3;

interface Crumb {
  node: string;
  name: string;
}

export function PlacementPage() {
  const { settings, marketplaces, currencySymbol, toast } = useApp();
  const marketplace: MarketplaceId = settings?.marketplace ?? "com";
  const store = marketplaces.find((m) => m.id === marketplace)?.host?.replace(/^www\./, "") ?? `amazon.${marketplace}`;

  const [asin, setAsin] = useState("");
  const [book, setBook] = useState<{ asin: string; title: string } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [node, setNode] = useState("");
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [children, setChildren] = useState<CategoryChild[]>([]);
  const [measured, setMeasured] = useState<PlacementCandidate[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  // Two errors, not one: browsing the tree used to clear whatever the book
  // lookup had said, so a rejected ASIN vanished the moment you carried on and
  // the screen simply never produced a message, with nothing on it explaining
  // why. Each step keeps its own complaint until that step is retried.
  const [bookError, setBookError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function lookUp() {
    const clean = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(clean)) {
      setBookError(`Un ASIN son 10 caracteres y ese tiene ${clean.length}. Está en la ficha del libro, en «Detalles del producto».`);
      return;
    }
    setBookError(null);
    setLookingUp(true);
    try {
      const found = await api.book(clean, marketplace);
      setBook({ asin: clean, title: found.detail.title ?? clean });
    } catch (err) {
      setBookError(err instanceof ApiError ? err.message : "No se pudo leer el libro");
    } finally {
      setLookingUp(false);
    }
  }

  /** Open a branch: list its children so they can be measured or descended. */
  const open = useCallback(async (target: string, targetName: string | null) => {
    setError(null);
    setWarning(null);
    setMeasured([]);
    setProgress({ label: "Leyendo las subcategorías…", done: 0, total: 1 });
    try {
      const listing = await api.categoryList({ node: target, marketplace, department: "print" });
      setName(listing.name ?? targetName);
      setChildren(listing.children);
      if (!listing.children.length) {
        setWarning("Esta rama ya no tiene subcategorías: es de las de abajo del todo, y por eso suele ser de las buenas.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo leer la categoría");
    } finally {
      setProgress(null);
    }
  }, [marketplace]);

  /** Measure every child of the branch: what does its #1 have to sell. */
  const measure = useCallback(async () => {
    if (!settings || !children.length) return;
    setError(null);
    setWarning(null);
    setMeasured([]);
    const path = [...trail.map((c) => c.name).filter(Boolean), name ?? ""].filter(Boolean);
    const results: PlacementCandidate[] = [];
    let refused = 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      setProgress({ label: `Midiendo «${child.name}» (${i + 1}/${children.length})`, done: i, total: children.length });
      try {
        const listing = await api.categoryList({ node: child.node, marketplace, department: "print" });
        const targets = listing.asins.slice(0, PROBE);
        let books: BookRecord[] = [];
        if (targets.length) {
          const response = await api.enrich({ asins: targets, marketplace });
          books = response.details
            .map((detail) => bookFromDetail(detail, marketplace, targets.indexOf(detail.asin) + 1))
            .map((record) => deriveMetrics(record, marketplace, settings))
            .sort((a, b) => a.position - b.position);
        }
        // The same summary the category screen uses, so the badge bar here and
        // the badge bar there can never be two different numbers.
        const stats = summariseCategory(books, {
          node: child.node, name: child.name, marketplace,
          department: "print", listed: listing.asins.length, settings,
        });
        results.push({
          node: child.node,
          name: child.name,
          path: [...path, child.name],
          url: `https://${store}/gp/bestsellers/books/${child.node}/`,
          salesToNumber1: stats.salesToNumber1,
          bsrNumber1: stats.bsrNumber1,
          read: books.length,
        });
      } catch {
        refused++;
        results.push({
          node: child.node, name: child.name, path: [...path, child.name],
          url: `https://${store}/gp/bestsellers/books/${child.node}/`,
          salesToNumber1: null, bsrNumber1: null, read: 0,
        });
      }
    }

    if (refused) setWarning(`${refused} de ${children.length} subcategorías no se pudieron leer. Vuelve a medir en un rato y se completan.`);
    setMeasured(results);
    setProgress(null);
  }, [children, marketplace, name, settings, store, trail]);

  const ranked = useMemo(() => readPlacements(measured), [measured]);
  const picked = useMemo(
    () => chosen.map((n) => ranked.find((r) => r.node === n)).filter((r): r is PlacementRead => Boolean(r)),
    [chosen, ranked],
  );

  function toggle(nodeId: string) {
    setChosen((current) => {
      if (current.includes(nodeId)) return current.filter((n) => n !== nodeId);
      if (current.length >= HIDDEN_CATEGORY_SLOTS) {
        toast(`Son ${HIDDEN_CATEGORY_SLOTS} como máximo: quita una para añadir otra.`, "info");
        return current;
      }
      return [...current, nodeId];
    });
  }

  function openChild(child: CategoryChild) {
    setTrail((current) => [...current, { node, name: name ?? "Libros" }]);
    setNode(child.node);
    void open(child.node, child.name);
  }

  function goBack() {
    const previous = trail[trail.length - 1];
    if (!previous) return;
    setTrail((current) => current.slice(0, -1));
    setNode(previous.node);
    void open(previous.node, previous.name);
  }

  const email = book && picked.length
    ? categoryRequestEmail({ title: book.title, asin: book.asin, store, chosen: picked })
    : null;

  return (
    <Layout
      title="Las diez categorías de tu libro"
      subtitle={`Al publicar eliges dos. Soporte añade ${HIDDEN_CATEGORY_SLOTS} más si se lo pides con las rutas exactas: ${TOTAL_CATEGORY_SLOTS} listas donde puede caerte el distintivo naranja.`}
    >
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {warning ? <Alert tone="warn">{warning}</Alert> : null}

      <Card>
        <CardHead title="1 · Qué libro" note="El ASIN está en la ficha del libro, en «Detalles del producto»." />
        <div className="card-pad">
          <div className="row-tight" style={{ alignItems: "flex-end" }}>
            <Field label="ASIN">
              <input
                className="input" value={asin} placeholder="B0XXXXXXXX"
                onChange={(event) => setAsin(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void lookUp(); }}
              />
            </Field>
            <Button onClick={() => void lookUp()} disabled={lookingUp}>
              {lookingUp ? "Buscando…" : "Buscar"}
            </Button>
          </div>
          {bookError ? <Alert tone="bad">{bookError}</Alert> : null}
          {book ? (
            <Alert tone="good"><strong>{book.title}</strong> · {book.asin}</Alert>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHead
          title="2 · Dónde buscar hueco"
          note="Baja hasta donde el nombre de la rama describa de verdad tu libro. Cuanto más abajo, más barato es el badge."
        />
        <div className="card-pad stack">
          {trail.length ? (
            <div className="row-tight" style={{ alignItems: "center" }}>
              <Button onClick={goBack}>← Volver</Button>
              <span className="small faint">
                {[...trail.map((c) => c.name), name ?? ""].filter(Boolean).join(" › ")}
              </span>
            </div>
          ) : null}

          {!trail.length && !children.length && !progress ? (
            <Button onClick={() => void open("", null)}>Empezar por todos los libros</Button>
          ) : null}

          {children.length ? (
            <>
              <div className="row-tight">
                {children.map((child) => (
                  <Button key={child.node} onClick={() => openChild(child)}>{child.name}</Button>
                ))}
              </div>
              <div>
                <Button variant="primary" onClick={() => void measure()} disabled={Boolean(progress)}>
                  Medir estas {children.length} subcategorías
                </Button>
              </div>
            </>
          ) : null}

          {progress ? (
            <div className="stack">
              <div className="small">{progress.label}</div>
              <Progress value={progress.done} max={Math.max(1, progress.total)} />
            </div>
          ) : null}
        </div>
      </Card>

      {ranked.length ? (
        <Card>
          <CardHead
            title="3 · Elige hasta ocho"
            note={`Ordenadas por lo que vende el primero de cada lista: cuanto menos, más barato el badge. Llevas ${chosen.length} de ${HIDDEN_CATEGORY_SLOTS}.`}
          />
          <div className="card-pad stack">
            {/* The obvious misreading of this list: cheapest badge = best
                category. It is not — an easy badge sits in a quiet shelf. The
                badge is still worth having, because it travels with the listing
                everywhere, but it is social proof, not traffic. */}
            <Alert tone="info">
              Que el badge sea barato aquí no significa que la categoría venda: significa que
              está tranquila. El distintivo igualmente merece la pena —viaja con tu ficha allá
              donde la vean— pero es prueba social, no visitas. Las visitas vienen de las
              palabras clave.
            </Alert>
            <Alert tone="warn">
              Pide solo categorías donde tu libro <strong>encaje de verdad</strong>. Amazon las
              revisa, y colocar un libro donde no pinta nada es la vía rápida a que se lo quiten
              todo — no solo la categoría de más.
            </Alert>
            {ranked.map((item) => (
              <label
                key={item.node}
                className="signal"
                style={{ alignItems: "flex-start", gap: 12, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(item.node)}
                  onChange={() => toggle(item.node)}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.name}</div>
                  <div className="row-tight" style={{ marginBottom: 6 }}>
                    {item.reach ? (
                      <Badge tone={item.reach === "asequible" ? "good" : item.reach === "exigente" ? "warn" : "bad"}>
                        {item.reach}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">sin medir</Badge>
                    )}
                    {item.salesToNumber1 !== null ? (
                      <Badge tone="neutral">{Math.round(item.salesToNumber1)} uds/mes para el #1</Badge>
                    ) : null}
                    {item.bsrNumber1 !== null ? (
                      <Badge tone="neutral">BSR {fmtInt(item.bsrNumber1)}</Badge>
                    ) : null}
                  </div>
                  <div className="small faint">{item.note}</div>
                </div>
              </label>
            ))}
          </div>
        </Card>
      ) : null}

      {ranked.length && !book ? (
        <Alert tone="info">Pon el ASIN arriba y te escribo el mensaje para soporte con estas rutas dentro.</Alert>
      ) : null}

      {email ? (
        <Card>
          <CardHead
            title="4 · El mensaje para soporte"
            note="KDP › Ayuda › Contacta con nosotros › Actualización de información del libro › Actualizar categorías."
          >
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(email)
                  .then(() => toast("Mensaje copiado", "good"))
                  .catch(() => toast("No se pudo copiar; selecciónalo a mano", "bad"));
              }}
            >
              <Icon.Bookmark className="icon" /> Copiar
            </Button>
          </CardHead>
          <div className="card-pad">
            <pre
              className="small"
              style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", lineHeight: 1.6 }}
            >
              {email}
            </pre>
          </div>
        </Card>
      ) : null}

      {!ranked.length && !progress && !children.length ? (
        <Empty icon="🏷" title="Todavía no hay nada medido">
          Elige el libro, baja por las ramas hasta donde encaje, y mide. Te digo en cuáles el
          primero vende poco — que son las que puedes ganar. Se muestra en {currencySymbol === "€" ? "euros" : "tu moneda"} lo
          que haga falta.
        </Empty>
      ) : null}
    </Layout>
  );
}
