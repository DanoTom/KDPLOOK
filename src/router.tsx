import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface RouteState {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouteState | null>(null);

/**
 * A ~40-line History router. The app has eight screens and no nested layouts,
 * so a routing dependency would cost more than it saves.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState(() => window.location.pathname + window.location.search);

  useEffect(() => {
    const onPop = () => setUrl(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState({}, "", to);
    else window.history.pushState({}, "", to);
    setUrl(to);
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo<RouteState>(() => {
    const [path, search = ""] = url.split("?");
    return { path: path || "/", query: new URLSearchParams(search), navigate };
  }, [url, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRoute(): RouteState {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRoute must be used inside RouterProvider");
  return context;
}

export function Link({
  to, className, children, onClick, style, title,
}: {
  to: string; className?: string; children: ReactNode;
  onClick?: () => void; style?: React.CSSProperties; title?: string;
}) {
  const { navigate } = useRoute();
  return (
    <a
      href={to}
      className={className}
      style={style}
      title={title}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
