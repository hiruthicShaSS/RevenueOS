import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { HttpError, id } from "../util.js";

/**
 * Lightweight sign-in: a teammate identifies themselves with their work email and
 * designation. Everyone writes into the same shared customer memory, so whatever one
 * person logs is available to the Deal Negotiator for everyone else.
 */
export interface User {
  id: string;
  name: string;
  title: string;
  email: string;
}

export const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid work email."),
  designation: z.string().trim().min(2, "Enter your designation.").max(80),
  name: z.string().trim().max(80).optional(),
});

/** "priya.nair@company.com" -> "Priya Nair" */
export function nameFromEmail(email: string) {
  const local = email.split("@")[0].replace(/\d+/g, " ");
  const parts = local.split(/[._\-+\s]+/).filter(Boolean);
  if (!parts.length) return email;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}

export async function login(input: z.infer<typeof LoginBody>): Promise<{ token: string; user: User }> {
  const db = await getDb();
  const [existing] = await db.query<User>(`SELECT id, name, title, email FROM reps WHERE lower(email)=$1`, [input.email]);
  let user: User;
  if (existing) {
    const name = input.name || existing.name;
    await db.query(`UPDATE reps SET title=$2, name=$3 WHERE id=$1`, [existing.id, input.designation, name]);
    user = { ...existing, title: input.designation, name };
  } else {
    user = { id: id("rep"), name: input.name || nameFromEmail(input.email), title: input.designation, email: input.email };
    await db.query(`INSERT INTO reps (id, name, title, email) VALUES ($1,$2,$3,$4)`, [user.id, user.name, user.title, user.email]);
  }
  const token = randomBytes(24).toString("hex");
  await db.query(`INSERT INTO sessions (token, rep_id) VALUES ($1,$2)`, [token, user.id]);
  return { token, user };
}

export async function userFromToken(token: string | undefined): Promise<User> {
  if (!token) throw new HttpError(401, "Sign in to continue.");
  const db = await getDb();
  const [u] = await db.query<User>(
    `UPDATE sessions s SET last_seen=now() FROM reps r WHERE s.token=$1 AND r.id=s.rep_id RETURNING r.id, r.name, r.title, r.email`,
    [token]
  );
  if (!u) throw new HttpError(401, "Your session has ended. Sign in again.");
  return u;
}

export async function logout(token: string | undefined) {
  if (token) await (await getDb()).query(`DELETE FROM sessions WHERE token=$1`, [token]);
}
