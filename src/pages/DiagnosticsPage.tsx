import { useCallback, useEffect, useState } from "react";
import type { FetchLogRow, HealthInfo } from "../../shared/types";
import { api, type ProbeResponse } from "../api";
import { Icon } from "../components/icons";
import { Layout } from "../components/Layout";
import { Alert, Badge, Button, Card, CardHead, Empty, Field, Kpi, Skeleton } from "../components/ui";
import { relativeTime } from "../lib/format";
import { useApp } from "../state";

export function DiagnosticsPage() {
  const { settings, toast } = useApp();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [log, setLog] = useState<FetchLogRow[]>([]);
  const [probeUrl, setProbeUrl] = useState("");
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [probing, setProbing] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [info, rows] = await Promise.all([api.health(), api.fetchLog()]);
      setHealth(info);
      setLog(rows);
    } catch {
      toast("No se pudo cargar el diagnóstico", "bad");
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function migrate() {
    setMigrating(true);
    try {
      const result = await api.migrate();
      toast(result.dbReady ? "Tablas creadas. Ya puedes usar la app." : "Se ejecutó el esquema pero la base sigue sin responder.", result.dbReady ? "good" : "bad");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudieron crear las tablas", "bad");
    } finally {
      setMigrating(false);
    }
  }

  async function runProbe() {
    if (!probeUrl.trim()) return;
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await api.probe(probeUrl.trim()));
    } catch (error) {
      toast(error instanceof Error ? error.message : "La sonda falló", "bad");
    } finally {
      setProbing(false);
      void load();
    }
  }

  const marketHost = `https://www.amazon.${settings?.marketplace ?? "com"}`;

  return (
    <Layout
      title="Diagnóstico"
      subtitle="Para distinguir «Amazon nos bloqueó» de «el marcado cambió y hay que ajustar el parser»."
      actions={<Button size="sm" icon={<Icon.Refresh size={15} />} onClick={load}>Recargar</Button>}
    >
      <div className="stack-lg">
        {health === null ? (
          <Card pad><Skeleton height={70} /></Card>
        ) : (
          <>
            <div className="grid grid-4">
              <Kpi
                label="Base de datos" value={health.dbReady ? "Lista" : "Sin migrar"}
                tone={health.dbReady ? "good" : "bad"}
                sub={health.dbReady ? "D1 conectada" : "ejecuta wrangler d1 migrations apply"}
              />
              <Kpi
                label="Acceso" value={health.authEnabled ? "Protegido" : "Abierto"}
                tone={health.authEnabled ? "good" : "bad"}
                sub={health.authEnabled ? "contraseña activa" : "define AUTH_PASSWORD"}
              />
              <Kpi
                label="Proveedor" value={health.provider.provider}
                tone={health.provider.configured ? "good" : "bad"}
                sub={health.provider.configured ? "configurado" : "falta la clave"}
              />
              <Kpi
                label="Tasa de bloqueo" value={`${health.blockRate}%`}
                tone={health.blockRate < 10 ? "good" : health.blockRate < 35 ? "warn" : "bad"}
                sub="últimas 40 peticiones"
              />
            </div>

            {!health.dbReady ? (
              <Alert tone="bad">
                <strong>Faltan las tablas de la base de datos.</strong> Créalas con un clic.
                Todo el esquema son sentencias <code>CREATE ... IF NOT EXISTS</code>, así que
                repetirlo no borra nada.
                <div className="row" style={{ marginTop: 10 }}>
                  <Button variant="primary" loading={migrating} icon={<Icon.Save size={15} />} onClick={migrate}>
                    Crear las tablas ahora
                  </Button>
                </div>
                <div className="small faint" style={{ marginTop: 10 }}>
                  Desde la terminal el equivalente es <code>npx wrangler d1 migrations apply kdplook --remote</code>.
                </div>
              </Alert>
            ) : null}

            {!health.authEnabled ? (
              <Alert tone="warn">
                <strong>La app está abierta a cualquiera con la URL.</strong> Ponle contraseña con{" "}
                <code>npx wrangler secret put AUTH_PASSWORD</code> y vuelve a desplegar.
              </Alert>
            ) : null}

            {health.blockRate >= 35 ? (
              <Alert tone="warn">
                <strong>Amazon está bloqueando buena parte de las peticiones.</strong> Espera unas horas, sube el
                tiempo de caché, baja el paralelismo, o configura un proveedor de scraping en Ajustes.
              </Alert>
            ) : null}
          </>
        )}

        <Card>
          <CardHead title="Sonda manual" note="Descarga una URL de Amazon y muestra qué entiende el parser." />
          <div className="card-pad stack">
            <form className="search-bar" onSubmit={(event) => { event.preventDefault(); void runProbe(); }}>
              <input
                className="input mono" placeholder={`${marketHost}/s?k=coloring+book&i=stripbooks`}
                value={probeUrl} onChange={(event) => setProbeUrl(event.target.value)}
              />
              <Button type="submit" variant="primary" loading={probing}>Sondear</Button>
            </form>
            <div className="row-tight small faint">
              <Button size="sm" variant="ghost" onClick={() => setProbeUrl(`${marketHost}/s?k=coloring+book&i=stripbooks`)}>
                Ejemplo: búsqueda
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setProbeUrl(`${marketHost}/dp/B08L5T4M2Z`)}>
                Ejemplo: ficha
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setProbeUrl(`${marketHost}/gp/bestsellers/books/`)}>
                Ejemplo: más vendidos
              </Button>
            </div>

            {probe ? (
              <div className="stack-sm">
                <div className="row">
                  <Badge tone={probe.ok ? "good" : probe.blocked ? "bad" : "warn"}>
                    HTTP {probe.status} {probe.blocked ? "· bloqueado" : probe.ok ? "· ok" : ""}
                  </Badge>
                  <Badge tone="neutral">{probe.provider}</Badge>
                  <Badge tone="neutral">{probe.ms} ms · {probe.attempts} intento(s)</Badge>
                  <Badge tone="neutral">{(probe.bodyLength / 1024).toFixed(0)} KB</Badge>
                </div>
                {probe.title ? <div className="small muted">Título del documento: {probe.title}</div> : null}
                <Field label="Datos reconocidos por el parser">
                  <pre className="code">{JSON.stringify(probe.parsed, null, 2) || "null"}</pre>
                </Field>
                <Field
                  label={probe.anchor
                    ? `Marcado alrededor de «${probe.anchor}»`
                    : "No se encontró ninguna estructura conocida en la página"}
                  help={probe.anchor
                    ? "Es el trozo de HTML del que el parser debería extraer los datos."
                    : "Ni un solo contenedor esperado aparece: o Amazon cambió el marcado por completo, o esta no es la página que creemos."}
                >
                  <pre className="code" style={{ maxHeight: 260 }}>{probe.excerpt || "(sin coincidencias)"}</pre>
                </Field>
                <Field label="Primeros bytes de la respuesta">
                  <pre className="code" style={{ maxHeight: 160 }}>{probe.snippet}</pre>
                </Field>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHead title="Registro de peticiones" note="Las 100 últimas llamadas salientes." />
          {log.length === 0 ? (
            <Empty title="Sin actividad registrada">Ejecuta un análisis y vuelve aquí.</Empty>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Cuándo</th><th>Tipo</th><th>Objetivo</th><th>Proveedor</th>
                    <th className="num">Estado</th><th className="num">ms</th><th className="num">Extraídos</th><th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((row, index) => (
                    <tr key={`${row.ts}-${index}`}>
                      <td className="small faint">{relativeTime(row.ts)}</td>
                      <td><Badge tone="neutral">{row.kind}</Badge></td>
                      <td className="small mono truncate" style={{ maxWidth: 320 }} title={row.target}>{row.target}</td>
                      <td className="small faint">{row.provider}</td>
                      <td className="num">
                        <Badge tone={row.blocked ? "bad" : row.ok ? "good" : "warn"}>{row.status || "—"}</Badge>
                      </td>
                      <td className="num faint">{row.ms}</td>
                      <td className="num">{row.parsed}</td>
                      <td className="small faint truncate" style={{ maxWidth: 240 }}>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card pad>
          <h3>Cómo interpretar esto</h3>
          <div className="small muted stack-sm" style={{ marginTop: 8, lineHeight: 1.65 }}>
            <p>
              <strong>Estado 200 pero 0 extraídos</strong> significa que Amazon respondió con una página real y el
              parser no la reconoció: normalmente han cambiado el marcado. Usa la sonda sobre esa misma URL y mira
              los primeros bytes para localizar los nuevos contenedores.
            </p>
            <p>
              <strong>Estado 503, 403 o «bloqueado»</strong> es la verificación anti-bot. No es un fallo del código:
              Amazon desconfía de las IP de centros de datos. Sube la caché, baja el paralelismo, espera, o enruta
              a través de un proveedor de scraping.
            </p>
            <p>
              <strong>Sin BSR reconocido</strong> en fichas concretas suele ser normal: los libros muy nuevos o sin
              ventas no muestran clasificación.
            </p>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
