import type { BookRecord } from "../types";

/**
 * Where a new title could differentiate itself.
 *
 * The rest of the app answers whether a niche is worth entering. This answers
 * the question that decides whether entering works: what would make the book
 * different from what is already there. A niche entered with a commodity
 * product competes only on cover and ad budget, which is the fight an
 * independent publisher loses.
 *
 * Every angle carries the evidence it was drawn from, so it can be judged
 * rather than taken on faith.
 */

export interface Angle {
  id: string;
  label: string;
  /** What in the scanned data suggests this. */
  evidence: string;
  /** What to do about it. */
  action: string;
  strength: "fuerte" | "media";
  /**
   * Whether this was read off this niche's own data or is a product variation
   * nobody happens to cover. The first is evidence, the second is a hypothesis,
   * and the label says which so they are not weighed the same.
   */
  source: "dato" | "hueco";
}

interface Facet {
  id: string;
  label: string;
  match: RegExp;
  action: string;
}

/** Product variations that regularly carve out a slice of an existing niche. */
const FACETS: Facet[] = [
  {
    id: "letra-grande",
    label: "Letra grande",
    match: /letra grande|large print|caracteres grandes|gran formato/i,
    action: "Nadie cubre a quien no ve bien de cerca. Una edición en letra grande es el mismo interior con otra maqueta.",
  },
  {
    id: "mayores",
    label: "Personas mayores",
    match: /mayores|seniors|tercera edad|abuelos|elderly|adultos mayores/i,
    action: "Un público con tiempo, hábito de compra en papel y poca oferta pensada para él.",
  },
  {
    id: "principiantes",
    label: "Principiantes",
    match: /principiantes|beginners|f[áa]cil|sencillo|iniciaci[óo]n|easy|starter/i,
    action: "Una edición fácil capta a quien abandona con la dificultad estándar.",
  },
  {
    id: "ninos",
    label: "Infantil por edad",
    match: /ni[ñn]os|kids|infantil|\b\d\s*-\s*\d+\s*a[ñn]os|ages?\s*\d/i,
    action: "Segmentar por franja de edad concreta (6-8, 9-12) es de las formas más limpias de subnichar.",
  },
  {
    id: "profesional",
    label: "Uso profesional",
    match: /profesional|profesionales|para (?:psic[óo]logos|terapeutas|docentes|enfermer|m[ée]dic|abogad)|professional/i,
    action: "Un producto para un oficio concreto vende más caro y compite con muchos menos. Es lo que ya te funcionó.",
  },
  {
    id: "regalo",
    label: "Edición regalo",
    match: /regalo|gift|para regalar|edici[óo]n especial/i,
    action: "Presentarlo como regalo permite tapa dura y un precio bastante más alto.",
  },
];

export interface AngleInput {
  items: BookRecord[];
  keyword: string;
}

export function findAngles({ items, keyword }: AngleInput): Angle[] {
  const organic = items.filter((b) => !b.sponsored);
  if (organic.length < 4) return [];

  // Angles read off the data outrank generic product gaps: "three competitors
  // have unhappy customers" is evidence, "nobody says gift edition" is a guess.
  const fromData: Angle[] = [];
  const fromGaps: Angle[] = [];
  const titles = organic.map((b) => `${b.title} ${b.author}`).join(" · ");
  const haystack = `${keyword} · ${titles}`;

  // --- unhappy customers: the strongest opening there is --------------------
  const reviewed = organic.filter((b) => (b.reviews ?? 0) >= 30 && b.rating !== null);
  const unhappy = reviewed.filter((b) => (b.rating ?? 5) <= 4.2);
  if (unhappy.length >= 2) {
    fromData.push({
      id: "clientes-insatisfechos",
      source: "dato",
      label: "Competidores con clientes descontentos",
      evidence: `${unhappy.length} libros con reseñas de sobra y solo ${Math.min(...unhappy.map((b) => b.rating ?? 5)).toFixed(1)}–${Math.max(...unhappy.map((b) => b.rating ?? 5)).toFixed(1)} estrellas.`,
      action: "Lee sus reseñas de 1 y 2 estrellas: ahí está escrita la especificación de tu producto. Las quejas repetidas son el hueco.",
      strength: "fuerte",
    });
  }

  // --- product variations nobody is covering --------------------------------
  for (const facet of FACETS) {
    if (facet.match.test(haystack)) continue;
    fromGaps.push({
      id: facet.id,
      source: "hueco",
      label: `Sin edición «${facet.label.toLowerCase()}»`,
      evidence: `Ningún resultado de la primera página menciona ${facet.label.toLowerCase()}.`,
      action: facet.action,
      strength: facet.id === "letra-grande" || facet.id === "profesional" ? "fuerte" : "media",
    });
  }

  // --- format gaps ----------------------------------------------------------
  const formats = new Set(organic.map((b) => b.format));
  if (!formats.has("hardcover") && organic.length >= 8) {
    fromData.push({
      id: "tapa-dura",
      source: "dato",
      label: "Nadie publica en tapa dura",
      evidence: "Toda la primera página es tapa blanda.",
      action: "La tapa dura sostiene un precio bastante más alto y posiciona el libro como regalo, con la misma tirada bajo demanda.",
      strength: "media",
    });
  }

  // --- an ageing shelf ------------------------------------------------------
  const ages = organic.map((b) => b.ageMonths).filter((v): v is number => v !== null);
  if (ages.length >= 5) {
    const median = [...ages].sort((a, b) => a - b)[Math.floor(ages.length / 2)];
    if (median >= 36) {
      fromData.push({
        id: "catalogo-antiguo",
        source: "dato",
        label: "El top es antiguo",
        evidence: `Mediana de ${Math.round(median / 12)} años desde la publicación.`,
        action: "Portadas de hace años pierden el primer clic frente a un diseño actual. Es la ventaja más barata de conseguir.",
        strength: "fuerte",
      });
    }
  }

  // --- everyone is long, which is also expensive to print -------------------
  const pages = organic.map((b) => b.pages).filter((v): v is number => v !== null);
  if (pages.length >= 5) {
    const median = [...pages].sort((a, b) => a - b)[Math.floor(pages.length / 2)];
    if (median >= 150) {
      fromData.push({
        id: "edicion-breve",
        source: "dato",
        label: "Todos son largos",
        evidence: `Mediana de ${median} páginas.`,
        action: "Una edición más breve cuesta bastante menos de imprimir y puede venderse igual de cara si el contenido está mejor elegido.",
        strength: "media",
      });
    }
  }

  // Strongest first within each tier, and never more than a handful: a list of
  // twenty options is the same as no recommendation at all.
  const order = { fuerte: 0, media: 1 };
  const byStrength = (a: Angle, b: Angle) => order[a.strength] - order[b.strength];
  const evidence = fromData.sort(byStrength);
  const gaps = fromGaps.sort(byStrength);
  return [...evidence, ...gaps.slice(0, Math.max(0, 6 - evidence.length))];
}
