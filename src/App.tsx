import { useEffect, useState } from "react";
import { UNAUTHORIZED_EVENT, api } from "./api";
import { AppProvider, useApp } from "./state";
import { RouterProvider, useRoute } from "./router";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { NichePage } from "./pages/NichePage";
import { IdeasPage } from "./pages/IdeasPage";
import { KeywordsPage } from "./pages/KeywordsPage";
import { CategoryPage } from "./pages/CategoryPage";
import { BookPage } from "./pages/BookPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { SavedPage } from "./pages/SavedPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { RoyaltyPage } from "./pages/RoyaltyPage";

export function App() {
  const [auth, setAuth] = useState<{ checked: boolean; ok: boolean }>({ checked: false, ok: false });

  const check = () => {
    api.authStatus()
      .then((status) => setAuth({ checked: true, ok: status.authenticated }))
      // If the status endpoint itself fails, render the app and let each screen
      // report its own error rather than trapping the user on a login form.
      .catch(() => setAuth({ checked: true, ok: true }));
  };

  useEffect(() => {
    check();
    const onUnauthorized = () => setAuth({ checked: true, ok: false });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (!auth.checked) {
    return <div className="login-wrap"><span className="spinner" style={{ width: 26, height: 26 }} /></div>;
  }

  if (!auth.ok) return <Login onSuccess={check} />;

  return (
    <RouterProvider>
      <AppProvider>
        <Routes />
      </AppProvider>
    </RouterProvider>
  );
}

function Routes() {
  const { path } = useRoute();
  const { loading, settings } = useApp();

  if (loading || !settings) {
    return <div className="login-wrap"><span className="spinner" style={{ width: 26, height: 26 }} /></div>;
  }

  if (path.startsWith("/ideas")) return <IdeasPage />;
  if (path.startsWith("/nicho")) return <NichePage />;
  if (path.startsWith("/keywords")) return <KeywordsPage />;
  if (path.startsWith("/categorias")) return <CategoryPage />;
  if (path.startsWith("/libro")) return <BookPage />;
  if (path.startsWith("/guardados")) return <SavedPage />;
  if (path.startsWith("/seguimiento")) return <WatchlistPage />;
  if (path.startsWith("/regalias")) return <RoyaltyPage />;
  if (path.startsWith("/ajustes")) return <SettingsPage />;
  if (path.startsWith("/diagnostico")) return <DiagnosticsPage />;
  return <Dashboard />;
}
