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
import { getMarketplace } from "../worker/amazon/marketplaces";
import { looksBlocked } from "../worker/amazon/fetcher";
import { parseDate, parseInteger, parsePrice } from "../worker/amazon/html";
import { salesPerMonth } from "../shared/analytics/bsr";
import { DEFAULT_PRINTING_COSTS, computeRoyalty, printingCost } from "../shared/analytics/royalty";

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
