import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness probe for Railway's healthcheck. */
export function GET() {
    return NextResponse.json({ ok: true });
}
