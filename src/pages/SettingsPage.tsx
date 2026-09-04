import { useState } from "react";
import type { AppSettings, CalibrationSample, MarketplaceId, PrintingCosts } from "../../shared/types";
import { calibrationFor, salesPerMonth, suggestCalibration } from "../../shared/analytics/bsr";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Field, SegmentedControl, Switch } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtCompact, fmtNum } from "../lib/format";
import { useApp } from "../state";

export function SettingsPage() {
  const { settings, marketplaces, updateSettings, reloadSettings, toast } = useApp();
  const [busy, setBusy] = useState(false);

  if (!settings) return null;
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => updateSettings({ [key]: value } as Partial<AppSettings>);
  const setPrinting = (key: keyof PrintingCosts, value: number) =>
    updateSettings({ printing: { ...settings.printing, [key]: value } });

  return (
    <Layout title="Ajustes" subtitle="Todo lo que cambia aquí se aplica al instante, sin volver a escanear." narrow>
      <div className="stack-lg">
        <Card>
          <CardHead title="Tienda y alcance" note="Cuánto se descarga en cada análisis." />
          <div className="card-pad grid grid-2">
            <Field label="Tienda por defecto">
              <select className="select" value={settings.marketplace} onChange={(e) => set("marketplace", e.target.value as AppSettings["marketplace"])}>
                {marketplaces.map((market) => <option key={market.id} value={market.id}>{market.flag} {market.label} · {market.currency}</option>)}
              </select>
            </Field>
            <Field label="Tema">
              <SegmentedControl
                value={settings.theme} onChange={(value) => set("theme", value)}
                options={[{ value: "dark", label: "Oscuro" }, { value: "light", label: "Claro" }]}
              />
            </Field>
            <Field
              label={`Páginas de resultados por escaneo: ${settings.searchPages}`}
              help="Cada página son ~48 libros y una petición a Amazon. Tres es un buen equilibrio."
            >
              <input type="range" min={1} max={7} value={settings.searchPages} onChange={(e) => set("searchPages", Number(e.target.value))} />
            </Field>
            <Field
              label={`Fichas a enriquecer: ${settings.enrichCount}`}
              help="Sin enriquecer no hay BSR y por tanto no hay estimación de ventas. Más fichas = más lento."
            >
              <input type="range" min={0} max={40} step={4} value={settings.enrichCount} onChange={(e) => set("enrichCount", Number(e.target.value))} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHead title="Criterios de análisis" note="Define qué consideras un rival batible y cuánta demanda te vale." />
          <div className="card-pad grid grid-2">
            <Field
              label={`Umbral de «pocas reseñas»: ${settings.weakReviewThreshold}`}
              help="Por debajo de esta cifra un competidor cuenta como alcanzable. 100 es un punto de partida razonable para no ficción."
            >
              <input type="range" min={10} max={500} step={10} value={settings.weakReviewThreshold} onChange={(e) => set("weakReviewThreshold", Number(e.target.value))} />
            </Field>
            <Field
              label={`Ajuste manual global: ×${settings.salesCurveCalibration.toFixed(2)}`}
              help="Se aplica a las tiendas que no tengan calibración propia. Mejor usa el asistente de abajo."
            >
              <input type="range" min={0.2} max={3} step={0.05} value={settings.salesCurveCalibration} onChange={(e) => set("salesCurveCalibration", Number(e.target.value))} />
            </Field>
          </div>
        </Card>

        <CalibrationCard />

        <Card>
          <CardHead title="Origen de los datos" note="Cómo llega KDPLOOK hasta Amazon." />
          <div className="card-pad stack">
            <Field
              label="Proveedor"
              help="«Directo» va desde Cloudflare a Amazon sin intermediarios: gratis, pero Amazon bloquea a veces las IP de centros de datos y a otras les sirve una página recortada. Un proveedor de scraping sale desde IPs residenciales del país de la tienda; no son gratis (prueba de unos días y luego decenas de dólares al mes), así que úsalos solo mientras te haga falta."
            >
              <select className="select" value={settings.provider} onChange={(e) => set("provider", e.target.value as AppSettings["provider"])}>
                <option value="direct">Directo (sin proveedor)</option>
                <option value="scraperapi">ScraperAPI</option>
                <option value="scrapingbee">ScrapingBee</option>
                <option value="custom">Personalizado</option>
              </select>
            </Field>

            {settings.provider !== "direct" ? (
              <Alert tone="info">
                Solo pasan por el proveedor las páginas de búsqueda y las fichas, que son las que Amazon
                rechaza. El autocompletado del Laboratorio sigue yendo directo: nunca lo han bloqueado y
                una expansión profunda dispara más de cien sondas, que se comerían la capa gratuita entera
                en tres usos.
                <br /><br />
                La clave se guarda como <em>secret</em> de Cloudflare, nunca en la base de datos. Desde tu terminal:
                <pre className="code" style={{ marginTop: 8, marginBottom: 0 }}>
{settings.provider === "scraperapi" ? "npx wrangler secret put SCRAPER_API_KEY"
  : settings.provider === "scrapingbee" ? "npx wrangler secret put SCRAPINGBEE_API_KEY"
  : "npx wrangler secret put CUSTOM_PROXY_TEMPLATE"}
                </pre>
              </Alert>
            ) : null}

            {settings.provider === "custom" ? (
              <Field
                label="Plantilla de URL"
                help="Usa {url_encoded} donde deba ir la URL de Amazon codificada, o {url} para la versión literal."
              >
                <input
                  className="input mono" value={settings.customProxyTemplate}
                  placeholder="https://mi-proxy.example/get?target={url_encoded}"
                  onChange={(e) => set("customProxyTemplate", e.target.value)}
                />
              </Field>
            ) : null}

            <div className="grid grid-2">
              <Field
                label={`Caché: ${settings.cacheTtlHours} h`}
                help="Reutiliza resultados ya descargados. Bajar esto multiplica las peticiones a Amazon y el riesgo de bloqueo."
              >
                <input type="range" min={0} max={168} step={1} value={settings.cacheTtlHours} onChange={(e) => set("cacheTtlHours", Number(e.target.value))} />
              </Field>
              <Field
                label={`Peticiones en paralelo: ${settings.concurrency}`}
                help="Más paralelismo va más rápido pero se parece más a un bot. Entre 3 y 4 es prudente."
              >
                <input type="range" min={1} max={8} value={settings.concurrency} onChange={(e) => set("concurrency", Number(e.target.value))} />
              </Field>
              <Field label={`Pausa entre peticiones: ${settings.requestDelayMs} ms`}>
                <input type="range" min={0} max={2000} step={50} value={settings.requestDelayMs} onChange={(e) => set("requestDelayMs", Number(e.target.value))} />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Costes de impresión"
            note="Tarifas de Amazon EE. UU. Cámbialas cuando KDP las revise o si publicas en otra tienda."
          />
          <div className="card-pad grid grid-3">
            <Field label="B/N regular, fijo (≤108 p.)"><NumberInput value={settings.printing.bwRegularFixed} onChange={(v) => setPrinting("bwRegularFixed", v)} /></Field>
            <Field label="B/N regular, por página"><NumberInput value={settings.printing.bwRegularPerPage} step={0.001} onChange={(v) => setPrinting("bwRegularPerPage", v)} /></Field>
            <Field label="Umbral de páginas"><NumberInput value={settings.printing.bwRegularFixedMaxPages} step={1} onChange={(v) => setPrinting("bwRegularFixedMaxPages", v)} /></Field>
            <Field label="B/N grande, fijo"><NumberInput value={settings.printing.bwLargeFixed} onChange={(v) => setPrinting("bwLargeFixed", v)} /></Field>
            <Field label="B/N grande, por página"><NumberInput value={settings.printing.bwLargePerPage} step={0.001} onChange={(v) => setPrinting("bwLargePerPage", v)} /></Field>
            <Field label="Color estándar, fijo"><NumberInput value={settings.printing.colorRegularFixed} onChange={(v) => setPrinting("colorRegularFixed", v)} /></Field>
            <Field label="Color estándar, por página"><NumberInput value={settings.printing.colorRegularPerPage} step={0.0005} onChange={(v) => setPrinting("colorRegularPerPage", v)} /></Field>
            <Field label="Color premium, fijo"><NumberInput value={settings.printing.premiumColorFixed} onChange={(v) => setPrinting("premiumColorFixed", v)} /></Field>
            <Field label="Color premium, por página"><NumberInput value={settings.printing.premiumColorPerPage} step={0.0005} onChange={(v) => setPrinting("premiumColorPerPage", v)} /></Field>
            <Field label="Tapa dura, fijo"><NumberInput value={settings.printing.hardcoverFixed} onChange={(v) => setPrinting("hardcoverFixed", v)} /></Field>
            <Field label="Tapa dura, por página"><NumberInput value={settings.printing.hardcoverPerPage} step={0.001} onChange={(v) => setPrinting("hardcoverPerPage", v)} /></Field>
          </div>
        </Card>

        <Card>
          <CardHead title="Mantenimiento" />
          <div className="card-pad row">
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const { removed } = await api.purgeCache(false);
                  toast(`${removed} entradas caducadas eliminadas`, "good");
                } finally { setBusy(false); }
              }}
            >
              Limpiar caché caducada
            </Button>
            <Button
              variant="danger" loading={busy}
              onClick={async () => {
                if (!confirm("¿Vaciar toda la caché? Los próximos análisis volverán a descargar de Amazon.")) return;
                setBusy(true);
                try {
                  const { removed } = await api.purgeCache(true);
                  toast(`${removed} entradas eliminadas`, "good");
                } finally { setBusy(false); }
              }}
            >
              Vaciar caché entera
            </Button>
            <Button
              variant="ghost" className="spacer"
              onClick={async () => {
                if (!confirm("¿Restaurar todos los ajustes por defecto?")) return;
                await api.resetSettings();
                await reloadSettings();
                toast("Ajustes restaurados", "good");
              }}
            >
              Restaurar valores por defecto
            </Button>
          </div>
        </Card>

        <Card pad>
          <div className="row">
            <Switch
              checked={settings.locale === "es"}
              onChange={(value) => set("locale", value ? "es" : "en")}
              label="Interfaz en español"
            />
          </div>
        </Card>
      </div>
    </Layout>
  );
}

