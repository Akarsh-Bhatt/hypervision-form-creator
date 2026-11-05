export const DESIGNATED_ADMIN_EMAIL = (
  process.env.NEXT_PUBLIC_ADMIN_EMAIL ||
  process.env.ADMIN_EMAIL ||
  "admin@gmail.com"
).toLowerCase();

export const DESIGNATED_ADMIN_NAME = "Admin";

export function isDesignatedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase() === DESIGNATED_ADMIN_EMAIL;
}

