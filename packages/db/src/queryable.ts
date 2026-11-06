import type pg from "pg";

/** A pool, a pooled client or a client. */
export interface Queryable {
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<Row>>;
}
