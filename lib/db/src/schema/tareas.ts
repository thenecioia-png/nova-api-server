import { pgTable, text, serial, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tareasTable = pgTable("tareas_programadas", {
  id: serial("id").primaryKey(),
  descripcion: text("descripcion").notNull(),
  hora: text("hora").notNull(),
  diasSemana: text("dias_semana").array(),
  accion: text("accion").notNull(),
  payload: jsonb("payload").notNull().default({}),
  activa: boolean("activa").notNull().default(true),
  ultimaEjecucion: timestamp("ultima_ejecucion"),
  creadaEn: timestamp("creada_en").notNull().defaultNow(),
});

export const insertTareaSchema = createInsertSchema(tareasTable).omit({ id: true, creadaEn: true, ultimaEjecucion: true });
export type InsertTarea = z.infer<typeof insertTareaSchema>;
export type Tarea = typeof tareasTable.$inferSelect;
