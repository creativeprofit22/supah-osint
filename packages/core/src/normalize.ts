// Pure normalizers that turn raw strings into stable identity keys.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}

export function normalizeText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeName(raw: string): Result<string> {
  const name = normalizeText(raw);
  return name === "" ? err("name is empty") : ok(name);
}

export function normalizeEmail(raw: string): Result<string> {
  const address = raw.trim().toLowerCase();
  const parts = address.split("@");
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || !domain) return err(`not an email address: ${raw}`);
  if (/\s/.test(address)) return err(`email contains whitespace: ${raw}`);
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => label === "")) return err(`email domain is invalid: ${raw}`);
  return ok(address);
}

export type PhoneOptions = { defaultCallingCode?: string };

export function normalizePhone(raw: string, options: PhoneOptions = {}): Result<string> {
  let compact = raw.trim().replace(/[\s\-.()]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  let digits: string;
  if (compact.startsWith("+")) {
    digits = compact.slice(1);
  } else {
    const code = options.defaultCallingCode?.replace(/^\+/, "");
    if (!code) return err(`phone has no country code and no default was given: ${raw}`);
    digits = code + compact.replace(/^0/, "");
  }
  if (!/^\d+$/.test(digits)) return err(`phone contains non-digits: ${raw}`);
  // E.164 allows at most 15 digits; 8 is a practical floor for a full international number.
  if (digits.length < 8 || digits.length > 15) return err(`phone has the wrong length: ${raw}`);
  if (digits.startsWith("0")) return err(`phone country code cannot start with 0: ${raw}`);
  return ok(`+${digits}`);
}

export function normalizeDomain(raw: string): Result<string> {
  const name = raw.trim().toLowerCase().replace(/\.$/, "");
  const labels = name.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9-]+$/.test(label))) {
    return err(`not a domain name: ${raw}`);
  }
  return ok(name);
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

export function normalizeUrl(raw: string): Result<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return err(`not a URL: ${raw}`);
  }
  url.hash = "";
  if (DEFAULT_PORTS[url.protocol] === url.port) url.port = "";
  const href = url.href;
  return ok(url.pathname === "/" && !url.search ? href.replace(/\/$/, "") : href);
}

export function normalizeAccount(service: string, username: string): Result<string> {
  const s = service.trim().toLowerCase();
  const u = username.trim().toLowerCase();
  if (s === "" || u === "") return err("account needs a service and a username");
  return ok(`${s}:${u}`);
}
