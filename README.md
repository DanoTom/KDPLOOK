# KDPLOOK

Consola personal de investigación de nichos para Amazon KDP. Corre entera en
Cloudflare (Workers + D1), no depende de ningún servicio de pago y está pensada
para una sola persona: tú.

Responde a la pregunta que importa antes de escribir un libro — **¿merece la pena
este nicho?** — con datos públicos de Amazon: quién ocupa la primera página,
cuántas reseñas tiene, qué BSR maneja, cuánto factura aproximadamente y cuánta de
esa página está en manos de autopublicados.

---

## Qué hace

| Pantalla | Para qué sirve |
| --- | --- |
| **Panel** | Punto de entrada, estado de la configuración y tus mejores nichos de un vistazo. |
| **Explorar nicho** | El corazón de la app. Escanea los resultados de una palabra clave, abre la ficha de los primeros libros para leer BSR/páginas/editorial, y devuelve una puntuación de oportunidad con su razonamiento en texto. |
| **Laboratorio de keywords** | Expande una semilla con el autocompletado real de Amazon (barrido alfabético, sufijos, prefijos, preguntas) y puntúa la competencia de las candidatas que elijas. |
| **Inspector de libro** | Ficha completa de un ASIN: BSR, rangos por categoría, páginas, editorial, estimación de ventas y regalías, e histórico de posiciones. |
| **Seguimiento** | Vigila competidores o tus propios títulos. Un cron diario guarda el BSR y verás la tendencia real, no una foto fija. |
| **Nichos guardados** | Tu banco de ideas, todas medidas con la misma vara. |
| **Calculadora KDP** | Regalía por unidad, coste de impresión, precio mínimo, y cuántos ejemplares (y qué BSR) hacen falta para un objetivo de ingresos. |
| **Diagnóstico** | Sonda manual y registro de peticiones, para distinguir «Amazon nos bloqueó» de «cambió el marcado». |

### Cómo se puntúa un nicho

Tres números, todos 0-100:

- **Demanda** — a partir de las ventas mensuales estimadas de los primeros
  resultados orgánicos (vía BSR).
- **Competencia** — mediana de reseñas del top, ajustada por valoración media,
  proporción de editoriales tradicionales y saturación de resultados.
- **Oportunidad** — la combinación de las dos, con bonus por rivales flojos,
  presencia de autopublicados y libros recientes rankeando.

El veredicto (`Excelente` / `Bueno` / `Ajustado` / `Difícil`) viene siempre con
las razones en lenguaje llano, no solo con el número.

---

## Puesta en marcha

Necesitas una cuenta de Cloudflare y Node 18+.

```bash
git clone <este-repo> && cd kdplook
npm install

# 1. Crear la base de datos
npx wrangler d1 create kdplook
#    Copia el database_id que imprime y pégalo en wrangler.jsonc

# 2. Crear las tablas (local y remoto)
npm run db:migrate:local
npm run db:migrate

# 3. Poner contraseña (¡importante! si no, la URL queda abierta)
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put AUTH_SECRET     # cualquier cadena larga y aleatoria

# 4. Desplegar
npm run deploy
```

Wrangler te devuelve una URL `*.workers.dev`. Eso es todo.

### Alternativa: desplegar sin instalar nada

Todo el proceso se puede hacer desde el navegador, incluso desde el móvil:

1. **Panel de Cloudflare → Storage & Databases → D1 SQL Database → Create Database**,
   con el nombre `kdplook`. Copia el *Database ID* que aparece en la ficha.
2. **Edita `wrangler.jsonc`** en GitHub (el lápiz de la vista de archivo) y pega
   ese id donde están los ceros.
3. **Workers & Pages → Create → Connect to Git**: elige el repositorio y la rama.
   Build command `npm run build`, deploy command `npx wrangler deploy`.
4. **Settings → Variables and Secrets** del Worker: añade `AUTH_PASSWORD` y
   `AUTH_SECRET` como *encrypted*.
5. Abre la app, entra con tu contraseña, ve a **Diagnóstico** y pulsa
   **Crear las tablas ahora**.