function NumberInput({ value, onChange, step = 0.01 }: { value: number; onChange: (value: number) => void; step?: number }) {
  return (
    <input
      className="input mono" type="number" step={step} value={value}
      onChange={(event) => {
        const parsed = Number(event.target.value);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}


/**
 * Turning the raw multiplier into something a publisher can actually set.
 *
 * The BSR→sales curve is an empirical fit for the US store; every other
 * storefront is scaled by a rough factor. Rather than ask for a number nobody
 * can guess, this reads the rank of a book whose real sales the owner knows
 * and works the multiplier out from the gap. Calibration is stored per
 * storefront, because a correction measured in Spain says nothing about the US.
 */
function CalibrationCard() {
  const { settings, marketplaces, updateSettings, toast } = useApp();
  const [asin, setAsin] = useState("");
  const [sales, setSales] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<{ bsr: number; raw: number; title: string; format: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!settings) return null;
  const marketplace: MarketplaceId = settings.marketplace;
  const market = marketplaces.find((m) => m.id === marketplace);
  const samples = (settings.calibrationSamples ?? []).filter((s) => s.marketplace === marketplace);
  const active = calibrationFor(settings, marketplace);

  async function read() {
    const code = asin.trim().toUpperCase().match(/[A-Z0-9]{10}/)?.[0];
    const actual = Number(sales);
    if (!code) { setProblem("Escribe un ASIN válido o pega la URL del libro."); return; }
    if (!Number.isFinite(actual) || actual <= 0) { setProblem("Indica cuántas unidades vendes al mes (un número mayor que cero)."); return; }

    setBusy(true);
    setProblem(null);
    setReading(null);
    try {
      // Amazon turns away a share of detail pages; the same request usually
      // works moments later, so do the retrying instead of asking the user to.
      let response = null as Awaited<ReturnType<typeof api.book>> | null;
      for (let attempt = 1; attempt <= 3 && !response; attempt++) {
        try {
          response = await api.book(code, marketplace, true);
        } catch (err) {
          if (attempt === 3) throw err;
          setProblem(`Amazon rechazó la petición · reintentando (${attempt} de 3)…`);
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
      if (!response) return;
      setProblem(null);
      const bsr = response.detail.bsr;
      if (!bsr) {
        setProblem("Amazon no muestra clasificación para ese libro ahora mismo, así que no hay nada con lo que comparar. Prueba con otro título o vuelve a intentarlo.");
        return;
      }
      const format = response.detail.format ?? "paperback";
      // What the curve would say with no correction at all.
      const raw = salesPerMonth(bsr, format, marketplace, 1) ?? 0;
      if (raw <= 0) {
        setProblem("La curva no devuelve una estimación utilizable para ese rango.");
        return;
      }
      setReading({ bsr, raw, title: response.detail.title ?? code, format });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo leer la ficha");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!reading || !settings) return;
    const sample: CalibrationSample = {
      id: crypto.randomUUID(),
      asin: asin.trim().toUpperCase().match(/[A-Z0-9]{10}/)?.[0] ?? "",
      marketplace,
      title: reading.title,
      format: reading.format as CalibrationSample["format"],
      bsr: reading.bsr,
      actualSalesPerMonth: Number(sales),
      rawEstimate: reading.raw,
      capturedAt: Date.now(),
    };
    const all = [...(settings.calibrationSamples ?? []).filter((s) => s.asin !== sample.asin || s.marketplace !== marketplace), sample];
    const forMarket = all.filter((s) => s.marketplace === marketplace);
    const multiplier = suggestCalibration(forMarket);
    if (multiplier === null) return;

    await updateSettings({
      calibrationSamples: all,
      calibrationByMarket: { ...(settings.calibrationByMarket ?? {}), [marketplace]: multiplier },
    });
    setReading(null);
    setAsin("");
    setSales("");
    toast(`${market?.label ?? marketplace} calibrado a ×${multiplier.toFixed(2)}`, "good");
  }

  async function removeSample(sample: CalibrationSample) {
    if (!settings) return;
    const all = (settings.calibrationSamples ?? []).filter((s) => s.id !== sample.id);
    const forMarket = all.filter((s) => s.marketplace === marketplace);
    const multiplier = suggestCalibration(forMarket);
    const byMarket = { ...(settings.calibrationByMarket ?? {}) };
    if (multiplier === null) delete byMarket[marketplace];
    else byMarket[marketplace] = multiplier;
    await updateSettings({ calibrationSamples: all, calibrationByMarket: byMarket });
  }

  const suggestion = reading ? Math.round((Number(sales) / reading.raw) * 100) / 100 : null;

  // A stored multiplier was fitted against whatever the curve said the day it
  // was measured. Refitting the curve — as happened when Amazon.es got one of
  // its own — leaves that correction behind, still quietly inflating every
  // estimate. `suggestCalibration` re-reads the live curve, so comparing it
  // with what is stored is enough to notice.
  const storedFactor = settings.calibrationByMarket?.[marketplace] ?? null;
  const liveFactor = samples.length ? suggestCalibration(samples) : null;
  const stale =
    storedFactor !== null && liveFactor !== null &&
    Math.abs(liveFactor - storedFactor) / storedFactor > 0.12
      ? liveFactor
      : null;

  async function refit(multiplier: number) {
    await updateSettings({
      calibrationByMarket: { ...(settings?.calibrationByMarket ?? {}), [marketplace]: multiplier },
    });
    toast(`${market?.label ?? marketplace} recalibrado a ×${multiplier.toFixed(2)}`, "good");
  }

  return (
    <Card>
      <CardHead
        title="Calibrar con tus ventas reales"
        note={`Ajusta las estimaciones de ${market?.label ?? marketplace} a partir de un libro cuyas ventas conoces.`}
      >
        <Badge tone={settings.calibrationByMarket?.[marketplace] ? "good" : "neutral"}>
          {market?.flag} ×{active.toFixed(2)}
          {settings.calibrationByMarket?.[marketplace] ? " · medido" : " · sin calibrar"}
        </Badge>
      </CardHead>

      <div className="card-pad stack">
        <Alert tone="info">
          La curva BSR→ventas de Amazon.es está ajustada con datos de esa tienda; las demás parten de la
          curva de EE.&nbsp;UU. escalada por tamaño de mercado. Un solo libro tuyo convierte esa suposición
          en un dato: la app lee su clasificación y calcula cuánto se desvía de tus ventas reales.
        </Alert>

        {stale !== null ? (
          <Alert tone="warn">
            <strong>Este multiplicador se quedó viejo.</strong>
            <div className="small" style={{ marginTop: 6, lineHeight: 1.7 }}>
              Está guardado en ×{storedFactor?.toFixed(2)}, pero con la curva actual tus mismos libros de
              referencia piden <strong>×{stale.toFixed(2)}</strong>. Mientras no lo actualices, todas las
              estimaciones de {market?.label} salen{" "}
              {stale < (storedFactor ?? 1) ? "más altas" : "más bajas"} de lo que deberían.
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <Button variant="primary" icon={<Icon.Check size={15} />} onClick={() => refit(stale)}>
                Recalcular a ×{stale.toFixed(2)}
              </Button>
            </div>
          </Alert>
        ) : null}

        <div className="grid grid-2">
          <Field label="ASIN de un libro tuyo" help="También vale pegar la URL de Amazon.">
            <input className="input mono" value={asin} placeholder="B0FQ1NPPM8" onChange={(e) => setAsin(e.target.value)} />
          </Field>
          <Field label="Unidades que vende al mes" help="Tu cifra real de KDP. Si tienes ventas de un año, divide entre 12.">
            <input className="input" type="number" min={0} step={0.5} value={sales} placeholder="1.75" onChange={(e) => setSales(e.target.value)} />
          </Field>
        </div>

        <div className="row">
          <Button variant="primary" loading={busy} icon={<Icon.Activity size={15} />} onClick={read}>
            Leer BSR y calcular
          </Button>
        </div>

        {problem ? <Alert tone="warn">{problem}</Alert> : null}

        {reading && suggestion !== null ? (
          <Alert tone="good">
            <strong>{reading.title.slice(0, 70)}</strong>
            <div className="small" style={{ marginTop: 6, lineHeight: 1.7 }}>
              Con BSR <strong>{fmtCompact(reading.bsr)}</strong> la curva sin calibrar estimaría{" "}
              <strong>{fmtNum(reading.raw, 2)}</strong> ventas/mes. Tú vendes <strong>{sales}</strong>.
              <br />
              Multiplicador sugerido para {market?.label}: <strong>×{suggestion.toFixed(2)}</strong>
              {suggestion > 3 || suggestion < 0.33
                ? " — es una desviación grande; comprueba la cifra de ventas antes de aplicarla."
                : ""}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <Button variant="primary" onClick={apply} icon={<Icon.Check size={15} />}>
                Aplicar a {market?.label}
              </Button>
              <Button variant="ghost" onClick={() => setReading(null)}>Descartar</Button>
            </div>
          </Alert>
        ) : null}

        {samples.length ? (
          <div>
            <div className="small faint" style={{ marginBottom: 6 }}>
              Libros de referencia ({samples.length}). Con varios, se usa la mediana para que un título
              atípico no arrastre toda la tienda.
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Libro</th><th className="num">BSR</th><th className="num">Reales</th><th className="num">Sin calibrar</th><th className="num">Factor</th><th></th></tr></thead>
                <tbody>
                  {samples.map((sample) => (
                    <tr key={sample.id}>
                      <td className="truncate" style={{ maxWidth: 260 }}>{sample.title}</td>
                      <td className="num">{fmtCompact(sample.bsr)}</td>
                      <td className="num">{fmtNum(sample.actualSalesPerMonth, 2)}</td>
                      <td className="num faint">{fmtNum(sample.rawEstimate, 2)}</td>
                      <td className="num">×{(sample.actualSalesPerMonth / sample.rawEstimate).toFixed(2)}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => removeSample(sample)}><Icon.Trash size={14} /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
