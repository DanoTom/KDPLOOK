import { useMemo, useState } from "react";
import type { BookRecord } from "../../shared/types";
import { fmtCompact, fmtDate, fmtInt, fmtMoney, fmtNum } from "../lib/format";
import { Badge, IconButton } from "./ui";
import { Icon } from "./icons";
import { Link } from "../router";

type SortKey =
  | "position" | "title" | "price" | "rating" | "reviews" | "bsr"
  | "salesPerMonth" | "revenuePerMonth" | "pages" | "publishedAt" | "weakness";

interface Column {
  key: SortKey | "actions";
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  title?: string;
}

const COLUMNS: Column[] = [
  { key: "position", label: "#", numeric: true, sortable: true, title: "Posición orgánica en los resultados" },
  { key: "title", label: "Libro", sortable: true },
  { key: "price", label: "Precio", numeric: true, sortable: true },
  { key: "rating", label: "★", numeric: true, sortable: true, title: "Valoración media" },
  { key: "reviews", label: "Reseñas", numeric: true, sortable: true },
  { key: "bsr", label: "BSR", numeric: true, sortable: true, title: "Best Sellers Rank de la tienda" },
  { key: "salesPerMonth", label: "Ventas/mes", numeric: true, sortable: true, title: "Estimación a partir del BSR" },
  { key: "revenuePerMonth", label: "Regalía/mes", numeric: true, sortable: true, title: "Ventas estimadas × regalía por unidad" },
  { key: "pages", label: "Págs.", numeric: true, sortable: true },
  { key: "publishedAt", label: "Publicado", sortable: true },
  { key: "weakness", label: "Batible", numeric: true, sortable: true, title: "Cuán alcanzable parece este competidor (0-100)" },
  { key: "actions", label: "" },
];

export function BookTable({
  items, currency, marketplace, onWatch, watched,
}: {
  items: BookRecord[];
  currency: string;
  marketplace: string;
  onWatch?: (book: BookRecord) => void;
  watched?: Set<string>;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "position", dir: "asc" });
  const [showSponsored, setShowSponsored] = useState(false);

  const rows = useMemo(() => {
    const filtered = showSponsored ? items : items.filter((item) => !item.sponsored);
    const sorted = [...filtered].sort((a, b) => {
      const av = valueOf(a, sort.key);
      const bv = valueOf(b, sort.key);
      // Rows missing the sorted metric always sink to the bottom.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return sort.dir === "asc"
          ? String(av).localeCompare(String(bv), "es")
          : String(bv).localeCompare(String(av), "es");
      }
      return sort.dir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [items, sort, showSponsored]);

  const sponsoredCount = items.filter((item) => item.sponsored).length;

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "position" || key === "bsr" || key === "title" || key === "publishedAt" ? "asc" : "desc" },
    );
  }

  return (
    <>
      {sponsoredCount > 0 ? (
        <div className="row small faint" style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
          <label className="row-tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={showSponsored} onChange={(e) => setShowSponsored(e.target.checked)} />
            Mostrar {sponsoredCount} anuncios patrocinados
          </label>
          <span className="spacer">{rows.length} libros</span>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={`${column.numeric ? "num" : ""} ${column.sortable ? "sortable" : ""}`}
                  title={column.title}
                  onClick={column.sortable ? () => toggleSort(column.key as SortKey) : undefined}
                >
                  {column.label}
                  {sort.key === column.key ? <span className="arrow">{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((book) => (
              <tr key={book.asin}>
                <td className="num faint">{book.sponsored ? "ad" : book.position}</td>
                <td>
                  <div className="book-cell">
                    {book.image
                      ? <img className="cover" src={book.image} alt="" loading="lazy" />
                      : <div className="cover" />}
                    <div style={{ minWidth: 0 }}>
                      <div className="book-title clamp-2" title={book.title}>{book.title}</div>
                      <div className="book-meta truncate">
                        {book.author || "—"} · {book.formatLabel}
                        {book.selfPublished === true ? " · indie" : book.selfPublished === false ? " · editorial" : ""}
                        {book.kindleUnlimited ? " · KU" : ""}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="num">{fmtMoney(book.price, currency)}</td>
                <td className="num">{book.rating !== null ? fmtNum(book.rating, 1) : "—"}</td>
                <td className="num">{fmtInt(book.reviews)}</td>
                <td className="num">{book.bsr !== null ? fmtCompact(book.bsr) : <span className="faint">—</span>}</td>
                <td className="num">{book.salesPerMonth !== null ? fmtInt(book.salesPerMonth) : "—"}</td>
                <td className="num">{fmtMoney(book.revenuePerMonth, currency)}</td>
                <td className="num">{fmtInt(book.pages)}</td>
                <td className="small">{book.publishedAt ? fmtDate(book.publishedAt) : "—"}</td>
                <td className="num">
                  {book.weakness !== null ? (
                    <Badge tone={book.weakness >= 65 ? "good" : book.weakness >= 45 ? "warn" : "bad"}>
                      {book.weakness}
                    </Badge>
                  ) : "—"}
                </td>
                <td>
                  <div className="row-tight" style={{ flexWrap: "nowrap" }}>
                    <Link to={`/libro?asin=${book.asin}&marketplace=${marketplace}`} className="btn btn-ghost btn-icon" title="Inspeccionar">
                      <Icon.Search size={15} />
                    </Link>
                    {onWatch ? (
                      <IconButton
                        label={watched?.has(book.asin) ? "Ya en seguimiento" : "Añadir a seguimiento"}
                        onClick={() => onWatch(book)}
                        disabled={watched?.has(book.asin)}
                      >
                        <Icon.Eye size={15} />
                      </IconButton>
                    ) : null}
                    <a
                      className="btn btn-ghost btn-icon" href={book.url}
                      target="_blank" rel="noreferrer noopener" title="Abrir en Amazon"
                    >
                      <Icon.External size={15} />
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function valueOf(book: BookRecord, key: SortKey): number | string | null {
  switch (key) {
    case "title": return book.title;
    case "publishedAt": return book.publishedAt ?? null;
    case "position": return book.sponsored ? 9999 : book.position;
    default: return book[key];
  }
}
