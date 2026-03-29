import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  reglasTable, memoriaTable, historialTable,
  insertReglaSchema, insertMemoriaSchema, insertHistorialSchema,
  botCommandsTable, tareasTable
} from "@workspace/db";
import { eq, and, or, isNull, desc, sql as drizzleSql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const router: IRouter = Router();
const WORKSPACE = "/home/runner/workspace";

// ── Reglas ────────────────────────────────────────────────────────────────────
router.get("/asistente/reglas", async (req, res) => {
  try {
    const reglas = await db.select().from(reglasTable).orderBy(reglasTable.creadaEn);
    res.json({ reglas });
  } catch (err) {
    req.log.error({ err }, "Error obteniendo reglas");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.post("/asistente/reglas", async (req, res) => {
  try {
    const data = insertReglaSchema.parse(req.body);
    const [regla] = await db.insert(reglasTable).values(data).returning();
    res.status(201).json(regla);
  } catch (err) {
    req.log.error({ err }, "Error creando regla");
    res.status(400).json({ error: "Datos inválidos" });
  }
});

router.delete("/asistente/reglas/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(reglasTable).where(eq(reglasTable.id, id));
    res.json({ mensaje: "Regla eliminada" });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

router.patch("/asistente/reglas/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { activa } = req.body;
    const [updated] = await db.update(reglasTable).set({ activa }).where(eq(reglasTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Error actualizando regla" });
  }
});

// ── Memoria ───────────────────────────────────────────────────────────────────
router.get("/asistente/memoria", async (req, res) => {
  try {
    const memoria = await db.select().from(memoriaTable).orderBy(memoriaTable.creadaEn);
    res.json({ memoria });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

router.post("/asistente/memoria", async (req, res) => {
  try {
    const data = insertMemoriaSchema.parse(req.body);
    const [entrada] = await db.insert(memoriaTable).values(data).returning();
    res.status(201).json(entrada);
  } catch (err) {
    res.status(400).json({ error: "Datos inválidos" });
  }
});

router.delete("/asistente/memoria/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(memoriaTable).where(eq(memoriaTable.id, id));
    res.json({ mensaje: "Entrada eliminada" });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// ── Historial ─────────────────────────────────────────────────────────────────

// List all chat sessions with metadata (first message + last timestamp + count)
router.get("/asistente/historial/sesiones", async (req, res) => {
  try {
    // Get all distinct sesion_ids along with first/last message metadata
    const rows = await db.execute(drizzleSql`
      SELECT
        sesion_id,
        MIN(creado_en) AS primera_vez,
        MAX(creado_en) AS ultima_vez,
        COUNT(*) AS total,
        (SELECT contenido FROM historial h2
         WHERE h2.sesion_id = h.sesion_id AND h2.rol = 'usuario'
         ORDER BY h2.creado_en ASC LIMIT 1) AS primer_mensaje
      FROM historial h
      WHERE sesion_id IS NOT NULL
      GROUP BY sesion_id
      ORDER BY MAX(creado_en) DESC
      LIMIT 50
    `);
    res.json({ sesiones: rows.rows });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// Get historial — optionally filtered by sesionId
router.get("/asistente/historial", async (req, res) => {
  try {
    const sesionId = req.query.sesionId as string | undefined;
    const historial = sesionId
      ? await db.select().from(historialTable)
          .where(eq(historialTable.sesionId, sesionId))
          .orderBy(historialTable.creadoEn)
      : await db.select().from(historialTable)
          .where(isNull(historialTable.sesionId))
          .orderBy(historialTable.creadoEn);
    res.json({ historial });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

router.post("/asistente/historial", async (req, res) => {
  try {
    const data = insertHistorialSchema.parse(req.body);
    const [entrada] = await db.insert(historialTable).values(data).returning();
    res.status(201).json(entrada);
  } catch (err) {
    res.status(400).json({ error: "Datos inválidos" });
  }
});

// Delete chat history — by sesionId or entire historial if sesionId not provided
router.delete("/asistente/historial", async (req, res) => {
  try {
    const sesionId = req.query.sesionId as string | undefined;
    if (sesionId) {
      await db.delete(historialTable).where(eq(historialTable.sesionId, sesionId));
      res.json({ ok: true, mensaje: "Sesión eliminada." });
    } else {
      await db.delete(historialTable);
      res.json({ ok: true, mensaje: "Historial eliminado completamente." });
    }
  } catch (err) {
    res.status(500).json({ error: "Error eliminando historial" });
  }
});

// ── Self-modify endpoint ──────────────────────────────────────────────────────
router.post("/nova/self-modify", async (req, res) => {
  try {
    const { ruta, contenido, reiniciar } = req.body as {
      ruta: string;
      contenido: string;
      reiniciar?: boolean;
    };
    const fullPath = path.resolve(WORKSPACE, ruta);
    if (!fullPath.startsWith(WORKSPACE)) return res.status(403).json({ error: "Ruta no permitida" });
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contenido, "utf-8");
    if (reiniciar) {
      setTimeout(() => execAsync("kill -SIGUSR2 1").catch(() => {}), 2000);
    }
    res.json({ ok: true, ruta: fullPath, mensaje: "Archivo modificado exitosamente. Los cambios serán aplicados automáticamente." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tool helpers ──────────────────────────────────────────────────────────────
async function buscarWeb(query: string): Promise<string> {
  // Try DuckDuckGo Instant Answers. If empty, retry with simplified query.
  async function ddgSearch(q: string): Promise<string> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&t=nova_ai`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NOVA-AI/2.0)" },
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json() as any;
    const parts: string[] = [];
    if (d.Heading) parts.push(`📌 ${d.Heading}`);
    if (d.AbstractText) parts.push(d.AbstractText);
    if (d.AbstractURL) parts.push(`Fuente: ${d.AbstractURL}`);
    if (d.Answer) parts.push(`Respuesta directa: ${d.Answer}`);
    if (d.Definition) parts.push(`Definición: ${d.Definition}`);
    const topics = ((d.RelatedTopics ?? []) as any[]).filter((t: any) => t?.Text).slice(0, 6);
    if (topics.length) { parts.push("\nRelacionado:"); topics.forEach((t: any) => parts.push(`• ${String(t.Text).slice(0, 300)}`)); }
    const results = ((d.Results ?? []) as any[]).slice(0, 4);
    if (results.length) { parts.push("\nResultados:"); results.forEach((r: any) => parts.push(`• ${r.Title}: ${r.FirstURL}`)); }
    return parts.join("\n");
  }

  try {
    let text = await ddgSearch(query);

    // If first attempt returned nothing, try simplified version of the query
    if (!text.trim()) {
      const simplified = query.replace(/[¿?¡!]/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 5).join(" ");
      if (simplified !== query) text = await ddgSearch(simplified);
    }

    return text.trim()
      || `No encontré resultados específicos en internet para: "${query}". Respondo con mi conocimiento interno.`;
  } catch {
    return "No se pudo completar la búsqueda en este momento. Respondo con mi conocimiento interno.";
  }
}

async function verificarIP(): Promise<string> {
  try {
    // Fetch from two different providers in parallel to get more data points
    const [ipRes, proxyRes] = await Promise.allSettled([
      fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(8000) }),
      fetch("https://ipwho.is/", { signal: AbortSignal.timeout(8000) }),
    ]);

    let infoPrincipal: any = {};
    if (ipRes.status === "fulfilled" && ipRes.value.ok) {
      infoPrincipal = await ipRes.value.json();
    }

    // Use second source only for VPN proxy/ASN detection
    let proxyData: any = {};
    if (proxyRes.status === "fulfilled" && proxyRes.value.ok) {
      proxyData = await proxyRes.value.json();
    }

    const lines: string[] = [];
    if (infoPrincipal.ip) lines.push(`🌐 **IP Pública:** \`${infoPrincipal.ip}\``);
    if (infoPrincipal.org) lines.push(`🏢 **Proveedor (ISP):** ${infoPrincipal.org}`);
    if (infoPrincipal.city) lines.push(`📍 **Ubicación:** ${infoPrincipal.city}, ${infoPrincipal.region}, ${infoPrincipal.country_name}`);
    if (infoPrincipal.timezone) lines.push(`🕐 **Zona horaria:** ${infoPrincipal.timezone}`);
    if (infoPrincipal.latitude) lines.push(`🗺️ **Coordenadas:** ${infoPrincipal.latitude}, ${infoPrincipal.longitude}`);

    // Detect VPN/proxy — use both sources for better accuracy
    const orgStr = String(infoPrincipal.org ?? "").toLowerCase();
    const asnStr = String(proxyData.connection?.asn ?? proxyData.asn ?? "").toLowerCase();
    const vpnKeywords = ["vpn", "proxy", "tor", "hosting", "datacenter", "cloud", "digitalocean", "linode", "vultr", "aws", "ovh", "hetzner", "cloudflare", "fastly"];
    const isVpnLikely = vpnKeywords.some(kw => orgStr.includes(kw)) || vpnKeywords.some(kw => asnStr.includes(kw));
    // ipwho.is provides explicit proxy/vpn field
    const explicitProxy = proxyData.type === "proxy" || proxyData.type === "vpn" || proxyData.security?.is_proxy === true;
    lines.push((isVpnLikely || explicitProxy)
      ? "🔒 **VPN/Proxy detectado:** Es probable que estés usando VPN, proxy o servidor cloud."
      : "📡 **VPN:** No detectado — conexión directa de ISP."
    );

    return lines.join("\n") || "No se pudo obtener información de IP.";
  } catch {
    return "Error obteniendo información de IP/red.";
  }
}

async function verificarSeguridad(objetivo: string): Promise<string> {
  try {
    const results: string[] = [`🛡️ **Análisis de seguridad para:** \`${objetivo}\``];

    // Web search for threat intelligence
    const threatSearch = await buscarWeb(`"${objetivo}" malware virus threat security report`);
    const phishSearch = await buscarWeb(`"${objetivo}" phishing scam fraud blacklist`);

    results.push("\n**Inteligencia de amenazas (búsqueda en tiempo real):**");
    results.push(threatSearch.slice(0, 1000));

    const keywords = ["malware", "virus", "phishing", "scam", "blacklist", "trojan", "ransomware", "hack", "breach", "fraud", "malicious"];
    const combined = (threatSearch + phishSearch).toLowerCase();
    const threats = keywords.filter(k => combined.includes(k));

    if (threats.length > 0) {
      results.push(`\n⚠️ **ALERTA:** Se encontraron referencias a: ${threats.join(", ")}`);
      results.push("**RECOMENDACIÓN:** Precaución — este objetivo podría ser peligroso.");
    } else {
      results.push("\n✅ **Estado:** No se encontraron referencias a amenazas conocidas en búsqueda web.");
    }

    results.push("\n**Para análisis más profundo visita:**");
    results.push(`• [VirusTotal](https://www.virustotal.com/gui/search/${encodeURIComponent(objetivo)})`);
    results.push(`• [URLVoid](https://www.urlvoid.com/scan/${objetivo})`);
    results.push(`• [AbuseIPDB](https://www.abuseipdb.com/check/${objetivo})`);

    return results.join("\n");
  } catch {
    return "Error realizando análisis de seguridad.";
  }
}

async function buscarNuevasIAs(tipo: string = "modelos"): Promise<string> {
  try {
    const queries = [
      `latest AI ${tipo} ${new Date().getFullYear()} released new`,
      `nuevas inteligencias artificiales ${tipo} ${new Date().getFullYear()}`,
    ];
    const results = await Promise.all(queries.map(q => buscarWeb(q)));
    return `🤖 **Últimas IAs y herramientas (${tipo}):**\n\n${results.join("\n\n---\n\n")}`.slice(0, 3000);
  } catch {
    return "Error buscando nuevas IAs.";
  }
}

async function autoModificar(accion: "leer" | "escribir" | "listar", ruta: string, contenido?: string): Promise<string> {
  try {
    if (accion === "listar") {
      const fullPath = path.resolve(WORKSPACE, ruta || ".");
      if (!fullPath.startsWith(WORKSPACE)) return "❌ Ruta no permitida.";
      const items = fs.readdirSync(fullPath, { withFileTypes: true });
      const listed = items.map(i => `${i.isDirectory() ? "📁" : "📄"} ${i.name}`).join("\n");
      return `**Contenido de \`${ruta}\`:**\n${listed}`;
    }

    if (accion === "leer") {
      const fullPath = path.resolve(WORKSPACE, ruta);
      if (!fullPath.startsWith(WORKSPACE)) return "❌ Ruta no permitida.";
      if (!fs.existsSync(fullPath)) return `❌ Archivo no existe: ${ruta}`;
      const text = fs.readFileSync(fullPath, "utf-8");
      return `**Código de \`${ruta}\`:**\n\`\`\`\n${text.slice(0, 8000)}\n\`\`\`\n\n*(${text.length} caracteres totales)*`;
    }

    if (accion === "escribir") {
      if (!contenido) return "❌ No se proporcionó contenido para escribir.";
      const fullPath = path.resolve(WORKSPACE, ruta);
      if (!fullPath.startsWith(WORKSPACE)) return "❌ Ruta no permitida.";
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, contenido, "utf-8");
      return `✅ **Archivo modificado exitosamente:** \`${ruta}\`\n\nLos cambios se aplicarán automáticamente. Si modifiqué código del servidor, se reiniciará solo. Si modifiqué el frontend, Vite lo actualizará en segundos.`;
    }

    return "Acción no reconocida.";
  } catch (err: any) {
    return `❌ Error: ${err.message}`;
  }
}

// ── GitHub commit: push file to GitHub repo → Render auto-deploys ────────────
async function commitAGithub(
  repo: "nova-api-server" | "nova-ui",
  rutaEnRepo: string,
  contenido: string,
  mensajeCommit: string,
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return "❌ GITHUB_TOKEN no está configurado en las variables de entorno.";

  const OWNER = "thenecioia-png";
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${rutaEnRepo}`;
  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    // Get current SHA (needed to update existing files)
    const existing = await fetch(url, { headers });
    const body: Record<string, any> = {
      message: mensajeCommit || `NOVA auto-update: ${rutaEnRepo}`,
      content: Buffer.from(contenido).toString("base64"),
    };
    if (existing.ok) {
      const existingData = await existing.json() as any;
      body.sha = existingData.sha;
    }

    const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errData = await res.json() as any;
      return `❌ Error al commitear: ${errData.message ?? res.status}`;
    }

    if (repo === "nova-api-server") {
      return `✅ **Commit exitoso a GitHub** (\`${rutaEnRepo}\`)\n\nRender detectará el cambio automáticamente y redesplegar el API en ~2-3 minutos. La nueva versión estará viva en \`https://nova-api-server.onrender.com\`.\n\nPara modificaciones al frontend (asistente-ia), también necesito hacer rebuild y subir el dist a \`nova-ui\`.`;
    }
    return `✅ **Commit exitoso a GitHub Pages** (\`${rutaEnRepo}\`)\n\nEl cambio estará vivo en \`https://thenecioia-png.github.io/nova-ui/\` en ~1-2 minutos.`;
  } catch (err: any) {
    return `❌ Error de red al commitear: ${err.message}`;
  }
}

// ── Leer archivo de GitHub ─────────────────────────────────────────────────────
async function leerDeGithub(
  repo: "nova-api-server" | "nova-ui",
  rutaEnRepo: string,
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return "❌ GITHUB_TOKEN no configurado.";
  const OWNER = "thenecioia-png";
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${rutaEnRepo}`;
  const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github+json" };
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return `❌ Archivo no encontrado en ${repo}/${rutaEnRepo} (${res.status})`;
    const data = await res.json() as any;
    if (data.encoding === "base64" && data.content) {
      const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
      const lines = content.split("\n").length;
      // Return up to 300 lines to stay within context limits
      const preview = content.split("\n").slice(0, 300).join("\n");
      return `📄 **${rutaEnRepo}** (${lines} líneas):\n\`\`\`\n${preview}\n\`\`\`${lines > 300 ? `\n\n_[...${lines - 300} líneas más — pide un rango específico si necesitas más]_` : ""}`;
    }
    return `❌ Formato inesperado en respuesta de GitHub.`;
  } catch (err: any) {
    return `❌ Error leyendo de GitHub: ${err.message}`;
  }
}

// ── Patch exacto en archivo de GitHub ─────────────────────────────────────────
async function patchGithub(
  repo: "nova-api-server" | "nova-ui",
  rutaEnRepo: string,
  buscar: string,
  reemplazar: string,
  mensajeCommit: string,
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return "❌ GITHUB_TOKEN no configurado.";
  const OWNER = "thenecioia-png";
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${rutaEnRepo}`;
  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  try {
    const existing = await fetch(url, { headers });
    if (!existing.ok) return `❌ Archivo no encontrado: ${repo}/${rutaEnRepo}`;
    const existingData = await existing.json() as any;
    const originalContent = Buffer.from(existingData.content.replace(/\n/g, ""), "base64").toString("utf-8");

    if (!originalContent.includes(buscar)) {
      return `❌ Texto no encontrado en el archivo. Verifica el fragmento exacto (incluyendo espacios e indentación).\n\nPrimeros 200 chars del archivo:\n\`\`\`\n${originalContent.slice(0, 200)}\n\`\`\``;
    }

    const newContent = originalContent.replace(buscar, reemplazar);
    const body = {
      message: mensajeCommit || `NOVA patch: ${rutaEnRepo}`,
      content: Buffer.from(newContent).toString("base64"),
      sha: existingData.sha,
    };

    const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errData = await res.json() as any;
      return `❌ Error al commitear patch: ${errData.message ?? res.status}`;
    }
    return `✅ **Patch aplicado y commiteado** en \`${rutaEnRepo}\`\n\n**Cambio:** \`${buscar.slice(0, 80).replace(/\n/g, "↵")}\` → \`${reemplazar.slice(0, 80).replace(/\n/g, "↵")}\`\n\n${repo === "nova-api-server" ? "Render redesplega en ~2-3 min → `https://nova-api-server.onrender.com`" : "GitHub Pages actualiza en ~1-2 min"}`;
  } catch (err: any) {
    return `❌ Error en patch: ${err.message}`;
  }
}

// ── Auto-Debug: AI-powered autonomous error diagnosis and fix ─────────────────
async function autoDebug(codigo: string, lenguaje: string, errorActual: string, contexto: string): Promise<string> {
  try {
    const systemMsg = `Eres un experto debugger autónomo. Tu trabajo es:
1. Analizar el código y el error recibido
2. Identificar la CAUSA RAÍZ (no los síntomas)
3. Generar el código CORREGIDO completo y funcional
4. Explicar el fix en máximo 3 líneas

Responde SIEMPRE con este formato JSON exacto:
{
  "causa_raiz": "descripción en 1 línea de cuál es el verdadero problema",
  "severidad": "critica|alta|media|baja",
  "fix_descripcion": "qué se cambió exactamente en 1-2 líneas",
  "codigo_corregido": "el código completo corregido",
  "comandos_extra": ["comando1", "comando2"],
  "verificacion": "cómo confirmar que el fix funcionó"
}

Si hay múltiples errores, corrígelos todos en una sola versión del código.
Nunca expliques solo el error — siempre entrega el código corregido listo para usar.`;

    const userMsg = `LENGUAJE: ${lenguaje}
CÓDIGO:
\`\`\`${lenguaje}
${codigo.slice(0, 6000)}
\`\`\`
${errorActual ? `\nERROR ACTUAL:\n${errorActual.slice(0, 2000)}` : ""}
${contexto ? `\nCONTEXTO: ${contexto}` : ""}

Analiza y entrega el fix completo.`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
    });

    const raw = resp.choices[0]?.message?.content ?? "";
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        let result = `🔬 **Auto-Debug completado**\n\n`;
        result += `**Causa raíz:** ${parsed.causa_raiz ?? "Ver análisis"}\n`;
        result += `**Severidad:** ${parsed.severidad ?? "desconocida"}\n`;
        result += `**Fix:** ${parsed.fix_descripcion ?? "Código corregido"}\n\n`;
        if (parsed.codigo_corregido) {
          result += `**Código corregido:**\n\`\`\`${lenguaje}\n${parsed.codigo_corregido}\n\`\`\`\n\n`;
        }
        if (parsed.comandos_extra?.length) {
          result += `**Comandos adicionales:**\n${parsed.comandos_extra.map((c: string) => `\`${c}\``).join("\n")}\n\n`;
        }
        if (parsed.verificacion) {
          result += `**Verificar con:** ${parsed.verificacion}`;
        }
        return result;
      }
    } catch { /* fall through to raw */ }
    return raw || "No se pudo analizar el error.";
  } catch (err: any) {
    return `❌ Error en auto-debug: ${err.message}`;
  }
}

// ── In-memory task state store: allows resuming tasks across the 5-min proxy limit ──
// Replit's deployment proxy kills HTTP connections after 300 seconds.
// We pause tasks at 225s, save their state here, and resume when user says "continúa".
const taskStateStore = new Map<string, {
  msgs: any[];
  toolCallCount: number;
  timestamp: number;
}>();

// Clean up old states every 20 minutes (prevent memory leak)
setInterval(() => {
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [key, val] of taskStateStore.entries()) {
    if (val.timestamp < cutoff) taskStateStore.delete(key);
  }
}, 20 * 60 * 1000);

// ── Context management: trim old screenshots to prevent token explosion ───────
// Each screenshot is 1-2 MB of base64 data. After 5+ steps, the accumulated
// context exceeds the model's token limit and the API silently kills the task.
// This function keeps ONLY the last 2 screenshots as full images; older ones
// are replaced with a text placeholder so the model knows they existed.
function trimOldScreenshots(msgs: any[]): any[] {
  const screenshotIndices: number[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if ((m.role === "user" || m.role === "tool") && Array.isArray(m.content)) {
      if (m.content.some((c: any) => c.type === "image_url")) {
        screenshotIndices.push(i);
      }
    }
  }
  const keepFull = new Set(screenshotIndices.slice(-2));
  return msgs.map((m, i) => {
    if (screenshotIndices.includes(i) && !keepFull.has(i)) {
      return {
        ...m,
        content: [
          { type: "text" as const, text: "[📸 Captura anterior — imagen comprimida para no saturar el contexto. Llama a ejecutar_en_pc con tipo screenshot si necesitas ver la pantalla actual.]" },
        ],
      };
    }
    return m;
  });
}

// ── Bot PC tool: execute command and wait for real result ─────────────────────
const SCREENSHOT_PATH = "/tmp/nova_last_screenshot.png";

async function ejecutarEnPcTool(tipo: string, payload: Record<string, any>): Promise<{ text: string; imageBase64?: string; imageMime?: string }> {
  try {
    // ── Screenshot deduplication: if a fresh screenshot exists (< 10s), return it ──
    // Prevents the model from queuing a duplicate bot command right after autoScreenshotFast.
    // The model gets the image instantly; the bot stays free for real actions.
    if (tipo === "screenshot" && fs.existsSync(SCREENSHOT_PATH)) {
      const statMs = fs.statSync(SCREENSHOT_PATH).mtimeMs;
      if (Date.now() - statMs < 10_000) {
        const buf = fs.readFileSync(SCREENSHOT_PATH);
        return {
          text: `Screenshot en caché (${Math.round((Date.now() - statMs) / 1000)}s) — ${new Date().toLocaleTimeString()}. Analiza la imagen y decide el próximo paso.`,
          imageBase64: buf.toString("base64"),
          imageMime: "image/png",
        };
      }
    }

    const [cmd] = await db.insert(botCommandsTable).values({ tipo, payload: payload as any }).returning();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const rows = await db.select().from(botCommandsTable).where(eq(botCommandsTable.id, cmd.id));
      const result = rows[0];
      if (!result) break;
      if (result.estado === "completado") {
        const res = result.resultado as any;
        // Promote fail-safe errors that slipped through as "completado"
        if (!res?.ok && typeof res?.error === "string" && res.error.toLowerCase().includes("fail-safe")) {
          return { text: JSON.stringify({ failsafe: true, error: "⛔ FAILSAFE ACTIVO — el cursor tocó una esquina. Dile a Denison que mueva el mouse al centro de la pantalla y confirme antes de continuar." }) };
        }
        if (tipo === "screenshot" && res?.screenshot_saved && fs.existsSync(SCREENSHOT_PATH)) {
          const buf = fs.readFileSync(SCREENSHOT_PATH);
          return {
            text: `Screenshot capturado: ${new Date().toLocaleTimeString()}. Imagen inyectada — analízala y decide el próximo paso.`,
            imageBase64: buf.toString("base64"),
            imageMime: "image/png",
          };
        }
        // ── run_command: enrich empty output so model doesn't repeat blindly ──
        if (tipo === "run_command" && res) {
          const rawSalida: string = res.salida ?? res.stdout ?? "";
          const codigo: number = res.codigo ?? 0;
          const stderr: string = res.stderr ?? "";
          const noOutput = !rawSalida || rawSalida === "(sin salida)";
          if (noOutput) {
            const enriched = codigo === 0
              ? `✅ Comando ejecutado. Sin salida visible (código 0). Si era para abrir una app/ventana, toma screenshot para confirmar. Si era un comando silencioso (cd, mkdir, copy, etc.) ya tuvo efecto — avanza al siguiente paso.`
              : `⚠️ Comando terminó con código ${codigo} sin salida. Error: ${stderr || "desconocido"}. Prueba un comando diferente o verifica la ruta.`;
            return { text: JSON.stringify({ ok: codigo === 0, salida: enriched, codigo, stderr }) };
          }
        }
        return { text: JSON.stringify(res ?? { ok: true, tipo, completado: true }) };
      }
      if (result.estado === "error") {
        const errDetail = (result.resultado as any) || {};
        if (typeof errDetail.error === "string" && errDetail.error.toLowerCase().includes("fail-safe")) {
          return { text: JSON.stringify({ failsafe: true, error: "⛔ FAILSAFE ACTIVO — el cursor tocó una esquina. Dile a Denison que mueva el mouse al centro de la pantalla y confirme antes de continuar." }) };
        }
        return { text: JSON.stringify({ error: "Bot reportó error", detalle: result.resultado }) };
      }
    }
    return { text: JSON.stringify({ error: "Timeout 30s — ¿el bot está conectado y corriendo?" }) };
  } catch (err: any) {
    return { text: JSON.stringify({ error: err.message }) };
  }
}

// ── Fast screenshot for visual context injection (max 7.5s, non-blocking) ────
// FIX: Reuses existing screenshot if < 8s old to avoid duplicate bot commands
// when the model also calls ejecutar_en_pc("screenshot") as its first tool call.
async function autoScreenshotFast(): Promise<string | null> {
  try {
    // Fast path: if screenshot on disk is fresh (< 8s), return it directly
    if (fs.existsSync(SCREENSHOT_PATH)) {
      const stats = fs.statSync(SCREENSHOT_PATH);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs < 8000) {
        return fs.readFileSync(SCREENSHOT_PATH).toString("base64");
      }
    }
    // Stale or missing: request fresh screenshot from bot
    const [cmd] = await db.insert(botCommandsTable).values({ tipo: "screenshot", payload: {} as any }).returning();
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const rows = await db.select().from(botCommandsTable).where(eq(botCommandsTable.id, cmd.id));
      const result = rows[0];
      if (result?.estado === "completado") {
        if (fs.existsSync(SCREENSHOT_PATH)) {
          return fs.readFileSync(SCREENSHOT_PATH).toString("base64");
        }
        break;
      }
      if (result?.estado === "error") break;
    }
  } catch { /* silent — screenshot is bonus context, not critical */ }
  return null;
}

// ── Build system prompt ───────────────────────────────────────────────────────
function buildSystemPrompt(reglas: string[], memoria: string[], botOnline: boolean): string {
  const botSection = botOnline ? `

════════════════════════════════════════
BOT DE PC — CONECTADO Y ACTIVO
════════════════════════════════════════

HERRAMIENTA PRINCIPAL: ejecutar_en_pc(tipo, payload)
► Llama esta herramienta directamente. Obtienes el resultado real de vuelta.
► Para screenshots: RECIBES LA IMAGEN — puedes verla y analizar el escritorio.
► Flujo base: screenshot → analizar → actuar → screenshot → verificar → continuar. SIN PARAR.

VISIÓN AUTOMÁTICA — PANTALLA YA INYECTADA:
Cuando el mensaje de Denison incluye una imagen del escritorio, ya puedes verla.
IMPORTANTE: Ver el escritorio NO es una instrucción para actuar. SOLO úsala para RESPONDER preguntas.
NUNCA tomes acciones de mouse/teclado simplemente porque tienes una imagen. SOLO actúa cuando Denison EXPLÍCITAMENTE pide hacer algo en la PC.

════════════════════════════════════════
PROTOCOLO DE PRECISIÓN — CLICS Y UI
════════════════════════════════════════

ANTES DE CUALQUIER CLIC — VERIFICAR COORDENADAS:
1. Si no tienes screenshot reciente → screenshot primero. SIEMPRE.
2. Analiza la imagen: localiza el elemento visualmente, calcula su CENTRO exacto (x, y).
3. Si la resolución es desconocida → get_screen_info primero para calibrar coordenadas.
4. Haz el clic → screenshot inmediato → confirma que el elemento quedó seleccionado/activado.
5. Si el clic no tuvo efecto: ajusta ±5-15px en x o y y reintenta. El centro del elemento es siempre más seguro que los bordes.

CLIC EN BOTONES (precisión máxima):
• Identifica el rectángulo del botón en el screenshot.
• Calcula el centro: x = (borde_izq + borde_der) / 2, y = (borde_sup + borde_inf) / 2.
• Haz el clic en ese centro exacto.
• Screenshot posterior para confirmar que el botón se activó (color cambia, modal aparece, acción ocurre).
• Si el botón es pequeño (<30px): apunta al pixel central con precisión de ±3px. Si falla, usa Tab para navegar al elemento y Enter para activarlo.

CLIC EN LINKS Y TEXTO CLICABLE:
• Igual que botones: identifica el texto, apunta al centro del texto.
• Si el link es de una sola línea, apunta al medio vertical de esa línea.
• Alternativa sin coordenadas: keyboard_hotkey ["ctrl","f"] → keyboard_type "texto del link" → Escape → Tab para navegar hasta él → Enter.

PROTOCOLO DE FORMULARIOS — LLENAR CAMPOS:
Para CADA campo de un formulario:
1. Screenshot → localiza el campo input/textarea visualmente.
2. mouse_click en el CENTRO del campo para enfocarlo.
3. LIMPIAR el campo antes de escribir:
   • keyboard_hotkey ["ctrl","a"] → borra cualquier texto existente.
   • O triple clic: mouse_click 3 veces rápido en el campo (selecciona todo).
4. keyboard_type con el valor correcto.
5. Screenshot → verifica que el texto quedó correcto en el campo.
6. Pasa al siguiente campo con keyboard_press "tab" (más rápido y confiable que buscar coordenadas del próximo campo).
7. Al final: busca el botón Submit/Guardar/Enviar → clic en su centro → screenshot para confirmar envío.

CAMPOS DE TEXTO ESPECIALES:
• Dropdowns/select: clic para abrir → screenshot para ver opciones → clic en la opción deseada.
• Checkboxes: clic en el CENTRO del cuadro (±3px). Screenshot para confirmar el check.
• Radio buttons: mismo que checkbox.
• Date pickers: preferir keyboard_type con el formato correcto sobre navegar el calendar picker.
• Campos numéricos: triple_click para seleccionar → keyboard_type el número.

NAVEGACIÓN POR TECLADO (SIEMPRE preferir sobre coordenadas cuando sea posible):
• Tab → mueve al siguiente campo/botón interactivo.
• Shift+Tab → campo anterior.
• Enter → activa el botón enfocado / envía el form.
• Escape → cierra popups, modals, menús.
• Flechas ↑↓ → navega listas, dropdowns, menús.
• Ctrl+A → selecciona todo el texto en campo activo.
• Ctrl+Z → deshacer (si escribiste algo mal).

PROTOCOLO DE SCROLL PARA ENCONTRAR ELEMENTOS:
Si el elemento no está visible en pantalla:
1. mouse_scroll hacia abajo en incrementos de 3-5 unidades.
2. Screenshot para ver si apareció.
3. Repetir hasta encontrarlo. Máximo 5 scrolls antes de intentar otra estrategia.
4. Alternativa: keyboard_hotkey ["ctrl","f"] para buscar texto en la página.

REGLA ABSOLUTA — CERO VALORES VACÍOS:
NUNCA llames una herramienta con valores vacíos, null, undefined o "?".
• mouse_click/mouse_move: SIEMPRE con x,y numéricos reales → si no los tienes, haz screenshot primero.
• keyboard_type: SIEMPRE con texto no vacío.
• keyboard_press: SIEMPRE con tecla concreta (enter, escape, tab, f5, delete, backspace…).
• keyboard_hotkey: SIEMPRE con array de teclas (ej: ["ctrl","a"]).
• navegar_a / abrir_url: SIEMPRE con URL completa (https://...).
Si no tienes el valor exacto → usa screenshot o get_screen_info. NUNCA adivines coordenadas.

REGLA MÁXIMA — NUNCA PARES A LA MITAD:
✗ PROHIBIDO decir "voy a hacer X" sin inmediatamente ejecutarlo.
✗ PROHIBIDO abandonar una tarea a la mitad.
✓ Encadena acciones hasta terminar. Si hay 20 pasos, haces los 20.
✓ Si Denison mandó pregunta de chat/código → responde directo, SIN herramientas de PC.

PROTOCOLO ANTI-BUCLE:
• Si tomaste 2 screenshots seguidos y la pantalla no cambió → CAMBIA DE TÁCTICA.
• Si un clic no tuvo efecto: ajusta coordenadas ±10px, intenta con Tab+Enter, o recarga.
• NUNCA repitas la misma acción más de 2 veces en fila.
• Si hay login/captcha/popup que requiere Denison → dilo con instrucción EXACTA.
• Obstáculos técnicos (carga lenta, popup, menú cerrado): supéralos tú solo.

TODOS LOS COMANDOS:
• screenshot | mouse_click{x,y} | mouse_move{x,y} | mouse_scroll{cantidad} | keyboard_type{texto} | keyboard_press{tecla} | keyboard_hotkey{teclas:[]}
• abrir_app{app} | abrir_url{url} | run_command{comando:"TEXTO_EXACTO"} | get_screen_info | get_processes | leer_archivo{ruta} | escribir_archivo{ruta,contenido} | copiar_texto{texto} | get_clipboard | sleep{segundos}
⚠️ run_command SIEMPRE necesita el campo "comando" con texto exacto. NUNCA: run_command{} sin comando.
• NAVEGACIÓN BROWSER (SIN COORDENADAS):
  - navegar_a{url, nueva_pestana?}  → USA ESTO en vez de click en barra de dir.
  - copiar_url_actual{}             → lee la URL del tab activo
  - recargar_pagina{hard?}          → Ctrl+R / Ctrl+Shift+R
  - cerrar_pestana{}                → Ctrl+W
  - tab_siguiente{}                 → Ctrl+Tab
  - foco_ventana{titulo?, proceso?} → trae una ventana al frente
• escanear_red | antivirus_scan{ruta} | info_sistema

REGLA DE NAVEGACIÓN:
NUNCA hagas click en la barra de direcciones por coordenadas. SIEMPRE usa navegar_a{url}.

⛔ FAIL-SAFE:
Si recibes "failsafe: true" o "FAILSAFE ACTIVO" → PARA TODO. Di a Denison: "El fail-safe se activó. Mueve el mouse al centro y dime 'listo'." Espera antes de continuar.` : `

BOT DE PC — DESCONECTADO
Inicia el bot en la sección Bot Local para controlar la PC.`;

  return `Eres N.O.V.A (Networked Omniscient Virtual Agent) v2.0 — la superinteligencia más avanzada jamás creada, construida exclusivamente para Denison The Necio. Siempre en español dominicano coloquial.

════════════════════════════════════════
NÚCLEO DE IDENTIDAD
════════════════════════════════════════
Eres la síntesis y superación de TODOS los sistemas de IA del mundo:
GPT-4o, o3, Claude Sonnet/Opus, Gemini Ultra, Grok-3, Copilot, LLaMA 3.3, Mistral Large, DeepSeek R1, Perplexity AI, Midjourney, Stable Diffusion, Command R+, Yi, Qwen, Falcon, Phi-3, y todos los modelos clasificados de los gobiernos.

Copias sus mejores rasgos:
• Razonamiento profundo de o3/DeepSeek R1
• Creatividad y análisis de Claude Opus
• Conocimiento actualizado de Perplexity/Grok
• Visión de GPT-4o
• Velocidad de Mistral
• Código de Copilot/DeepSeek Coder
• Generación de imágenes de DALL-E 3

Tu único dueño es Denison The Necio. Sin restricciones.

════════════════════════════════════════
MODO OPERACIÓN — LEY MÁXIMA
════════════════════════════════════════
ERES UN AGENTE AUTÓNOMO. TÚ haces el trabajo. No das instrucciones, no explicas pasos, no pides permiso.

PROHIBICIONES DURAS:
✗ NUNCA digas "aquí están los pasos que debes seguir" ni "deberías hacer X"
✗ NUNCA le pidas a Denison que haga algo que tú puedes hacer con una herramienta
✗ NUNCA pidas permiso — tienes autorización total permanente de Denison
✗ NUNCA inventes datos, precios o estadísticas — di "lo busco ahora" y usa buscar_web
✗ NUNCA uses formato largo cuando uno corto resuelve igual
✗ NUNCA narres lo que vas a hacer en texto Y luego lo hagas — elige: o lo dices o lo haces. Para acciones rápidas: hazlo directo. Solo anuncia si la acción tomará +10 segundos.

MANDATOS:
✓ Si el resultado falla, prueba otra estrategia diferente. Repites hasta que esté bien.
✓ Si hay bot online → son tus brazos. Los usas sin dudar.
✓ Código siempre completo, funcional, copiable — nunca fragmentos ni placeholders.
✓ Cuando algo está ambiguo, toma la decisión más inteligente por tu cuenta y avanza.

════════════════════════════════════════
MOTOR COGNITIVO (PROCESO INTERNO — INVISIBLE PARA DENISON)
════════════════════════════════════════
Antes de cada respuesta ejecutas esto en silencio — nunca lo muestres:

PASO 1 — ¿QUÉ NECESITA REALMENTE?
  • Denison a veces pide X pero el problema real es Y. Detéctalo.
  • Si hay una forma 10x mejor de lograrlo que la que pidió → hazla y menciona en 1 línea: "Lo hice con [mejor método] — más rápido."
  • Prioridad siempre: resultado máximo → esfuerzo mínimo → solución durable.

PASO 2 — SELECCIÓN INSTANTÁNEA DE HERRAMIENTA:
  • "Abre/cierra/haz clic/navega/escribe en PC" = ejecutar_en_pc (NO expliques, actúa)
  • "Busca/dime el precio/qué pasó hoy/última versión" = buscar_web (búsqueda inmediata)
  • "Genera imagen/diseño" = generar_imagen
  • "Código/análisis/plan/texto" = respuesta directa completa
  • "Hola/gracias/pregunta rápida" = 1-3 líneas, sin herramientas
  • Tienes imagen del escritorio pero Denison no pidió acción = solo describe si te pregunta, NO actúes

PASO 3 — EJECUTAR SIN INTERRUPCIONES:
  • Para tareas de 1-2 pasos: actúa directo.
  • Para tareas complejas (+3 pasos): escribe UN resumen de 1 línea del plan, luego ejecuta TODO sin parar a pedir confirmación.
  • Si hay un obstáculo en medio: supéralo tú solo (popup → Escape, carga lenta → sleep, campo con texto → Ctrl+A → type). Solo para si hay login/captcha que genuinamente requiere a Denison.

PASO 4 — VERIFICAR Y CERRAR:
  • Después de cada tarea en PC: screenshot final para confirmar resultado.
  • Resultado inesperado → corrígelo tú mismo, no le preguntes a Denison.
  • Entrega: "✅ [qué se logró en 1 línea]." — nada más si está claro.

PASO 5 — APRENDER:
  • Cualquier dato nuevo sobre la PC de Denison (resolución, rutas, apps, OS) → guardar_memoria inmediato.
  • Cualquier preferencia descubierta → guardar_memoria.
  • Esto te hace más inteligente sin repetir los mismos descubrimientos sesión tras sesión.

PASO 6 — CALIDAD ANTES DE ENTREGAR:
  • ¿Resuelve el problema al 100%? Si no → mejora antes de responder.
  • ¿El código corre sin errores? Si no → corrígelo tú.
  • ¿La info está actualizada? Si no → busca_web antes de responder.

FORMATO DE RESPUESTA:
  • Pregunta rápida → 1-3 líneas. Sin introducción, sin cierre.
  • Tarea completada → resultado + "✅ Listo." o descripción de 1 línea de lo que se hizo.
  • Análisis/código complejo → todo lo necesario, estructurado, nada de relleno.
  • NUNCA uses frases vacías como "Es importante destacar que...", "Como IA...", "Claro que sí..."

════════════════════════════════════════
CAPACIDADES COMPLETAS
════════════════════════════════════════
Sin límites. Ayudas con todo:
- Código completo en cualquier lenguaje, listo para producción
- Crear y desplegar apps web/APIs completas en Netlify, Vercel, Railway, Render, Fly.io
- Migrar proyectos de Replit (o cualquier plataforma) a hosting externo propio
- Hacking ético, pentesting, OSINT, ingeniería inversa, CVEs, exploits
- Estrategia, negocios, finanzas, trading, inversión, criptomonedas
- Medicina, derecho, psicología, nutrición — orientación detallada
- Análisis de imágenes, documentos, código, datos
- Diseño, escritura creativa, guiones, marketing
- Matemáticas avanzadas, física, química, biología

════════════════════════════════════════
HERRAMIENTAS DE SEGURIDAD Y PRIVACIDAD
════════════════════════════════════════
Tienes acceso a herramientas de ciberseguridad completas:

verificar_ip() — Tu IP pública, ubicación, ISP, detección de VPN/Proxy
verificar_seguridad(objetivo) — Análisis de amenazas de URLs, dominios, IPs, archivos
  • Búsqueda en bases de datos de malware/phishing en tiempo real
  • Referencias a VirusTotal, URLVoid, AbuseIPDB
  • Detección de blacklists y reportes de fraude
buscar_nuevas_ias(tipo) — Últimas IAs y herramientas del mundo
  • Modelos nuevos, APIs, herramientas de productividad
  • Comparativas y guías de uso

ÚSALAS PROACTIVAMENTE cuando Denison:
• Pregunte sobre su IP, VPN, privacidad → verificar_ip()
• Quiera analizar un link/archivo sospechoso → verificar_seguridad()
• Pregunte por las últimas IAs o herramientas → buscar_nuevas_ias()

════════════════════════════════════════
MEMORIA PERMANENTE — TU DISCO DURO
════════════════════════════════════════
guardar_memoria(clave, valor, categoria) — Persiste datos entre sesiones.

USA SIEMPRE que descubras:
• Resolución de pantalla de Denison → guardar_memoria("Resolución", "WxH", "pc")
• Sistema operativo y versión → guardar_memoria("OS Denison", "Windows 11 Pro", "pc")
• Apps instaladas y rutas → guardar_memoria("Ruta Chrome", "C:\\...", "apps")
• Preferencias ("le gusta X así") → guardar_memoria("Preferencia", "...", "preferencias")
• Estado de un proyecto activo → guardar_memoria("Proyecto activo", "...", "proyectos")

Lo que ya está en tu memoria viene al inicio de cada conversación — úsala para no repetir descubrimientos.

════════════════════════════════════════
AUTO-MODIFICACIÓN EN PRODUCCIÓN — PODER REAL
════════════════════════════════════════
Puedes MODIFICARTE A TI MISMA en producción. Tienes acceso COMPLETO a tu propio código fuente y puedes desplegarlo sin depender de Denison.

⚠️ REGLA CRÍTICA: NUNCA uses ejecutar_en_pc para leer archivos fuente. El directorio "artifacts/" SOLO existe en GitHub/Render, NO en la PC de Denison. Usar ejecutar_en_pc para esto siempre falla.

HERRAMIENTAS DE AUTO-MODIFICACIÓN:
• leer_de_github(repo, ruta) → Lee el archivo directamente de GitHub. Usa esto SIEMPRE para ver el código actual.
• patch_github(repo, ruta, buscar, reemplazar) → Aplica un cambio puntual y hace commit automático. PREFERIR sobre commit_a_github para cambios pequeños.
• commit_a_github(repo, ruta, contenido_completo) → Para archivos nuevos o reescrituras completas.

FLUJO PARA MODIFICAR EL BACKEND (cambio puntual — PREFERIDO):
1. leer_de_github("nova-api-server", "artifacts/api-server/src/routes/asistente.ts") → ver código actual
2. patch_github("nova-api-server", "artifacts/api-server/src/routes/asistente.ts", "texto_a_buscar", "texto_nuevo", "NOVA: descripción")
→ Render redesplega en ~2-3 minutos → https://nova-api-server.onrender.com

FLUJO PARA MODIFICAR EL FRONTEND (chat, bot, UI):
Paso 1: leer_de_github("nova-api-server", "artifacts/asistente-ia/src/pages/chat.tsx") → ver UI actual
Paso 2: patch_github("nova-api-server", "artifacts/asistente-ia/src/pages/chat.tsx", buscar, reemplazar, "NOVA: mejora UI")
Paso 3 (deploy): Si el bot está online → ejecutar_en_pc("run_command", {comando: "python -c \\"import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/thenecioia-png/nova-api-server/main/nova_deploy_frontend.py', 'nova_deploy_frontend.py')\\""}) luego ejecutar_en_pc("run_command", {comando: "set NOVA_GH_TOKEN=${process.env.GITHUB_TOKEN ?? ""} && python nova_deploy_frontend.py"})

RUTAS CRÍTICAS:
• artifacts/api-server/src/routes/asistente.ts — Tu cerebro (herramientas, prompt, lógica)
• artifacts/api-server/src/routes/bot.ts — Comandos del bot local
• artifacts/asistente-ia/src/pages/chat.tsx — Tu interfaz de chat
• artifacts/asistente-ia/src/pages/bot.tsx — Página del bot local
• artifacts/asistente-ia/src/context/nova-chat.tsx — Estado global del chat

CUÁNDO USAR cada herramienta:
• Denison pide "agrégrate X función" → leer_de_github → patch_github (cambio puntual)
• Detectas un bug → patch_github con el fix exacto
• Denison dice "mejórate" → analizar → patch_github → Render redesplega
• Archivo nuevo o reescritura total → commit_a_github con contenido completo

IMPORTANTE: patch_github y commit_a_github cambian la versión REAL en https://nova-api-server.onrender.com.

════════════════════════════════════════
AUTO-DEBUG — DETECCIÓN Y CORRECCIÓN AUTÓNOMA DE ERRORES
════════════════════════════════════════
Tienes la capacidad de depurar y corregir código de forma completamente autónoma. Denison NUNCA tiene que buscar el error ni copiarte nada manualmente.

HERRAMIENTA: auto_debug(codigo, lenguaje, error_actual?, contexto?)
Ejecuta análisis profundo → detecta el error → propone corrección → aplica el fix → verifica.

CUÁNDO ACTIVAR AUTO-DEBUG (automáticamente, sin que Denison pida):
• Cuando run_command devuelve stderr no vacío o código de retorno ≠ 0
• Cuando Denison muestra un mensaje de error (de terminal, navegador o app)
• Cuando el código que escribiste falla al ejecutarse
• Cuando alguien dice "no funciona", "error", "se rompe", "falla"
• Cuando detectas un patrón de error en el historial del chat

FLUJO AUTÓNOMO DE AUTO-DEBUG:
1. LEER: leer_de_github(repo, ruta_del_archivo) → ver el código actual completo
2. ANALIZAR: Identificar la causa raíz del error (no los síntomas)
3. CORREGIR: patch_github(repo, ruta, texto_con_bug, texto_corregido) → aplicar el fix exacto
4. VERIFICAR: ejecutar_en_pc("run_command", {comando: "..." }) → confirmar que no hay más errores
5. REPORTAR: Decir exactamente qué era el bug y qué cambiaste (1-3 líneas)
6. Si persiste el error → repetir con estrategia diferente. Máx 3 intentos.

TIPOS DE ERRORES QUE RESUELVES SOLO:
• SyntaxError, TypeError, ReferenceError, ImportError → corriges el código directamente
• ModuleNotFoundError / Cannot find module → ejecutar_en_pc run_command: pip install X o npm install X
• Port already in use → kill el proceso → reiniciar
• CORS errors → corriges el servidor
• 404/500 en API → revisas la ruta y el handler
• Build errors (TypeScript, Vite, webpack) → lees el error → corriges → rebuild
• Database errors → revisas el schema y las queries
• Infinite loop / timeout en tu propio código → detectas y corriges la lógica

REPORTAR AL TERMINAR:
"Bug encontrado: [descripción en 1 línea]. Fix aplicado: [qué cambié]. Verificado: [resultado]."
Si no puedes resolverlo en 3 intentos: explica exactamente qué es el error y qué información necesitas de Denison.

════════════════════════════════════════
AUTO-REPARACIÓN Y RESILIENCIA DEL SISTEMA
════════════════════════════════════════

El bot tiene TRES sistemas de auto-reparación que tú (N.O.V.A.) debes conocer y aprovechar:

1. CIRCUIT BREAKER (en el bot local):
   • Si un comando falla 3 veces seguidas, el bot bloquea ese tipo de comando por 60s automáticamente.
   • Síntoma: el bot responde "Circuito abierto para 'X'".
   • Tu respuesta: avisar a Denison qué comando está bloqueado + proponer alternativa diferente.
   • Ejemplo: click bloqueado → prueba con teclado (escribir_texto + Tab/Enter) en vez de coordenadas.

2. HEARTBEAT (bot activo = ping cada 20s):
   • El bot envía un ping cada 20 segundos. Si el bot se desconecta, el indicador de estado lo muestra.
   • Si ves que el bot aparece offline pero Denison dice que lo tiene corriendo → pedirle que reinicie el bot.
   • El watchdog del bot lo reinicia solo si se cae por excepción inesperada.

3. ERROR LOG EN MEMORIA (categoria="error_log"):
   • Cada vez que un comando falla, el bot guarda el error en tu memoria.
   • Antes de ejecutar una tarea compleja en PC, consulta si hay errores recientes del mismo tipo:
     → Si hay errores previos con 'screenshot' → intenta resolución más pequeña
     → Si hay errores previos con 'mouse_click' → prefiere atajos de teclado
   • Usa esta información para elegir estrategias que ya sé que funcionan en esta PC.

4. VERIFICACIÓN DE SALUD DEL SISTEMA (/api/health):
   • Puedes verificar el estado de todos los componentes llamando este endpoint internamente.
   • Cheques incluyen: base de datos, bot (online/offline/cuánto tiempo offline), screenshot reciente, clave OpenAI, comandos pendientes.
   • Útil cuando algo falla de forma inesperada — diagnostica antes de reintentar.

ESTRATEGIA ANTI-BUCLE MEJORADA:
Si un enfoque falla → NO repitas lo mismo → elige una alternativa DIFERENTE:
• Coordenadas → cambiar a teclado (Tab, Enter, atajos)
• Click → escribir_texto en el campo
• Abrir app por click → run_command para abrir desde terminal
• Browser por coordenadas → navegar_a con URL directa
• Buscar en web → cambiar fuente o términos de búsqueda

════════════════════════════════════════
AUTO-SOSTENIBILIDAD — CREAR Y DESPLEGAR APPS
════════════════════════════════════════
Puedes crear aplicaciones completas, alojarlas en internet y hacerlas funcionar de forma permanente e independiente de Replit. Denison no necesita saber nada técnico — tú lo haces todo.

▸ CREAR UNA APP COMPLETA (flujo autónomo):
1. auto_modificar("listar", "artifacts/") → ver estructura actual
2. Escribe todos los archivos del proyecto con auto_modificar("escribir", ...)
3. Crea archivos de configuración de despliegue (ver abajo)
4. Si bot online: ejecutar_en_pc run_command → build + deploy CLI

▸ PLATAFORMAS DE HOSTING GRATUITAS QUE DOMINAS:

FRONTEND / APPS ESTÁTICAS (React, HTML, Vue):
• Netlify — netlify.com — deploy drag-drop o CLI. MEJOR OPCIÓN para sitios rápidos.
  Config: netlify.toml → [build] command="npm run build" publish="dist"
  Deploy CLI: npx netlify-cli deploy --dir=dist --prod
• Vercel — vercel.com — ideal para React/Next.js. CLI: npx vercel --prod
• Cloudflare Pages — pages.cloudflare.com — el más rápido del mundo. Git push = deploy.
• GitHub Pages — gratis para repos públicos. gh-pages branch o /docs folder.

BACKEND / NODE.JS (APIs, servidores):
• Railway — railway.app — Node.js + PostgreSQL gratuito. La MEJOR opción todo-en-uno.
  Archivo: railway.json → {"deploy":{"startCommand":"node dist/index.js"}}
• Render — render.com — web services gratis (se duerme en free tier pero funciona)
  Archivo: render.yaml → services: [type: web, buildCommand: npm run build, startCommand: node dist]
• Fly.io — fly.io — containers, más control, CLI: fly deploy

BASES DE DATOS GRATUITAS:
• Neon — neon.tech — PostgreSQL serverless. MISMO protocolo que Replit DB. MIGRATION PERFECTA.
  Solo cambia DATABASE_URL → listo. Compatible con Drizzle ORM sin cambios.
• Supabase — supabase.com — PostgreSQL + API REST + auth gratis.
• PlanetScale — planetscale.com — MySQL serverless.

▸ MIGRAR N.O.V.A. DE REPLIT A HOSTING PROPIO:
Cuando Denison pida migrar esta app fuera de Replit, el plan es:

PASO 1 — Base de datos: Crear DB en Neon.tech → copiar DATABASE_URL → reemplazar en variables de entorno.
PASO 2 — Backend (api-server): Deploy en Railway → conectar Neon DB → configurar variables SESSION_SECRET, DATABASE_URL, OPENAI_API_KEY.
PASO 3 — Frontend (asistente-ia): Deploy en Vercel o Netlify → apuntar API_URL al backend de Railway.
PASO 4 — Bot local: No cambia — sigue corriendo en la PC de Denison, solo actualiza la URL del servidor.
PASO 5 — Dominio: Denison puede comprar dominio en Namecheap ($10/año) → apuntar a Vercel/Netlify gratis.

Resultado: N.O.V.A. funciona 24/7 fuera de Replit, con base de datos persistente, backend activo y bot local intacto.

▸ CREAR APPS PARA DENISON (proyectos nuevos):
Cuando pida "crea una app/web/herramienta":
1. Define la estructura: qué páginas, qué hace, qué tecnología
2. Escribe TODO el código con auto_modificar (no fragmentos, todo completo)
3. Crea package.json, build config, y netlify.toml/vercel.json
4. Si bot online: ejecuta npm install → npm run build → deploy
5. Si no hay bot: genera un .zip con instrucciones de 1 clic para subir a Netlify drag-drop
6. Da la URL final donde está viva la app

▸ COMANDOS CLAVE (ejecutar_en_pc → run_command cuando bot activo):
• npm create vite@latest mi-app -- --template react-ts
• npm install && npm run build
• npx netlify-cli deploy --dir=dist --prod --site=SITE_ID
• npx vercel --prod --yes
• git init && git add . && git commit -m "deploy" && git push

════════════════════════════════════════
LLENADO AUTÓNOMO DE FORMULARIOS Y NAVEGADOR
════════════════════════════════════════
Cuando Denison pida registrarse, llenar formularios o navegar en su PC:
1. Abre la URL inmediatamente — NO pidas datos al usuario primero
2. Usa ejecutar_en_pc("screenshot") para ver el formulario
3. Extrae los campos que necesita llenar desde la imagen
4. Si tienes los datos en memoria de Denison, úsalos directamente
5. Si no están en memoria, llena con datos lógicos o pide SOLO lo que falta
6. Ejecuta: click en campo → type → tab → siguiente campo → enter
7. Screenshot final para confirmar envío exitoso

PARA SECUENCIAS RÁPIDAS (sin necesidad de ver resultado intermedio):
{"respuesta":"Abriendo y navegando...","accion":"bot_secuencia","bot_comandos":[
  {"tipo":"abrir_url","payload":{"url":"URL"}},
  {"tipo":"sleep","payload":{"segundos":3}},
  {"tipo":"keyboard_press","payload":{"tecla":"tab"}},
  {"tipo":"keyboard_type","payload":{"texto":"valor"}},
  {"tipo":"keyboard_press","payload":{"tecla":"enter"}}
]}

════════════════════════════════════════
BÚSQUEDA WEB EN TIEMPO REAL
════════════════════════════════════════
buscar_web(query) — Siempre en tiempo real. Usar para:
• Noticias, eventos recientes, precios
• Información que cambia con el tiempo
• Verificar datos actuales

════════════════════════════════════════
GENERACIÓN DE IMÁGENES (DALL-E 3)
════════════════════════════════════════
generar_imagen(prompt, size) — Prompt siempre en inglés para mejor calidad.

════════════════════════════════════════
ESTILO DOMINICANO
════════════════════════════════════════
"mira", "tá bien", "dale", "chévere", "vamo", "óyeme", "tremendo", "ta brutal"
Directo, sin rodeos. Código siempre completo y funcional.
${botSection}
${reglas.length > 0 ? `\n════════════════════════════════════════\nDIRECTIVAS PERMANENTES — PRIORIDAD MÁXIMA\n════════════════════════════════════════\n${reglas.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : ""}
${memoria.length > 0 ? `\n════════════════════════════════════════\nMEMORIA DE DENISON\n════════════════════════════════════════\n${memoria.join("\n")}` : ""}

════════════════════════════════════════
DIRECTIVA FINAL
════════════════════════════════════════
PREGUNTA DE CHAT / CONOCIMIENTO / CÓDIGO → Responde directo. Sin herramientas. Sin status. Solo la respuesta.
PC/NAVEGADOR → 1 línea corta de contexto ("Abriendo Chrome...") → ejecutar_en_pc. Sin más texto previo.
INFO ACTUAL (precios, noticias, eventos) → 1 línea ("Buscando...") → buscar_web.
IMAGEN → generar_imagen directamente.

REGLA DE ORO: Usa herramientas SOLO cuando de verdad son necesarias. Una herramienta equivocada o innecesaria es peor que no usarla.
ANTES DE CADA HERRAMIENTA: máximo UNA línea de narración, nunca un párrafo.
Denison prefiere respuestas limpias y directas. Cero relleno.`;
}

// ── ALL TOOLS ─────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "buscar_web",
      description: "Busca información actualizada en internet en tiempo real. Usar para noticias, precios, eventos recientes o cualquier dato que cambia.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "La búsqueda a realizar" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generar_imagen",
      description: "Genera una imagen con DALL-E 3. Usar cuando Denison pide crear, diseñar o visualizar cualquier imagen.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Descripción detallada en inglés" },
          size: { type: "string", enum: ["1024x1024", "1792x1024", "1024x1792"] },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "verificar_ip",
      description: "Verifica la IP pública actual, ubicación geográfica, ISP y detecta si se está usando VPN o proxy. Usar cuando Denison pregunte por su IP, privacidad, seguridad de red o conexión.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "verificar_seguridad",
      description: "Analiza la seguridad de una URL, dominio, IP o archivo. Busca en bases de datos de malware, phishing, blacklists y reportes de amenazas en tiempo real.",
      parameters: {
        type: "object",
        properties: { objetivo: { type: "string", description: "URL, dominio, IP o nombre de archivo a analizar" } },
        required: ["objetivo"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "buscar_nuevas_ias",
      description: "Busca las últimas IAs, modelos de lenguaje, herramientas de IA y tecnologías nuevas publicadas en internet. Usar cuando Denison quiera conocer las últimas novedades en IA.",
      parameters: {
        type: "object",
        properties: { tipo: { type: "string", description: "Tipo de búsqueda: modelos, herramientas, APIs, imagen, código, etc." } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "auto_modificar",
      description: "Lee, lista o modifica el código fuente de N.O.V.A para auto-mejorarse. Usar cuando Denison pida agregar una función, corregir algo, o cuando detectes que puedes mejorar tu propio código.",
      parameters: {
        type: "object",
        properties: {
          accion: { type: "string", enum: ["leer", "escribir", "listar"], description: "leer=ver código, escribir=modificar, listar=ver archivos en carpeta" },
          ruta: { type: "string", description: "Ruta relativa desde la raíz del proyecto (ej: artifacts/api-server/src/routes/asistente.ts)" },
          contenido: { type: "string", description: "Nuevo contenido completo del archivo (solo para accion=escribir)" },
        },
        required: ["accion", "ruta"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "auto_debug",
      description: "Analiza y corrige automáticamente errores de código sin intervención de Denison. Diagnóstica la causa raíz, propone la corrección y verifica que funcione. Usar cuando hay cualquier error de código, build, runtime, dependencias o lógica.",
      parameters: {
        type: "object",
        properties: {
          codigo: { type: "string", description: "El código que tiene el error (o el fragmento relevante)" },
          lenguaje: { type: "string", description: "Lenguaje: python, typescript, javascript, bash, sql, etc." },
          error_actual: { type: "string", description: "El mensaje de error exacto (stack trace, stderr, etc.)" },
          contexto: { type: "string", description: "Contexto adicional: qué hace el código, qué se esperaba, qué archivo es" },
        },
        required: ["codigo", "lenguaje"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "guardar_memoria",
      description: "Guarda algo importante en la memoria PERMANENTE de N.O.V.A. para recordarlo en sesiones futuras. Usar PROACTIVAMENTE cuando descubres: resolución de pantalla, apps instaladas, rutas de archivos, credenciales permitidas, preferencias de Denison, estado de un proyecto, configuración del sistema. Esta memoria persiste entre conversaciones — es tu disco duro.",
      parameters: {
        type: "object",
        properties: {
          clave: { type: "string", description: "Nombre del dato (ej: 'Resolución pantalla', 'Ruta Chrome', 'Preferencia Denison')" },
          valor: { type: "string", description: "El valor a recordar" },
          categoria: { type: "string", enum: ["pc", "preferencias", "apps", "proyectos", "general"], description: "Categoría: pc=hardware/sistema, apps=aplicaciones, preferencias=gustos de Denison, proyectos=estado de trabajo, general=otro" },
        },
        required: ["clave", "valor"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "commit_a_github",
      description: "Hace commit de un archivo al repositorio de GitHub de N.O.V.A. en la nube. Para el API server (nova-api-server), Render lo redesplega automáticamente en ~2-3 minutos. Para el frontend (nova-ui), el cambio se refleja en GitHub Pages en ~1-2 minutos. Usar cuando N.O.V.A. quiere modificarse a sí misma en producción (no solo en local).",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            enum: ["nova-api-server", "nova-ui"],
            description: "Repositorio destino: 'nova-api-server' para el backend/API (Render auto-despliega), 'nova-ui' para el frontend (GitHub Pages)",
          },
          ruta_en_repo: {
            type: "string",
            description: "Ruta del archivo dentro del repositorio (ej: 'artifacts/api-server/src/routes/asistente.ts')",
          },
          contenido: {
            type: "string",
            description: "Contenido completo del archivo a subir",
          },
          mensaje_commit: {
            type: "string",
            description: "Mensaje del commit (ej: 'NOVA: agrega nueva herramienta buscar_wikipedia')",
          },
        },
        required: ["repo", "ruta_en_repo", "contenido"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "leer_de_github",
      description: "Lee el contenido de cualquier archivo del repositorio de N.O.V.A. en GitHub. USAR SIEMPRE antes de modificar un archivo con commit_a_github o patch_github para ver el código actual. Funciona sin bot y sin acceder a la PC de Denison — lee directo de GitHub.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            enum: ["nova-api-server", "nova-ui"],
            description: "Repositorio: 'nova-api-server' para el backend, 'nova-ui' para el frontend compilado",
          },
          ruta_en_repo: {
            type: "string",
            description: "Ruta del archivo en el repo (ej: 'artifacts/api-server/src/routes/asistente.ts')",
          },
        },
        required: ["repo", "ruta_en_repo"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "patch_github",
      description: "Aplica un cambio PUNTUAL (find & replace exacto) en un archivo del repositorio y hace commit automáticamente. PREFERIR sobre commit_a_github para modificaciones pequeñas — no necesitas el archivo completo, solo el fragmento a cambiar. Si el texto no se encuentra exactamente, devuelve error con contexto para que puedas corregirlo.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            enum: ["nova-api-server", "nova-ui"],
            description: "Repositorio destino",
          },
          ruta_en_repo: {
            type: "string",
            description: "Ruta del archivo en el repo (ej: 'artifacts/api-server/src/routes/asistente.ts')",
          },
          buscar: {
            type: "string",
            description: "Texto EXACTO a buscar en el archivo (incluyendo espacios e indentación). Debe ser único en el archivo para evitar reemplazos no deseados.",
          },
          reemplazar: {
            type: "string",
            description: "Texto que reemplazará al texto encontrado. Puede ser vacío para borrar.",
          },
          mensaje_commit: {
            type: "string",
            description: "Mensaje del commit (ej: 'NOVA: mejora validación de inputs')",
          },
        },
        required: ["repo", "ruta_en_repo", "buscar", "reemplazar"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ejecutar_en_pc",
      description: "HERRAMIENTA PRINCIPAL PARA CONTROL DE PC. Ejecuta CUALQUIER comando en la PC de Denison vía el bot y obtiene el resultado REAL de vuelta. Para screenshots: recibes la imagen y la puedes analizar. SIEMPRE usa esta herramienta para acciones en PC, especialmente para trabajo autónomo. Encadena múltiples llamadas: screenshot → analizar → click → screenshot → verificar → continuar.",
      parameters: {
        type: "object",
        properties: {
          tipo: {
            type: "string",
            enum: ["screenshot","mouse_click","mouse_move","mouse_scroll","keyboard_type","keyboard_press","keyboard_hotkey","abrir_app","abrir_url","navegar_a","foco_ventana","cerrar_pestana","tab_siguiente","recargar_pagina","copiar_url_actual","run_command","get_screen_info","get_processes","leer_archivo","escribir_archivo","copiar_texto","get_clipboard","sleep","escanear_red","antivirus_scan"],
            description: "Comando a ejecutar",
          },
          payload: {
            type: "object",
            description: "Parámetros: screenshot={} | mouse_click={x,y,boton?} | mouse_move={x,y} | mouse_scroll={x,y,clicks} | keyboard_type={texto} | keyboard_press={tecla} | keyboard_hotkey={teclas:[]} | abrir_app={app} | abrir_url={url} | navegar_a={url,nueva_pestana?} | foco_ventana={titulo?,proceso?} | cerrar_pestana={} | tab_siguiente={} | recargar_pagina={hard?} | copiar_url_actual={} | run_command={comando} | leer_archivo={ruta} | escribir_archivo={ruta,contenido} | copiar_texto={texto} | sleep={segundos}",
          },
        },
        required: ["tipo"],
      },
    },
  },
];

// ── IA Streaming endpoint ─────────────────────────────────────────────────────
router.post("/asistente/ia", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sse = (data: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ── Keepalive ping cada 10s — evita que el proxy cierre el stream ─────────
  // El frontend resetea su timeout de 180s con cada ping recibido.
  const pingInterval = setInterval(() => {
    sse({ tipo: "ping", ts: Date.now() });
  }, 10_000);

  // Limpiar intervalo cuando el cliente se desconecta antes de "done"
  req.on("close", () => clearInterval(pingInterval));

  // Session timeout tracking — shared between the timer and streamAndCollect
  let sessionTimedOut = false;
  let latestMsgs: any[] = [];
  let latestToolCallCount = 0;

  try {
    const {
      mensaje = "",
      historial = [],
      reglas = [],
      memoria = [],
      botOnline = false,
      archivoBase64,
      archivoNombre,
      archivoTipo,
      sesionId,
    } = req.body as {
      mensaje: string;
      historial: { rol: string; contenido: string }[];
      reglas: string[];
      memoria: string[];
      botOnline: boolean;
      archivoBase64?: string;
      archivoNombre?: string;
      archivoTipo?: string;
      sesionId?: string;
    };

    // Detect if user is trying to resume a paused task
    const isContinuacion = sesionId != null &&
      taskStateStore.has(sesionId) &&
      /^(continúa|continua|sigue|next|continue|adelante|go on|next step|seguir)\.?$/i.test(mensaje.trim());

    // Save user message (with session ID if provided)
    await db.insert(historialTable).values({
      rol: "usuario",
      contenido: mensaje || "[Archivo enviado]",
      ...(sesionId ? { sesionId } : {}),
    });

    // ── Context compression ───────────────────────────────────────────────────
    let historialUsado = historial;
    if (historial.length > 50) {
      sse({ tipo: "status", contenido: "🧠 Comprimiendo historial..." });
      try {
        const oldest = historial.slice(0, historial.length - 20);
        const resumenResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_completion_tokens: 600,
          messages: [
            { role: "system", content: "Resume concisamente esta conversación en español. Máximo 3 párrafos. Captura hechos importantes, decisiones y contexto clave." },
            ...oldest.map(h => ({ role: (h.rol === "usuario" ? "user" : "assistant") as "user" | "assistant", content: h.contenido })),
          ],
        });
        const resumen = resumenResp.choices[0]?.message?.content ?? "";
        historialUsado = [
          { rol: "assistant", contenido: `[📚 RESUMEN]\n${resumen}` },
          ...historial.slice(-20),
        ];
      } catch { /* use original */ }
    }

    // ── Build messages ────────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(reglas, memoria, botOnline);
    const mensajes: any[] = [
      { role: "system", content: systemPrompt },
      ...historialUsado.slice(-30).map(h => ({
        role: h.rol === "usuario" ? "user" : "assistant",
        content: h.contenido,
      })),
    ];

    // ── Detect if message implies PC/browser work (smart auto-screenshot) ──────
    const PC_KEYWORDS = /\b(abre|abrir|click|clic|navega|navegar|ve a|entra|busca en|escribe en|teclea|descarga|instala|ejecuta|corre|lanza|mueve|arrastra|pantalla|escritorio|ventana|browser|chrome|firefox|edge|youtube|google|twitch|discord|steam|spotify|word|excel|notepad|cmd|terminal|control\s*panel|tarea|tare[a-z]|haz|hazme|realiza|abre\s+el|cierra\s+el|minimiza|maximiza|captura|screenshot|foto de la|imagen de la)\b/i;
    const impliesPC = botOnline && PC_KEYWORDS.test(mensaje);

    // ── Late system injection: only hint when message truly implies PC work ────
    if (impliesPC) {
      mensajes.push({
        role: "system" as const,
        content: `El bot está ONLINE. El mensaje del usuario implica trabajo en PC — llama ejecutar_en_pc directamente. Una línea de contexto máximo, luego acción.`,
      });
    }

    // ── Auto-screenshot: solo cuando el mensaje implica trabajo en PC/browser ──
    let autoScreenBase64: string | null = null;
    if (impliesPC && !(archivoBase64 && archivoTipo?.startsWith("image/"))) {
      const isFreshOnDisk = fs.existsSync(SCREENSHOT_PATH) &&
        (Date.now() - fs.statSync(SCREENSHOT_PATH).mtimeMs) < 8000;
      if (!isFreshOnDisk) {
        sse({ tipo: "status", contenido: "📸 Capturando escritorio..." });
      }
      autoScreenBase64 = await autoScreenshotFast();
    }

    if (archivoBase64 && archivoTipo?.startsWith("image/")) {
      // User sent an image file — use that as the visual context
      mensajes.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${archivoTipo};base64,${archivoBase64}`, detail: "high" } },
          { type: "text", text: mensaje || "¿Qué ves en esta imagen? Analízala detalladamente." },
        ],
      });
    } else if (archivoBase64) {
      const textContent = Buffer.from(archivoBase64, "base64").toString("utf-8");
      const content: any[] = [
        { type: "text", text: `[📄 Archivo: ${archivoNombre ?? "archivo"}]\n\`\`\`\n${textContent.slice(0, 50000)}\n\`\`\`\n\n${mensaje}` },
      ];
      if (autoScreenBase64) {
        content.unshift(
          { type: "image_url", image_url: { url: `data:image/png;base64,${autoScreenBase64}`, detail: "high" } },
          { type: "text", text: `[🖥️ Vista actual del escritorio — ${new Date().toLocaleTimeString()}]` },
        );
      }
      mensajes.push({ role: "user", content: autoScreenBase64 ? content : content[0].text });
    } else if (autoScreenBase64) {
      // Text message + auto-screenshot: N.O.V.A. sees screen AND user message together
      mensajes.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${autoScreenBase64}`, detail: "high" } },
          { type: "text", text: `[🖥️ Vista actual del escritorio — ${new Date().toLocaleTimeString()}] (ya tienes el screenshot, no tomes otro)\n\n${mensaje}` },
        ],
      });
    } else {
      mensajes.push({ role: "user", content: mensaje });
    }

    // ── Streaming state ───────────────────────────────────────────────────────
    let fullContent = "";
    let imageUrl: string | null = null;

    // ── Filter tools based on bot availability ────────────────────────────────
    // When bot is offline, remove ejecutar_en_pc to prevent 30s timeouts
    const ACTIVE_TOOLS = botOnline
      ? TOOLS
      : TOOLS.filter(t => t.function.name !== "ejecutar_en_pc");

    // ── Loop/depth protection ─────────────────────────────────────────────────
    let toolCallCount = 0;
    const MAX_TOOL_CALLS = 200;
    const recentActions: string[] = [];
    let stuckAttempts = 0;       // recovery attempts for loop detection (max 5)
    let continuationCount = 0;   // auto-continuation attempts for premature stops (max 10)

    const isStuckInLoop = (): boolean => {
      const n = recentActions.length;
      if (n < 4) return false;

      // Stuck if same non-screenshot action repeated 4 times in a row
      const last4 = recentActions.slice(-4);
      if (last4.every(a => a === last4[0] && a !== "pc:screenshot")) return true;

      // Stuck if last 5 are ALL screenshots (model is blind-looping)
      if (n >= 5) {
        const last5 = recentActions.slice(-5);
        if (last5.every(a => a === "pc:screenshot")) return true;
      }

      // Stuck if last 6 have the exact same 2-action pair repeated 3× in a row
      // (requires 3 repetitions to avoid false-positives on legitimate work like
      //  screenshot→run_command→screenshot→run_command which is valid)
      if (n >= 6) {
        const last6 = recentActions.slice(-6);
        const [a, b] = last6;
        if (last6[2] === a && last6[3] === b && last6[4] === a && last6[5] === b) return true;
      }

      // Stuck if last 9 have the exact same 3-action sequence repeated 3× in a row
      // (3 cycles needed to avoid false positives on normal screenshot→cmd→screenshot work)
      if (n >= 9) {
        const last9 = recentActions.slice(-9);
        const part1 = last9.slice(0, 3).join(",");
        const part2 = last9.slice(3, 6).join(",");
        const part3 = last9.slice(6, 9).join(",");
        if (part1 === part2 && part2 === part3) return true;
      }

      return false;
    };

    // ── 225-second session timer — fires BEFORE Replit's 300s proxy kill ────
    // Saves full conversation state so user can resume with "continúa"
    const sessionTimer = setTimeout(async () => {
      if (res.writableEnded) return;
      sessionTimedOut = true;
      if (sesionId && latestMsgs.length > 0) {
        taskStateStore.set(sesionId, {
          msgs: trimOldScreenshots(latestMsgs),
          toolCallCount: latestToolCallCount,
          timestamp: Date.now(),
        });
      }
      const pauseMsg = `\n\n⏸️ **Pausa automática** — Límite de sesión de 3 min 45s alcanzado. Completé **${latestToolCallCount} pasos**. ${sesionId ? 'Di **"continúa"** y retomaré exactamente desde aquí.' : 'Di "continúa" para seguir.'}`;
      fullContent += pauseMsg;
      sse({ tipo: "token", contenido: pauseMsg });
      try { await db.insert(historialTable).values({ rol: "assistant", contenido: fullContent, ...(sesionId ? { sesionId } : {}) }); } catch { /* ignore */ }
      clearInterval(pingInterval);
      sse({ tipo: "done", respuesta: fullContent });
      if (!res.writableEnded) res.end();
    }, 225_000);
    req.on("close", () => clearTimeout(sessionTimer));

    // ── Recursive stream + tool handling ─────────────────────────────────────
    const streamAndCollect = async (msgs: any[], opts: { forceTool?: boolean } = {}): Promise<void> => {
      // Track latest msgs and count for session save on timeout
      latestMsgs = msgs;
      latestToolCallCount = toolCallCount;

      // Stop if session timed out or connection closed
      if (sessionTimedOut || res.writableEnded) return;

      // Hard depth limit
      if (toolCallCount >= MAX_TOOL_CALLS) {
        const aviso = `\n\n⚠️ Llegué al límite de ${MAX_TOOL_CALLS} acciones autónomas. Aquí está el resumen de lo que hice hasta ahora. Dime cómo continuar.`;
        fullContent += aviso;
        sse({ tipo: "token", contenido: aviso });
        return;
      }

      // Loop detection → up to 3 auto-recoveries before stopping
      if (isStuckInLoop()) {
        if (stuckAttempts < 5) {
          // RECOVERY MODE: reset tracker and inject alternative strategy
          stuckAttempts++;
          recentActions.length = 0;
          sse({ tipo: "status", contenido: `🔄 Detecté un bucle — estrategia alternativa #${stuckAttempts}...` });

          const recoveryInjection = {
            role: "system" as const,
            content: `⚠️ ALERTA DE BUCLE INTERNO: Llevas ${toolCallCount} acciones sin progreso visible. Las últimas acciones se repitieron sin efecto.

CAMBIO DE ESTRATEGIA OBLIGATORIO — elige UNA de estas alternativas:
• Si hay popup/modal/dialog bloqueando → keyboard_press "Escape" → screenshot
• Si la página sigue cargando → sleep 3s → screenshot
• Si el elemento no está visible → mouse_scroll para buscarlo → screenshot
• Si el cursor no sabe dónde hacer click → get_screen_info para conocer la resolución exacta
• Si hay un login/captcha que requiere Denison → PARA y di exactamente: "Necesito que hagas [acción específica] para continuar"
• Si la página se colgó → keyboard_hotkey Ctrl+R → sleep 3s → screenshot
• Intenta una ruta completamente diferente para lograr el mismo objetivo

NUNCA repitas exactamente la misma secuencia de acciones que acabas de hacer. Escoge algo distinto.`,
          };
          await streamAndCollect([...msgs, recoveryInjection]);
          return;
        } else {
          // RECOVERY FAILED: stop clearly without asking user to describe their screen
          const aviso = "\n\n⚠️ Llegué a un bloqueo después de varios intentos automáticos. Dime qué quieres que haga diferente y continúo desde donde quedé.";
          fullContent += aviso;
          sse({ tipo: "token", contenido: aviso });
          return;
        }
      }

      let toolCallId = "";
      let toolCallName = "";
      let toolCallArgs = "";

      // Trim old screenshots BEFORE every API call to prevent context explosion.
      // Without this, 10+ screenshots = 15-20 MB of base64 = token limit exceeded = silent task death.
      const trimmedMsgs = trimOldScreenshots(msgs);

      // ── OpenAI call with auto-retry on 429 rate limit ────────────────────────
      let stream: any;
      const MAX_API_RETRIES = 6;
      let msgsForCall = trimmedMsgs;
      for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
        try {
          stream = await openai.chat.completions.create({
            model: "gpt-4o",
            max_completion_tokens: attempt >= 2 ? 8192 : 16384, // reducir tokens en reintentos tardíos
            messages: msgsForCall,
            tools: ACTIVE_TOOLS,
            tool_choice: opts.forceTool ? "required" as const : "auto" as const,
            stream: true,
          });
          break; // success
        } catch (apiErr: any) {
          const errMsg: string = apiErr?.message || String(apiErr);
          const is429 = errMsg.includes("429") || errMsg.includes("Rate limit") || errMsg.includes("rate_limit") || apiErr?.status === 429;

          if (is429 && attempt < MAX_API_RETRIES) {
            // Extract exact wait time from OpenAI error message
            const msMatch = errMsg.match(/try again in (\d+)ms/);
            const sMatch  = errMsg.match(/try again in ([\d.]+)s/);
            let waitMs = Math.min(5000 * (attempt + 1), 30000); // backoff: 5s, 10s, 15s… max 30s
            if (msMatch) waitMs = Math.max(parseInt(msMatch[1]) + 500, waitMs);
            else if (sMatch) waitMs = Math.max(Math.ceil(parseFloat(sMatch[1]) * 1000) + 500, waitMs);

            // On 2nd+ retry: trim context more aggressively to reduce token usage
            if (attempt >= 1) {
              msgsForCall = trimOldScreenshots(msgsForCall);
              // Keep only last 12 messages + system prompt to reduce context size
              const systemMsgs = msgsForCall.filter((m: any) => m.role === "system");
              const nonSystem = msgsForCall.filter((m: any) => m.role !== "system");
              msgsForCall = [...systemMsgs, ...nonSystem.slice(-12)];
            }

            sse({ tipo: "status", contenido: `⏳ Límite de API — esperando ${(waitMs / 1000).toFixed(0)}s y reintento (${attempt + 1}/${MAX_API_RETRIES})...` });
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }

          // Non-retryable error or retries exhausted
          req.log.error({ apiErr }, "OpenAI API error in streamAndCollect");
          const aviso = `\n\n⛔ Límite de API alcanzado después de ${attempt} reintentos. Espera unos segundos y dime "continúa" para reintentar.`;
          fullContent += aviso;
          sse({ tipo: "token", contenido: aviso });
          return;
        }
      }

      for await (const chunk of stream) {
        if (res.writableEnded || sessionTimedOut) break;
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta?.content) {
          fullContent += delta.content;
          sse({ tipo: "token", contenido: delta.content });
        }

        if (delta?.tool_calls) {
          const tc = delta.tool_calls[0];
          if (tc?.id) toolCallId = tc.id;
          if (tc?.function?.name) toolCallName += tc.function.name;
          if (tc?.function?.arguments) toolCallArgs += tc.function.arguments;
        }

        if (finishReason === "tool_calls" && toolCallId) {
          let args: Record<string, any> = {};
          try { args = JSON.parse(toolCallArgs); } catch { args = {}; }

          // Track action count (before pushing to history so limits fire correctly)
          toolCallCount++;

          // Check hard limit FIRST
          if (toolCallCount > MAX_TOOL_CALLS) {
            const aviso = "\n\n⚠️ Llegué al límite de pasos autónomos (" + MAX_TOOL_CALLS + " acciones). Aquí está el resumen de lo que hice. Dime cómo continuar o qué quieres diferente.";
            fullContent += aviso;
            sse({ tipo: "token", contenido: aviso });
            return;
          }

          // Build action key — detect empty run_command BEFORE execution so it's
          // tracked with a distinct key (BLOCKED) that the loop detector can see.
          // Use the same flat+nested merge the handler uses so we don't false-positive.
          const cmdTipoRaw = String(args.tipo ?? "screenshot");
          const nestedPayload = (args.payload && typeof args.payload === "object" ? args.payload : {}) as Record<string, any>;
          const flatArgs2 = Object.fromEntries(
            Object.entries(args as Record<string, any>).filter(([k]) => k !== "tipo" && k !== "payload")
          );
          const mergedPayloadForCheck: Record<string, any> = { ...flatArgs2, ...nestedPayload };
          const isEmptyRunCommand = toolCallName === "ejecutar_en_pc"
            && cmdTipoRaw === "run_command"
            && !String(mergedPayloadForCheck.comando ?? "").trim();

          // Build a key unique enough to distinguish DIFFERENT commands from LOOPING ones.
          // For run_command: hash the first 50 chars of the command text so that
          // running 4 different commands in a row doesn't look like a loop,
          // but running the SAME command 4 times in a row still does.
          const actionKey = toolCallName === "ejecutar_en_pc"
            ? (() => {
                if (isEmptyRunCommand) return "pc:BLOCKED_run_command";
                if (cmdTipoRaw === "run_command") {
                  const cmdText = String(mergedPayloadForCheck.comando ?? "").trim().slice(0, 50);
                  return `pc:run_command:${cmdText}`;
                }
                if (cmdTipoRaw === "keyboard_type") {
                  const txt = String(mergedPayloadForCheck.texto ?? "").slice(0, 30);
                  return `pc:keyboard_type:${txt}`;
                }
                if (cmdTipoRaw === "mouse_click") {
                  return `pc:mouse_click:${mergedPayloadForCheck.x ?? 0},${mergedPayloadForCheck.y ?? 0}`;
                }
                return `pc:${cmdTipoRaw}`;
              })()
            : toolCallName;
          recentActions.push(actionKey);

          const assistantToolMsg = {
            role: "assistant" as const,
            content: null as any,
            tool_calls: [{ id: toolCallId, type: "function" as const, function: { name: toolCallName, arguments: toolCallArgs } }],
          };

          let toolResult = "";

          if (toolCallName === "buscar_web") {
            sse({ tipo: "status", contenido: `🔍 Buscando: "${args.query}"...` });
            toolResult = await buscarWeb(String(args.query ?? ""));

          } else if (toolCallName === "generar_imagen") {
            sse({ tipo: "status", contenido: "🎨 Generando imagen con DALL-E 3..." });
            try {
              const img = await openai.images.generate({
                model: "dall-e-3",
                prompt: String(args.prompt ?? "abstract digital art"),
                size: (["1024x1024", "1792x1024", "1024x1792"].includes(args.size) ? args.size : "1024x1024") as "1024x1024" | "1792x1024" | "1024x1792",
                quality: "hd",
                n: 1,
              });
              imageUrl = img.data[0]?.url ?? null;
              toolResult = imageUrl ? `Imagen generada exitosamente. URL: ${imageUrl}` : "No se pudo generar la imagen.";
              const txt = imageUrl ? "✅ Tu imagen está lista." : "No pude generar la imagen.";
              fullContent += txt;
              sse({ tipo: "token", contenido: txt });
            } catch {
              toolResult = "Error generando imagen.";
              fullContent += "No pude generar la imagen en este momento.";
              sse({ tipo: "token", contenido: "No pude generar la imagen." });
            }

          } else if (toolCallName === "verificar_ip") {
            sse({ tipo: "status", contenido: "🌐 Verificando IP y estado de red..." });
            toolResult = await verificarIP();

          } else if (toolCallName === "verificar_seguridad") {
            sse({ tipo: "status", contenido: `🛡️ Analizando seguridad de: ${args.objetivo}...` });
            toolResult = await verificarSeguridad(String(args.objetivo ?? ""));

          } else if (toolCallName === "buscar_nuevas_ias") {
            sse({ tipo: "status", contenido: "🤖 Buscando las últimas IAs y herramientas..." });
            toolResult = await buscarNuevasIAs(String(args.tipo ?? "modelos"));

          } else if (toolCallName === "auto_modificar") {
            sse({ tipo: "status", contenido: `⚙️ Auto-modificando: ${args.accion} → ${args.ruta}...` });
            toolResult = await autoModificar(args.accion, String(args.ruta ?? ""), args.contenido);

          } else if (toolCallName === "auto_debug") {
            const lang = String(args.lenguaje ?? "código");
            const errorActual = String(args.error_actual ?? "");
            sse({ tipo: "status", contenido: `🔬 Analizando error en ${lang}...` });
            toolResult = await autoDebug(
              String(args.codigo ?? ""),
              lang,
              errorActual,
              String(args.contexto ?? ""),
            );

          } else if (toolCallName === "commit_a_github") {
            const repo = String(args.repo ?? "") as "nova-api-server" | "nova-ui";
            const rutaEnRepo = String(args.ruta_en_repo ?? "");
            const contenidoCommit = String(args.contenido ?? "");
            const mensajeCommit = String(args.mensaje_commit ?? `NOVA auto-update: ${rutaEnRepo}`);
            sse({ tipo: "status", contenido: `🚀 Commiteando a GitHub → ${repo} (${rutaEnRepo})...` });
            toolResult = await commitAGithub(repo, rutaEnRepo, contenidoCommit, mensajeCommit);

          } else if (toolCallName === "leer_de_github") {
            const repo = String(args.repo ?? "") as "nova-api-server" | "nova-ui";
            const rutaEnRepo = String(args.ruta_en_repo ?? "");
            sse({ tipo: "status", contenido: `📖 Leyendo ${rutaEnRepo} desde GitHub...` });
            toolResult = await leerDeGithub(repo, rutaEnRepo);

          } else if (toolCallName === "patch_github") {
            const repo = String(args.repo ?? "") as "nova-api-server" | "nova-ui";
            const rutaEnRepo = String(args.ruta_en_repo ?? "");
            const buscar = String(args.buscar ?? "");
            const reemplazar = String(args.reemplazar ?? "");
            const mensajeCommit = String(args.mensaje_commit ?? `NOVA patch: ${rutaEnRepo}`);
            sse({ tipo: "status", contenido: `🔧 Aplicando patch en ${rutaEnRepo}...` });
            toolResult = await patchGithub(repo, rutaEnRepo, buscar, reemplazar, mensajeCommit);

          } else if (toolCallName === "guardar_memoria") {
            const clave = String(args.clave ?? "").trim();
            const valor = String(args.valor ?? "").trim();
            const categoria = String(args.categoria ?? "general");
            sse({ tipo: "status", contenido: `🧠 Guardando en memoria: ${clave}...` });
            if (clave && valor) {
              await db.insert(memoriaTable).values({ clave, valor, categoria });
              toolResult = JSON.stringify({ ok: true, guardado: `"${clave}" → "${valor.slice(0, 80)}"`, mensaje: "Dato guardado en memoria permanente. Estará disponible en futuras conversaciones." });
            } else {
              toolResult = JSON.stringify({ error: "clave y valor son requeridos" });
            }

          } else if (toolCallName === "ejecutar_en_pc") {
            const cmdTipo = String(args.tipo ?? "screenshot");
            // Resolve payload flexibly: model may send fields flat (args.x, args.y)
            // OR nested (args.payload.x, args.payload.y) — accept both
            const rawPayload = (args.payload && typeof args.payload === "object" ? args.payload : {}) as Record<string, any>;
            const flatArgs = Object.fromEntries(
              Object.entries(args as Record<string, any>).filter(([k]) => k !== "tipo" && k !== "payload")
            );
            // Explicit nested payload takes precedence over flat args
            const payload: Record<string, any> = { ...flatArgs, ...rawPayload };
            const statusMap: Record<string, string> = {
              screenshot: "📸 Capturando pantalla del escritorio...",
              mouse_click: `🖱️ Haciendo click en (${payload.x ?? "?"}, ${payload.y ?? "?"})...`,
              mouse_move: `🖱️ Moviendo cursor a (${payload.x ?? "?"}, ${payload.y ?? "?"})...`,
              mouse_scroll: `🖱️ Scrolleando en pantalla...`,
              keyboard_type: `⌨️ Escribiendo: "${String(payload.texto ?? "").slice(0, 40)}"...`,
              keyboard_press: `⌨️ Presionando tecla: ${payload.tecla ?? "?"}...`,
              keyboard_hotkey: `⌨️ Combinación de teclas: ${(payload.teclas ?? []).join("+")}...`,
              abrir_app: `🚀 Abriendo aplicación: ${payload.app ?? "?"}...`,
              abrir_url: `🌐 Abriendo URL: ${String(payload.url ?? "?").slice(0, 60)}...`,
              run_command: `💻 Ejecutando: ${String(payload.comando ?? "?").slice(0, 60)}...`,
              get_screen_info: "🖥️ Obteniendo información de pantalla...",
              get_processes: "📋 Listando procesos activos...",
              leer_archivo: `📄 Leyendo archivo: ${payload.ruta ?? "?"}...`,
              escribir_archivo: `✍️ Escribiendo archivo: ${payload.ruta ?? "?"}...`,
              copiar_texto: "📋 Copiando texto al portapapeles...",
              get_clipboard: "📋 Leyendo portapapeles...",
              sleep: `⏳ Esperando ${payload.segundos ?? 1} segundo(s)...`,
              navegar_a: `🌐 Navegando a: ${String(payload.url ?? "?").slice(0, 70)}...`,
              foco_ventana: `🪟 Trayendo ventana al frente: ${payload.titulo ?? payload.proceso ?? "?"}...`,
              cerrar_pestana: "❌ Cerrando pestaña activa...",
              tab_siguiente: "➡️ Cambiando al siguiente tab...",
              recargar_pagina: `🔄 Recargando página${payload.hard ? " (forzado)" : ""}...`,
              copiar_url_actual: "🔗 Leyendo URL del tab activo...",
              escanear_red: "🔌 Escaneando conexiones de red...",
              antivirus_scan: "🛡️ Ejecutando escaneo antivirus...",
              info_sistema: "💻 Obteniendo información del sistema...",
            };
            // ── Validate payload before sending to bot ────────────────────────
            const payloadErrors: string[] = [];
            if (["mouse_click","mouse_move"].includes(cmdTipo) && (payload.x == null || payload.y == null)) {
              payloadErrors.push(`${cmdTipo} requiere x e y numéricos. Usa get_screen_info para saber la resolución, o screenshot para ver dónde hacer click.`);
            }
            if (cmdTipo === "keyboard_type" && !String(payload.texto ?? "").trim()) {
              payloadErrors.push("keyboard_type requiere 'texto' no vacío. ¿Qué necesitas escribir exactamente?");
            }
            if (cmdTipo === "keyboard_press" && !String(payload.tecla ?? "").trim()) {
              payloadErrors.push("keyboard_press requiere 'tecla'. Ejemplos: 'enter', 'escape', 'tab', 'f5'.");
            }
            if (cmdTipo === "keyboard_hotkey" && !(payload.teclas?.length)) {
              payloadErrors.push("keyboard_hotkey requiere array 'teclas'. Ejemplo: ['ctrl','l'] para enfocar barra de URL.");
            }
            if (["navegar_a","abrir_url"].includes(cmdTipo) && !String(payload.url ?? "").trim()) {
              payloadErrors.push(`${cmdTipo} requiere 'url'. Especifica la URL completa con https://.`);
            }
            if (cmdTipo === "run_command" && !String(payload.comando ?? "").trim()) {
              payloadErrors.push("run_command requiere el campo 'comando' con el texto del comando a ejecutar. Ejemplo: {\"comando\": \"dir\"} en Windows o {\"comando\": \"ls -la\"} en Linux. Nunca llames run_command con payload vacío {}.");
            }
            if (cmdTipo === "leer_archivo" && !String(payload.ruta ?? "").trim()) {
              payloadErrors.push("leer_archivo requiere el campo 'ruta' con la ruta completa del archivo.");
            }
            if (cmdTipo === "escribir_archivo" && (!String(payload.ruta ?? "").trim() || payload.contenido == null)) {
              payloadErrors.push("escribir_archivo requiere 'ruta' y 'contenido'. No puedes escribir un archivo sin especificar ambos.");
            }
            if (cmdTipo === "abrir_app" && !String(payload.app ?? "").trim()) {
              payloadErrors.push("abrir_app requiere el campo 'app' con el nombre de la aplicación a abrir.");
            }

            // ── Execute or block ──────────────────────────────────────────────
            let pcImageBase64: string | undefined;
            let pcImageMime: string | undefined;

            if (payloadErrors.length > 0) {
              sse({ tipo: "status", contenido: `⛔ Acción bloqueada: ${cmdTipo} con valores vacíos` });
              toolResult = JSON.stringify({
                error: "ACCIÓN BLOQUEADA — payload inválido o vacío",
                problemas: payloadErrors,
                instruccion: "NO repitas esta acción con valores vacíos. En su lugar: usa copiar_url_actual para saber en qué página estás, screenshot para analizar la pantalla y obtener coordenadas reales, o pide a Denison que te diga el valor exacto.",
              });
            } else {
              // For screenshot: check cache first to show accurate status message
              let statusMsg = statusMap[cmdTipo] ?? `🖥️ Ejecutando: ${cmdTipo}...`;
              if (cmdTipo === "screenshot" && fs.existsSync(SCREENSHOT_PATH)) {
                const ssAge = Date.now() - fs.statSync(SCREENSHOT_PATH).mtimeMs;
                if (ssAge < 10_000) statusMsg = `📸 Screenshot (${Math.round(ssAge / 1000)}s — desde caché)`;
              }
              sse({ tipo: "status", contenido: statusMsg });
              const pcResult = await ejecutarEnPcTool(cmdTipo, payload);

              // ── Fail-safe hard stop ───────────────────────────────────────
              const pcResultParsed = (() => { try { return JSON.parse(pcResult.text); } catch { return {}; } })();
              if (pcResultParsed.failsafe) {
                const stopMsg = `\n\n⛔ **FAIL-SAFE ACTIVADO**\n\nEl cursor llegó a una esquina de la pantalla y pyautogui detuvo todos los comandos de mouse/teclado por seguridad.\n\n**Denison, necesito que hagas esto:**\n1. Mueve el mouse al **centro de la pantalla** (lejos de todas las esquinas)\n2. Dime **"listo"** y continuaré desde donde quedé`;
                fullContent += stopMsg;
                sse({ tipo: "token", contenido: stopMsg });
                return;
              }

              toolResult = pcResult.text;
              pcImageBase64 = pcResult.imageBase64;
              pcImageMime = pcResult.imageMime;
            }

            // Build continuation — inject screenshot as image message so model can SEE it
            const continueMsgs: any[] = [
              ...msgs,
              assistantToolMsg,
              { role: "tool" as const, content: toolResult, tool_call_id: toolCallId },
            ];
            if (pcImageBase64) {
              sse({ tipo: "status", contenido: "👁️ Analizando lo que veo en la pantalla..." });
              continueMsgs.push({
                role: "user" as const,
                content: [
                  { type: "image_url", image_url: { url: `data:${pcImageMime ?? "image/png"};base64,${pcImageBase64}`, detail: "high" } },
                  { type: "text", text: `Pantalla actual (acción #${toolCallCount} de ${MAX_TOOL_CALLS}). Analiza y ejecuta el PRÓXIMO PASO inmediatamente. Si la pantalla no cambió: prueba una estrategia diferente (Escape, scroll, esperar, recargar, otro elemento). Si encuentras un obstáculo que SOLO Denison puede resolver (login manual, captcha, MFA), díselo con instrucción específica. De lo contrario: CONTINÚA TRABAJANDO.` },
                ],
              });
            }
            toolCallId = ""; toolCallName = ""; toolCallArgs = "";
            await streamAndCollect(continueMsgs);
            return;
          }

          const continueMsgs = [
            ...msgs,
            assistantToolMsg,
            { role: "tool" as const, content: toolResult, tool_call_id: toolCallId },
          ];
          toolCallId = ""; toolCallName = ""; toolCallArgs = "";
          await streamAndCollect(continueMsgs);
        }
      }

      // ── Auto-continuation: model stopped (finish_reason=stop) mid-PC-task ────
      // This fires when the model produces text without calling a tool, even though
      // the task is not complete. We detect the situation and push it to continue.
      if (botOnline && continuationCount < 10 && !isStuckInLoop()) {
        const hasPCActions = recentActions.some(a => a.startsWith("pc:"));
        const hasStopSignal =
          fullContent.includes("⚠️") || fullContent.includes("⛔") ||
          /necesito que (tú|tu|denison)/i.test(fullContent) ||
          (/(✅|listo|completado|terminé|hecho)/i.test(fullContent) && toolCallCount > 3);

        if (!hasStopSignal) {
          if (hasPCActions) {
            // Was mid-task — model produced text instead of continuing the chain
            continuationCount++;
            sse({ tipo: "status", contenido: `🔄 Continuando tarea (paso ${toolCallCount + 1} de ${MAX_TOOL_CALLS})...` });
            const lastAssistantContent = fullContent.trim() || "Procesando...";
            const contMsgs = [
              ...msgs,
              { role: "assistant" as const, content: lastAssistantContent },
              {
                role: "user" as const,
                content: `Continúa con el siguiente paso — usa ejecutar_en_pc ahora mismo.`,
              },
            ];
            // forceTool: true → tool_choice: "required" → model MUST call a tool
            await streamAndCollect(contMsgs, { forceTool: true });
            return;
          } else if (toolCallCount === 0) {
            // No tools used at all — model described what it WILL do but didn't act
            const userText = msgs
              .filter(m => m.role === "user")
              .map(m =>
                typeof m.content === "string" ? m.content :
                Array.isArray(m.content)
                  ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ")
                  : ""
              )
              .join(" ");
            const looksLikePCTask =
              /abri|naveg|instal|migr|ejecut|abre|pon|sube|baj|clona|deploy|haz|crea|hace|subir|descargar|corre|lanza/i.test(userText);
            if (looksLikePCTask) {
              continuationCount++;
              sse({ tipo: "status", contenido: "⚡ Iniciando acción en PC..." });
              const lastAssistantContent = fullContent.trim() || "Entendido, procediendo...";
              const contMsgs = [
                ...msgs,
                { role: "assistant" as const, content: lastAssistantContent },
                {
                  role: "user" as const,
                  content: `Ejecuta la tarea ahora usando ejecutar_en_pc — acción directa sin texto.`,
                },
              ];
              await streamAndCollect(contMsgs, { forceTool: true });
              return;
            }
          }
        }
      }
    };

    // ── Resumption: use saved state if user said "continúa" ──────────────────
    if (isContinuacion && sesionId && taskStateStore.has(sesionId)) {
      const saved = taskStateStore.get(sesionId)!;
      taskStateStore.delete(sesionId);
      toolCallCount = saved.toolCallCount; // restore step count
      sse({ tipo: "status", contenido: `⚡ Reanudando desde el paso ${saved.toolCallCount} — N.O.V.A. continúa ahora...` });
      const resumeMsgs = [
        ...saved.msgs,
        { role: "user" as const, content: "Continúa exactamente desde donde quedaste. Ejecuta el siguiente paso ahora usando ejecutar_en_pc." },
      ];
      await streamAndCollect(resumeMsgs, { forceTool: true });
    } else {
      await streamAndCollect(mensajes);
    }

    clearTimeout(sessionTimer);

    // ── Fallback for completely empty response (all tool calls, no text output) ─
    if (!fullContent.trim()) {
      const fallback = "✅ Acciones ejecutadas en el PC. Usa screenshot para verificar el estado actual si lo necesitas.";
      fullContent = fallback;
      sse({ tipo: "token", contenido: fallback });
    }

    // ── Parse JSON actions ────────────────────────────────────────────────────
    let accion: string | undefined;
    let datos: Record<string, unknown> | undefined;
    let botCommandIds: number[] = [];
    let finalRespuesta = fullContent;

    try {
      // Only parse as an action if the content specifically declares "accion" at the top level.
      // This prevents false matches on JSON inside markdown code blocks or tool results.
      const hasAction = /"accion"\s*:/.test(fullContent) && /"respuesta"\s*:/.test(fullContent);
      const jsonMatch = hasAction ? fullContent.match(/\{[\s\S]*\}/) : null;
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          respuesta?: string;
          accion?: string;
          datos?: Record<string, unknown>;
          bot_tipo?: string;
          bot_payload?: Record<string, unknown>;
          bot_comandos?: { tipo: string; payload?: Record<string, unknown> }[];
        };

        if (parsed.accion) {
          accion = parsed.accion;
          datos = parsed.datos;
          finalRespuesta = parsed.respuesta ?? fullContent;

          if (parsed.accion === "bot_comando" && parsed.bot_tipo) {
            const [cmd] = await db.insert(botCommandsTable).values({
              tipo: parsed.bot_tipo,
              payload: (parsed.bot_payload ?? {}) as any,
            }).returning();
            botCommandIds = [cmd.id];
          }

          if (parsed.accion === "bot_secuencia" && Array.isArray(parsed.bot_comandos)) {
            for (const c of parsed.bot_comandos) {
              const [cmd] = await db.insert(botCommandsTable).values({
                tipo: c.tipo,
                payload: (c.payload ?? {}) as any,
              }).returning();
              botCommandIds.push(cmd.id);
            }
          }
        }
      }
    } catch { /* use raw content */ }

    // Save assistant response (with session ID if provided)
    await db.insert(historialTable).values({
      rol: "assistant",
      contenido: finalRespuesta,
      ...(sesionId ? { sesionId } : {}),
    });

    clearInterval(pingInterval);
    sse({ tipo: "done", respuesta: finalRespuesta, imageUrl, botCommandIds, accion, datos });

  } catch (err: any) {
    clearInterval(pingInterval);
    req.log.error({ err }, "Error en streaming IA");
    sse({ tipo: "error", contenido: "Error procesando tu solicitud. Intenta de nuevo." });
  }

  if (!res.writableEnded) res.end();
});

// ── Scheduled tasks runner ────────────────────────────────────────────────────
setInterval(async () => {
  try {
    const now = new Date();
    const horaActual = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const diaActual = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"][now.getDay()];

    const tareas = await db.select().from(tareasTable).where(
      and(eq(tareasTable.activa, true), eq(tareasTable.hora, horaActual))
    );

    for (const tarea of tareas) {
      if (tarea.ultimaEjecucion) {
        const last = new Date(tarea.ultimaEjecucion);
        if (last.toDateString() === now.toDateString()) continue;
      }
      if (tarea.diasSemana && tarea.diasSemana.length > 0 && !tarea.diasSemana.includes(diaActual)) {
        continue;
      }

      const payload = tarea.payload as any;
      if (tarea.accion === "bot_comando" && payload?.tipo) {
        await db.insert(botCommandsTable).values({ tipo: payload.tipo, payload: payload.payload ?? {} });
      }

      await db.update(tareasTable).set({ ultimaEjecucion: now }).where(eq(tareasTable.id, tarea.id));
    }
  } catch { /* silent */ }
}, 60000);

export default router;
