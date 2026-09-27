'use client';

/**
 * Calls an authenticated admin API route. Throws an Error with the server's
 * (sanitised) error message when the response is not ok; otherwise returns the
 * parsed JSON body (or null when there is none).
 */
export async function adminApi(
    getAccessToken: () => Promise<string>,
    path: string,
    init: { method: 'PATCH' | 'DELETE' | 'POST'; body?: unknown },
): Promise<unknown> {
    const token = await getAccessToken();
    const res = await fetch(path, {
        method: init.method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
            const data: unknown = await res.json();
            if (typeof data === 'object' && data !== null && 'error' in data) {
                const err = (data as { error: unknown }).error;
                if (typeof err === 'string' && err) message = err;
            }
        } catch {
            // Non-JSON response; keep the generic message.
        }
        throw new Error(message);
    }

    try {
        return (await res.json()) as unknown;
    } catch {
        return null;
    }
}
