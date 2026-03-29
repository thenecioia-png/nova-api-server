import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botCommandsTable = pgTable("bot_commands", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),
  payload: jsonb("payload").notNull().default({}),
  estado: text("estado").notNull().default("pendiente"), // pendiente | ejecutando | completado | error
  resultado: jsonb("resultado"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  ejecutadoEn: timestamp("ejecutado_en"),
});

export const insertBotCommandSchema = createInsertSchema(botCommandsTable).omit({ id: true, creadoEn: true, ejecutadoEn: true, resultado: true });
export type InsertBotCommand = z.infer<typeof insertBotCommandSchema>;
export type BotCommand = typeof botCommandsTable.$inferSelect;

export const botSessionsTable = pgTable("bot_sessions", {
  id: serial("id").primaryKey(),
  apiKey: text("api_key").notNull().unique(),
  nombre: text("nombre").notNull().default("BOT-PC"),
  ultimaConexion: timestamp("ultima_conexion").notNull().defaultNow(),
  activo: text("activo").notNull().default("si"),
});

export type BotSession = typeof botSessionsTable.$inferSelect;
