import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { botCommandsTable, botSessionsTable, memoriaTable } from "@workspace/db";
import { eq, asc, inArray, desc, sql as drizzleSql } from "drizzle-orm";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

// Where we save the latest screenshot PNG on disk
const SCREENSHOT_PATH = path.join("/tmp", "nova_last_screenshot.png");

// ─── Bot registration / auth ───────────────────────────────────────────────

router.post("/bot/register", async (req, res) => {
  try {
    const { nombre } = req.body as { nombre?: string };
    const apiKey = crypto.randomBytes(32).toString("hex");
    const [session] = await db
      .insert(botSessionsTable)
      .values({ apiKey, nombre: nombre ?? "BOT-PC" })
      .returning();
    res.json({ apiKey: session.apiKey, mensaje: "Bot registrado." });
  } catch (err) {
    req.log.error({ err }, "Error registrando bot");
    res.status(500).json({ error: "Error registrando bot" });
  }
});

// ─── Auth middleware ───────────────────────────────────────────────────────

async function verifyBot(req: any, res: any, next: any) {
  const apiKey = req.headers["x-bot-api-key"] as string;
  if (!apiKey) return res.status(401).json({ error: "API key requerida" });
  const [session] = await db
    .select()
    .from(botSessionsTable)
    .where(eq(botSessionsTable.apiKey, apiKey))
    .limit(1);
  if (!session) return res.status(401).json({ error: "API key inválida" });
  await db
    .update(botSessionsTable)
    .set({ ultimaConexion: new Date(), activo: "si" })
    .where(eq(botSessionsTable.id, session.id));
  req.botSession = session;
  next();
}

// ─── Bot polls for pending commands ───────────────────────────────────────

