'use client';

import { Query, type Models } from 'appwrite';
import { DATABASE_ID, FUNCTIONS, getAppwrite } from '@/lib/appwrite';
import { BackendError, executeFunction } from '@/lib/function-call';

/**
 * Reads go straight to the database; writes go through the `write` Function.
 *
 * Every collection the admin panel writes is closed to clients — Phase 1 of
 * the Appwrite migration moved role, approval and ward out of the client's
 * reach, and the same rule that stops a reporter approving their own report
 * stops this panel writing a row directly. The Function re-checks the
 * caller's role from their profile, so the panel's own admin guard is a
 * convenience, not the enforcement.
 *
 * Reads are permitted by the collections' own ACLs: `authorities`,
 * `knowledge_base`, `news_links`, `app_settings` and `alerts` are
 * `read("any")`, and `profiles` and `reports` carry `read("label:admin")`.
 * An admin therefore reads with their session and nothing else.
 */

export type Row = Models.DefaultRow;

/**
 * A row as the panel uses it: the caller's own shape, plus Appwrite's
 * system fields, plus `$id` surfaced again as `id`.
 *
 * `id` because that is what the panel's components and keys have always
 * used, and renaming it across every list and dialog would be churn with
 * no reader.
 */
export type WithId<T> = T & Row & { id: string };

/** The caller's shape: just the columns, with no system fields to declare. */
export type Columns = Record<string, unknown>;

function withId<T>(row: Row): WithId<T> {
    return { ...row, id: row.$id } as WithId<T>;
}

export interface ListResult<T> {
    rows: WithId<T>[];
    /** Rows matching the queries, ignoring `limit`/`offset`. */
    total: number;
}

export async function listRows<T = Columns>(
    table: string,
    queries: string[] = [],
): Promise<ListResult<T>> {
    const { tables } = getAppwrite();
    const result = await tables.listRows({
        databaseId: DATABASE_ID,
        tableId: table,
        queries,
    });
    return { rows: result.rows.map((row) => withId<T>(row)), total: result.total };
}

/** The row, or null when it is not there — or not readable, which Appwrite answers alike. */
export async function getRow<T = Columns>(
    table: string,
    rowId: string,
): Promise<WithId<T> | null> {
    const { tables } = getAppwrite();
    try {
        const row = await tables.getRow({
            databaseId: DATABASE_ID,
            tableId: table,
            rowId,
        });
        return withId<T>(row);
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

/**
 * How many rows match, without fetching them.
 *
 * `limit(1)` rather than `limit(0)`: Appwrite rejects a zero limit, and the
 * total it returns is the count of matches regardless of the page size.
 */
export async function countRows(table: string, queries: string[] = []): Promise<number> {
    const { tables } = getAppwrite();
    const result = await tables.listRows({
        databaseId: DATABASE_ID,
        tableId: table,
        queries: [...queries, Query.limit(1)],
    });
    return result.total;
}

export async function createRow<T = Columns>(
    table: string,
    rowId: string,
    data: Record<string, unknown>,
): Promise<WithId<T>> {
    return withId<T>(await write('create', table, rowId, data));
}

/**
 * [expect] is an optimistic lock: the edit applies only while those
 * fields still hold those values, and the Function answers 409 when they
 * do not.
 *
 * Appwrite has no `WHERE` on a single-row update, so the Function does
 * it with `updateRows` and a query — one atomic call, rather than a read
 * followed by a hopeful write. An admin deciding a report from a card
 * that may be minutes old must not overwrite somebody else's decision.
 */
export async function updateRow<T = Columns>(
    table: string,
    rowId: string,
    data: Record<string, unknown>,
    options: { expect?: Record<string, unknown> } = {},
): Promise<WithId<T>> {
    return withId<T>(await write('update', table, rowId, data, options.expect));
}

/**
 * Writes the row whether or not it is already there.
 *
 * For the tables the panel keys by a natural id — `app_settings`, whose
 * row id is the setting key — a create and an update are the same
 * intent, and asking which one it is first would be a race.
 */
export async function upsertRow<T = Columns>(
    table: string,
    rowId: string,
    data: Record<string, unknown>,
): Promise<WithId<T>> {
    return withId<T>(await write('upsert', table, rowId, data));
}

export async function deleteRow(table: string, rowId: string): Promise<void> {
    await write('delete', table, rowId, {});
}

/** A named server-side operation — the Postgres RPCs, as Functions. */
export async function callOperation(
    operation: string,
    params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
    return executeFunction(getAppwrite(), FUNCTIONS.OPERATION, { operation, params });
}

async function write(
    op: 'create' | 'update' | 'upsert' | 'delete',
    collection: string,
    documentId: string,
    data: Record<string, unknown>,
    expect?: Record<string, unknown>,
): Promise<Row> {
    const body = await executeFunction(getAppwrite(), FUNCTIONS.WRITE, {
        op,
        collection,
        documentId,
        data,
        ...(expect ? { expect } : {}),
    });
    const document = body.document;
    if (document && typeof document === 'object') return document as Row;
    if (op === 'delete') return {} as Row;
    // A create or update that answers with no document is a Function bug, and
    // returning an empty row would make it look like a successful write of
    // nothing.
    throw new BackendError(`The ${op} Function returned no document`, 502);
}

export function isNotFound(error: unknown): boolean {
    if (error instanceof BackendError) return error.status === 404;
    if (typeof error === 'object' && error !== null && 'code' in error) {
        return (error as { code: unknown }).code === 404;
    }
    return false;
}

export { Query };
export { BackendError } from '@/lib/function-call';