Ese último paso sustituye a `wrangler d1 migrations apply`: ejecuta el mismo
archivo `migrations/0001_init.sql` (el Worker lo importa como texto, así que no
hay dos copias del esquema que puedan divergir). Son todas sentencias
`CREATE ... IF NOT EXISTS`, el endpoint está detrás de la contraseña, y
repetirlo no borra nada.

### Desarrollo local

```bash
cp .dev.vars.example .dev.vars   # opcional, para probar el login
npm run build                    # el Worker sirve ./dist
npm run dev:worker               # http://localhost:8787 (app completa)

# o, con recarga en caliente del frontend:
npm run dev                      # Vite en :5173, proxy de /api al Worker
```

Comprobaciones:

```bash
npm run typecheck   # TypeScript en worker, shared y src
npm test            # 77 pruebas de los parsers y del motor de cálculo
npm run build
npm run check       # las tres de golpe
```

---

## Sobre el plan de Cloudflare

La app está construida para caber en el **plan gratuito**: cada petición a la API
descarga **una sola** página de Amazon y el navegador orquesta el resto, de modo
que ninguna invocación se acerca al límite de 50 subpeticiones. Aun así, el plan
gratuito impone **10 ms de CPU por invocación**, y una página de resultados de
Amazon pesa 1-2 MB. Los parsers recortan el HTML y trabajan sobre regiones
pequeñas localizadas con `indexOf` precisamente por eso, pero en páginas
especialmente pesadas puedes ver errores de CPU.

Si te ocurre, el plan **Workers Paid (5 USD/mes)** sube el límite a 30 segundos y
el problema desaparece. Sigue siendo una fracción de lo que cuesta cualquier
herramienta comercial equivalente.

---

## Cuando Amazon bloquea

Amazon desconfía de las IP de centros de datos, y Cloudflare es exactamente eso.
Verás verificaciones anti-bot de vez en cuando; la app las detecta, te lo dice
con claridad y no las confunde con «no hay resultados».

Qué hacer, por orden de coste:

1. **Espera y sube la caché.** En Ajustes, `Caché` a 24-48 h. Los datos de un
   nicho no cambian de hora en hora.
2. **Baja el paralelismo** a 2-3 y sube la pausa entre peticiones.
3. **Reduce páginas y fichas por escaneo.** 2 páginas y 12 fichas ya dan un
   veredicto decente.
4. **Enruta por un proveedor de scraping.** En Ajustes puedes elegir ScraperAPI,
   ScrapingBee o una plantilla propia; todos tienen capa gratuita suficiente para
   uso personal. La clave se guarda como secret de Cloudflare, nunca en la base
   de datos:
   ```bash
   npx wrangler secret put SCRAPER_API_KEY
   ```

El **autocompletado** (Laboratorio de keywords) usa un endpoint distinto, mucho
menos protegido: suele funcionar aunque el scraping de búsquedas esté bloqueado.

---

## Qué es un dato y qué es una estimación

Vale la pena tenerlo claro, porque ninguna herramienta del mercado — de pago
incluidas — puede ofrecer más que esto:

**Datos reales**, leídos de Amazon: título, autor, precio, valoración, número de
reseñas, formato, BSR, rangos por categoría, páginas, editorial, fecha de
publicación, número total de resultados y las sugerencias del autocompletado.

**Estimaciones**, calculadas:

- **Ventas a partir del BSR.** Amazon nunca ha publicado esta correspondencia.
  KDPLOOK usa una curva ajustada empíricamente (la misma familia de curvas que
  emplean KDSpy, Publisher Rocket o Book Bolt), interpolada en escala log-log y
  escalada por el tamaño relativo de cada tienda. Trátalo como un orden de
  magnitud. Si conoces las ventas reales de algún libro, calíbrala en
  **Ajustes → Calibración de la curva de ventas** y toda la app se recalcula al
  instante.