router.get("/bot/commands/pending", verifyBot, async (req, res) => {
  try {
    // Clean up stale "pendiente" commands older than 3 minutes — prevents
    // the bot from re-executing leftover commands from a previous session.
    await db.execute(
      drizzleSql`UPDATE bot_commands SET estado = 'error', resultado = '{"error":"Expirado - sesion anterior"}'::jsonb WHERE estado = 'pendiente' AND creado_en < NOW() - INTERVAL '3 minutes'`
    );

    const commands = await db
      .select()
      .from(botCommandsTable)
      .where(eq(botCommandsTable.estado, "pendiente"))
      .orderBy(asc(botCommandsTable.creadoEn))
      .limit(5);
    res.json({ comandos: commands });
  } catch (err) {
    req.log.error({ err }, "Error obteniendo comandos");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Bot reports result ────────────────────────────────────────────────────
// When the bot finishes a command it POSTs the result here.
// If it's a screenshot result, we extract the base64, save it as PNG on disk,
// and strip the heavy base64 blob from the DB row so the DB stays lean.

router.post("/bot/commands/:id/resultado", verifyBot, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { estado, resultado } = req.body as {
      estado: string;
      resultado: Record<string, unknown>;
    };

    // If this is a screenshot result, save the PNG to disk
    let dbResultado = resultado;
    if (resultado?.imagen_b64 && typeof resultado.imagen_b64 === "string") {
      try {
        const buf = Buffer.from(resultado.imagen_b64, "base64");
        fs.writeFileSync(SCREENSHOT_PATH, buf);
        // Store only metadata in DB — not the huge base64
        dbResultado = {
          ok: resultado.ok,
          ancho: resultado.ancho,
          alto: resultado.alto,
          screenshot_saved: true,
          guardadoEn: new Date().toISOString(),
        };
      } catch (e) {
        req.log.warn({ e }, "No se pudo guardar el screenshot en disco");
      }
    }

    await db
      .update(botCommandsTable)
      .set({
        estado,
        resultado: dbResultado as any,
        ejecutadoEn: new Date(),
      })
      .where(eq(botCommandsTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error actualizando resultado");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Serve the last screenshot PNG ────────────────────────────────────────
// The frontend fetches /api/bot/last-screenshot?ts=<timestamp> to bust cache.

router.get("/bot/last-screenshot", (req, res) => {
  if (!fs.existsSync(SCREENSHOT_PATH)) {
    return res.status(404).json({ error: "No hay screenshot todavía" });
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(SCREENSHOT_PATH);
});

// ─── Cancel all pending commands (Abandonar misión) ───────────────────────

router.delete("/bot/commands/pendientes", async (_req, res) => {
  try {
    await db
      .update(botCommandsTable)
      .set({ estado: "error", resultado: { error: "Misión abandonada por el usuario" } as any })
      .where(eq(botCommandsTable.estado, "pendiente"));
    res.json({ ok: true, mensaje: "Todos los comandos pendientes cancelados." });
  } catch (err) {
    req.log?.error?.({ err }, "Error cancelando comandos");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Web creates a command for the bot ────────────────────────────────────

router.post("/bot/commands", async (req, res) => {
  try {
    const { tipo, payload } = req.body as {
      tipo: string;
      payload: Record<string, unknown>;
    };
    if (!tipo) return res.status(400).json({ error: "Tipo requerido" });
    const [cmd] = await db
      .insert(botCommandsTable)
      .values({ tipo, payload: payload ?? {} })
      .returning();
    res.status(201).json(cmd);
  } catch (err) {
    req.log.error({ err }, "Error creando comando");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Get results for specific command IDs ─────────────────────────────────

router.get("/bot/commands/results", async (req, res) => {
  try {
    const rawIds = String(req.query.ids ?? "");
    const ids = rawIds.split(",").map(Number).filter(n => !isNaN(n) && n > 0);
    if (ids.length === 0) return res.json({ commands: [] });
    const commands = await db.select().from(botCommandsTable).where(inArray(botCommandsTable.id, ids));
    res.json({ commands });
  } catch (err) {
    req.log.error({ err }, "Error obteniendo resultados de comandos");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Get all recent commands ───────────────────────────────────────────────

router.get("/bot/commands", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const commands = await db
      .select()
      .from(botCommandsTable)
      .orderBy(desc(botCommandsTable.creadoEn))
      .limit(limit);
    res.json({ comandos: commands.reverse() });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Bot online status ────────────────────────────────────────────────────

router.get("/bot/status", async (req, res) => {
  try {
    // Use the MOST RECENTLY active session (desc by ultimaConexion)
    const sessions = await db
      .select()
      .from(botSessionsTable)
      .orderBy(desc(botSessionsTable.ultimaConexion))
      .limit(1);

    if (!sessions.length) return res.json({ online: false, ultimaConexion: null });

    const session = sessions[0];
    const lastSeen = session.ultimaConexion ? new Date(session.ultimaConexion).getTime() : 0;
    const secsAgo = (Date.now() - lastSeen) / 1000;
    const hasScreenshot = fs.existsSync(SCREENSHOT_PATH);

    // 45s threshold: bot polls every 2s (commands) + heartbeat every 20s
    // 45s gives plenty of margin for slow networks / Replit hibernation
    res.json({
      online: secsAgo < 45,
      nombre: session.nombre,
      ultimaConexion: session.ultimaConexion,
      segsDesdeConexion: Math.round(secsAgo),
      hasScreenshot,
    });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Get current config (key + server URL) ────────────────────────────────
// The bot page calls this on load so the user always sees the existing key.

router.get("/bot/config", async (req, res) => {
  try {
    const sessions = await db.select().from(botSessionsTable).orderBy(asc(botSessionsTable.id)).limit(1);
    if (sessions.length === 0) {
      // Auto-create a session; use epoch 0 for ultimaConexion so bot shows OFFLINE until real connection
      const apiKey = crypto.randomBytes(32).toString("hex");
      const [s] = await db.insert(botSessionsTable).values({ apiKey, nombre: "BOT-PC", ultimaConexion: new Date(0) }).returning();
      return res.json({ apiKey: s.apiKey, created: true });
    }
    res.json({ apiKey: sessions[0].apiKey, created: false });
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo configuración" });
  }
});

// ─── Generate / regenerate API key ────────────────────────────────────────

router.post("/bot/regenerar-key", async (req, res) => {
  try {
    const sessions = await db.select().from(botSessionsTable).limit(1);
    const apiKey = crypto.randomBytes(32).toString("hex");

    if (sessions.length === 0) {
      const [session] = await db
        .insert(botSessionsTable)
        .values({ apiKey, nombre: "BOT-PC" })
        .returning();
      return res.json({ apiKey: session.apiKey });
    }

    await db
      .update(botSessionsTable)
      .set({ apiKey })
      .where(eq(botSessionsTable.id, sessions[0].id));

    res.json({ apiKey });
  } catch (err) {
    req.log.error({ err }, "Error regenerando key");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Live MJPEG streaming ─────────────────────────────────────────────────
// Bot pushes compressed JPEG frames → server stores in memory → frontend streams

let latestFrameJpeg: Buffer | null = null;
const frameListeners = new Set<(frame: Buffer) => void>();

// In-memory cache: apiKey → expiry timestamp (avoid DB hit on every frame at 8 FPS)
const apiKeyCache = new Map<string, number>();
const API_KEY_TTL_MS = 30_000; // cache valid for 30 seconds

async function verifyBotFast(req: any, res: any, next: any) {
  const apiKey = req.headers["x-bot-api-key"] as string;
  if (!apiKey) return res.status(401).json({ error: "API key requerida" });
  const now = Date.now();
  const cached = apiKeyCache.get(apiKey);
  if (cached && cached > now) return next();
  // Not in cache — validate against DB
  const [session] = await db
    .select()
    .from(botSessionsTable)
    .where(eq(botSessionsTable.apiKey, apiKey))
    .limit(1);
  if (!session) return res.status(401).json({ error: "API key inválida" });
  apiKeyCache.set(apiKey, now + API_KEY_TTL_MS);
  next();
}

// Bot pushes a JPEG frame (base64) — called ~5-10x per second from bot background thread
router.post("/bot/push-frame", verifyBotFast, (req, res) => {
  const b64 = (req.body as any)?.frame_b64;
  if (!b64 || typeof b64 !== "string") return res.status(400).json({ error: "No frame" });
  try {
    latestFrameJpeg = Buffer.from(b64, "base64");
    frameListeners.forEach(fn => { try { fn(latestFrameJpeg!); } catch { /* client disconnected */ } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error procesando frame" });
  }
});

// SSE live-screen stream — sends each frame as base64 JSON event (works through proxy)
// Browser JavaScript receives events and sets img.src = "data:image/jpeg;base64,..."
router.get("/bot/live-screen-sse", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send latest frame immediately if available
  if (latestFrameJpeg) {
    res.write(`data: ${JSON.stringify({ ts: Date.now(), b64: latestFrameJpeg.toString("base64") })}\n\n`);
  }

  const sendFrame = (frame: Buffer) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify({ ts: Date.now(), b64: frame.toString("base64") })}\n\n`);
  };

  // Heartbeat every 3s to keep proxy from closing idle connection
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return clearInterval(heartbeat);
    res.write(": heartbeat\n\n");
  }, 3000);

  frameListeners.add(sendFrame);
  req.on("close", () => { frameListeners.delete(sendFrame); clearInterval(heartbeat); });
  req.on("error", () => { frameListeners.delete(sendFrame); clearInterval(heartbeat); });
});

// Keep MJPEG endpoint for direct browser support where proxy allows it
router.get("/bot/live-screen", (req, res) => {
  const BOUNDARY = "novascreenboundary";
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const writeFrame = (frame: Buffer) => {
    if (res.writableEnded) return;
    res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    res.write(frame);
    res.write("\r\n");
  };
  if (latestFrameJpeg) writeFrame(latestFrameJpeg);
  frameListeners.add(writeFrame);
  req.on("close", () => frameListeners.delete(writeFrame));
  req.on("error", () => frameListeners.delete(writeFrame));
});

// Return the latest JPEG as a single image (for analysis / snapshot)
router.get("/bot/last-frame", (req, res) => {
  if (!latestFrameJpeg) return res.status(404).json({ error: "Sin frame disponible — inicia la Visión en Vivo primero" });
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(latestFrameJpeg);
});

// ─── Heartbeat — bot pings every 20s so N.O.V.A. knows it's alive ───────────
// More reliable than relying solely on command-poll updates.
router.post("/bot/heartbeat", verifyBot, async (req, res) => {
  // verifyBot already updates ultimaConexion and activo="si" — nothing more needed.
  res.json({ ok: true, ts: Date.now() });
});

// ─── Error log — bot reports failed commands so N.O.V.A. can learn ─────────
// Saves to memoria table (categoria="error_log") so N.O.V.A. sees patterns.
router.post("/bot/error-log", verifyBot, async (req, res) => {
  try {
    const { tipo, error, ts } = req.body as { tipo?: string; error?: string; ts?: string };
    if (!tipo || !error) return res.json({ ok: true }); // skip malformed

    const clave   = `error_bot_${tipo}_${Date.now()}`;
    const valor   = `[${ts ?? new Date().toISOString()}] Comando '${tipo}' falló: ${String(error).slice(0, 400)}`;

    // Keep last 20 error logs — delete oldest if over limit
    const existing = await db
      .select({ id: memoriaTable.id })
      .from(memoriaTable)
      .where(eq(memoriaTable.categoria, "error_log"))
      .orderBy(asc(memoriaTable.creadaEn));

    if (existing.length >= 20) {
      const toDelete = existing.slice(0, existing.length - 19).map(r => r.id);
      if (toDelete.length > 0) await db.delete(memoriaTable).where(inArray(memoriaTable.id, toDelete));
    }

    await db.insert(memoriaTable).values({ clave, valor, categoria: "error_log" });
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // never crash on error logs
  }
});

// ─── System health check ───────────────────────────────────────────────────
// N.O.V.A. (and admins) can call this to see the status of all components.
router.get("/health", async (req, res) => {
  const checks: Record<string, string> = {};

  // 1. Database
  try {
    await db.select().from(botSessionsTable).limit(1);
    checks.database = "ok";
  } catch (e: any) {
    checks.database = `error: ${e.message}`;
  }

  // 2. Bot status — is any session active in last 60s?
  try {
    const sessions = await db.select().from(botSessionsTable).orderBy(desc(botSessionsTable.ultimaConexion)).limit(1);
    if (sessions.length === 0) {
      checks.bot = "sin_sesion";
    } else {
      const last = sessions[0].ultimaConexion;
      const ageMs = last ? Date.now() - new Date(last).getTime() : Infinity;
      checks.bot      = ageMs < 60_000 ? "online" : `offline_${Math.round(ageMs / 1000)}s_ago`;
      checks.bot_name = sessions[0].nombre ?? "desconocido";
    }
  } catch (e: any) {
    checks.bot = `error: ${e.message}`;
  }

  // 3. Screenshot freshness
  try {
    if (fs.existsSync(SCREENSHOT_PATH)) {
      const stat  = fs.statSync(SCREENSHOT_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      checks.screenshot = ageMs < 120_000 ? `fresh_${Math.round(ageMs / 1000)}s_ago` : `stale_${Math.round(ageMs / 1000)}s_ago`;
    } else {
      checks.screenshot = "no_screenshot";
    }
  } catch {
    checks.screenshot = "error";
  }

  // 4. OpenAI — via Replit AI integrations proxy (no OPENAI_API_KEY env var needed)
  checks.openai_key = "via_replit_integrations";

  // 5. Pending bot commands
  try {
    const pending = await db.select().from(botCommandsTable).where(eq(botCommandsTable.estado, "pendiente"));
    checks.pending_commands = String(pending.length);
  } catch {
    checks.pending_commands = "error";
  }

  const allOk = Object.values(checks).every(v => !v.startsWith("error") && v !== "missing");
  res.status(allOk ? 200 : 207).json({ status: allOk ? "healthy" : "degraded", checks, ts: new Date().toISOString() });
});

export default router;
