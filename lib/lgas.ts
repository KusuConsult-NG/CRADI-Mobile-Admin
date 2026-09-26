// Derived from lib/wards.ts (generated from CRADI-mobile lib/core/data/mvp_locations_data.dart).
import { LOCATIONS } from '@/lib/wards';

/** Every LGA name covered by the app (unique, sorted). Names match `reports.lga` exactly. */
export const LGAS: readonly string[] = Array.from(new Set(LOCATIONS.map((l) => l.lga))).sort((a, b) =>
    a.localeCompare(b),
);

export function isLga(value: unknown): value is string {
    return typeof value === 'string' && LGAS.includes(value);
}