- **Lo que la curva no puede ver: un lanzamiento.** El BSR es una media ponderada
  de los pedidos recientes que decae en horas, así que en un libro sin historial
  una sola venta puede dejar un ranking sorprendentemente bueno durante un día o
  dos, y la publicidad paga exactamente ese tipo de pico. Multiplicar esa foto
  por 30 inventa un mes que no ocurrió. Por eso el Inspector marca la estimación
  como **techo** (no como previsión) cuando el libro tiene menos de dos meses, y
  como **provisional** hasta los cuatro; el informe de nicho avisa cuando varios
  de los libros de la primera página son igual de recientes. Durante esas semanas
  el único dato bueno es el informe de regalías de KDP.
- **La mediana del ranking, cuando la hay.** Si sigues un libro, KDPLOOK toma una
  muestra diaria de su BSR y, con una semana de muestras, estima sobre la mediana
  de la serie en lugar de sobre la lectura del día. Es la diferencia entre lo que
  el libro *sostiene* y lo que *tocó* la tarde en que lo miraste.
- **Regalías.** Aplican el modelo de KDP (60 % menos coste de impresión en papel;
  70 % o 35 % en Kindle según la banda de precio). Las tarifas de impresión son
  las de EE. UU. y Amazon las revisa: son editables en Ajustes.
- **Demanda de una keyword.** No existe volumen de búsqueda público. Lo que se
  mide es cuántas sondas distintas del autocompletado devuelven una frase y en
  qué posición — el mejor proxy disponible sin datos de pago.
- **Detección de autopublicados.** Se basa en el nombre de la editorial
  («Independently published», CreateSpace…). Muchos autores de KDP registran un
  sello propio, así que la cifra real suele ser **algo mayor** que la mostrada.

---

## Arquitectura

```
worker/                 API en Cloudflare Workers (Hono)
  index.ts              rutas + cron de seguimiento
  auth.ts               cookie de sesión firmada con HMAC
  db.ts                 acceso a D1: ajustes, caché, nichos, seguimiento
  amazon/
    fetcher.ts          descarga con cabeceras realistas, reintentos y detección de bloqueo
    search.ts           parser de páginas de resultados
    product.ts          parser de fichas de producto
    suggest.ts          expansión de keywords vía autocompletado
    marketplaces.ts     15 tiendas de Amazon
    html.ts             utilidades de texto, precios y fechas multi-idioma
shared/                 código que usan Worker y navegador
  types.ts              contrato de la API
  analytics/            curva BSR→ventas, regalías KDP, puntuación de nichos
src/                    SPA en React
tests/                  suite de regresión de los parsers, con fixtures de HTML
migrations/             esquema de D1
```

Dos decisiones que explican casi todo lo demás:

**El motor de cálculo vive en `shared/`.** El Worker devuelve datos crudos y el
navegador deriva las métricas y la puntuación. Por eso cambiar la calibración o
el umbral de reseñas en Ajustes vuelve a puntuar el análisis al instante, sin
tocar Amazon otra vez.

**Una página de Amazon por invocación.** El navegador orquesta el escaneo en
varias llamadas pequeñas. Así se respetan los límites del plan gratuito, se ve
progreso real en vez de un spinner opaco, y un bloqueo puntual solo cuesta una
página, no el análisis entero.

### Los parsers

Amazon sirve marcado distinto por tienda, por semana y por experimento A/B. Cada
campo se extrae con varias estrategias en cascada (el `aria-label` del `h2`, el
contenedor `data-cy`, el `alt` de la portada…) y la primera que devuelva algo
sensato gana. `npm test` los ejercita contra fixtures de HTML real —tarjeta
moderna, tarjeta patrocinada, ficha con bullets, ficha con tabla de atributos, en
inglés y español— para que una regresión se note antes de desplegar.

Cuando Amazon cambie el marcado, **Diagnóstico → Sonda manual** te enseña
exactamente qué llegó y qué entendió el parser: es el punto de partida para
ajustar un selector.

---

## Uso previsto

Herramienta personal de investigación de mercado sobre datos públicos de Amazon.
Está deliberadamente limitada en velocidad y protegida con contraseña, y no
recoge datos de usuarios ni información privada. Amazon desaconseja el acceso
automatizado en sus condiciones de uso; mantén el volumen bajo, la caché alta, y
no la conviertas en un servicio para terceros.
