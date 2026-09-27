/**
 * Password rules for the admin panel.
 *
 * These mirror the mobile app's `lib/core/utils/password_validator.dart`
 * (`PasswordValidator.validate`) one for one — same order, same thresholds,
 * same messages — so that a password accepted by one client is accepted by the
 * other. Keep the two in step when either changes.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Same list as `PasswordValidator._commonPasswords`. */
const COMMON_PASSWORDS = [
    'password',
    'password123',
    '12345678',
    'qwerty123',
    'abc123456',
    'password1',
    'welcome123',
    'admin123',
    'letmein',
    'monkey123',
];

/** Same character class as the Dart validator's special-character check. */
const SPECIAL = /[!@#$%^&*(),.?":{}|<>_\-+=[\]\;/]/;

const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

export function isCommonPassword(password: string): boolean {
    return COMMON_PASSWORDS.includes(password.toLowerCase());
}

/** True when the password contains three consecutive characters of a run (123, abc). */
function hasSequentialChars(password: string): boolean {
    return SEQUENCES.some((sequence) => {
        for (let i = 0; i <= sequence.length - 3; i++) {
            if (password.includes(sequence.slice(i, i + 3))) return true;
        }
        return false;
    });
}

/** Returns the first rule the password breaks, or null when it is acceptable. */
export function validatePassword(password: string): string | null {
    if (!password) return 'Password is required';
    if (password.length < PASSWORD_MIN_LENGTH) {
        return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
        return `Password is too long (max ${PASSWORD_MAX_LENGTH} characters)`;
    }
    if (!/[A-Z]/.test(password)) return 'Must contain at least one uppercase letter';
    if (!/[a-z]/.test(password)) return 'Must contain at least one lowercase letter';
    if (!/[0-9]/.test(password)) return 'Must contain at least one number';
    if (!SPECIAL.test(password)) return 'Must contain at least one special character';
    if (isCommonPassword(password)) {
        return 'This password is too common. Please choose a stronger password';
    }
    if (hasSequentialChars(password)) {
        return 'Password should not contain sequential characters (e.g., 123, abc)';
    }
    return null;
}

/** The rules as shown to the user under the password field. */
export const PASSWORD_RULES = [
    `At least ${PASSWORD_MIN_LENGTH} characters`,
    'An uppercase and a lowercase letter',
    'A number and a special character',
    'No common or sequential passwords (123, abc)',
];
