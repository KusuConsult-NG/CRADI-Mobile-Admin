import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness probe. It answers `{"ok": true}` unconditionally and says nothing
 * about whether Appwrite is reachable or the environment is configured, so it
 * is not a readiness check. What it does prove is that a Node server is
 * running this app rather than a static host serving files — which is the one
 * question worth asking when a Site 404s on every path.
 */
export function GET() {
    return NextResponse.json({ ok: true });
}
