import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useRoute } from "../router";
import { useApp } from "../state";
import { api } from "../api";
import { Icon } from "./icons";
import { IconButton } from "./ui";

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
  group: string;
}

const NAV: NavEntry[] = [
  { to: "/", label: "Panel", icon: <Icon.Compass className="icon" />, group: "Investigar" },
  { to: "/ideas", label: "Buscar ideas", icon: <Icon.Compass className="icon" />, group: "Investigar" },
  { to: "/nicho", label: "Explorar nicho", icon: <Icon.Search className="icon" />, group: "Investigar" },
  { to: "/keywords", label: "Laboratorio de keywords", icon: <Icon.Tag className="icon" />, group: "Investigar" },
  { to: "/categorias", label: "Categorías", icon: <Icon.Trend className="icon" />, group: "Investigar" },
  { to: "/libro", label: "Inspector de libro", icon: <Icon.Book className="icon" />, group: "Investigar" },
  { to: "/guardados", label: "Nichos guardados", icon: <Icon.Bookmark className="icon" />, group: "Biblioteca" },
  { to: "/seguimiento", label: "Seguimiento", icon: <Icon.Eye className="icon" />, group: "Biblioteca" },
  { to: "/regalias", label: "Calculadora KDP", icon: <Icon.Calculator className="icon" />, group: "Herramientas" },
  { to: "/ajustes", label: "Ajustes", icon: <Icon.Sliders className="icon" />, group: "Herramientas" },
  { to: "/diagnostico", label: "Diagnóstico", icon: <Icon.Activity className="icon" />, group: "Herramientas" },
];

export function Layout({
  title, subtitle, actions, children, narrow,
}: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; narrow?: boolean }) {
  const { path } = useRoute();
  const { settings, updateSettings } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [path]);
  useEffect(() => { document.title = `${title} · KDPLOOK`; }, [title]);

  const groups = Array.from(new Set(NAV.map((entry) => entry.group)));
  const theme = settings?.theme ?? "dark";

  return (
    <div className="shell">
      {menuOpen ? <div className="scrim" onClick={() => setMenuOpen(false)} role="presentation" /> : null}

      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">KL</div>
          <div>
            <div className="brand-name">KDPLOOK</div>
            <div className="brand-sub">Research console</div>
          </div>
        </div>

        <nav className="nav">
          {groups.map((group) => (
            <div key={group}>
              <div className="nav-group">{group}</div>
              {NAV.filter((entry) => entry.group === group).map((entry) => {
                const active = entry.to === "/" ? path === "/" : path.startsWith(entry.to);
                return (
                  <Link key={entry.to} to={entry.to} className={`nav-item ${active ? "active" : ""}`}>
                    {entry.icon}
                    <span>{entry.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="row-tight">
            <IconButton
              label={theme === "dark" ? "Cambiar a claro" : "Cambiar a oscuro"}
              onClick={() => updateSettings({ theme: theme === "dark" ? "light" : "dark" })}
            >
              {theme === "dark" ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
            </IconButton>
            <IconButton
              label="Cerrar sesión"
              onClick={async () => { await api.logout(); window.location.href = "/"; }}
            >
              <Icon.Logout size={16} />
            </IconButton>
            <span className="tiny faint spacer">
              {settings ? settings.marketplace.toUpperCase() : ""}
            </span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <IconButton label="Menú" className="menu-toggle" onClick={() => setMenuOpen((open) => !open)}>
            <Icon.Menu size={18} />
          </IconButton>
          <div style={{ minWidth: 0 }}>
            <h1 className="truncate">{title}</h1>
            {subtitle ? <div className="topbar-sub truncate">{subtitle}</div> : null}
          </div>
          {actions ? <div className="topbar-actions">{actions}</div> : null}
        </header>

        <main className={`page ${narrow ? "page-narrow" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
