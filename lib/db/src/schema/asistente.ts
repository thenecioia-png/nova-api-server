import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reglasTable = pgTable("reglas", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion").notNull(),
  activa: boolean("activa").notNull().default(true),
  creadaEn: timestamp("creada_en").notNull().defaultNow(),
});

export const insertReglaSchema = createInsertSchema(reglasTable).omit({ id: true, creadaEn: true });
export type InsertRegla = z.infer<typeof insertReglaSchema>;
export type Regla = typeof reglasTable.$inferSelect;

export const memoriaTable = pgTable("memoria", {
  id: serial("id").primaryKey(),
  clave: text("clave").notNull(),
  valor: text("valor").notNull(),
  categoria: text("categoria").notNull().default("general"),
  creadaEn: timestamp("creada_en").notNull().defaultNow(),
});

export const insertMemoriaSchema = createInsertSchema(memoriaTable).omit({ id: true, creadaEn: true });
export type InsertMemoria = z.infer<typeof insertMemoriaSchema>;
export type Memoria = typeof memoriaTable.$inferSelect;

export const historialTable = pgTable("historial", {
  id: serial("id").primaryKey(),
  sesionId: text("sesion_id"),
  rol: text("rol").notNull(),
  contenido: text("contenido").notNull(),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

export const insertHistorialSchema = createInsertSchema(historialTable).omit({ id: true, creadoEn: true });
export type InsertHistorial = z.infer<typeof insertHistorialSchema>;
export type Historial = typeof historialTable.$inferSelect;
