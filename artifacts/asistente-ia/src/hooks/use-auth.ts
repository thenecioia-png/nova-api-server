import { useState, useCallback, useEffect } from "react";

const SESSION_KEY = "nova_auth_session";
const CREDENTIAL_KEY = "nova_webauthn_credential";
const PIN_KEY = "nova_pin_hash";
const VOICE_PHRASE_KEY = "nova_voice_phrase";

// Simple hash for PIN storage
async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "denison_nova_salt_2024");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isSessionValid(): boolean {
  const session = sessionStorage.getItem(SESSION_KEY);
  if (!session) return false;
  try {
    const { expiry } = JSON.parse(session);
    return Date.now() < expiry;
  } catch {
    return false;
  }
}

function setSession() {
  // Session valid for 8 hours
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ expiry: Date.now() + 8 * 60 * 60 * 1000, user: "Denison" })
  );
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// ─── WebAuthn (fingerprint / face / device biometric) ───────────────────────

async function isWebAuthnAvailable(): Promise<boolean> {
  return (
    window.PublicKeyCredential !== undefined &&
    (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  );
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  return new Uint8Array(bin.split("").map((c) => c.charCodeAt(0)));
}

async function registerFingerprint(): Promise<{ success: boolean; error?: string }> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "N.O.V.A - Denison", id: window.location.hostname },
        user: {
          id: userId,
          name: "Denison The Necio",
          displayName: "Denison",
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    const response = credential.response as AuthenticatorAttestationResponse;
    const credentialId = base64url(credential.rawId);

    localStorage.setItem(
      CREDENTIAL_KEY,
      JSON.stringify({
        id: credentialId,
        rawId: credentialId,
        type: credential.type,
        clientDataJSON: base64url(response.clientDataJSON),
      })
    );

    return { success: true };
  } catch (err: unknown) {
    const e = err as Error;
    if (e.name === "NotAllowedError") {
      return { success: false, error: "Cancelaste la autenticación biométrica." };
    }
    return { success: false, error: `Error: ${e.message}` };
  }
}

async function authenticateFingerprint(): Promise<{ success: boolean; error?: string }> {
  try {
    const stored = localStorage.getItem(CREDENTIAL_KEY);
    if (!stored) {
      return { success: false, error: "No hay huella registrada." };
    }
    const storedCred = JSON.parse(stored);
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            id: base64urlDecode(storedCred.id),
            type: "public-key",
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60000,
        rpId: window.location.hostname,
      },
    });

    return assertion ? { success: true } : { success: false, error: "Huella no reconocida." };
  } catch (err: unknown) {
    const e = err as Error;
    if (e.name === "NotAllowedError") {
      return { success: false, error: "Cancelaste la autenticación." };
    }
    return { success: false, error: `Error: ${e.message}` };
  }
}

// ─── Voice phrase auth ────────────────────────────────────────────────────────

function saveVoicePhrase(phrase: string) {
  localStorage.setItem(VOICE_PHRASE_KEY, phrase.toLowerCase().trim());
}

function getVoicePhrase(): string | null {
  return localStorage.getItem(VOICE_PHRASE_KEY);
}

async function listenForVoice(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SR = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      reject(new Error("SpeechRecognition no disponible"));
      return;
    }
    const recognition = new SR();
    recognition.lang = "es-DO";
    recognition.interimResults = false;
    recognition.maxAlternatives = 5;
    recognition.onresult = (event: any) => {
      const results: string[] = [];
      for (let i = 0; i < event.results[0].length; i++) {
        results.push(event.results[0][i].transcript.toLowerCase().trim());
      }
      resolve(results.join("|"));
    };
    recognition.onerror = (e: any) => reject(new Error(e.error));
    recognition.start();
    setTimeout(() => {
      try { recognition.stop(); } catch {}
      reject(new Error("Tiempo agotado"));
    }, 8000);
  });
}

// ─── PIN auth ────────────────────────────────────────────────────────────────

async function savePin(pin: string) {
  const hash = await hashPin(pin);
  localStorage.setItem(PIN_KEY, hash);
}

async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(PIN_KEY);
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

