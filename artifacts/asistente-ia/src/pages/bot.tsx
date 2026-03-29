import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Cpu, WifiOff, Key, Copy, Check, Play, RefreshCw,
  Terminal, CheckCircle, XCircle, Clock, Loader2,
  Monitor, Mouse, Keyboard, Camera, FolderOpen, Zap, Bot,
  Pause, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { API_BASE } from "@/lib/api-url";
import { useNovaChat } from "@/context/nova-chat";
const BASE = API_BASE;

// Derive public server URL
function getServerUrl() {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (apiUrl) return apiUrl.replace(/\/$/, "");
  const { protocol, host } = window.location;
  return `${protocol}//${host}`;
}

interface BotCommand {
  id: number;
  tipo: string;
  payload: Record<string, unknown>;
  estado: string;
  resultado?: Record<string, unknown> | null;
  creadoEn: string;
}

const TIPOS_RAPIDOS = [
  { tipo: "screenshot",      icono: Camera,    label: "Captura" },
  { tipo: "get_screen_info", icono: Monitor,   label: "Info pantalla" },
  { tipo: "get_processes",   icono: Cpu,       label: "Procesos" },
  { tipo: "mouse_click",     icono: Mouse,     label: "Clic",     payload: { x: 960, y: 540 } },
  { tipo: "keyboard_hotkey", icono: Zap,       label: "Ctrl+C",   payload: { teclas: ["ctrl", "c"] } },
  { tipo: "run_command",     icono: Terminal,  label: "CMD",      payload: { comando: "echo Hola NOVA" } },
  { tipo: "abrir_url",       icono: FolderOpen,label: "URL",      payload: { url: "https://google.com" } },
  { tipo: "keyboard_type",   icono: Keyboard,  label: "Escribir", payload: { texto: "Hola NOVA" } },
];

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all", copied ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20", className)}>
      {copied ? <><Check className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
    </button>
  );
}

