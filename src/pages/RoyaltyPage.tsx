import { useMemo, useState } from "react";
import type { RoyaltyInput } from "../../shared/types";
import { computeRoyalty, printingCost } from "../../shared/analytics/royalty";
import { bsrForSalesPerMonth } from "../../shared/analytics/bsr";
import { BarChart } from "../components/charts";
import { Layout } from "../components/Layout";
import { Alert, Card, CardHead, Field, Kpi, SegmentedControl } from "../components/ui";
import { fmtCompact, fmtInt, fmtMoney, fmtPct } from "../lib/format";
import { useApp } from "../state";

export function RoyaltyPage() {
  const { settings, currencySymbol } = useApp();
  const [format, setFormat] = useState<RoyaltyInput["format"]>("paperback");
  const [ink, setInk] = useState<RoyaltyInput["ink"]>("bw");
  const [trim, setTrim] = useState<RoyaltyInput["trim"]>("regular");
  const [price, setPrice] = useState(12.99);
  const [pages, setPages] = useState(120);
  const [fileSizeMb, setFileSizeMb] = useState(2);
  const [targetIncome, setTargetIncome] = useState(500);

  const printing = settings!.printing;

  const result = useMemo(
    () => computeRoyalty(
      { price, pages, format, ink, trim, marketplace: settings!.marketplace, fileSizeMb },
      printing,
    ),
    [price, pages, format, ink, trim, fileSizeMb, printing, settings],
  );

  // How the margin behaves across the plausible price band.
  const priceCurve = useMemo(() => {
    const points: Array<{ label: string; value: number; tone: "good" | "warn" | "bad" }> = [];
    for (const candidate of [5.99, 7.99, 9.99, 11.99, 14.99, 17.99, 21.99, 24.99]) {
      const royalty = computeRoyalty(
        { price: candidate, pages, format, ink, trim, marketplace: settings!.marketplace, fileSizeMb },
        printing,
      ).royaltyPerUnit;
      points.push({
        label: `${currencySymbol}${candidate}`,
        value: Math.max(0, royalty),
        tone: royalty <= 0 ? "bad" : royalty >= 3 ? "good" : "warn",
      });
    }
    return points;
  }, [pages, format, ink, trim, fileSizeMb, printing, currencySymbol, settings]);

  const unitsNeeded = result.royaltyPerUnit > 0 ? targetIncome / result.royaltyPerUnit : null;
  const rankNeeded = unitsNeeded
    ? bsrForSalesPerMonth(unitsNeeded, format === "kindle" ? "kindle" : "paperback", settings!.marketplace, settings!.salesCurveCalibration)
    : null;

  const pageCostSteps = useMemo(
    () => [24, 60, 100, 108, 120, 200, 300, 500].map((count) => ({
      label: `${count}p`,
      value: printingCost(count, format === "kindle" ? "paperback" : format, ink, trim, printing),
      tone: "accent" as const,
    })),
    [format, ink, trim, printing],
  );

  return (
    <Layout
      title="Calculadora KDP"
      subtitle="Cuánto te queda por ejemplar y cuántos ejemplares hacen falta para tu objetivo."
      narrow
    >
      <div className="stack-lg">
        <Card pad>
          <div className="grid grid-2">
            <Field label="Formato">
              <SegmentedControl
                value={format} onChange={setFormat}
                options={[
                  { value: "paperback", label: "Tapa blanda" },
                  { value: "hardcover", label: "Tapa dura" },
                  { value: "kindle", label: "Kindle" },
                ]}
              />
            </Field>
            {format !== "kindle" ? (
              <>
                <Field label="Tinta">
                  <SegmentedControl
                    value={ink} onChange={setInk}
                    options={[
                      { value: "bw", label: "B/N" },
                      { value: "color", label: "Color estándar" },
                      { value: "premium", label: "Color premium" },
                    ]}
                  />
                </Field>
                <Field label="Tamaño" help="«Grande» es cualquier corte por encima de 6,12 × 9 pulgadas.">
                  <SegmentedControl
                    value={trim} onChange={setTrim}
                    options={[{ value: "regular", label: "Regular" }, { value: "large", label: "Grande" }]}
                  />
                </Field>
              </>
            ) : (
              <Field label={`Tamaño del archivo: ${fileSizeMb} MB`} help="Amazon cobra 0,15 $/MB de entrega en el plan del 70%.">
                <input type="range" min={0.5} max={20} step={0.5} value={fileSizeMb} onChange={(e) => setFileSizeMb(Number(e.target.value))} />
              </Field>
            )}
            <Field label="Precio de lista">
              <input className="input" type="number" min={0} step={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            </Field>
            {format !== "kindle" ? (
              <Field label={`Páginas: ${pages}`} help="El coste de impresión da un salto a partir de 108 páginas.">
                <input type="range" min={24} max={600} step={2} value={pages} onChange={(e) => setPages(Number(e.target.value))} />
              </Field>
            ) : null}
          </div>
        </Card>

        <div className="grid grid-4">
          <Kpi
            label="Regalía por unidad" value={fmtMoney(result.royaltyPerUnit, currencySymbol)}
            tone={result.royaltyPerUnit >= 3 ? "good" : result.royaltyPerUnit > 0 ? "warn" : "bad"}
            sub={`margen ${fmtPct(result.marginPct / 100)}`}
          />
          <Kpi label="Coste de impresión" value={fmtMoney(result.printingCost, currencySymbol)} tone="neutral" sub={format === "kindle" ? "no aplica" : `${pages} páginas`} />
          <Kpi label="Tasa de regalía" value={fmtPct(result.royaltyRate)} tone="neutral" sub={format === "kindle" ? "según banda de precio" : "plan del 60%"} />
          <Kpi
            label="Precio mínimo" value={fmtMoney(result.breakEvenPrice, currencySymbol)}
            tone="neutral" sub="por debajo, no hay regalía"
          />
        </div>

        {result.notes.length ? (
          <Alert tone={result.royaltyPerUnit <= 0 ? "bad" : "info"}>
            <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
              {result.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </Alert>
        ) : null}

        <Card>
          <CardHead title="Objetivo de ingresos" note="Qué hace falta para llegar a la cifra que te propones." />
          <div className="card-pad">
            <Field label={`Ingreso mensual objetivo: ${fmtMoney(targetIncome, currencySymbol)}`}>
              <input type="range" min={50} max={5000} step={50} value={targetIncome} onChange={(e) => setTargetIncome(Number(e.target.value))} />
            </Field>
            <div className="grid grid-3" style={{ marginTop: 14 }}>
              <Kpi
                label="Ejemplares/mes" value={unitsNeeded ? fmtInt(Math.ceil(unitsNeeded)) : "—"}
                tone="accent" sub={unitsNeeded ? `≈ ${fmtInt(Math.ceil(unitsNeeded / 30.44))} al día` : "sube el precio"}
              />
              <Kpi
                label="BSR necesario" value={rankNeeded ? `#${fmtCompact(rankNeeded)}` : "—"}
                tone={rankNeeded && rankNeeded < 100_000 ? "good" : "warn"}
                sub="rango aproximado en esa tienda"
              />
              <Kpi
                label="Con 3 títulos" value={unitsNeeded ? fmtInt(Math.ceil(unitsNeeded / 3)) : "—"}
                tone="neutral" sub="ejemplares/mes por título"
              />
            </div>
          </div>
        </Card>

        <div className="grid grid-2">
          <Card>
            <CardHead title="Regalía según el precio" note="Dónde deja de compensar bajar de precio." />
            <div className="card-pad"><BarChart data={priceCurve} format={(v) => fmtMoney(v, currencySymbol)} /></div>
          </Card>
          <Card>
            <CardHead title="Coste según páginas" note="El salto de 108 a 110 páginas es el más caro del catálogo." />
            <div className="card-pad">
              {format === "kindle"
                ? <div className="empty small">Kindle no tiene coste de impresión.</div>
                : <BarChart data={pageCostSteps} format={(v) => fmtMoney(v, currencySymbol)} />}
            </div>
          </Card>
        </div>

        <Alert tone="warn">
          <strong>Verifica antes de publicar.</strong> Las tarifas de impresión son las de Amazon EE. UU. y
          cambian cada cierto tiempo. Puedes ajustarlas en <strong>Ajustes → Costes de impresión</strong>;
          la fuente oficial es la calculadora de KDP.
        </Alert>
      </div>
    </Layout>
  );
}
