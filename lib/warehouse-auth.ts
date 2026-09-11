const DEFAULT_PASSWORD = "RL-7K4M-926P";
const DEFAULT_SECRET = "russian-forest-warehouse-v05-2026";

export function accessPassword() {
  return process.env.APP_PASSWORD || DEFAULT_PASSWORD;
}

export async function sessionToken() {
  const value = `${accessPassword()}:${process.env.AUTH_SECRET || DEFAULT_SECRET}`;
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
