import { useState, useEffect } from "react";
import { Fingerprint, Mic, KeyRound, Shield, CheckCircle2, AlertTriangle, Eye, EyeOff, ChevronRight, Settings2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type Screen = "main" | "setup" | "pin-setup" | "voice-setup";

export default function AuthPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>("main");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [voicePhrase, setVoicePhrase] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);

  useEffect(() => {
    if (auth.authenticated) {
      onAuthenticated();
    }
  }, [auth.authenticated, onAuthenticated]);

  const handleFingerprint = async () => {
    if (!auth.hasFingerprint) {
      setScreen("setup");
      return;
    }
    await auth.loginWithFingerprint();
  };

  const handleVoice = async () => {
    if (!auth.hasVoice) {
      setScreen("setup");
      return;
    }
    await auth.loginWithVoice();
  };

  const handlePinSubmit = async () => {
    if (!auth.hasPin) {
      setScreen("setup");
      return;
    }
    if (pin.length < 4) {
      setLocalError("El código debe tener al menos 4 dígitos.");
      return;
    }
    await auth.loginWithPin(pin);
    setPin("");
  };

  const handlePinKey = (key: string) => {
    setLocalError(null);
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
    } else if (key === "ok") {
      handlePinSubmit();
    } else if (pin.length < 8) {
      setPin((p) => p + key);
    }
  };

  // Setup fingerprint
  const handleSetupFingerprint = async () => {
    await auth.setupFingerprint();
  };

  // Setup voice
  const handleSetupVoice = async () => {
    if (!voicePhrase.trim()) {
      setLocalError("Escribe tu frase secreta primero.");
      return;
    }
    await auth.setupVoice(voicePhrase.trim());
    setLocalStatus(`Frase "${voicePhrase.trim()}" guardada. Ya puedes autenticarte con tu voz.`);
  };

  // Setup PIN
  const handleSetupPin = async () => {
    if (pin.length < 4) {
      setLocalError("Mínimo 4 dígitos.");
      return;
    }
    if (pin !== pinConfirm) {
      setLocalError("Los códigos no coinciden.");
      return;
    }
    await auth.setupPin(pin);
    setPin("");
    setPinConfirm("");
    setLocalStatus("PIN guardado. Ahora puedes iniciar sesión con él.");
    setTimeout(() => setScreen("main"), 1500);
  };

  const hasAnyMethod = auth.hasFingerprint || auth.hasVoice || auth.hasPin;

  const error = auth.error || localError;
  const status = localStatus || auth.status;

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Grid pattern */}
      <div className="fixed inset-0 opacity-20 pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle, hsl(var(--primary)/0.3) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      <div className="relative z-10 w-full max-w-md mx-auto px-4">
        <AnimatePresence mode="wait">

          {/* ── MAIN LOGIN SCREEN ── */}
          {screen === "main" && (
            <motion.div
              key="main"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              {/* Logo */}
              <div className="text-center space-y-3">
                <div className="relative inline-block">
                  <div className="absolute inset-0 bg-primary/30 blur-2xl rounded-full scale-150 animate-pulse" />
                  <div className="relative w-20 h-20 mx-auto rounded-full border-2 border-primary/50 flex items-center justify-center bg-black/60 shadow-[0_0_40px_hsl(var(--primary)/0.4)]">
                    <Shield className="w-10 h-10 text-primary" />
                  </div>
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-primary tracking-widest font-mono">N.O.V.A</h1>
                  <p className="text-sm text-muted-foreground font-mono mt-1">SISTEMA RESTRINGIDO — SOLO DENISON</p>
                </div>
              </div>

              {/* Status / Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {auth.loading && (
                <div className="text-center text-sm text-primary font-mono animate-pulse">{status}</div>
              )}

              {/* Auth buttons */}
              <div className="space-y-3">

                {/* Fingerprint */}
                {auth.biometricAvailable && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleFingerprint}
                    disabled={auth.loading}
                    className={cn(
                      "w-full flex items-center gap-4 px-6 py-4 rounded-2xl border transition-all duration-300",
                      auth.hasFingerprint
                        ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 shadow-[0_0_20px_hsl(var(--primary)/0.15)]"
                        : "bg-white/5 border-white/10 text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    <Fingerprint className="w-6 h-6 shrink-0" />
                    <div className="text-left">
                      <p className="font-semibold text-sm">{auth.hasFingerprint ? "Autenticar con Huella" : "Registrar Huella Digital"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {auth.hasFingerprint ? "Usa el lector de huella de tu PC" : "Configura tu huella para acceso rápido"}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 ml-auto shrink-0" />
                  </motion.button>
                )}

                {/* Voice */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleVoice}
                  disabled={auth.loading}
                  className={cn(
                    "w-full flex items-center gap-4 px-6 py-4 rounded-2xl border transition-all duration-300",
                    auth.hasVoice
                      ? "bg-accent/10 border-accent/40 text-accent hover:bg-accent/20"
                      : "bg-white/5 border-white/10 text-muted-foreground hover:border-accent/30"
                  )}
                >
                  <Mic className="w-6 h-6 shrink-0" />
                  <div className="text-left">
                    <p className="font-semibold text-sm">{auth.hasVoice ? "Autenticar con Voz" : "Registrar Frase de Voz"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {auth.hasVoice ? "Di tu frase secreta en el micrófono" : "Configura tu contraseña de voz"}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto shrink-0" />
                </motion.button>

                {/* PIN */}
                <div className={cn(
                  "rounded-2xl border transition-all duration-300",
                  auth.hasPin ? "bg-white/5 border-white/15" : "bg-white/5 border-white/10"
                )}>
                  <button
                    onClick={() => !auth.hasPin && setScreen("setup")}
                    className="w-full flex items-center gap-4 px-6 py-4 text-left"
                    disabled={auth.loading}
                  >
                    <KeyRound className="w-6 h-6 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-semibold text-sm text-foreground">{auth.hasPin ? "Código PIN" : "Registrar Código PIN"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {auth.hasPin ? "Introduce tu código secreto" : "Configura un PIN de respaldo"}
                      </p>
                    </div>
                    {!auth.hasPin && <ChevronRight className="w-4 h-4 ml-auto shrink-0 text-muted-foreground" />}
                  </button>

                  {auth.hasPin && (
                    <div className="px-6 pb-5">
                      {/* PIN pad */}
                      <div className="flex gap-2 mb-4 justify-center">
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div
                            key={i}
                            className={cn(
                              "w-3 h-3 rounded-full border transition-all",
                              i < pin.length
                                ? "bg-primary border-primary shadow-[0_0_8px_hsl(var(--primary))]"
                                : "border-white/20"
                            )}
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"].map((k) => (
                          <button
                            key={k}
                            onClick={() => handlePinKey(k)}
                            disabled={auth.loading}
                            className={cn(
                              "py-3 rounded-xl font-mono text-sm font-bold transition-all active:scale-95",
                              k === "ok"
                                ? "bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30"
                                : k === "del"
                                ? "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10"
                                : "bg-white/5 text-foreground border border-white/10 hover:bg-white/10"
                            )}
                          >
                            {k === "del" ? "⌫" : k === "ok" ? "OK" : k}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Setup link */}
              <div className="text-center">
                <button
                  onClick={() => setScreen("setup")}
                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 mx-auto transition-colors"
                >
                  <Settings2 className="w-3 h-3" />
                  Configurar métodos de acceso
                </button>
              </div>

              <p className="text-center text-[10px] font-mono text-muted-foreground/30">
                Creado por <span className="text-primary/50">Denison The Necio</span>
              </p>
            </motion.div>
          )}

          {/* ── SETUP SCREEN ── */}
          {screen === "setup" && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="space-y-5"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setScreen("main"); setLocalError(null); setLocalStatus(null); }}
                  className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  ←
                </button>
                <h2 className="text-xl font-bold text-foreground font-mono">Configurar Acceso</h2>
              </div>

              <AnimatePresence>
                {(error || localStatus) && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 rounded-xl text-sm",
                      localStatus && !error
                        ? "bg-green-500/10 border border-green-500/30 text-green-400"
                        : "bg-destructive/10 border border-destructive/30 text-destructive"
                    )}
                  >
                    {localStatus && !error ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    {error || localStatus}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Fingerprint setup */}
              {auth.biometricAvailable && (
                <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                  <div className="flex items-center gap-3">
                    <Fingerprint className="w-5 h-5 text-primary" />
                    <span className="font-semibold text-sm">Huella Digital / Face ID</span>
                    {auth.hasFingerprint && <span className="ml-auto text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Registrada</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">Usa el lector de huella o cámara de tu PC para identificarte.</p>
                  <button
                    onClick={handleSetupFingerprint}
                    disabled={auth.loading}
                    className="w-full py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {auth.hasFingerprint ? "Re-registrar huella" : "Registrar huella"}
                  </button>
                </div>
              )}

              {/* Voice setup */}
              <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                <div className="flex items-center gap-3">
                  <Mic className="w-5 h-5 text-accent" />
                  <span className="font-semibold text-sm">Frase de Voz Secreta</span>
                  {auth.hasVoice && <span className="ml-auto text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Configurada</span>}
                </div>
                <p className="text-xs text-muted-foreground">Define una frase secreta. Solo tú la conoces y solo tu voz la activa.</p>
                <input
                  type="text"
                  value={voicePhrase}
                  onChange={(e) => setVoicePhrase(e.target.value)}
                  placeholder='Ej: "Denison activa nova"'
                  className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent/50"
                />
                <button
                  onClick={handleSetupVoice}
                  disabled={auth.loading || !voicePhrase.trim()}
                  className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-semibold hover:bg-accent/20 transition-colors disabled:opacity-50"
                >
                  Guardar frase secreta
                </button>
              </div>

              {/* PIN setup */}
              <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                <div className="flex items-center gap-3">
                  <KeyRound className="w-5 h-5 text-muted-foreground" />
                  <span className="font-semibold text-sm">Código PIN</span>
                  {auth.hasPin && <span className="ml-auto text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Configurado</span>}
                </div>
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type={showPin ? "text" : "password"}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="Código (4-8 dígitos)"
                      className="w-full px-4 py-2.5 pr-10 rounded-xl bg-black/40 border border-white/10 text-sm font-mono text-foreground placeholder-muted-foreground focus:outline-none focus:border-white/30"
                    />
                    <button
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <input
                    type={showPin ? "text" : "password"}
                    value={pinConfirm}
                    onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="Confirmar código"
                    className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm font-mono text-foreground placeholder-muted-foreground focus:outline-none focus:border-white/30"
                  />
                  <button
                    onClick={handleSetupPin}
                    disabled={auth.loading || pin.length < 4}
                    className="w-full py-2.5 rounded-xl bg-white/5 border border-white/15 text-foreground text-sm font-semibold hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    Guardar PIN
                  </button>
                </div>
              </div>

              {hasAnyMethod && (
                <button
                  onClick={() => setScreen("main")}
                  className="w-full py-3 rounded-2xl bg-primary/10 border border-primary/30 text-primary font-semibold text-sm hover:bg-primary/20 transition-colors"
                >
                  Ir a autenticarme →
                </button>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
