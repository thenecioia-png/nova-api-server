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

// ─── In-memory fallback (used when DATABASE_URL is not set) ───────────────
const DB_AVAILABLE = !!process.env.DATABASE_URL;

// The known hardcoded bot API key (always accepted as fallback)
const FALLBACK_BOT_KEY = "3a41524bae3a863463e1b8c80332175ac8fdfcee269720a3fb2d145e54854d88";

interface MemSession { id: number; apiKey: string; nombre: string; ultimaConexion: Date; activo: string; }
interface MemCommand { id: number; tipo: string; payload: any; estado: string; resultado: any; creadoEn: Date; ejecutadoEn: Date | null; }

const memSessions = new Map<string, MemSession>();
const memCommands = new Map<number, MemCommand>();
let memCommandCounter = 1;
let memBotLastSeen: Date | null = null;
let memBotName = "BOT-PC";

// Pre-seed the fallback session
memSessions.set(FALLBACK_BOT_KEY, { id: 1, apiKey: FALLBACK_BOT_KEY, nombre: "BOT-PC", ultimaConexion: new Date(0), activo: "si" });

// ─── Bot registration / auth ───────────────────────────────────────────────

router.post("/bot/register", async (req, res) => {
  try {
    const { nombre } = req.body as { nombre?: string };
    const apiKey = crypto.randomBytes(32).toString("hex");
    if (!DB_AVAILABLE) {
      const sess: MemSession = { id: memSessions.size + 1, apiKey, nombre: nombre ?? "BOT-PC", ultimaConexion: new Date(0), activo: "si" };
      memSessions.set(apiKey, sess);
      return res.json({ apiKey, mensaje: "Bot registrado (modo memoria)." });
    }
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

  if (!DB_AVAILABLE) {
    const sess = memSessions.get(apiKey);
    if (!sess) return res.status(401).json({ error: "API key inválida" });
    sess.ultimaConexion = new Date();
    memBotLastSeen = new Date();
    memBotName = sess.nombre;
    req.botSession = sess;
    return next();
  }

  try {
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
  } catch {
    // DB error — try memory fallback
    const sess = memSessions.get(apiKey);
    if (!sess) return res.status(401).json({ error: "API key inválida (DB error)" });
    sess.ultimaConexion = new Date();
    memBotLastSeen = new Date();
    req.botSession = sess;
    next();
  }
}

// ─── Bot polls for pending commands ───────────────────────────────────────

router.get("/bot/commands/pending", verifyBot, async (req, res) => {
  if (!DB_AVAILABLE) {
    const now = Date.now();
    // Expire stale commands (>3 min)
    for (const [id, cmd] of memCommands) {
      if (cmd.estado === "pendiente" && now - cmd.creadoEn.getTime() > 180_000) {
        cmd.estado = "error"; cmd.resultado = { error: "Expirado" };
      }
    }
    const pending = [...memCommands.values()].filter(c => c.estado === "pendiente").slice(0, 5);
    return res.json({ comandos: pending });
  }
  try {
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
        dbResultado = { ok: resultado.ok, ancho: resultado.ancho, alto: resultado.alto, screenshot_saved: true, guardadoEn: new Date().toISOString() };
      } catch (e) {
        req.log.warn({ e }, "No se pudo guardar el screenshot en disco");
      }
    }

    if (!DB_AVAILABLE) {
      const cmd = memCommands.get(id);
      if (cmd) { cmd.estado = estado; cmd.resultado = dbResultado; cmd.ejecutadoEn = new Date(); }
      return res.json({ ok: true });
    }

    await db
      .update(botCommandsTable)
      .set({ estado, resultado: dbResultado as any, ejecutadoEn: new Date() })
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
  if (!DB_AVAILABLE) {
    for (const cmd of memCommands.values()) {
      if (cmd.estado === "pendiente") { cmd.estado = "error"; cmd.resultado = { error: "Misión abandonada" }; }
    }
    return res.json({ ok: true, mensaje: "Todos los comandos pendientes cancelados." });
  }
  try {
    await db
      .update(botCommandsTable)
      .set({ estado: "error", resultado: { error: "Misión abandonada por el usuario" } as any })
      .where(eq(botCommandsTable.estado, "pendiente"));
    res.json({ ok: true, mensaje: "Todos los comandos pendientes cancelados." });
  } catch (err) {
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

    if (!DB_AVAILABLE) {
      const id = memCommandCounter++;
      const cmd: MemCommand = { id, tipo, payload: payload ?? {}, estado: "pendiente", resultado: null, creadoEn: new Date(), ejecutadoEn: null };
      memCommands.set(id, cmd);
      return res.status(201).json(cmd);
    }

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
  const rawIds = String(req.query.ids ?? "");
  const ids = rawIds.split(",").map(Number).filter(n => !isNaN(n) && n > 0);
  if (ids.length === 0) return res.json({ commands: [] });
  if (!DB_AVAILABLE) {
    return res.json({ commands: ids.map(id => memCommands.get(id)).filter(Boolean) });
  }
  try {
    const commands = await db.select().from(botCommandsTable).where(inArray(botCommandsTable.id, ids));
    res.json({ commands });
  } catch (err) {
    req.log.error({ err }, "Error obteniendo resultados de comandos");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Get all recent commands ───────────────────────────────────────────────

router.get("/bot/commands", async (req, res) => {
  if (!DB_AVAILABLE) {
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const cmds = [...memCommands.values()].slice(-limit);
    return res.json({ comandos: cmds });
  }
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
  if (!DB_AVAILABLE) {
    const lastSeen = memBotLastSeen?.getTime() ?? 0;
    const secsAgo = (Date.now() - lastSeen) / 1000;
    return res.json({
      online: secsAgo < 45,
      nombre: memBotName,
      ultimaConexion: memBotLastSeen,
      segsDesdeConexion: Math.round(secsAgo),
      hasScreenshot: fs.existsSync(SCREENSHOT_PATH),
    });
  }
  try {
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

router.get("/bot/config", async (req, res) => {
  if (!DB_AVAILABLE) {
    return res.json({ apiKey: FALLBACK_BOT_KEY, created: false });
  }
  try {
    const sessions = await db.select().from(botSessionsTable).orderBy(asc(botSessionsTable.id)).limit(1);
    if (sessions.length === 0) {
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
  if (!DB_AVAILABLE) {
    const apiKey = crypto.randomBytes(32).toString("hex");
    const sess: MemSession = { id: 1, apiKey, nombre: "BOT-PC", ultimaConexion: new Date(0), activo: "si" };
    memSessions.clear();
    memSessions.set(apiKey, sess);
    return res.json({ apiKey });
  }
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

  if (!DB_AVAILABLE) {
    if (!memSessions.has(apiKey)) return res.status(401).json({ error: "API key inválida" });
    apiKeyCache.set(apiKey, now + API_KEY_TTL_MS);
    return next();
  }

  try {
    const [session] = await db
      .select()
      .from(botSessionsTable)
      .where(eq(botSessionsTable.apiKey, apiKey))
      .limit(1);
    if (!session) return res.status(401).json({ error: "API key inválida" });
    apiKeyCache.set(apiKey, now + API_KEY_TTL_MS);
    next();
  } catch {
    // DB down — try memory
    if (!memSessions.has(apiKey)) return res.status(401).json({ error: "API key inválida" });
    apiKeyCache.set(apiKey, now + API_KEY_TTL_MS);
    next();
  }
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
    if (!tipo || !error) return res.json({ ok: true });

    if (!DB_AVAILABLE) return res.json({ ok: true }); // skip in memory mode

    const clave   = `error_bot_${tipo}_${Date.now()}`;
    const valor   = `[${ts ?? new Date().toISOString()}] Comando '${tipo}' falló: ${String(error).slice(0, 400)}`;

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
    res.json({ ok: true });
  }
});

// ─── System health check ───────────────────────────────────────────────────
// N.O.V.A. (and admins) can call this to see the status of all components.
router.get("/health", async (req, res) => {
  const checks: Record<string, string> = {};

  // 1. Database
  if (!DB_AVAILABLE) {
    checks.database = "no_db_url (modo_memoria)";
  } else {
    try {
      await db.select().from(botSessionsTable).limit(1);
      checks.database = "ok";
    } catch (e: any) {
      checks.database = `error: ${e.message}`;
    }
  }

  // 2. Bot status
  if (!DB_AVAILABLE) {
    const ageMs = memBotLastSeen ? Date.now() - memBotLastSeen.getTime() : Infinity;
    checks.bot = ageMs < 60_000 ? "online" : `offline_${Math.round(ageMs / 1000)}s_ago`;
    checks.bot_name = memBotName;
  } else {
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

  // 4. OpenAI
  checks.openai_key = "via_replit_integrations";

  // 5. Pending commands
  if (!DB_AVAILABLE) {
    checks.pending_commands = String([...memCommands.values()].filter(c => c.estado === "pendiente").length);
  } else {
    try {
      const pending = await db.select().from(botCommandsTable).where(eq(botCommandsTable.estado, "pendiente"));
      checks.pending_commands = String(pending.length);
    } catch {
      checks.pending_commands = "error";
    }
  }

  const allOk = Object.values(checks).every(v => !v.startsWith("error") && v !== "missing");
  res.status(allOk ? 200 : 207).json({ status: allOk ? "healthy" : "degraded", checks, ts: new Date().toISOString() });
});

export default router;
