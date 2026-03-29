/**
 * NovaChatContext — Global AI streaming state.
 *
 * Lives above the router so SSE streams survive page navigation.
 * The chat page is just a view; all state & logic lives here.
 */
import { createContext, useContext, useRef, useState, useCallback, useEffect, ReactNode } from "react";
import { useReglas, useMemoria } from "@/hooks/use-asistente";

import { API_BASE } from "@/lib/api-url";
const BASE = API_BASE;

// ── Types ──────────────────────────────────────────────────────────────────────
export type LocalMessage = {
  rol: "user" | "assistant" | "system";
  contenido: string;
  imageUrl?: string;
  tipo?: "normal" | "bot-resultado" | "vision";
};

export type SessionMeta = {
  sesion_id: string;
  primera_vez: string;
  ultima_vez: string;
  total: number;
  primer_mensaje: string;
};

export type UploadedFile = {
  name: string;
  type: string;
  base64: string;
  preview?: string;
};

function initSessionId(): string {
  let id = localStorage.getItem("nova_session_current");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("nova_session_current", id);
  }
  return id;
}

// ── Context shape ──────────────────────────────────────────────────────────────
interface NovaChatContextValue {
  localMessages: LocalMessage[];
  setLocalMessages: React.Dispatch<React.SetStateAction<LocalMessage[]>>;
  isStreaming: boolean;
  streamingStatus: string | null;
  sessionId: string;
  sessions: SessionMeta[];
  botOnline: boolean;
  botResultsQueue: number[];
  setBotResultsQueue: React.Dispatch<React.SetStateAction<number[]>>;
  selfRepairActive: boolean;
  toggleSelfRepair: () => void;

  sendMessage: (
    msg: string,
    fileBase64?: string,
    fileTipo?: string,
    fileNombre?: string,
    speakFn?: (text: string) => void
  ) => Promise<void>;
  pauseStream: () => void;

  loadSessionMessages: (sid: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  handleNuevoChat: () => void;
  handleSwitchSession: (sid: string, onDone?: () => void) => void;
  handleEliminarSesion: (sid: string) => Promise<void>;
  handleEliminarChat: () => Promise<void>;

  abortRef: React.MutableRefObject<AbortController | null>;
  streamingRef: React.MutableRefObject<boolean>;
}

const NovaChatContext = createContext<NovaChatContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────────
export function NovaChatProvider({ children }: { children: ReactNode }) {
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>(initSessionId);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [botOnline, setBotOnline] = useState(false);
  const [botResultsQueue, setBotResultsQueue] = useState<number[]>([]);
  const [selfRepairActive, setSelfRepairActive] = useState<boolean>(
    () => localStorage.getItem("nova_self_repair") !== "false"
  );

  const toggleSelfRepair = useCallback(() => {
    setSelfRepairActive(prev => {
      const next = !prev;
      localStorage.setItem("nova_self_repair", String(next));
      return next;
    });
  }, []);

  const pauseStream = useCallback(() => {
    if (!streamingRef.current) return;
    abortRef.current?.abort();
    streamingRef.current = false;
    setIsStreaming(false);
    setStreamingStatus(null);
    setLocalMessages(prev => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.rol === "assistant") {
        const txt = last.contenido?.trim();
        copy[copy.length - 1] = {
          ...last,
          contenido: txt ? txt + "\n\n_⏸ Respuesta pausada._" : "⏸ Respuesta pausada.",
        };
      }
      return copy;
    });
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);

  const { data: reglasData } = useReglas();
  const { data: memoriaData } = useMemoria();

