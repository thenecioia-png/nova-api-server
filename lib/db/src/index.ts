import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (process.env.DATABASE_URL) {
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  _db = drizzle(_pool, { schema });
} else {
  console.warn("[db] WARNING: DATABASE_URL no configurada. DB no disponible.");
}

export const pool = _pool as pg.Pool;
export const db = (_db ?? new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return () => { throw new Error(`[db] Sin DATABASE_URL. Op '${String(prop)}' no disponible.`); };
  },
}));

export * from "./schema";
