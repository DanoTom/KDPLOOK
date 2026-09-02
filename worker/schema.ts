import schemaSql from "../migrations/0001_init.sql";

/**
 * The initial schema, split into individual statements.
 *
 * The SQL file is imported as text (see the `rules` block in wrangler.jsonc)
 * rather than copied here, so the migration Wrangler applies from the CLI and
 * the one the Diagnostics screen can apply from the browser can never drift.
 */
export function schemaStatements(): string[] {
  return schemaSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