  // ── Bot status polling ─────────────────────────────────────────────────────
  const checkBot = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/bot/status`);
      const d = await r.json();
      setBotOnline(d.online ?? false);
    } catch { setBotOnline(false); }
  }, []);

  useEffect(() => {
    checkBot();
    const id = setInterval(checkBot, 8000);
    return () => clearInterval(id);
  }, [checkBot]);

  // ── Load session messages ──────────────────────────────────────────────────
  const loadSessionMessages = useCallback(async (sid: string) => {
    if (streamingRef.current) return;
    try {
      const r = await fetch(`${BASE}/api/asistente/historial?sesionId=${encodeURIComponent(sid)}`);
      const d = await r.json();
      if (Array.isArray(d.historial)) {
        setLocalMessages(d.historial.map((h: any) => ({
          rol: h.rol === "usuario" ? "user" : "assistant",
          contenido: h.contenido,
        })));
      }
    } catch { /* silent */ }
  }, []);

  // ── Load sessions list ─────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/asistente/historial/sesiones`);
      const d = await r.json();
      setSessions(d.sesiones ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setLocalMessages([]);
    loadSessionMessages(sessionId);
  }, [sessionId, loadSessionMessages]);

  // ── Bot results polling ────────────────────────────────────────────────────
  const botPollAttempts = useRef(0);
  useEffect(() => {
    if (botResultsQueue.length === 0) return;
    botPollAttempts.current = 0;
    const poll = setInterval(async () => {
      botPollAttempts.current += 1;
      if (botPollAttempts.current > 30) { setBotResultsQueue([]); return; }
      try {
        const ids = botResultsQueue.join(",");
        const r = await fetch(`${BASE}/api/bot/commands/results?ids=${ids}`);
        const data = await r.json();
        const commands: any[] = data.commands ?? [];
        const completed = commands.filter(c => c.estado === "completado" || c.estado === "error");

        for (const cmd of completed) {
          const res = cmd.resultado as any;
          if (!res) continue;
          let contenido = "";
          if (cmd.estado === "error" || res?.ok === false) {
            contenido = `❌ Error en \`${cmd.tipo}\`: ${res?.error ?? "desconocido"}`;
          } else if (cmd.tipo === "run_command" && (res?.salida || res?.stdout || res?.stderr)) {
            const out = res?.salida || res?.stdout || res?.stderr || "(sin salida)";
            const code = res?.codigo !== undefined ? ` (código: ${res.codigo})` : "";
            contenido = `\`\`\`\n${String(out).slice(0, 4000)}\n\`\`\`${code}`;
          } else if (cmd.tipo === "get_processes" && res?.procesos) {
            const procs = (res.procesos as any[]).slice(0, 15).map((p: any) => `• **${p.nombre ?? p.name ?? "?"}** — PID ${p.pid ?? "?"} — ${p.memoria_mb ?? "?"} MB`).join("\n");
            contenido = `**Procesos activos (top por CPU):**\n${procs}`;
          } else if (cmd.tipo === "get_clipboard" && res?.contenido !== undefined) {
            contenido = `📋 **Portapapeles:**\n\`\`\`\n${String(res.contenido).slice(0, 2000)}\n\`\`\``;
          } else if (cmd.tipo === "leer_archivo" && res?.contenido) {
            contenido = `📄 **Archivo leído:**\n\`\`\`\n${String(res.contenido).slice(0, 3000)}\n\`\`\``;
          } else if (cmd.tipo === "get_screen_info" && (res?.ancho || res?.pantalla)) {
            const ancho = res.ancho ?? res.pantalla?.ancho;
            const alto = res.alto ?? res.pantalla?.alto;
            contenido = `🖥️ Pantalla: **${ancho}×${alto}** px | Cursor: (${res.cursor_x ?? res.cursor?.x}, ${res.cursor_y ?? res.cursor?.y})`;
          } else if (cmd.tipo === "screenshot" && res?.ok) {
            contenido = `📸 Captura tomada. [Ver en Bot Local](/bot)`;
          } else if (cmd.tipo === "escanear_red" && res?.ok) {
            const ext = (res.externas ?? []) as any[];
            const lineas = ext.slice(0, 10).map((c: any) => `• \`${c.proceso || "desconocido"}\` → ${c.remoto} (${c.estado})`).join("\n");
            contenido = `🔌 **Red escaneada:** ${res.total ?? 0} conexiones activas\n\n**Externas (${ext.length}):**\n${lineas || "Ninguna"}`;
          } else if (cmd.tipo === "antivirus_scan" && res?.ok) {
            contenido = `🛡️ **Escaneo antivirus:**\n\n${res.estado}\n• Archivos: **${res.archivos_analizados}**\n• Amenazas: **${res.amenazas_detectadas}**`;
          } else if (cmd.tipo === "info_sistema" && res?.ok) {
            contenido = `💻 **Sistema:**\n• OS: ${res.os}\n• CPU: **${res.cpu_porcentaje}%**\n• RAM: **${res.ram_usada_gb}/${res.ram_total_gb} GB** (${res.ram_porcentaje}%)\n• Disco: **${res.disco_libre_gb} GB libres** (${res.disco_porcentaje}% usado)`;
          } else if (res?.ok === true) {
            contenido = `✅ \`${cmd.tipo}\` ejecutado correctamente.`;
          }
          if (contenido) setLocalMessages(prev => [...prev, { rol: "assistant", contenido, tipo: "bot-resultado" }]);
        }

        const completedIds = completed.map((c: any) => c.id as number);
        setBotResultsQueue(prev => prev.filter(id => !completedIds.includes(id)));
      } catch { /* silent */ }
    }, 2000);
    return () => clearInterval(poll);
  }, [botResultsQueue]);

  // ── Core sendMessage — SSE stream ─────────────────────────────────────────
  const sendMessage = useCallback(async (
    msg: string,
    fileBase64?: string,
    fileTipo?: string,
    fileNombre?: string,
    speakFn?: (text: string) => void
  ) => {
    if (isStreaming || (!msg.trim() && !fileBase64)) return;

    const userText = msg.trim() || (fileNombre ? `[Archivo: ${fileNombre}]` : "");
    setLocalMessages(prev => [...prev, { rol: "user", contenido: userText }]);
    setLocalMessages(prev => [...prev, { rol: "assistant", contenido: "" }]);
    setIsStreaming(true);
    setStreamingStatus(null);
    streamingRef.current = true;

    const reglas = reglasData?.reglas.filter(r => r.activa).map(r => r.descripcion) ?? [];
    const memoria = memoriaData?.memoria.map(m => `${m.clave}: ${m.valor}`) ?? [];

    const historial = localMessages
      .filter(m => !m.tipo || m.tipo === "normal")
      .slice(-20)
      .map(m => ({ rol: m.rol === "user" ? "usuario" : "assistant", contenido: m.contenido }));

    abortRef.current?.abort();
    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    const currentSessionId = sessionId;

    try {
      const response = await fetch(`${BASE}/api/asistente/ia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensaje: msg,
          historial,
          reglas,
          memoria,
          botOnline,
          sesionId: currentSessionId,
          archivoBase64: fileBase64,
          archivoTipo: fileTipo,
          archivoNombre: fileNombre,
        }),
      });

      if (!response.body) throw new Error("No stream body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accText = "";

      let timeoutId: ReturnType<typeof setTimeout>;
      const resetTimeout = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => { reader.cancel("timeout-180s").catch(() => {}); }, 180_000);
      };
      resetTimeout();

      const updateLastMsg = (contenido: string, extra?: Partial<LocalMessage>) => {
        setLocalMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { rol: "assistant", contenido, ...extra };
          return copy;
        });
      };

      const exitStream = () => {
        clearTimeout(timeoutId);
        reader.cancel("exit").catch(() => {});
      };

      abortCtrl.signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        reader.cancel("aborted").catch(() => {});
      });

      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;

          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as any;

              if (event.tipo === "ping") {
                resetTimeout();
              } else if (event.tipo === "token") {
                accText += event.contenido;
                setStreamingStatus(null);
                updateLastMsg(accText);
              } else if (event.tipo === "status") {
                setStreamingStatus(event.contenido);
              } else if (event.tipo === "done") {
                const finalText = event.respuesta ?? accText;
                setStreamingStatus(null);
                updateLastMsg(finalText, { imageUrl: event.imageUrl ?? undefined });
                speakFn?.(finalText);

                if (Array.isArray(event.botCommandIds) && event.botCommandIds.length > 0) {
                  setBotResultsQueue(event.botCommandIds);
                }
                if (event.accion === "abrir_url" && event.datos?.url) window.open(event.datos.url, "_blank");
                if (event.accion === "buscar_google" && event.datos?.busqueda) window.open(`https://google.com/search?q=${encodeURIComponent(event.datos.busqueda)}`, "_blank");
                if (event.accion === "copiar_texto" && event.datos?.texto) navigator.clipboard.writeText(event.datos.texto).catch(() => {});

                exitStream();
                return;
              } else if (event.tipo === "error") {
                setStreamingStatus(null);
                updateLastMsg(`❌ ${event.contenido}`);
                exitStream();
                return;
              }
            } catch { /* malformed SSE line */ }
          }
        }
        if (accText) updateLastMsg(accText);
        else updateLastMsg("⌛ Conexión cerrada sin respuesta. Intenta de nuevo.");
      } finally {
        clearTimeout(timeoutId);
        reader.cancel("finally").catch(() => {});
      }

    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setLocalMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { rol: "assistant", contenido: "❌ Error de conexión. Intenta de nuevo." };
          return copy;
        });
      }
    } finally {
      streamingRef.current = false;
      setIsStreaming(false);
      setStreamingStatus(null);
      loadSessionMessages(currentSessionId);
    }
  }, [isStreaming, reglasData, memoriaData, localMessages, botOnline, sessionId, loadSessionMessages]);

  // ── Session management ─────────────────────────────────────────────────────
  const handleNuevoChat = useCallback(() => {
    abortRef.current?.abort();
    streamingRef.current = false;
    const newId = crypto.randomUUID();
    localStorage.setItem("nova_session_current", newId);
    setSessionId(newId);
    setLocalMessages([]);
    setIsStreaming(false);
    setStreamingStatus(null);
  }, []);

  const handleSwitchSession = useCallback((sid: string, onDone?: () => void) => {
    abortRef.current?.abort();
    streamingRef.current = false;
    localStorage.setItem("nova_session_current", sid);
    setSessionId(sid);
    setLocalMessages([]);
    setIsStreaming(false);
    setStreamingStatus(null);
    onDone?.();
  }, []);

  const handleEliminarSesion = useCallback(async (sid: string) => {
    try {
      await fetch(`${BASE}/api/asistente/historial?sesionId=${encodeURIComponent(sid)}`, { method: "DELETE" });
      if (sid === sessionId) handleNuevoChat();
      loadSessions();
    } catch { /* silent */ }
  }, [sessionId, handleNuevoChat, loadSessions]);

  const handleEliminarChat = useCallback(async () => {
    try {
      await fetch(`${BASE}/api/asistente/historial?sesionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      setLocalMessages([]);
    } catch { /* silent */ }
  }, [sessionId]);

  return (
    <NovaChatContext.Provider value={{
      localMessages, setLocalMessages,
      isStreaming, streamingStatus, sessionId, sessions,
      botOnline, botResultsQueue, setBotResultsQueue,
      selfRepairActive, toggleSelfRepair,
      sendMessage, pauseStream,
      loadSessionMessages, loadSessions,
      handleNuevoChat, handleSwitchSession,
      handleEliminarSesion, handleEliminarChat,
      abortRef, streamingRef,
    }}>
      {children}
    </NovaChatContext.Provider>
  );
}

export function useNovaChat() {
  const ctx = useContext(NovaChatContext);
  if (!ctx) throw new Error("useNovaChat must be used inside NovaChatProvider");
  return ctx;
}
