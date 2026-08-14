import { describe, expect, it } from "vitest";
import { query } from "../src/db.js";

async function insertClinic(email = "front.desk@bloormedical.ca"): Promise<string> {
  const [clinic] = await query<{ id: string }>(
    `INSERT INTO clinics (name, email, auth_user_id, emr)
     VALUES ($1, $2, $3, 'oscar') RETURNING id`,
    ["Bloor Medical", email, `auth-${email}`],
  );
  return clinic!.id;
}

describe("migrations", () => {
  it("creates the three tables", async () => {
    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      "clinics",
      "devices",
      "pgmigrations",
      "submissions",
    ]);
  });

  it("creates the indexes the design calls for", async () => {
    const indexes = await query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = indexes.map((i) => i.indexname);
    expect(names).toContain("clinics_lower_email_key");
    expect(names).toContain("devices_clinic_id_idx");
    expect(names).toContain("submissions_clinic_id_status_idx");
    expect(names).toContain("submissions_status_submitted_at_idx");
  });

  it("rejects a second clinic on the same email, whatever the casing", async () => {
    await insertClinic("duplicate@clinic.ca");
    await expect(insertClinic("DUPLICATE@clinic.ca")).rejects.toThrow(/duplicate key/);
  });

  it("rejects a status outside PENDING, DONE, and DELETED", async () => {
    const clinicId = await insertClinic("status@clinic.ca");
    await expect(
      query(`INSERT INTO submissions (clinic_id, status) VALUES ($1, 'ARCHIVED')`, [
        clinicId,
      ]),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("rejects a device kind outside desktop and tablet", async () => {
    const clinicId = await insertClinic("kind@clinic.ca");
    await expect(
      query(`INSERT INTO devices (clinic_id, kind) VALUES ($1, 'printer')`, [clinicId]),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("defaults a new submission to PENDING with empty details", async () => {
    const clinicId = await insertClinic("defaults@clinic.ca");
    const [submission] = await query<{ status: string; details: object; entered_at: null }>(
      `INSERT INTO submissions (clinic_id) VALUES ($1)
       RETURNING status, details, entered_at`,
      [clinicId],
    );
    expect(submission).toMatchObject({ status: "PENDING", details: {}, entered_at: null });
  });

  it("deletes a clinic's devices and submissions with it", async () => {
    const clinicId = await insertClinic("cascade@clinic.ca");
    await query(`INSERT INTO devices (clinic_id, kind) VALUES ($1, 'tablet')`, [clinicId]);
    await query(`INSERT INTO submissions (clinic_id) VALUES ($1)`, [clinicId]);

    await query(`DELETE FROM clinics WHERE id = $1`, [clinicId]);

    const devices = await query(`SELECT 1 FROM devices WHERE clinic_id = $1`, [clinicId]);
    const submissions = await query(`SELECT 1 FROM submissions WHERE clinic_id = $1`, [
      clinicId,
    ]);
    expect(devices).toHaveLength(0);
    expect(submissions).toHaveLength(0);
  });
});
