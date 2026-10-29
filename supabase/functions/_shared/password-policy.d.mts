export type PasswordCheckKey = 'length' | 'uppercase' | 'lowercase' | 'number' | 'special';
export function passwordChecks(value: unknown): Record<PasswordCheckKey, boolean>;
export function validPassword(value: unknown): boolean;
