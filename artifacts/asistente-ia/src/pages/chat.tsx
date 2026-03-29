import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Mic, MicOff, Volume2, VolumeX, Terminal, Bot, Paperclip, X, Loader2, Search, Image as ImageIcon, Cpu, Plus, Trash2, AlertTriangle, Monitor, MessageSquare, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import { Layout } from "@/components/layout";
import { PageTransition } from "@/components/ui-elements";
import { useVoice } from "@/hooks/use-voice";
import { useNovaChat } from "@/context/nova-chat";
import { cn } from "@/lib/utils";

import { API_BASE } from "@/lib/api-url";
const BASE = API_BASE;

type UploadedFile = {
  name: string;
  type: string;
  base64: string;
  preview?: string;
};

export default function ChatPage() {
  // ── UI-only state (lives in this component only) ──────────────────────────
  const [input, setInput] = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSessions, setShowSessions] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Global AI state from context (persists across page navigation) ────────
  const {
    localMessages, isStreaming, sessionId,
    sessions, botOnline,
    sendMessage, loadSessions, handleNuevoChat,
    handleSwitchSession, handleEliminarSesion, handleEliminarChat,
  } = useNovaChat();

  // ── Voice ─────────────────────────────────────────────────────────────────
  const { isListening, toggleListening, speak, voiceEnabled, toggleVoice, supported: voiceSupported } = useVoice({
    onResult: (text) => setInput(prev => prev + " " + text),
  });

  // ── Scroll to bottom on new messages ──────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages, isStreaming]);

  // ── Wrapped send — passes the speak function to the context sendMessage ───
  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && !uploadedFile) return;
    const msg = input;
    const file = uploadedFile;
    setInput("");
    setUploadedFile(null);
    sendMessage(msg, file?.base64, file?.type, file?.name, speak);
  };

  // ── Quick-send from suggestion chips ─────────────────────────────────────
  const quickSend = (msg: string) => sendMessage(msg, undefined, undefined, undefined, speak);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("Archivo muy grande. Máximo 10MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setUploadedFile({
        name: file.name,
        type: file.type,
        base64: dataUrl.split(",")[1],
        preview: file.type.startsWith("image/") ? dataUrl : undefined,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ── Desktop vision capture ────────────────────────────────────────────────
  const handleVerEscritorio = useCallback(async () => {
    if (!botOnline || visionLoading || isStreaming) return;
    setVisionLoading(true);
    try {
      const r = await fetch(`${BASE}/api/bot/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "screenshot", payload: {} }),
      });
      const { id } = await r.json();
      for (let i = 0; i < 15; i++) {
        await new Promise(res => setTimeout(res, 1500));
        const sr = await fetch(`${BASE}/api/bot/commands/results?ids=${id}`);
        const sd = await sr.json();
        const cmd = sd.commands?.[0];
        if (cmd?.estado === "completado") {
          const imgResp = await fetch(`${BASE}/api/bot/last-screenshot?ts=${Date.now()}`);
          if (!imgResp.ok) break;
          const blob = await imgResp.blob();
          const base64 = await new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res((fr.result as string).split(",")[1]);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
          });
          await sendMessage(
            "Analiza esta captura de mi escritorio en detalle. Describe todo lo que ves: aplicaciones abiertas, contenido visible, errores o notificaciones. Luego dime qué puedes hacer para ayudarme a trabajar con lo que ves, y si puedes ejecutar acciones en la PC usando el bot (movimiento de ratón, clicks, escribir texto, ejecutar comandos), ofrécete a hacerlo.",
            base64, "image/png", "escritorio.png", speak
          );
          break;
        }
        if (cmd?.estado === "error") break;
      }
    } catch { /* silent */ }
    finally { setVisionLoading(false); }
  }, [botOnline, visionLoading, isStreaming, sendMessage, speak]);

  // ── Delete current chat ───────────────────────────────────────────────────
  const doEliminarChat = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await handleEliminarChat();
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }, [deleting, handleEliminarChat]);

  // ── Sessions panel handlers ───────────────────────────────────────────────
  const openSessions = () => { loadSessions(); setShowSessions(true); };
  const nuevoChat = () => { handleNuevoChat(); setShowSessions(false); };
  const switchSession = (sid: string) => {
    if (sid === sessionId) { setShowSessions(false); return; }
    handleSwitchSession(sid, () => setShowSessions(false));
  };

  return (
    <Layout>
      <PageTransition className="flex flex-col h-full bg-background/50">

        {/* ── Sessions slide-in panel ─────────────────────────────────────── */}
        <AnimatePresence>
          {showSessions && (
            <>
              <motion.div
                key="sessions-backdrop"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowSessions(false)}
              />
              <motion.div
                key="sessions-panel"
                initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="fixed top-0 right-0 bottom-0 z-50 w-80 bg-[#0a0a12] border-l border-white/10 flex flex-col"
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm text-white">Historial de Chats</span>
                  </div>
                  <button onClick={() => setShowSessions(false)} className="p-1 rounded-lg text-gray-500 hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="px-4 py-3 border-b border-white/5">
                  <button
                    onClick={nuevoChat}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/20 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Nuevo chat
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto py-2">
                  {sessions.length === 0 ? (
                    <div className="text-center text-gray-600 text-xs py-8 px-4">No hay chats anteriores guardados</div>
                  ) : (
                    sessions.map(s => (
                      <div
                        key={s.sesion_id}
                        className={cn(
                          "mx-2 mb-1 rounded-xl border px-4 py-3 cursor-pointer transition-all group flex items-start justify-between gap-2",
                          s.sesion_id === sessionId
                            ? "bg-primary/10 border-primary/30"
                            : "bg-white/3 border-white/5 hover:bg-white/5 hover:border-white/10"
                        )}
                        onClick={() => switchSession(s.sesion_id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-xs font-medium truncate", s.sesion_id === sessionId ? "text-primary" : "text-gray-300")}>
                            {s.primer_mensaje ? String(s.primer_mensaje).slice(0, 60) : "Chat sin nombre"}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Clock className="w-2.5 h-2.5 text-gray-600" />
                            <span className="text-[10px] text-gray-600">
                              {new Date(s.ultima_vez).toLocaleDateString("es-DO", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="text-[10px] text-gray-700">· {s.total} msg</span>
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleEliminarSesion(s.sesion_id); }}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg text-red-500/60 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          title="Eliminar este chat"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Chat Header ─────────────────────────────────────────────────── */}
        <header className="px-6 py-4 border-b border-border/50 glass-panel z-20 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-primary" />
            <h2 className="font-display text-xl text-foreground font-semibold hidden sm:block">Interfaz de Comando</h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Bot status */}
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all",
              botOnline ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" : "bg-gray-800/50 border-gray-700 text-gray-600"
            )}>
              <Bot className="w-3 h-3" />
              <span className={cn("w-1.5 h-1.5 rounded-full", botOnline ? "bg-cyan-400 animate-pulse" : "bg-gray-600")} />
              {botOnline ? "BOT PC" : "BOT OFF"}
            </div>

            {botOnline && (
              <button
                onClick={handleVerEscritorio}
                disabled={visionLoading || isStreaming}
                title="N.O.V.A. captura tu escritorio y trabaja de forma autónoma"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold border transition-all",
                  visionLoading
                    ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-300 animate-pulse"
                    : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40"
                )}
              >
                {visionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Monitor className="w-3 h-3" />}
                {visionLoading ? "CAPTURANDO..." : "VER ESCRITORIO"}
              </button>
            )}

            {voiceSupported && (
              <button
                onClick={toggleVoice}
                className={cn("p-2 rounded-full border transition-all", voiceEnabled ? "border-primary/30 text-primary" : "border-gray-700 text-gray-600")}
                title={voiceEnabled ? "Voz activada" : "Voz desactivada"}
              >
                {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            )}

            <div className="w-px h-6 bg-white/10 mx-1" />

            <button
              onClick={openSessions}
              title="Ver chats anteriores"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border border-white/10 text-gray-400 hover:border-primary/30 hover:text-primary transition-all"
            >
              <MessageSquare className="w-3 h-3" />
              CHATS
            </button>

            <button
              onClick={nuevoChat}
              disabled={isStreaming}
              title="Nuevo chat — el actual se guarda en el historial"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border border-white/10 text-gray-400 hover:border-primary/30 hover:text-primary transition-all disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
              NUEVO
            </button>

            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isStreaming || localMessages.length === 0}
              title="Borrar el chat actual"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border border-red-500/20 text-red-500/70 hover:bg-red-500/10 hover:text-red-400 transition-all disabled:opacity-30"
            >
              <Trash2 className="w-3 h-3" />
              BORRAR
            </button>
          </div>
        </header>

        {/* ── Chat messages ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scroll-smooth">
          {localMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50 select-none">
              <div className="w-24 h-24 mb-6 rounded-full border border-primary/20 flex items-center justify-center relative">
                <div className="absolute inset-0 bg-primary/10 rounded-full blur-xl" />
                <img src={`${import.meta.env.BASE_URL}images/ai-avatar.png`} alt="IA" className="w-full h-full object-cover rounded-full mix-blend-screen" />
              </div>
              <p className="font-display text-2xl text-primary/80 mb-2">N.O.V.A En Línea</p>
              <p className="text-muted-foreground font-mono text-sm max-w-md">Superinteligencia activa. Búsqueda web, visión, generación de imágenes, control de PC.</p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center max-w-md">
                {["¿Cuál es mi IP y VPN?", "Busca las últimas IAs de 2025", "Analiza si google.com es seguro", "Genera una imagen de un dragón neon cyberpunk", "Escanea la red de mi PC", "Mejórate a ti misma"].map(s => (
                  <button key={s} onClick={() => quickSend(s)} className="text-[10px] px-3 py-1.5 rounded-full border border-white/10 text-muted-foreground hover:border-primary/30 hover:text-primary transition-all font-mono">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {localMessages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className={cn("flex w-full", msg.rol === "user" ? "justify-end" : "justify-start")}
                >
                  <div className={cn(
                    "max-w-[88%] md:max-w-[78%] rounded-2xl p-4 shadow-lg",
                    msg.rol === "user"
                      ? "bg-primary/10 border border-primary/30 text-primary-foreground backdrop-blur-md rounded-br-sm"
                      : msg.tipo === "status"
                        ? "bg-cyan-950/20 border border-cyan-400/15 text-cyan-200/70 text-[11px] font-mono py-1.5 px-3 rounded-lg flex items-center gap-2 max-w-full"
                        : msg.tipo === "bot-resultado"
                          ? "bg-cyan-950/40 border border-cyan-500/20 text-card-foreground rounded-bl-sm"
                          : "bg-card border border-white/5 text-card-foreground rounded-bl-sm"
                  )}>
                    {msg.rol === "assistant" && msg.tipo !== "status" && (
                      <div className="flex items-center gap-2 mb-2">
                        {msg.tipo === "bot-resultado"
                          ? <><Cpu className="w-3 h-3 text-cyan-400" /><span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">BOT_RESULTADO</span></>
                          : <><span className="w-2 h-2 rounded-full bg-accent animate-pulse" /><span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">N.O.V.A</span></>
                        }
                      </div>
                    )}

                    {msg.tipo === "status" && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}

                    {msg.imageUrl && (
                      <div className="mb-3 rounded-xl overflow-hidden border border-white/10">
                        <img src={msg.imageUrl} alt="Imagen generada" className="w-full max-w-lg rounded-xl" />
                      </div>
                    )}

                    {msg.contenido && (
                      <div className={cn(
                        "prose prose-sm max-w-none",
                        msg.rol === "user" ? "prose-invert text-foreground" : "prose-invert",
                        msg.tipo === "status" && "not-prose text-[11px] text-cyan-200/70"
                      )}>
                        {msg.tipo === "status" ? msg.contenido : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.contenido}</ReactMarkdown>
                        )}
                      </div>
                    )}

                    {msg.rol === "assistant" && idx === localMessages.length - 1 && isStreaming && !msg.imageUrl && (
                      <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse" />
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* ── File preview strip ───────────────────────────────────────────── */}
        {uploadedFile && (
          <div className="px-6 pb-2 flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm">
              {uploadedFile.preview
                ? <img src={uploadedFile.preview} alt="preview" className="w-8 h-8 rounded object-cover" />
                : <Paperclip className="w-4 h-4 text-primary" />
              }
              <span className="text-xs text-primary font-mono truncate max-w-[200px]">{uploadedFile.name}</span>
              <button onClick={() => setUploadedFile(null)} className="ml-1 text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* ── Input area ───────────────────────────────────────────────────── */}
        <div className="p-4 md:p-5 bg-background/80 backdrop-blur-xl border-t border-border/50 shrink-0 z-20">
          <form onSubmit={handleSend} className="max-w-4xl mx-auto flex items-end gap-2">
            <button
              type="button"
              onClick={toggleListening}
              disabled={!voiceSupported || isStreaming}
              className={cn(
                "shrink-0 h-12 w-12 rounded-full border flex items-center justify-center transition-all duration-300",
                isListening
                  ? "border-primary bg-primary/20 text-primary animate-pulse"
                  : "border-white/10 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className="shrink-0 h-12 w-12 rounded-full border border-white/10 flex items-center justify-center text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all"
              title="Adjuntar archivo o imagen"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.txt,.md,.py,.js,.ts,.json,.csv,.html,.css,.pdf" onChange={handleFileSelect} />

            <div className="relative flex-1">
              {isListening && (
                <div className="absolute -top-6 left-2 text-xs font-mono text-primary animate-pulse flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                  Escuchando...
                </div>
              )}
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={uploadedFile ? `Pregunta sobre ${uploadedFile.name}...` : "Escribe un comando o pregunta..."}
                disabled={isStreaming}
                className="w-full h-12 rounded-2xl bg-black/40 border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/30 focus:outline-none px-4 text-sm md:text-base text-foreground placeholder:text-muted-foreground/60 transition-all disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={(!input.trim() && !uploadedFile) || isStreaming}
              className="shrink-0 h-12 w-12 rounded-2xl bg-primary hover:bg-primary/80 disabled:opacity-40 flex items-center justify-center transition-all"
            >
              {isStreaming
                ? <Loader2 className="w-5 h-5 text-primary-foreground animate-spin" />
                : <Send className="w-5 h-5 text-primary-foreground" />
              }
            </button>
          </form>

          {localMessages.length === 0 && (
            <div className="max-w-4xl mx-auto mt-2 flex gap-3 justify-center">
              {[
                { icon: Search, label: "Web en tiempo real" },
                { icon: ImageIcon, label: "Genera imágenes" },
                { icon: Paperclip, label: "Analiza archivos" },
                { icon: Bot, label: "Controla tu PC" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 font-mono">
                  <Icon className="w-3 h-3" />
                  {label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Delete confirmation modal ─────────────────────────────────────── */}
        <AnimatePresence>
          {confirmDelete && (
            <motion.div
              key="confirm-delete"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
              onClick={() => setConfirmDelete(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 10 }}
                className="bg-[#0d0d14] border border-red-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-sm">¿Borrar este chat?</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Esta acción no se puede deshacer. Se eliminarán todos los mensajes de este chat.</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-muted-foreground hover:border-white/20 hover:text-foreground transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={doEliminarChat}
                    disabled={deleting}
                    className="flex-1 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-sm text-red-300 hover:bg-red-500/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {deleting ? "Borrando..." : "Sí, borrar"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </PageTransition>
    </Layout>
  );
}
