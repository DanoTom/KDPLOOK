import { useState } from "react";
import { api } from "../api";
import { Button, Card, Field } from "../components/ui";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div className="brand-mark">KL</div>
        <h1 style={{ fontSize: "1.35rem" }}>KDPLOOK</h1>
        <p className="muted small" style={{ marginTop: 6, marginBottom: 22 }}>
          Consola privada de investigación de nichos para KDP.
        </p>

        <form onSubmit={submit} className="stack">
          <Field label="Contraseña">
            <input
              className="input input-lg" type="password" value={password} autoFocus
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {error ? <div className="alert alert-bad small">{error}</div> : null}
          <Button type="submit" variant="primary" block loading={busy}>Entrar</Button>
        </form>
      </Card>
    </div>
  );
}
