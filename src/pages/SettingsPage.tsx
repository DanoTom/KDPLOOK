import { useState } from "react";
import type { AppSettings, PrintingCosts } from "../../shared/types";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { Alert, Button, Card, CardHead, Field, SegmentedControl, Switch } from "../components/ui";
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
              label={`Calibración de la curva de ventas: ×${settings.salesCurveCalibration.toFixed(2)}`}
              help="Si conoces las ventas reales de un libro con cierto BSR, ajusta aquí hasta que la estimación coincida. Afecta a toda la app."
            >
              <input type="range" min={0.2} max={3} step={0.05} value={settings.salesCurveCalibration} onChange={(e) => set("salesCurveCalibration", Number(e.target.value))} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHead title="Origen de los datos" note="Cómo llega KDPLOOK hasta Amazon." />
          <div className="card-pad stack">
            <Field
              label="Proveedor"
              help="«Directo» va desde Cloudflare a Amazon sin intermediarios: gratis, pero Amazon bloquea a veces las IP de centros de datos. Si te bloquean con frecuencia, un proveedor de scraping con capa gratuita resuelve el problema."
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
