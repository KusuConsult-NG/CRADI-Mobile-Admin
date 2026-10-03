import { ExecutionMethod } from 'appwrite';
import type { Appwrite } from '@/lib/appwrite';

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

/**
 * Calls a Function and returns its JSON body.
 *
 * A Function that refuses answers with a 4xx *inside* a successful
 * execution — the execution completed, the response did not. Turning that
 * back into an error is what lets the panel treat a Function refusal and a
 * database refusal alike.
 *
 * Takes the client rather than reaching for the shared one, because the
 * recovery page runs on a client of its own.
 */
export async function executeFunction(
    appwrite: Appwrite,
    functionId: string,
    payload: Record<string, unknown>,
    // Which handler inside the merged Function runs; Appwrite passes it
    // through as `req.path`.
    path = '/',
): Promise<Record<string, unknown>> {
    const execution = await appwrite.functions.createExecution({
        functionId,
        body: JSON.stringify(payload),
        // The web SDK's parameter is `xpath`; it goes on the wire as `path`,
        // which is what the Function reads as `req.path`.
        xpath: path,
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
