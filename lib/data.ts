'use client';

import { ExecutionMethod, Query, type Models } from 'appwrite';
import { DATABASE_ID, FUNCTIONS, getAppwrite } from '@/lib/appwrite';

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

/** A row as the panel uses it: Appwrite's `$id` also surfaced as `id`. */
export type WithId<T> = T & { id: string; $id: string; $createdAt: string; $updatedAt: string };

function withId<T extends Row>(row: T): WithId<T> {
    return { ...row, id: row.$id } as WithId<T>;
}

export interface ListResult<T> {
    rows: WithId<T>[];
    /** Rows matching the queries, ignoring `limit`/`offset`. */
    total: number;
}

export async function listRows<T extends Row = Row>(
    table: string,
    queries: string[] = [],
): Promise<ListResult<T>> {
    const { tables } = getAppwrite();
    const result = await tables.listRows<T>({
        databaseId: DATABASE_ID,
        tableId: table,
        queries,
    });
    return { rows: result.rows.map(withId), total: result.total };
}

/** The row, or null when it is not there — or not readable, which Appwrite answers alike. */
export async function getRow<T extends Row = Row>(
    table: string,
    rowId: string,
): Promise<WithId<T> | null> {
    const { tables } = getAppwrite();
    try {
        const row = await tables.getRow<T>({
            databaseId: DATABASE_ID,
            tableId: table,
            rowId,
        });
        return withId(row);
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

export async function createRow<T extends Row = Row>(
    table: string,
    rowId: string,
    data: Record<string, unknown>,
): Promise<WithId<T>> {
    return withId(await write<T>('create', table, rowId, data));
}

export async function updateRow<T extends Row = Row>(
    table: string,
    rowId: string,
    data: Record<string, unknown>,
): Promise<WithId<T>> {
    return withId(await write<T>('update', table, rowId, data));
}

export async function deleteRow(table: string, rowId: string): Promise<void> {
    await write('delete', table, rowId, {});
}

/** A named server-side operation — the Postgres RPCs, as Functions. */
export async function callOperation(
    operation: string,
    params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
    return execute(FUNCTIONS.OPERATION, { operation, params });
}

async function write<T extends Row = Row>(
    op: 'create' | 'update' | 'delete',
    collection: string,
    documentId: string,
    data: Record<string, unknown>,
): Promise<T> {
    const body = await execute(FUNCTIONS.WRITE, { op, collection, documentId, data });
    const document = body.document;
    if (document && typeof document === 'object') return document as T;
    if (op === 'delete') return {} as T;
    // A create or update that answers with no document is a Function bug, and
    // returning an empty row would make it look like a successful write of
    // nothing.
    throw new BackendError(`The ${op} Function returned no document`, 502);
}

/**
 * Calls a Function and returns its JSON body.
 *
 * A Function that refuses a write answers with a 4xx *inside* a successful
 * execution — the execution completed, the response did not. Turning that
 * back into an error is what lets the panel treat a Function refusal and a
 * database refusal alike.
 */
async function execute(
    functionId: string,
    payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const { functions } = getAppwrite();
    const execution = await functions.createExecution({
        functionId,
        body: JSON.stringify(payload),
        async: false,
        method: ExecutionMethod.POST,
        headers: { 'content-type': 'application/json' },
    });

    const body = decode(execution.responseBody);
    const status = execution.responseStatusCode;
    if (status >= 400) {
        throw new BackendError(
            typeof body.message === 'string' ? body.message : 'The request was refused',
            status,
            typeof body.type === 'string' ? body.type : undefined,
        );
    }
    // An execution that never ran — a cold-start timeout, a crash — has no
    // response at all. It must not read as success.
    if (execution.status !== 'completed') {
        throw new BackendError(
            `${functionId} did not complete (${execution.status})`,
            503,
            'function_incomplete',
        );
    }
    return body;
}

function decode(body: string): Record<string, unknown> {
    if (!body) return {};
    try {
        const parsed: unknown = JSON.parse(body);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
        return { message: body };
    }
}

/** An error carrying the status and type the panel branches on. */
export class BackendError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly type?: string,
    ) {
        super(message);
        this.name = 'BackendError';
    }
}

export function isNotFound(error: unknown): boolean {
    if (error instanceof BackendError) return error.status === 404;
    if (typeof error === 'object' && error !== null && 'code' in error) {
        return (error as { code: unknown }).code === 404;
    }
    return false;
}

export { Query };
