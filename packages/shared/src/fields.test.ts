import { describe, expect, it } from "vitest";
import { patientDetailsSchema } from "./fields.js";

const valid = {
  first_name: "Jane",
  last_name: "Doe",
  preferred_name: "Janie",
  address: "12 King St W",
  city: "Toronto",
  province: "ON",
  postal_code: "M5H 1A1",
  phone: "4165551234",
  email: "jane@example.com",
  date_of_birth: "1985-04-17",
  health_insurance_number: "1234567890",
  health_insurance_version: "AB",
  hc_type: "ON",
};

const parse = (overrides: Record<string, unknown>) =>
  patientDetailsSchema.safeParse({ ...valid, ...overrides });

describe("patientDetailsSchema", () => {
  it("accepts a complete submission", () => {
    const result = patientDetailsSchema.parse(valid);
    expect(result).toEqual(valid);
  });

  it.each(Object.keys(valid))("rejects a missing %s", (field) => {
    expect(parse({ [field]: undefined }).success).toBe(false);
  });

  it.each(Object.keys(valid))("rejects a blank %s", (field) => {
    expect(parse({ [field]: "" }).success).toBe(false);
  });

  it.each(["first_name", "last_name", "preferred_name", "address", "city"])(
    "rejects a whitespace-only %s",
    (field) => {
      expect(parse({ [field]: "   " }).success).toBe(false);
    },
  );

  it("trims names and addresses", () => {
    const result = parse({ first_name: "  Jane  ", address: " 12 King St W " });
    expect(result.success && result.data.first_name).toBe("Jane");
    expect(result.success && result.data.address).toBe("12 King St W");
  });

  it.each(["ON", "QC", "YT"])("accepts province %s", (province) => {
    expect(parse({ province }).success).toBe(true);
  });

  it.each(["XX", "on", "Ontario"])("rejects province %s", (province) => {
    expect(parse({ province }).success).toBe(false);
  });

  it.each([
    ["M5H1A1", "M5H 1A1"],
    ["m5h 1a1", "M5H 1A1"],
    ["M5H-1A1", "M5H 1A1"],
  ])("normalizes postal code %s", (input, expected) => {
    const result = parse({ postal_code: input });
    expect(result.success && result.data.postal_code).toBe(expected);
  });

  it.each(["M5H 1A", "5MH 1A1", "M5H 1A11", "D5H 1A1", "12345"])(
    "rejects postal code %s",
    (postal_code) => {
      expect(parse({ postal_code }).success).toBe(false);
    },
  );

  it.each([
    "(416) 555-1234",
    "416-555-1234",
    "416 555 1234",
    "+1 (416) 555-1234",
    "1-416-555-1234",
    "14165551234",
  ])("normalizes phone %s to digits", (input) => {
    const result = parse({ phone: input });
    expect(result.success && result.data.phone).toBe("4165551234");
  });

  it.each([
    "41655512",
    "41655512345",
    "0165551234",
    "1165551234",
    "11165551234",
    "not a phone",
  ])("rejects phone %s", (phone) => {
    expect(parse({ phone }).success).toBe(false);
  });

  it.each(["jane@example.com", "jane.doe+clinic@sub.example.co.uk"])(
    "accepts email %s",
    (email) => {
      expect(parse({ email }).success).toBe(true);
    },
  );

  it.each(["jane", "jane@", "@example.com", "jane example.com"])(
    "rejects email %s",
    (email) => {
      expect(parse({ email }).success).toBe(false);
    },
  );

  it.each(["1985-04-17", "2000-02-29"])("accepts date of birth %s", (date_of_birth) => {
    expect(parse({ date_of_birth }).success).toBe(true);
  });

  it.each(["17-04-1985", "1985-4-17", "1985-02-30", "1899-12-31", "3000-01-01"])(
    "rejects date of birth %s",
    (date_of_birth) => {
      expect(parse({ date_of_birth }).success).toBe(false);
    },
  );

  it.each(["1234 567 890", "123-456-7890", "1234-567 890"])(
    "strips separators from health insurance number %s",
    (health_insurance_number) => {
      const result = parse({ health_insurance_number });
      expect(result.success && result.data.health_insurance_number).toBe("1234567890");
    },
  );

  it.each(["123456789", "12345678901", "12345abcde"])(
    "rejects health insurance number %s",
    (health_insurance_number) => {
      expect(parse({ health_insurance_number }).success).toBe(false);
    },
  );

  it("upper-cases the health insurance version", () => {
    const result = parse({ health_insurance_version: "ab" });
    expect(result.success && result.data.health_insurance_version).toBe("AB");
  });

  it.each(["ABC", "1A", "12"])(
    "rejects health insurance version %s",
    (health_insurance_version) => {
      expect(parse({ health_insurance_version }).success).toBe(false);
    },
  );

  it("rejects an hc_type that is not a province", () => {
    expect(parse({ hc_type: "CA" }).success).toBe(false);
  });

  it("rejects a preferred name longer than 100 characters", () => {
    expect(parse({ preferred_name: "a".repeat(101) }).success).toBe(false);
  });
});