export default function BotPage() {
  const [botOnline, setBotOnline]     = useState(false);
  const [botNombre, setBotNombre]     = useState("");
  const [hasScreenshot, setHasScreenshot] = useState(false);
  const [screenshotTs, setScreenshotTs]   = useState(0);
  const [apiKey, setApiKey]           = useState("");
  const [generando, setGenerando]     = useState(false);
  const [commands, setCommands]       = useState<BotCommand[]>([]);
  const [enviando, setEnviando]       = useState(false);
  const [payloadEdit, setPayloadEdit] = useState("{}");
  const [tipoSel, setTipoSel]         = useState(TIPOS_RAPIDOS[0]);
  const [payloadErr, setPayloadErr]   = useState(false);
  const [botPaused, setBotPaused]     = useState(false);
  const [abandonando, setAbandonando] = useState(false);
  const pollingPausedRef              = useRef(false);
  const { selfRepairActive, toggleSelfRepair } = useNovaChat();
  const serverUrl = getServerUrl();
  const screenshotUrl = `${BASE}/api/bot/last-screenshot?ts=${screenshotTs}`;

  const cmd1 = `pip install pyautogui requests pyperclip psutil pillow`;
  const cmd2 = apiKey
    ? `python -c "import urllib.request,sys; exec(urllib.request.urlopen('${serverUrl}/nova_bot.py').read().decode())" ${serverUrl} ${apiKey}`
    : "";

  // Generate a .bat file for Windows double-click install
  const descargarBat = () => {
    if (!apiKey) return;
    const batContent = [
      `@echo off`,
      `echo Instalando dependencias...`,
      `pip install pyautogui requests pyperclip psutil pillow`,
      `echo.`,
      `echo Iniciando N.O.V.A Bot...`,
      `python -c "import urllib.request,sys; exec(urllib.request.urlopen('${serverUrl}/nova_bot.py').read().decode())" ${serverUrl} ${apiKey}`,
      `pause`,
    ].join("\r\n");
    const blob = new Blob([batContent], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nova_bot.bat";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Auto-load existing API key on mount
  useEffect(() => {
    fetch(`${BASE}/api/bot/config`)
      .then(r => r.json())
      .then(d => { if (d.apiKey) setApiKey(d.apiKey); })
      .catch(() => {});
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/bot/status`);
      if (!r.ok) return;
      const d = await r.json();
      setBotOnline(d.online ?? false);
      setBotNombre(d.nombre ?? "BOT-PC");
      if (d.hasScreenshot) setHasScreenshot(true);
    } catch {
      setBotOnline(false);
    }
  }, []);

  const fetchCommands = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/bot/commands`);
      if (!r.ok) return;
      const d = await r.json();
      const list: BotCommand[] = (d.comandos ?? []).slice().reverse().slice(0, 20);
      setCommands(list);
      // Detect when a screenshot was saved to disk on the server
      const ss = list.find(
        (c) => c.tipo === "screenshot" && c.estado === "completado" && (c.resultado as any)?.screenshot_saved
      );
      if (ss) {
        setHasScreenshot(true);
        setScreenshotTs(Date.now()); // Force image reload with cache-bust
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchCommands();
    const id = setInterval(() => {
      if (!pollingPausedRef.current) { fetchStatus(); fetchCommands(); }
    }, 4000);
    return () => clearInterval(id);
  }, [fetchStatus, fetchCommands]);

  const togglePauseBot = useCallback(() => {
    setBotPaused(prev => {
      const next = !prev;
      pollingPausedRef.current = next;
      if (!next) { fetchStatus(); fetchCommands(); }
      return next;
    });
  }, [fetchStatus, fetchCommands]);

  const abandonarMisionBot = useCallback(async () => {
    setAbandonando(true);
    try {
      await fetch(`${BASE}/api/bot/commands/pendientes`, { method: "DELETE" });
      setTimeout(fetchCommands, 500);
    } catch {}
    setAbandonando(false);
  }, [fetchCommands]);

  useEffect(() => {
    setPayloadEdit(JSON.stringify(tipoSel.payload ?? {}, null, 2));
    setPayloadErr(false);
  }, [tipoSel]);

  const generarKey = async () => {
    setGenerando(true);
    try {
      const r = await fetch(`${BASE}/api/bot/regenerar-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const d = await r.json();
      if (d.apiKey) setApiKey(d.apiKey);
    } catch (e) {
      console.error("Error generando key:", e);
    }
    setGenerando(false);
  };

  const enviarComando = async () => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadEdit);
      setPayloadErr(false);
    } catch {
      setPayloadErr(true);
      return;
    }
    setEnviando(true);
    try {
      await fetch(`${BASE}/api/bot/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: tipoSel.tipo, payload }),
      });
      setTimeout(fetchCommands, 800);
    } catch {}
    setEnviando(false);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-5 p-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Bot className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">BOT LOCAL</h1>
            <p className="text-xs text-gray-500">N.O.V.A controla tu PC a través del agente local</p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            {/* Self-repair badge */}
            <button
              onClick={toggleSelfRepair}
              title={selfRepairActive ? "Auto-reparación activa — click para desactivar" : "Activar auto-reparación"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-semibold border transition-all",
                selfRepairActive
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-gray-800/50 border-gray-700 text-gray-500"
              )}
            >
              <Wrench className="w-3 h-3" />
              <span className={cn("w-1.5 h-1.5 rounded-full", selfRepairActive ? "bg-emerald-400 animate-pulse" : "bg-gray-600")} />
              {selfRepairActive ? "AUTO-FIX" : "FIX OFF"}
            </button>

            {/* Pause polling */}
            <button
              onClick={togglePauseBot}
              title={botPaused ? "Reanudar monitoreo del bot" : "Pausar monitoreo del bot"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-semibold border transition-all",
                botPaused
                  ? "bg-yellow-500/15 border-yellow-500/40 text-yellow-400"
                  : "bg-white/5 border-white/10 text-gray-400 hover:border-yellow-500/30 hover:text-yellow-400"
              )}
            >
              <Pause className="w-3 h-3" />
              {botPaused ? "PAUSADO" : "PAUSAR"}
            </button>

            {/* Abandon mission */}
            <button
              onClick={abandonarMisionBot}
              disabled={abandonando}
              title="Cancelar todos los comandos pendientes"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-semibold border bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
            >
              {abandonando ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
              ABANDONAR MISIÓN
            </button>

            {/* Status & refresh */}
            {botOnline ? (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                ONLINE — {botNombre}
              </span>
            ) : (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700 text-gray-500 text-xs">
                <WifiOff className="w-3.5 h-3.5" /> OFFLINE
              </span>
            )}
            <button onClick={() => { fetchStatus(); fetchCommands(); }} className="p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* PASO 1: Generar Key */}
        <div className="rounded-xl border border-white/10 bg-white/3 p-5 space-y-4">
          <p className="text-xs text-cyan-400 font-semibold uppercase tracking-widest flex items-center gap-2">
            <Key className="w-3.5 h-3.5" /> Paso 1 — Generar tu API Key
          </p>

          <button
            onClick={generarKey}
            disabled={generando}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm font-semibold hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
          >
            {generando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
            {apiKey ? "Regenerar API Key" : "Generar API Key"}
          </button>

          {apiKey && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-gray-950 border border-cyan-500/30 px-4 py-3">
                <code className="text-cyan-400 text-xs font-mono break-all flex-1">{apiKey}</code>
                <CopyButton text={apiKey} className="ml-3 flex-shrink-0" />
              </div>
              <p className="text-[10px] text-gray-600">Guarda esta key. Si la regeneras la anterior deja de funcionar.</p>
            </motion.div>
          )}
        </div>

        {/* PASO 2: Instrucciones para la PC */}
        {apiKey && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-white/10 bg-white/3 p-5 space-y-5">
            <p className="text-xs text-cyan-400 font-semibold uppercase tracking-widest flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5" /> Paso 2 — Ejecutar en tu PC
            </p>

            {/* OPCIÓN FÁCIL: .bat */}
            <div className="rounded-lg bg-cyan-500/8 border border-cyan-500/25 p-4 space-y-2">
              <p className="text-cyan-300 text-sm font-bold">Opción fácil (recomendada)</p>
              <p className="text-gray-300 text-xs leading-relaxed">Descarga el archivo y haz <span className="text-white font-semibold">doble clic</span> en él. Instala todo automáticamente.</p>
              <button
                onClick={descargarBat}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-bold hover:bg-cyan-500/30 transition-colors"
              >
                ⬇ Descargar nova_bot.bat
              </button>
            </div>

            {/* SEPARADOR */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-white/10" />
              <span className="text-[10px] text-gray-600 uppercase tracking-widest">o manualmente</span>
              <div className="flex-1 border-t border-white/10" />
            </div>

            {/* ADVERTENCIA CRÍTICA */}
            <div className="rounded-lg bg-red-500/8 border border-red-500/25 px-4 py-3 text-xs space-y-1">
              <p className="text-red-400 font-bold">⚠ IMPORTANTE: Abre el CMD de Windows, NO Python</p>
              <p className="text-gray-400 leading-relaxed">
                Presiona <kbd className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-white text-[10px]">Windows</kbd> + <kbd className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-white text-[10px]">R</kbd>, escribe <span className="text-yellow-300 font-mono">cmd</span> y presiona <kbd className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-white text-[10px]">Enter</kbd>.
                El CMD es la ventana negra con el cursor parpadeante que dice <span className="font-mono text-yellow-300">C:\Users\...&gt;</span>
              </p>
              <p className="text-gray-500">No uses la ventana de Python que dice <span className="font-mono">&gt;&gt;&gt;</span> — eso es diferente.</p>
            </div>

            {/* COMANDO 1 */}
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold">Comando 1 — Instalar dependencias:</p>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-950 border border-white/10 px-4 py-3">
                <code className="text-green-400 text-xs font-mono flex-1 break-all">{cmd1}</code>
                <CopyButton text={cmd1} className="flex-shrink-0" />
              </div>
              <p className="text-[10px] text-gray-600">Espera a que termine antes del siguiente paso.</p>
            </div>

            {/* COMANDO 2 */}
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold">Comando 2 — Iniciar el bot:</p>
              <div className="flex items-start justify-between gap-3 rounded-lg bg-gray-950 border border-white/10 px-4 py-3">
                <code className="text-green-400 text-xs font-mono flex-1 break-all leading-relaxed">{cmd2}</code>
                <CopyButton text={cmd2} className="flex-shrink-0 mt-0.5" />
              </div>
              <p className="text-[10px] text-gray-600">El bot queda corriendo. Cuando veas "Esperando comandos..." está listo.</p>
            </div>

            {/* Python no instalado */}
            <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 px-4 py-3 text-[11px] text-yellow-300/70 space-y-1">
              <p className="font-semibold text-yellow-300">Si el CMD dice que Python no se reconoce:</p>
              <p>Descárgalo en <span className="text-cyan-400 font-mono">python.org/downloads</span> → instala marcando la opción <span className="text-white font-semibold">"Add Python to PATH"</span> → cierra y vuelve a abrir el CMD.</p>
            </div>
          </motion.div>
        )}

        {/* PASO 3: Controlar */}
        <div className={cn("rounded-xl border p-5 space-y-4 transition-all", botOnline ? "border-cyan-500/30 bg-cyan-500/3" : "border-white/10 bg-white/3 opacity-60")}>
          <p className="text-xs text-cyan-400 font-semibold uppercase tracking-widest flex items-center gap-2">
            <Play className="w-3.5 h-3.5" /> Paso 3 — Enviar comandos a tu PC
            {!botOnline && <span className="text-gray-600 normal-case font-normal">(bot offline)</span>}
          </p>

          {/* Quick actions */}
          <div className="grid grid-cols-4 gap-2">
            {TIPOS_RAPIDOS.map((t) => (
              <button
                key={t.tipo}
                onClick={() => setTipoSel(t)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-lg border text-[10px] transition-all",
                  tipoSel.tipo === t.tipo
                    ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                    : "border-white/5 bg-black/30 text-gray-500 hover:border-white/10 hover:text-gray-300"
                )}
              >
                <t.icono className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Payload editor */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-widest mb-1 block">Parámetros (JSON)</label>
            <textarea
              value={payloadEdit}
              onChange={(e) => { setPayloadEdit(e.target.value); setPayloadErr(false); }}
              rows={3}
              className={cn(
                "w-full rounded-lg bg-gray-950 border text-xs font-mono text-gray-200 p-3 resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500/40",
                payloadErr ? "border-red-500/50" : "border-white/10"
              )}
            />
            {payloadErr && <p className="text-red-400 text-[10px] mt-1">JSON inválido — revisa las llaves y comillas</p>}
          </div>

          <button
            onClick={enviarComando}
            disabled={enviando || !botOnline}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm font-semibold hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {botOnline ? `Ejecutar → ${tipoSel.tipo}` : "Esperando que el bot se conecte..."}
          </button>
        </div>

        {/* Screenshot — served from server disk, not base64 */}
        {hasScreenshot && (
          <div className="rounded-xl border border-white/10 bg-white/3 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-cyan-400 font-semibold uppercase tracking-widest flex items-center gap-2">
                <Camera className="w-3.5 h-3.5" /> Última captura de pantalla
              </p>
              <button
                onClick={() => setScreenshotTs(Date.now())}
                className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-cyan-400 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Actualizar
              </button>
            </div>
            <img
              src={screenshotUrl}
              alt="Captura de pantalla"
              className="w-full rounded-lg border border-white/10 max-h-80 object-contain bg-black"
              onError={() => setHasScreenshot(false)}
            />
          </div>
        )}

        {/* History */}
        <div className="rounded-xl border border-white/10 bg-white/3 p-5 space-y-3">
          <p className="text-xs text-cyan-400 font-semibold uppercase tracking-widest flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5" /> Historial de comandos
            <span className="ml-auto text-[10px] text-gray-600 normal-case font-normal">{commands.length} comandos</span>
          </p>

          {commands.length === 0 ? (
            <p className="text-gray-600 text-xs text-center py-6">No hay comandos todavía.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {commands.map((cmd) => (
                <div key={cmd.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-950/60 border border-white/5">
                  <div className="mt-0.5 flex-shrink-0">
                    {cmd.estado === "completado" && <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />}
                    {cmd.estado === "error"      && <XCircle     className="w-3.5 h-3.5 text-red-400" />}
                    {cmd.estado === "pendiente"  && <Clock       className="w-3.5 h-3.5 text-gray-500 animate-pulse" />}
                    {cmd.estado === "ejecutando" && <Loader2     className="w-3.5 h-3.5 text-yellow-400 animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-white">{cmd.tipo}</span>
                      <span className={cn("text-[10px] font-semibold",
                        cmd.estado === "completado" ? "text-cyan-400" :
                        cmd.estado === "error"      ? "text-red-400"  :
                        cmd.estado === "ejecutando" ? "text-yellow-400" : "text-gray-500"
                      )}>{cmd.estado.toUpperCase()}</span>
                      <span className="ml-auto text-[10px] text-gray-600">{new Date(cmd.creadoEn).toLocaleTimeString("es-DO")}</span>
                    </div>
                    {cmd.resultado && cmd.tipo !== "screenshot" && (
                      <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5">
                        {JSON.stringify(cmd.resultado).slice(0, 160)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
