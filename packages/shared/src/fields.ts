import { z } from "zod";

/** Canadian provinces and territories, used for both `province` and `hc_type`. */
export const PROVINCES = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;

export type Province = (typeof PROVINCES)[number];

const requiredText = (max: number) => z.string().trim().min(1).max(max);

const postalCode = z
  .string()
  .trim()
  .regex(/^[ABCEGHJ-NPRSTVXY]\d[A-Z][ -]?\d[A-Z]\d$/i, "Not a Canadian postal code")
  .transform((value) => {
    const compact = value.replace(/[ -]/g, "").toUpperCase();
    return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  });

/** Accepts the ways people type a phone number; stores ten digits. */
const phone = z
  .string()
  // A leading 1 is the country code, not part of the number: +1 (416) 555-1234.
  .transform((value) => value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))
  .refine((digits) => /^[2-9]\d{9}$/.test(digits), "Not a 10-digit phone number");

const dateOfBirth = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Not a real date")
  .refine((value) => value >= "1900-01-01", "Too far in the past")
  .refine((value) => value <= new Date().toISOString().slice(0, 10), "Date is in the future");

/** The 13 fields a patient fills in on the tablet. */
export const patientDetailsSchema = z.object({
  first_name: requiredText(100),
  last_name: requiredText(100),
  preferred_name: requiredText(100),
  address: requiredText(200),
  city: requiredText(100),
  province: z.enum(PROVINCES),
  postal_code: postalCode,
  phone,
  email: z.string().trim().min(1).max(254).email("Not an email address"),
  date_of_birth: dateOfBirth,
  health_insurance_number: z
    .string()
    // Same separators people use in a phone number, so the form treats both alike.
    .transform((value) => value.replace(/[\s-]/g, ""))
    .refine((value) => /^\d{10}$/.test(value), "Not a 10-digit health insurance number"),
  health_insurance_version: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,2}$/, "One or two letters"),
  hc_type: z.enum(PROVINCES),
});

export type PatientDetails = z.infer<typeof patientDetailsSchema>;
