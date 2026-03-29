import { useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, MessageSquare } from "lucide-react";
import { NovaChatProvider, useNovaChat } from "@/context/nova-chat";

// Pages
import AuthPage from "./pages/auth";
import ChatPage from "./pages/chat";
import ReglasPage from "./pages/reglas";
import MemoriaPage from "./pages/memoria";
import HistorialPage from "./pages/historial";
import BotPage from "./pages/bot";
import TareasPage from "./pages/tareas";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

/** Floating badge shown on non-chat pages while the AI is still processing */
function StreamingIndicator() {
  const [location, navigate] = useLocation();
  const { isStreaming } = useNovaChat();

  // Only show on pages other than chat (which is at "/")
  const onChat = location === "/" || location === "";
  if (onChat || !isStreaming) return null;

  return (
    <AnimatePresence>
      <motion.button
        key="streaming-badge"
        initial={{ opacity: 0, y: 20, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.9 }}
        onClick={() => navigate("/")}
        className="fixed bottom-6 right-6 z-[200] flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-[#0a0a18] border border-primary/40 shadow-[0_0_24px_rgba(0,255,255,0.18)] cursor-pointer hover:border-primary/70 transition-all"
      >
        <Loader2 className="w-4 h-4 text-primary animate-spin" />
        <div className="flex flex-col items-start">
          <span className="text-[10px] font-bold text-primary tracking-widest">N.O.V.A. PROCESANDO</span>
          <span className="text-[9px] text-gray-500">Toca para volver al chat</span>
        </div>
        <MessageSquare className="w-3.5 h-3.5 text-primary/60 ml-1" />
      </motion.button>
    </AnimatePresence>
  );
}

function Router() {
  return (
    <>
      <Switch>
        <Route path="/" component={ChatPage} />
        <Route path="/reglas" component={ReglasPage} />
        <Route path="/memoria" component={MemoriaPage} />
        <Route path="/historial" component={HistorialPage} />
        <Route path="/bot" component={BotPage} />
        <Route path="/tareas" component={TareasPage} />
        <Route component={NotFound} />
      </Switch>
      {/* Floating indicator — persists across all pages */}
      <StreamingIndicator />
    </>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(() => {
    try {
      const session = sessionStorage.getItem("nova_auth_session");
      if (!session) return false;
      const { expiry } = JSON.parse(session);
      return Date.now() < expiry;
    } catch {
      return false;
    }
  });

  const handleAuthenticated = useCallback(() => {
    setAuthenticated(true);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="dark h-full w-full">
          {!authenticated ? (
            <AuthPage onAuthenticated={handleAuthenticated} />
          ) : (
            <NovaChatProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
            </NovaChatProvider>
          )}
          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
