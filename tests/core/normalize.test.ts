import { describe, expect, test } from "bun:test";
import {
  createEntity,
  entityId,
  mergeEntities,
  normalizeAccount,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  normalizeUsername,
  type Entity,
  type Result,
} from "../../packages/core/src/index.ts";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("email", () => {
  test("case and spacing variants merge into one entity", () => {
    const a = value(createEntity("audit-1", "Email", { address: " Bob@Example.COM " }));
    const b = value(createEntity("audit-1", "Email", { address: "bob@example.com" }));
    expect(a.key).toBe("bob@example.com");
    expect(entityId(a)).toBe(entityId(b));
    expect(mergeEntities([a, b])).toHaveLength(1);
  });

  test("rejects strings that are not addresses", () => {
    expect(normalizeEmail("bob").ok).toBe(false);
    expect(normalizeEmail("bob@@example.com").ok).toBe(false);
    expect(normalizeEmail("bob@localhost").ok).toBe(false);
    expect(createEntity("audit-1", "Email", { address: "a b@example.com" }).ok).toBe(false);
  });
});

describe("phone", () => {
  test("UK local, spaced, 00 and + forms give the same E.164 and merge", () => {
    const forms = ["07700 900123", "+44 7700 900123", "0044 (7700) 900-123", "+447700900123"];
    const entities: Entity[] = forms.map((number) =>
      value(createEntity("audit-1", "Phone", { number }, { defaultCallingCode: "44" })),
    );
    for (const entity of entities) expect(entity.key).toBe("+447700900123");
    expect(mergeEntities(entities)).toHaveLength(1);
  });

  test("US number with a default code", () => {
    expect(value(normalizePhone("(415) 555-0132", { defaultCallingCode: "1" }))).toBe("+14155550132");
    expect(value(normalizePhone("+1 415.555.0132"))).toBe("+14155550132");
  });

  test("rejects local numbers without a default code, and bad lengths", () => {
    expect(normalizePhone("07700 900123").ok).toBe(false);
    expect(normalizePhone("+44 123").ok).toBe(false);
    expect(normalizePhone("+44 1234 5678 9012 3456").ok).toBe(false);
    expect(normalizePhone("+44 77OO 900123").ok).toBe(false);
  });
});

describe("other identities", () => {
  test("domain is lowercased and loses its trailing dot", () => {
    expect(value(normalizeDomain("Example.COM."))).toBe("example.com");
    expect(normalizeDomain("not a domain").ok).toBe(false);
  });

  test("url drops fragment, default port and bare root slash", () => {
    expect(value(normalizeUrl("HTTPS://Example.com:443/#top"))).toBe("https://example.com");
    expect(value(normalizeUrl("https://example.com/Profile/Bob#x"))).toBe("https://example.com/Profile/Bob");
    expect(normalizeUrl("not a url").ok).toBe(false);
  });

  test("account key joins lowercased service and username", () => {
    expect(value(normalizeAccount(" GitHub ", "BobSmith"))).toBe("github:bobsmith");
    expect(normalizeAccount("github", " ").ok).toBe(false);
  });

  test("person names collapse whitespace and case but keep display form", () => {
    const person = value(createEntity("audit-1", "Person", { name: "  Bob   Smith " }));
    expect(person.key).toBe("bob smith");
    expect(person.props.name).toBe("Bob Smith");
  });

  test("the same email in different audits never merges", () => {
    const a = value(createEntity("audit-1", "Email", { address: "bob@example.com" }));
    const b = value(createEntity("audit-2", "Email", { address: "bob@example.com" }));
    expect(mergeEntities([a, b])).toHaveLength(2);
  });
});

describe("username", () => {
  test("key is trimmed and lowercased", () => {
    expect(value(normalizeUsername("  BobSmith "))).toBe("bobsmith");
  });

  test("rejects empty names and names with whitespace inside", () => {
    expect(normalizeUsername("   ").ok).toBe(false);
    expect(normalizeUsername("bob smith").ok).toBe(false);
  });

  test("entity keeps the original case for building URLs", () => {
    const username = value(createEntity("audit-1", "Username", { name: " BobSmith " }));
    expect(username.key).toBe("bobsmith");
    expect(username.props.name).toBe("BobSmith");
  });
});