// ─── Auth state and hook ────────────────────────────────────────────────────

export type AuthMethod = "fingerprint" | "voice" | "pin";

export interface AuthState {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  status: string;
  hasFingerprint: boolean;
  hasVoice: boolean;
  hasPin: boolean;
  biometricAvailable: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    authenticated: isSessionValid(),
    loading: true,
    error: null,
    status: "Verificando sesión...",
    hasFingerprint: false,
    hasVoice: false,
    hasPin: false,
    biometricAvailable: false,
  });

  useEffect(() => {
    async function init() {
      const biometricAvailable = await isWebAuthnAvailable();
      setState((s) => ({
        ...s,
        loading: false,
        biometricAvailable,
        hasFingerprint: !!localStorage.getItem(CREDENTIAL_KEY),
        hasVoice: !!localStorage.getItem(VOICE_PHRASE_KEY),
        hasPin: !!localStorage.getItem(PIN_KEY),
        status: isSessionValid() ? "Sesión activa" : "Esperando autenticación...",
      }));
    }
    init();
  }, []);

  const loginWithFingerprint = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null, status: "Verificando huella..." }));
    const result = await authenticateFingerprint();
    if (result.success) {
      setSession();
      setState((s) => ({ ...s, loading: false, authenticated: true, status: "Identidad verificada" }));
    } else {
      setState((s) => ({ ...s, loading: false, error: result.error ?? "Error", status: "Fallo de autenticación" }));
    }
  }, []);

  const loginWithVoice = useCallback(async () => {
    const phrase = getVoicePhrase();
    if (!phrase) {
      setState((s) => ({ ...s, error: "No hay frase de voz registrada. Configúrala primero.", status: "" }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null, status: "Escuchando tu voz..." }));
    try {
      const heard = await listenForVoice();
      const alternatives = heard.split("|");
      const match = alternatives.some((alt) => {
        const phraseWords = phrase.split(" ");
        const altWords = alt.split(" ");
        const matchCount = phraseWords.filter((w) => altWords.includes(w)).length;
        return matchCount >= Math.ceil(phraseWords.length * 0.7);
      });
      if (match) {
        setSession();
        setState((s) => ({ ...s, loading: false, authenticated: true, status: "Voz reconocida" }));
      } else {
        setState((s) => ({ ...s, loading: false, error: "Voz no reconocida. Intenta de nuevo.", status: "Fallo" }));
      }
    } catch (err: unknown) {
      const e = err as Error;
      setState((s) => ({ ...s, loading: false, error: e.message, status: "Error de micrófono" }));
    }
  }, []);

  const loginWithPin = useCallback(async (pin: string) => {
    setState((s) => ({ ...s, loading: true, error: null, status: "Verificando código..." }));
    const ok = await verifyPin(pin);
    if (ok) {
      setSession();
      setState((s) => ({ ...s, loading: false, authenticated: true, status: "Acceso concedido" }));
    } else {
      setState((s) => ({ ...s, loading: false, error: "Código incorrecto.", status: "Acceso denegado" }));
    }
  }, []);

  const setupFingerprint = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null, status: "Registrando huella..." }));
    const result = await registerFingerprint();
    if (result.success) {
      setState((s) => ({ ...s, loading: false, hasFingerprint: true, status: "Huella registrada exitosamente" }));
    } else {
      setState((s) => ({ ...s, loading: false, error: result.error ?? "Error", status: "" }));
    }
  }, []);

  const setupVoice = useCallback(async (phrase: string) => {
    saveVoicePhrase(phrase);
    setState((s) => ({ ...s, hasVoice: true, status: `Frase "${phrase}" guardada` }));
  }, []);

  const setupPin = useCallback(async (pin: string) => {
    await savePin(pin);
    setState((s) => ({ ...s, hasPin: true, status: "Código PIN guardado" }));
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setState((s) => ({ ...s, authenticated: false, status: "Sesión cerrada" }));
  }, []);

  return {
    ...state,
    loginWithFingerprint,
    loginWithVoice,
    loginWithPin,
    setupFingerprint,
    setupVoice,
    setupPin,
    logout,
    listenForVoice,
  };
}
