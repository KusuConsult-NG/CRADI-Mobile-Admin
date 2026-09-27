// Nigerian phone number normalisation to E.164 (+234XXXXXXXXXX).
// Same rules as the backend's CRADI-mobile/backend/src/sms/phone.js, so a
// number accepted here is one the SMS sender can text.
//
// Accepts common local spellings: "0803 123 4567", "803-123-4567",
// "2348031234567", "+234 (0)803 123 4567", "002348031234567".
// Returns null for anything that is not a 10-digit Nigerian subscriber number.
export function normalizeNigerianPhone(input: string | null | undefined): string | null {
    if (input == null) return null;
    let digits = String(input).replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
    let international = false;
    if (digits.startsWith('+')) {
        digits = digits.slice(1);
        international = true;
    } else if (digits.startsWith('00')) {
        digits = digits.slice(2);
        international = true;
    }
    if (digits.includes('+')) return null;

    if (digits.startsWith('234') && digits.length >= 13) digits = digits.slice(3);
    else if (international) return null; // another country code
    if (digits.startsWith('0')) digits = digits.slice(1);
    // Nigerian mobile/landline subscriber numbers are 10 digits after the country code.
    if (!/^[1-9]\d{9}$/.test(digits)) return null;
    return `+234${digits}`;
}
