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
  truthy("espana usa su propio host", suggestUrl(getMarketplace("es"), "sudoku").startsWith("https://completion.amazon.es/"));
  truthy("reino unido usa el suyo", suggestUrl(getMarketplace("co.uk"), "sudoku").startsWith("https://completion.amazon.co.uk/"));
  truthy("estados unidos sigue igual", suggestUrl(getMarketplace("com"), "sudoku").startsWith("https://completion.amazon.com/"));
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

console.log(`\n${passed} pruebas superadas, ${failed} fallidas\n`);
process.exit(failed ? 1 : 0);
