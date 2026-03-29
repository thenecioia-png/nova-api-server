import { Link, useLocation } from "wouter";
import { MessageSquare, ScrollText, BrainCircuit, History, Cpu, Bot, CalendarCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";

import { API_BASE } from "@/lib/api-url";
const BASE = API_BASE;

const NAV_ITEMS = [
  { href: "/",        label: "Terminal IA",      icon: MessageSquare },
  { href: "/reglas",  label: "Directivas",       icon: ScrollText },
  { href: "/memoria", label: "Núcleo de Memoria", icon: BrainCircuit },
  { href: "/historial", label: "Registros",      icon: History },
  { href: "/bot",     label: "Bot Local",        icon: Bot },
  { href: "/tareas",  label: "Tareas",           icon: CalendarCheck },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [botOnline, setBotOnline] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${BASE}/api/bot/status`);
        const d = await r.json();
        setBotOnline(d.online ?? false);
      } catch { setBotOnline(false); }
    };
    check();
    const id = setInterval(check, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30 selection:text-primary">
      {/* Background Effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none z-0 mix-blend-screen opacity-50" />
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-0 right-1/4 w-[500px] h-[500px] bg-accent/10 rounded-full blur-[150px] pointer-events-none z-0" />

      {/* Sidebar Navigation */}
      <aside className="relative z-10 w-64 h-full border-r border-border/50 glass-panel flex flex-col backdrop-blur-2xl">
        <div className="p-6 flex items-center gap-4 border-b border-border/50">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/50 blur-md rounded-full animate-pulse" />
            <img 
              src={`${import.meta.env.BASE_URL}images/ai-avatar.png`} 
              alt="AI Core" 
              className="w-10 h-10 rounded-full relative z-10 border border-primary/50 object-cover"
            />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg text-primary tracking-wider leading-none">N.O.V.A</h1>
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mt-1">v1.0 // Activo</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            const isBot = item.href === "/bot";
            
            return (
              <Link key={item.href} href={item.href} className="block">
                <div
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group relative overflow-hidden",
                    isActive 
                      ? "bg-primary/10 text-primary font-medium border border-primary/30 shadow-[0_0_15px_hsl(var(--primary)/0.15)_inset]" 
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"
                  )}
                >
                  {isActive && (
                    <motion.div 
                      layoutId="active-nav-indicator"
                      className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_10px_hsl(var(--primary))]"
                    />
                  )}
                  <Icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className="font-display tracking-wide flex-1">{item.label}</span>
                  {isBot && (
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", botOnline ? "bg-cyan-400 shadow-[0_0_6px_#22d3ee] animate-pulse" : "bg-gray-600")} />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-border/50 space-y-3">
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-black/40 border border-white/5">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-accent" />
              <span className="text-xs font-mono text-muted-foreground">SISTEMA</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e] animate-pulse" />
          </div>
          <div className="px-2 pb-1">
            <p className="text-[10px] font-mono text-muted-foreground/50 text-center leading-tight">
              Creado por{" "}
              <span className="text-primary/70 font-semibold tracking-wide">Denison The Necio</span>
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 h-full overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
