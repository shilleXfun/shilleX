/** Escape LIKE/ILIKE wildcards so user input matches literally (Postgres default escape char is backslash). */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');
