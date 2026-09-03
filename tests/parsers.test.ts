/**
 * Parser regression suite.
 *
 * Amazon is unreachable from CI, so the parsers are exercised against captured
 * markup shapes instead: the modern `data-cy` search card, a sponsored card, a
 * detail page built from bullet lists and one built from the attribute table,
 * in English and Spanish. Run with: npm test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSearchPage } from "../worker/amazon/search";
import { parseProductPage } from "../worker/amazon/product";
import { bestsellerUrl, parseBestsellerPage } from "../worker/amazon/category";
import { getMarketplace, suggestUrl } from "../worker/amazon/marketplaces";
import { looksBlocked } from "../worker/amazon/fetcher";
import { parseDate, parseInteger, parsePrice } from "../worker/amazon/html";
import { calibrationFor, salesPerMonth, suggestCalibration } from "../shared/analytics/bsr";
import { DEFAULT_PRINTING_COSTS, computeRoyalty, printingCost } from "../shared/analytics/royalty";
import { buildEntryPlan } from "../shared/analytics/entry";
import { summariseNiche } from "../shared/analytics/score";
import { demandBsrFor, reviewExpertise } from "../shared/analytics/checklist";
import { seasonInsight } from "../shared/analytics/season";
import { findAngles } from "../shared/analytics/angles";
import { assessEstimate, estimateRange, readSeries } from "../shared/analytics/reliability";
import { keywordOpportunity } from "../shared/analytics/keyword";
import { buildProbes, relatedSeeds } from "../worker/amazon/suggest";
import type { AppSettings, BookRecord } from "../shared/types";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        esperado: ${JSON.stringify(expected)}`);
    console.log(`        obtenido: ${JSON.stringify(actual)}`);
  }
}

function truthy(name: string, value: unknown): void {
  if (value) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} (obtenido ${JSON.stringify(value)})`);
  }
}

console.log("\npagina de busqueda (en)");
{
  const result = parseSearchPage(fixture("search-en.html"), getMarketplace("com"));
  check("3 tarjetas reconocidas", result.items.length, 3);
  check("total de resultados", result.totalResults, 6000);

  const first = result.items[0];
  check("titulo", first.title, "Mandala Coloring Book for Adults: 50 Relaxing Designs");
  check("asin", first.asin, "B0BQ7XYZ12");
  check("autor", first.author, "Laura Vidal");
  check("precio", first.price, 7.99);
  check("valoracion", first.rating, 4.6);
  check("resenas", first.reviews, 1284);
  check("formato", first.format, "paperback");
  check("no patrocinado", first.sponsored, false);
  check("posicion organica", first.position, 1);
  truthy("portada", first.image.startsWith("https://m.media-amazon.com/"));

  const sponsored = result.items[1];
  check("tarjeta patrocinada detectada", sponsored.sponsored, true);
  check("los patrocinados no ocupan posicion", sponsored.position, 0);

  const third = result.items[2];
  check("el segundo organico mantiene la numeracion", third.position, 2);
  check("tapa dura", third.format, "hardcover");
  check("precio alto", third.price, 24.95);
  check("resenas con separador de millar", third.reviews, 12043);
  check("kindle unlimited", third.kindleUnlimited, true);
}

console.log("\npagina de busqueda (es)");
{
  const result = parseSearchPage(fixture("search-es.html"), getMarketplace("es"));
  check("una tarjeta", result.items.length, 1);
  const item = result.items[0];
  check("titulo con entidades", item.title, "Libro de Colorear para Adultos: Mandalas Antiestrés");
  check("autor tras 'de '", item.author, "Carmen Ruiz");
  check("precio en formato europeo", item.price, 8.99);
  check("valoracion con coma decimal", item.rating, 4.4);
  check("resenas", item.reviews, 356);
  check("formato tapa blanda", item.format, "paperback");
  check("total con separador de miles europeo", result.totalResults, 2000);
}

console.log("\nficha de producto (detail bullets)");
{
  const detail = parseProductPage(fixture("product-en.html"), "B0BQ7XYZ12");
  check("titulo", detail.title, "Mandala Coloring Book for Adults: 50 Relaxing Designs for Stress Relief");
  check("autor", detail.author, "Laura Vidal");
  check("precio", detail.price, 7.99);
  check("valoracion", detail.rating, 4.6);
  check("resenas", detail.reviews, 1284);
  check("bsr general", detail.bsr, 12486);
  check("rangos de categoria", detail.categoryRanks, [
    { name: "Mandala Coloring Books for Adults", rank: 24 },
    { name: "Adult Coloring Books", rank: 57 },
  ]);
  check("paginas", detail.pages, 112);
  check("editorial", detail.publisher, "Independently published");
  check("autopublicado", detail.selfPublished, true);
  check("fecha de publicacion", detail.publishedAt, "2023-05-12");
  check("idioma", detail.language, "English");
  check("isbn", detail.isbn, "979-8391234567");
  check("formato", detail.format, "paperback");
  truthy("imagen en alta resolucion", detail.image?.includes("91abcd"));
}

console.log("\nficha de producto (tabla de atributos, en-GB)");
{
  const detail = parseProductPage(fixture("product-table.html"), "B0UKTEST01");
  check("titulo", detail.title, "Sudoku Large Print for Seniors: 200 Puzzles");
  check("precio en libras", detail.price, 6.49);
  check("bsr desde tabla", detail.bsr, 142905);
  check("paginas desde Print length", detail.pages, 208);
  check("editorial tradicional", detail.publisher, "Puzzle House Press");
  check("no autopublicado", detail.selfPublished, false);
  check("fecha en formato britanico", detail.publishedAt, "2024-02-03");
  check("categoria anidada", detail.categoryRanks, [{ name: "Sudoku Puzzles", rank: 312 }]);
}

console.log("\nficha de producto (widget rich product information)");
{
  // Reproduces a real miss: this layout has no detail bullets and no attribute
  // table, and the field labels also appear inside HTML attributes such as
  // data-rpi-attribute-name="book_details-dimensions". The old reader matched
  // those attributes and returned fragments of markup as the value.
  const detail = parseProductPage(fixture("product-rpi.html"), "B0C1J5GRWQ");
  check("titulo", detail.title, "Music Coloring Book for Kids Age 4-8: 50 unique pictures to color");
  check("autor", detail.author, "Sonia Cajigal");
  check("editorial desde el widget rpi", detail.publisher, "Independently published");
  check("autopublicado detectado", detail.selfPublished, true);
  check("fecha desde el widget rpi", detail.publishedAt, "2023-04-18");
  check("idioma sin prefijo book_details", detail.language, "English");
  check("dimensiones limpias", detail.dimensions, "8.5 x 0.24 x 11 inches");
  check("isbn", detail.isbn, "979-8391914471");
  check("paginas", detail.pages, 102);
  check("precio desde corePrice_feature_div", detail.price, 6.99);
  check("una sola resena en singular", detail.reviews, 1);
  check("valoracion", detail.rating, 5);
  check("bsr general", detail.bsr, 368524);
  check("subcategorias", detail.categoryRanks, [
    { name: "Children's Music Books", rank: 1204 },
    { name: "Children's Coloring Books", rank: 3891 },
  ]);
  truthy("ningun valor arrastra marcado", ![detail.publisher, detail.language, detail.dimensions]
    .some((v) => v && /[<>"]|rpi-attribute|data-/.test(v)));
}

console.log("\nficha de producto (rpi parcial + vinetas con marcas bidi)");
{
  // Mirrors a live page: the RPI widget lacks the publisher, which therefore
  // has to come from a detail bullet whose separator is padded with bidi
  // marks, and the sales-rank list is followed by more page content.
  const detail = parseProductPage(fixture("product-rpi-mixed.html"), "B0C1J5GRWQ");
  check("editorial desde la vineta, sin marcas bidi", detail.publisher, "Independently published");
  check("autopublicado", detail.selfPublished, true);
  check("fecha desde el parentesis de la editorial", detail.publishedAt, "2023-04-12");
  check("idioma desde rpi", detail.language, "English");
  check("dimensiones desde rpi", detail.dimensions, "8.5 x 0.23 x 11 inches");
  check("isbn desde la vineta", detail.isbn, "979-8391121701");
  check("bsr general", detail.bsr, 407977);
  // The final category is the one the old boundary rule dropped.
  check("ambas subcategorias, incluida la ultima", detail.categoryRanks, [
    { name: "Children's Music Books", rank: 2190 },
    { name: "Children's Coloring Books", rank: 5014 },
  ]);
  check("resena en singular", detail.reviews, 1);
  truthy("ningun campo arrastra marcado ni marcas bidi",
    ![detail.publisher, detail.language, detail.dimensions, detail.isbn]
      .some((v) => v && /[<>]|rlm|lrm|data-/.test(v)));
}

console.log("\nlista de mas vendidos por categoria");
{
  const listing = parseBestsellerPage(fixture("bestsellers.html"));
  // Document order of the product links is the category ranking.
  check("asins en orden de ranking", listing.asins, ["B0AAA11111", "B0BBB22222", "B0CCC33333", "B0DDD44444"]);
  truthy("el enlace promocional previo a la parrilla se ignora", !listing.asins.includes("B0DECOY001"));
  check("nombre de la categoria", listing.name, "Children's Coloring Books");
  check("subcategorias de la navegacion", listing.children.map((child) => child.name), [
    "Books", "Animals", "Fantasy & Magic", "Vehicles",
  ]);
  check("nodo de una subcategoria", listing.children[1].node, "3204");
  check("migas de pan", listing.breadcrumb, ["Children's Coloring Books"]);
}

console.log("\nurls de mas vendidos");
{
  const us = getMarketplace("com");
  check("raiz de papel", bestsellerUrl(us, "", "print"), "https://www.amazon.com/gp/bestsellers/books/?language=en_US");
  check("nodo concreto", bestsellerUrl(us, "3204", "print"), "https://www.amazon.com/gp/bestsellers/books/3204/?language=en_US");
  check("segunda pagina", bestsellerUrl(us, "3204", "print", 2), "https://www.amazon.com/gp/bestsellers/books/3204/?language=en_US&pg=2");
  check("tienda kindle", bestsellerUrl(us, "", "kindle"), "https://www.amazon.com/gp/bestsellers/digital-text/?language=en_US");
  // Amazon served amazon.es in English to the Worker until the locale was pinned.
  check("amazon espana pide la tienda en espanol", bestsellerUrl(getMarketplace("es"), "902686031", "print"),
    "https://www.amazon.es/gp/bestsellers/books/902686031/?language=es_ES");
}

console.log("\nnombres de categoria");
{
  const listing = parseBestsellerPage(
    '<html><head><title>Amazon.es Best Sellers: The most popular items in Books</title></head>' +
    '<body><div id="gridItemRoot"><a href="/x/dp/B0AAA11111/ref=z"></a></div></body></html>',
  );
  check("se recorta el prefijo de amazon", listing.name, "Books");
}

console.log("\nautocompletado por tienda");
{
  // The US completion host answers in English whatever locale it is asked for,
  // which is why the keyword lab suggested English phrases on amazon.es.
  // The shared host serves every storefront; `mid` and `lop` pick which.
  truthy("por defecto va al host compartido", suggestUrl(getMarketplace("es"), "sudoku").startsWith("https://completion.amazon.com/"));
  truthy("el host regional queda como alternativa",
    suggestUrl(getMarketplace("es"), "sudoku", "print", "regional").startsWith("https://completion.amazon.es/"));
  truthy("se envia el mercado espanol", suggestUrl(getMarketplace("es"), "sudoku").includes("mid=A1RKKUPIHCS9HS"));
  truthy("se pide el locale de la tienda", suggestUrl(getMarketplace("es"), "sudoku").includes("lop=es_ES"));
}

console.log("\ndeteccion de bloqueo");
{
  const captcha =
    '<!DOCTYPE html><html><head><title>Amazon.com</title></head><body>' +
    '<form action="/errors/validateCaptcha"><h4>Enter the characters you see below</h4></form></body></html>';
  truthy("la pagina de captcha se reconoce como bloqueo", looksBlocked(200, captcha));
  check("un captcha no genera libros fantasma", parseSearchPage(captcha, getMarketplace("com")).items.length, 0);
  truthy("una pagina normal no se marca como bloqueo", !looksBlocked(200, fixture("search-en.html")));
  truthy("un 503 se marca como bloqueo", looksBlocked(503, ""));
}

console.log("\nnumeros y fechas");
{
  check("precio US", parsePrice("$1,234.56"), 1234.56);
  check("precio EU", parsePrice("1.234,56 EUR"), 1234.56);
  check("precio EU simple", parsePrice("8,99 EUR"), 8.99);
  check("precio sin decimales", parsePrice("1,200"), 1200);
  check("entero con puntos", parseInteger("12.486"), 12486);
  check("fecha US", parseDate("May 12, 2023"), "2023-05-12");
  check("fecha ES", parseDate("12 de mayo de 2023"), "2023-05-12");
  check("fecha DE", parseDate("12. Mai 2023"), "2023-05-12");
  check("fecha ISO", parseDate("2023-05-12"), "2023-05-12");
}

console.log("\ncurva de ventas");
{
  const a = salesPerMonth(1_000, "paperback", "com") ?? 0;
  const b = salesPerMonth(100_000, "paperback", "com") ?? 0;
  const c = salesPerMonth(1_000_000, "paperback", "com") ?? 0;
  truthy("bsr 1k vende mas que bsr 100k", a > b);
  truthy("bsr 100k vende mas que bsr 1M", b > c);
  truthy("bsr 1k da una cifra plausible (2000-5000/mes)", a > 2000 && a < 5000);
  truthy("bsr 100k da una cifra plausible (30-150/mes)", b > 30 && b < 150);
  check("sin bsr no hay estimacion", salesPerMonth(null, "paperback", "com"), null);
  truthy(
    "la tienda espanola vende menos con el mismo rango",
    (salesPerMonth(10_000, "paperback", "es") ?? 0) < (salesPerMonth(10_000, "paperback", "com") ?? 0),
  );
  truthy(
    "la calibracion escala la estimacion",
    Math.abs((salesPerMonth(10_000, "paperback", "com", 2) ?? 0) - 2 * (salesPerMonth(10_000, "paperback", "com") ?? 0)) < 0.5,
  );
}

console.log("\ncalibracion de la curva");
{
  // The multiplier that makes the curve match a figure the publisher knows.
  check("un libro de referencia", suggestCalibration([{ actualSalesPerMonth: 1.75, rawEstimate: 1.2 }]), 1.46);
  check("con varios se usa la mediana", suggestCalibration([
    { actualSalesPerMonth: 2, rawEstimate: 1 },
    { actualSalesPerMonth: 3, rawEstimate: 1 },
    { actualSalesPerMonth: 30, rawEstimate: 1 },
  ]), 3);
  check("sin muestras no hay sugerencia", suggestCalibration([]), null);
  check("una estimacion nula se ignora", suggestCalibration([{ actualSalesPerMonth: 5, rawEstimate: 0 }]), null);

  const base = {
    salesCurveCalibration: 1.5,
    calibrationByMarket: { es: 4 },
  } as unknown as Parameters<typeof calibrationFor>[0];
  check("la tienda calibrada usa su propio factor", calibrationFor(base, "es"), 4);
  check("las demas heredan el global", calibrationFor(base, "com"), 1.5);

  // Calibrating Spain must not move the US numbers.
  const spain = salesPerMonth(200_000, "paperback", "es", calibrationFor(base, "es")) ?? 0;
  const us = salesPerMonth(200_000, "paperback", "com", calibrationFor(base, "com")) ?? 0;
  truthy("espana escala con su factor medido", spain > 0);
  truthy("estados unidos no se ve afectado",
    Math.abs(us - (salesPerMonth(200_000, "paperback", "com", 1.5) ?? 0)) < 0.001);
}

console.log("\nplan de entrada");
{
  const settings = { printing: DEFAULT_PRINTING_COSTS } as unknown as AppSettings;
  const book = (position: number, over: Partial<BookRecord> = {}): BookRecord => ({
    asin: `B0${String(position).padStart(8, "0")}`, title: `Libro ${position}`, author: "A",
    url: "", image: "", format: "paperback", formatLabel: "Tapa blanda",
    price: 12.99, rating: 4.5, reviews: 40, sponsored: false, kindleUnlimited: false, position,
    bsr: 50_000, categoryRanks: [], pages: 120, publisher: null, publishedAt: null, language: null,
    isbn: null, dimensions: null, selfPublished: null, enriched: true,
    salesPerMonth: 20, revenuePerMonth: null, royaltyPerUnit: null, ageMonths: null, weakness: null,
    ...over,
  });

  const items = Array.from({ length: 12 }, (_, i) => book(i + 1));
  items[9] = book(10, { salesPerMonth: 25, reviews: 60 });   // the listing to displace
  items[11] = book(12, { salesPerMonth: 5 });                // outside the band

  const plan = buildEntryPlan({
    items, settings, marketplace: "com", targetIncome: 300, reviewsPerHundredSales: 1,
  });

  check("apunta al ultimo puesto de la banda", plan.targetPosition, 10);
  check("ventas mensuales para entrar", plan.targetSalesPerMonth, 25);
  check("equivalente diario", plan.targetSalesPerDay, 0.82);
  check("resenas del libro a desbancar", plan.reviewsToBeat, 60);
  check("precio de referencia (mediana del top 10)", plan.suggestedPrice, 12.99);
  check("paginas de referencia", plan.suggestedPages, 120);
  // 12.99 * 0.6 - (1.00 + 0.012 * 120) = 7.794 - 2.44
  check("regalia por unidad", plan.royaltyPerUnit, 5.35);
  check("ejemplares para 300 al mes", plan.unitsForTarget, 57);
  // 60 reviews at 1 per 100 sales, selling 25 a month = 0.25 reviews/month.
  check("meses hasta igualar resenas", plan.monthsToReviews, 240);
  check("viabilidad", plan.feasibility, "alcanzable");

  const hard = buildEntryPlan({
    items: items.map((b) => ({ ...b, salesPerMonth: 400 })),
    settings, marketplace: "com", targetIncome: 300, reviewsPerHundredSales: 1,
  });
  check("un top que vende mucho es duro", hard.feasibility, "duro");

  const blind = buildEntryPlan({
    items: items.map((b) => ({ ...b, salesPerMonth: null, bsr: null })),
    settings, marketplace: "com", targetIncome: 300, reviewsPerHundredSales: 1,
  });
  check("sin BSR no se inventa un plan", blind.feasibility, "sin datos");
  check("sin BSR no hay objetivo de ventas", blind.targetSalesPerMonth, null);
}

console.log("\ndemanda con resultados sesgados");
{
  const settings = {
    printing: DEFAULT_PRINTING_COSTS, weakReviewThreshold: 100,
    salesCurveCalibration: 1, calibrationByMarket: {}, calibrationSamples: [],
  } as unknown as AppSettings;
  const make = (position: number, sales: number): BookRecord => ({
    asin: `B0${String(position).padStart(8, "0")}`, title: `T${position}`, author: "A", url: "", image: "",
    format: "paperback", formatLabel: "Tapa blanda", price: 12, rating: 4.4, reviews: 5,
    sponsored: false, kindleUnlimited: false, position, bsr: 50_000, categoryRanks: [], pages: 120,
    publisher: null, publishedAt: null, language: null, isbn: null, dimensions: null,
    selfPublished: null, enriched: true, salesPerMonth: sales, revenuePerMonth: sales * 3,
    royaltyPerUnit: 3, ageMonths: 6, weakness: 60,
  });

  // Eighteen slow titles and two runaway bestsellers: the mean says the niche
  // is busy, the median says what a new entrant would actually face.
  const skewed = [
    ...Array.from({ length: 18 }, (_, i) => make(i + 1, 12)),
    make(19, 2400), make(20, 3000),
  ];
  const summary = summariseNiche(skewed, {
    keyword: "agenda docente", marketplace: "es", settings, totalResults: 10_000, resultsCountText: null,
  });

  check("la mediana ignora las superventas", summary.medianSalesPerMonth, 12);
  truthy("la media si se dispara (280 frente a 12)", (summary.avgSalesPerMonth ?? 0) > 250);
  truthy("la demanda se puntua por la mediana, no por la media", summary.demandScore < 50);
}

console.log("\ncurva propia de amazon.es");
{
  // Both anchors the curve was fitted to must come back out of it.
  const atTenK = salesPerMonth(10_000, "paperback", "es") ?? 0;
  truthy("BSR 10.000 da alrededor de una venta diaria", atTenK > 28 && atTenK < 33);
  const measured = salesPerMonth(334_200, "paperback", "es") ?? 0;
  truthy("BSR 334.200 reproduce las 1,75 ventas/mes medidas", Math.abs(measured - 1.75) < 0.1);

  // The old approach scaled the US curve, which fitted neither end.
  truthy("es monotona", (salesPerMonth(50_000, "paperback", "es") ?? 0) > (salesPerMonth(500_000, "paperback", "es") ?? 0));
  truthy("la calibracion sigue escalando",
    Math.abs((salesPerMonth(10_000, "paperback", "es", 2) ?? 0) - 2 * atTenK) < 0.2);

  // Other storefronts keep the US curve scaled by market size.
  truthy("estados unidos no cambia", (salesPerMonth(10_000, "paperback", "com") ?? 0) > 500);
  truthy("alemania sigue escalada", (salesPerMonth(10_000, "paperback", "de") ?? 0) < (salesPerMonth(10_000, "paperback", "com") ?? 0));

  // With the measurement now inside the curve, no correction is left to make.
  const factor = suggestCalibration([
    { actualSalesPerMonth: 1.75, rawEstimate: 1.2, bsr: 334_200, format: "paperback", marketplace: "es" },
  ]);
  truthy("una muestra ya incorporada no pide correccion", factor !== null && Math.abs(factor - 1) < 0.06);
}

console.log("\ncriterios de entrada del operador");
{
  const settings = {
    printing: DEFAULT_PRINTING_COSTS, weakReviewThreshold: 100,
    salesCurveCalibration: 1, calibrationByMarket: {}, calibrationSamples: [],
  } as unknown as AppSettings;

  const b = (position: number, over: Partial<BookRecord> = {}): BookRecord => ({
    asin: `B0${String(position).padStart(8, "0")}`, title: `T${position}`, author: "A", url: "", image: "",
    format: "paperback", formatLabel: "Tapa blanda", price: 12.99, rating: 4.5, reviews: 30,
    sponsored: false, kindleUnlimited: false, position, bsr: 6_000, categoryRanks: [], pages: 104,
    publisher: "Independently published", publishedAt: null, language: null, isbn: null, dimensions: null,
    selfPublished: true, enriched: true, salesPerMonth: 40, revenuePerMonth: 180,
    royaltyPerUnit: 4.5, ageMonths: 8, weakness: 70, ...over,
  });

  check("umbral de BSR para espana", demandBsrFor("es"), 10_000);
  check("umbral de BSR para estados unidos", demandBsrFor("com"), 300_000);

  const green = reviewExpertise(Array.from({ length: 10 }, (_, i) => b(i + 1)),
    { marketplace: "es", totalResults: 800, settings });
  check("nicho verde pasa los tres", green.passed, 3);
  check("sin banderas rojas", green.flags.length, 0);

  const crowded = reviewExpertise(Array.from({ length: 10 }, (_, i) => b(i + 1)),
    { marketplace: "es", totalResults: 12_000, settings });
  check("mas de 2.000 resultados suspende competencia", crowded.gates[0].pass, false);

  // Every competitor past a thousand reviews: unassailable head-on.
  const entrenched = reviewExpertise(Array.from({ length: 10 }, (_, i) => b(i + 1, { reviews: 3_000 })),
    { marketplace: "es", totalResults: 800, settings });
  check("prueba social masiva suspende viabilidad", entrenched.gates[2].pass, false);

  // Nothing selling: demand is not proven.
  const quiet = reviewExpertise(Array.from({ length: 10 }, (_, i) => b(i + 1, { bsr: 400_000 })),
    { marketplace: "es", totalResults: 800, settings });
  check("sin libros por debajo del umbral suspende demanda", quiet.gates[1].pass, false);

  // One live title among corpses: traffic is coming from outside Amazon.
  const oneSeller = [b(1, { bsr: 3_000 }), ...Array.from({ length: 8 }, (_, i) => b(i + 2, { bsr: 3_500_000 }))];
  const trap = reviewExpertise(oneSeller, { marketplace: "es", totalResults: 700, settings });
  truthy("detecta el nicho de un solo vendedor", trap.flags.some((f) => f.id === "trafico-externo"));

  const cheap = reviewExpertise(Array.from({ length: 10 }, (_, i) => b(i + 1, { price: 6.5 })),
    { marketplace: "es", totalResults: 800, settings });
  truthy("detecta guerra de precios", cheap.flags.some((f) => f.id === "guerra-precios"));

  const houses = reviewExpertise(
    Array.from({ length: 10 }, (_, i) => b(i + 1, { selfPublished: false, publisher: "Planeta" })),
    { marketplace: "es", totalResults: 800, settings });
  truthy("detecta monopolio editorial", houses.flags.some((f) => f.id === "monopolio-editorial"));

  const ads = reviewExpertise(
    [...Array.from({ length: 5 }, (_, i) => b(i + 1, { sponsored: true, position: 0 })),
     ...Array.from({ length: 8 }, (_, i) => b(i + 1))],
    { marketplace: "es", totalResults: 800, settings });
  truthy("detecta patrocinados dominando", ads.flags.some((f) => f.id === "patrocinados"));

  const blind = reviewExpertise([], { marketplace: "es", totalResults: null, settings });
  check("sin datos no se pronuncia", blind.tone, "unknown");
}

console.log("\nestacionalidad");
{
  const sept = new Date("2026-09-03T12:00:00Z");
  const teacher = seasonInsight("agenda docente 2026 2027", sept);
  check("reconoce la vuelta al cole", teacher.profile?.id, "vuelta-al-cole");
  check("septiembre es su pico", teacher.phase, "pico");
  truthy("avisa de que las cifras son el techo", /techo del a[ñn]o/.test(teacher.advice));

  // The same niche measured in spring reads as dead, and that is also wrong.
  const march = seasonInsight("agenda docente", new Date("2026-03-10T12:00:00Z"));
  check("en marzo esta en valle", march.phase, "valle");
  truthy("invita a volver a medirlo en temporada", /vuelve a medirlo/.test(march.advice));

  const diet = seasonInsight("diario de dieta y nutricion", new Date("2026-01-15T12:00:00Z"));
  check("bienestar en enero es pico", diet.phase, "pico");
  check("bienestar viene de la guia", diet.profile?.source, "guía");

  const gift = seasonInsight("libro de curiosidades para regalo", new Date("2026-11-20T12:00:00Z"));
  check("regalo en noviembre es pico", gift.phase, "pico");

  const neutral = seasonInsight("contabilidad para autonomos", sept);
  check("un nicho sin estacionalidad no inventa una", neutral.profile, null);
  check("y no da consejo estacional", neutral.phase, "neutro");

  // Publishing just before the season starts is the moment that matters.
  const beforePeak = seasonInsight("libro para colorear", new Date("2026-05-20T12:00:00Z"));
  check("mayo precede al pico de verano", beforePeak.phase, "entrando");
  truthy("recomienda publicar ahora", /Buen momento para publicar/.test(beforePeak.advice));
}

console.log("\ncombinacion dorada");
{
  const settings = {
    printing: DEFAULT_PRINTING_COSTS, weakReviewThreshold: 100,
    salesCurveCalibration: 1, calibrationByMarket: {}, calibrationSamples: [],
  } as unknown as AppSettings;
  const mk = (position: number, price: number, pages: number): BookRecord => ({
    asin: `B0${String(position).padStart(8, "0")}`, title: `T${position}`, author: "A", url: "", image: "",
    format: "paperback", formatLabel: "Tapa blanda", price, rating: 4.4, reviews: 20,
    sponsored: false, kindleUnlimited: false, position, bsr: 40_000, categoryRanks: [], pages,
    publisher: null, publishedAt: null, language: null, isbn: null, dimensions: null,
    selfPublished: true, enriched: true, salesPerMonth: 25, revenuePerMonth: 100,
    royaltyPerUnit: 4, ageMonths: 5, weakness: 60,
  });

  const onTarget = buildEntryPlan({
    items: Array.from({ length: 10 }, (_, i) => mk(i + 1, 11.99, 104)),
    settings, marketplace: "es", targetIncome: 300, reviewsPerHundredSales: 1,
  });
  truthy("un nicho al precio y extension objetivo encaja", onTarget.golden?.fits === true);
  // 9.99 * 0.6 - 2.30 flat print fee under 108 pages.
  check("regalia en el extremo bajo del rango", onTarget.golden?.royaltyLow, 3.69);
  check("regalia en el extremo alto", onTarget.golden?.royaltyHigh, 5.49);

  const tooLong = buildEntryPlan({
    items: Array.from({ length: 10 }, (_, i) => mk(i + 1, 12.99, 200)),
    settings, marketplace: "es", targetIncome: 300, reviewsPerHundredSales: 1,
  });
  truthy("200 paginas no encaja", tooLong.golden?.fits === false);
  // 1.00 + 0.012*200 = 3.40 against the 2.30 flat fee.
  check("cuantifica el sobrecoste de impresion", tooLong.golden?.extraPrintCost, 1.1);
  truthy("lo explica en las notas", tooLong.notes.some((n) => /108 p[áa]ginas/.test(n)));

  const cheap = buildEntryPlan({
    items: Array.from({ length: 10 }, (_, i) => mk(i + 1, 6.99, 104)),
    settings, marketplace: "es", targetIncome: 300, reviewsPerHundredSales: 1,
  });
  truthy("un nicho barato no encaja", cheap.golden?.fits === false);
  truthy("avisa del margen", cheap.notes.some((n) => /por debajo del objetivo/.test(n)));
}

console.log("\nangulos de diferenciacion");
{
  const mk = (position: number, over: Partial<BookRecord> = {}): BookRecord => ({
    asin: `B0${String(position).padStart(8, "0")}`, title: `Sudoku Vol ${position}`, author: "A",
    url: "", image: "", format: "paperback", formatLabel: "Tapa blanda", price: 11.99,
    rating: 4.6, reviews: 40, sponsored: false, kindleUnlimited: false, position,
    bsr: 40_000, categoryRanks: [], pages: 110, publisher: null, publishedAt: null,
    language: null, isbn: null, dimensions: null, selfPublished: true, enriched: true,
    salesPerMonth: 25, revenuePerMonth: 90, royaltyPerUnit: 3.6, ageMonths: 10, weakness: 60, ...over,
  });

  const base = Array.from({ length: 10 }, (_, i) => mk(i + 1));

  // Competitors with plenty of reviews and a mediocre rating are the clearest
  // opening there is: their own reviewers wrote the spec.
  const unhappy = findAngles({
    items: base.map((b, i) => (i < 3 ? { ...b, rating: 3.8, reviews: 200 } : b)),
    keyword: "sudoku",
  });
  truthy("detecta clientes descontentos", unhappy.some((a) => a.id === "clientes-insatisfechos"));
  check("y lo marca como fuerte", unhappy.find((a) => a.id === "clientes-insatisfechos")?.strength, "fuerte");
  check("y como deducido de los datos", unhappy.find((a) => a.id === "clientes-insatisfechos")?.source, "dato");
  // Evidence from this niche always outranks a generic product gap.
  check("los angulos con evidencia van primero", unhappy[0].source, "dato");

  // Nobody serving large print is a gap; if someone does, it is not.
  truthy("propone letra grande cuando falta",
    findAngles({ items: base, keyword: "sudoku" }).some((a) => a.id === "letra-grande"));
  truthy("no la propone si ya existe",
    !findAngles({
      items: base.map((b, i) => (i === 0 ? { ...b, title: "Sudoku en Letra Grande" } : b)),
      keyword: "sudoku",
    }).some((a) => a.id === "letra-grande"));
  truthy("tampoco si la propia consulta ya la cubre",
    !findAngles({ items: base, keyword: "sudoku letra grande" }).some((a) => a.id === "letra-grande"));

  const old = findAngles({ items: base.map((b) => ({ ...b, ageMonths: 60 })), keyword: "sudoku" });
  truthy("detecta un catalogo envejecido", old.some((a) => a.id === "catalogo-antiguo"));

  const long = findAngles({ items: base.map((b) => ({ ...b, pages: 240 })), keyword: "sudoku" });
  truthy("detecta que todos son largos", long.some((a) => a.id === "edicion-breve"));

  truthy("detecta ausencia de tapa dura", findAngles({ items: base, keyword: "sudoku" }).some((a) => a.id === "tapa-dura"));
  truthy("no la propone si ya la hay",
    !findAngles({
      items: base.map((b, i) => (i === 0 ? { ...b, format: "hardcover" as const } : b)),
      keyword: "sudoku",
    }).some((a) => a.id === "tapa-dura"));

  // A handful of options is a recommendation; twenty is none.
  truthy("nunca abruma con opciones", findAngles({ items: base, keyword: "sudoku" }).length <= 6);
  check("sin muestra suficiente no opina", findAngles({ items: base.slice(0, 2), keyword: "sudoku" }).length, 0);
}

console.log("\nregalias");
{
  check("impresion b/n 100 paginas (tarifa fija)", printingCost(100, "paperback", "bw", "regular", DEFAULT_PRINTING_COSTS), 2.3);
  check("impresion b/n 200 paginas", printingCost(200, "paperback", "bw", "regular", DEFAULT_PRINTING_COSTS), 3.4);

  const paperback = computeRoyalty(
    { price: 9.99, pages: 120, format: "paperback", ink: "bw", trim: "regular", marketplace: "com" },
    DEFAULT_PRINTING_COSTS,
  );
  check("regalia tapa blanda", paperback.royaltyPerUnit, 3.55);
  check("precio de equilibrio", paperback.breakEvenPrice, 4.07);

  const kindle70 = computeRoyalty(
    { price: 4.99, pages: 0, format: "kindle", ink: "bw", trim: "regular", marketplace: "com", fileSizeMb: 2 },
    DEFAULT_PRINTING_COSTS,
  );
  check("kindle en la banda del 70%", kindle70.royaltyRate, 0.7);
  check("kindle descuenta la entrega", kindle70.royaltyPerUnit, 3.19);

  const kindle35 = computeRoyalty(
    { price: 14.99, pages: 0, format: "kindle", ink: "bw", trim: "regular", marketplace: "com", fileSizeMb: 2 },
    DEFAULT_PRINTING_COSTS,
  );
  check("fuera de banda cae al 35%", kindle35.royaltyRate, 0.35);
}

console.log("\nfiabilidad de la estimacion");
{
  const day = 24 * 60 * 60 * 1000;
  const point = (daysAgo: number, bsr: number | null) => ({
    capturedAt: Date.now() - daysAgo * day,
    bsr, price: 16.99, rating: null, reviews: null, salesEst: null,
  });

  // Dano's own case: a title published thirteen days ago, running ads, showing
  // BSR 21.000 and no sales at all in KDP. The projection is a ceiling.
  const launch = assessEstimate({
    bsr: 21_000, ageMonths: 0.43, reviews: 0, salesPerMonth: 24,
  });
  check("un lanzamiento no se lee como ritmo", launch.level, "techo");
  truthy("y dice cuantos dias lleva", launch.reasons.some((r) => r.includes("13 días")));
  truthy("con la advertencia de usar el informe de KDP", (launch.advice ?? "").includes("KDP"));
  check("la banda baja hasta cero", estimateRange(24, launch), [0, 24]);

  // Past the launch window the estimate is usable, but a single reading is
  // still a single reading.
  const settled = assessEstimate({
    bsr: 21_000, ageMonths: 14, reviews: 38, salesPerMonth: 24,
  });
  check("un libro asentado si se estima", settled.level, "solida");
  truthy("aunque avise de que es una sola lectura", settled.reasons.some((r) => r.includes("única lectura")));
  truthy("y proponga seguirlo", (settled.advice ?? "").includes("seguimiento"));

  // Between two and four months the launch still shows through.
  check("los primeros meses quedan provisionales",
    assessEstimate({ bsr: 21_000, ageMonths: 3, reviews: 12, salesPerMonth: 24 }).level, "provisional");

  // Sales the curve claims would have left reviews behind them by now.
  const mismatch = assessEstimate({ bsr: 8_000, ageMonths: 10, reviews: 0, salesPerMonth: 60 });
  check("600 ventas sin una sola resena no cuadra", mismatch.level, "techo");
  truthy("y lo dice con la cifra implicada", mismatch.reasons.some((r) => r.includes("600 ventas")));

  // A rank series is what actually replaces the guess.
  const steady = [point(14, 40_000), point(10, 44_000), point(6, 38_000), point(2, 42_000)];
  const read = readSeries(steady);
  truthy("cuatro muestras en dos semanas valen como serie", read !== null);
  check("la mediana del ranking", read?.medianBsr, 41_000);
  check("y su vaiven", read?.swing, 1.2);

  const stable = assessEstimate({ bsr: 42_000, ageMonths: 14, reviews: 38, salesPerMonth: 6, history: steady });
  check("una serie estable no rebaja la fiabilidad", stable.level, "solida");
  check("y ya no pide seguimiento", stable.advice, null);

  const swinging = assessEstimate({
    bsr: 12_000, ageMonths: 14, reviews: 38, salesPerMonth: 26,
    history: [point(12, 12_000), point(8, 90_000), point(4, 60_000), point(1, 150_000)],
  });
  check("un ranking que oscila deja la lectura provisional", swinging.level, "provisional");

  // Too few samples, or too short a window, is not a series.
  check("dos muestras no son una serie", readSeries([point(6, 10_000), point(1, 12_000)]), null);
  check("tres muestras en dos dias tampoco",
    readSeries([point(2, 10_000), point(1, 11_000), point(0, 12_000)]), null);
  check("ni tres muestras sin ranking",
    readSeries([point(9, null), point(5, null), point(1, null)]), null);

  // No rank at all: there is nothing to derive sales from, and it says so.
  const noRank = assessEstimate({ bsr: null, ageMonths: 20, reviews: 5, salesPerMonth: null });
  check("sin BSR no hay estimacion", noRank.level, "techo");
  check("sin BSR no hay rango", estimateRange(null, noRank), null);
}

console.log("\nnicho inflado por lanzamientos");
{
  const settings = {
    printing: DEFAULT_PRINTING_COSTS, weakReviewThreshold: 100,
    salesCurveCalibration: 1, calibrationByMarket: {}, calibrationSamples: [],
  } as unknown as AppSettings;
  const make = (position: number, ageMonths: number): BookRecord => ({
    asin: `B0${String(position).padStart(8, "0")}`, title: `T${position}`, author: "A", url: "", image: "",
    format: "paperback", formatLabel: "Tapa blanda", price: 12, rating: 4.4, reviews: 5,
    sponsored: false, kindleUnlimited: false, position, bsr: 20_000, categoryRanks: [], pages: 120,
    publisher: null, publishedAt: null, language: null, isbn: null, dimensions: null,
    selfPublished: null, enriched: true, salesPerMonth: 30, revenuePerMonth: 90,
    royaltyPerUnit: 3, ageMonths, weakness: 60,
  });

  // Half the page published in the last few weeks: the demand figure is reading
  // launch bursts, and the report has to say so before anyone acts on it.
  const fresh = summariseNiche(
    [...Array.from({ length: 5 }, (_, i) => make(i + 1, 0.5)), ...Array.from({ length: 5 }, (_, i) => make(i + 6, 20))],
    { keyword: "agenda 2027", marketplace: "es", settings, totalResults: 3_000, resultsCountText: null },
  );
  const warned = fresh.signals.find((sig) => sig.id === "launches");
  check("avisa de cuantos son recien publicados", warned?.value, "5 de 10");
  truthy("y lo suma al razonamiento del veredicto",
    fresh.verdict.reasoning.some((r) => r.includes("menos de dos meses")));

  const mature = summariseNiche(
    Array.from({ length: 10 }, (_, i) => make(i + 1, 20)),
    { keyword: "agenda 2027", marketplace: "es", settings, totalResults: 3_000, resultsCountText: null },
  );
  check("un nicho asentado no lo lleva", mature.signals.some((sig) => sig.id === "launches"), false);
}

console.log("\nrutas cercanas a una frase");
{
  const es = getMarketplace("es");
  const near = relatedSeeds("agenda psicologo", es);

  // The exact case that returned nothing: the phrase itself never completes,
  // because shoppers type "agenda para psicologos".
  truthy("prueba la frase con conector", near.includes("agenda para psicologo"));
  truthy("y el conector solo, que es la sonda mas productiva", near.includes("agenda para"));
  truthy("prueba el plural", near.includes("agenda psicologos"));
  truthy("prueba cada palabra por separado", near.includes("agenda") && near.includes("psicologo"));
  truthy("y el orden inverso", near.includes("psicologo agenda"));
  check("nunca repite la semilla", near.includes("agenda psicologo"), false);
  truthy("y cabe en el presupuesto de subpeticiones", near.length <= 12);

  // A one-word seed has no neighbourhood of its own, so it widens instead.
  const single = relatedSeeds("agenda", es);
  truthy("una sola palabra se abre con sufijos", single.some((p) => p.startsWith("agenda ")));
  truthy("y con su plural", single.includes("agendas"));

  // Each storefront asks in its own language.
  truthy("en ingles usa for", relatedSeeds("planner teacher", getMarketplace("com")).includes("planner for"));
  truthy("en aleman usa fur", relatedSeeds("kalender lehrer", getMarketplace("de")).includes("kalender für"));

  check("el grupo related usa esas mismas rutas", buildProbes("agenda psicologo", "related", es), near);
  check("una semilla vacia no genera sondas", relatedSeeds("   ", es), []);
}

console.log("\noportunidad de una keyword");
{
  // Nothing measured about the competition yet: no verdict, rather than half of one.
  check("sin puntuar no hay veredicto",
    keywordOpportunity({ demandProxy: 80, totalResults: null, medianReviews: null, lowReviewShare: null }), null);

  const green = keywordOpportunity({ demandProxy: 78, totalResults: 800, medianReviews: 12, lowReviewShare: 0.8 });
  check("demanda alta con nicho vacio: entrar", green?.label, "Entrar");
  truthy("y lo explica con las cifras", (green?.reason ?? "").includes("800"));

  const crowded = keywordOpportunity({ demandProxy: 82, totalResults: 60_000, medianReviews: 1_400, lowReviewShare: 0.1 });
  check("muy buscada pero saturada: dificil", crowded?.label, "Difícil");
  truthy("la saturacion pesa mas que la demanda", (crowded?.score ?? 100) < (green?.score ?? 0));

  const quiet = keywordOpportunity({ demandProxy: 10, totalResults: 300, medianReviews: 5, lowReviewShare: 0.9 });
  truthy("un nicho vacio que nadie busca no es una oportunidad", (quiet?.score ?? 100) < (green?.score ?? 0));
}

console.log(`\n${passed} pruebas superadas, ${failed} fallidas\n`);
process.exit(failed ? 1 : 0);
