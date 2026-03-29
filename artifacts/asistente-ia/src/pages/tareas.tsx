import { useState } from "react";
import { Layout } from "@/components/layout";
import { PageTransition } from "@/components/ui-elements";
import { Clock, Plus, Trash2, ToggleLeft, ToggleRight, CalendarCheck, Bot, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { API_BASE } from "@/lib/api-url";
const BASE = API_BASE;

const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_LABEL: Record<string, string> = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };

function useTareas() {
  return useQuery({
    queryKey: ["tareas"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/tareas`);
      return r.json() as Promise<{ tareas: any[] }>;
    },
  });
}

function useCreateTarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`${BASE}/api/tareas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tareas"] }),
  });
}

function useToggleTarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, activa }: { id: number; activa: boolean }) => {
      await fetch(`${BASE}/api/tareas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tareas"] }),
  });
}

function useDeleteTarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/tareas/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tareas"] }),
  });
}

export default function TareasPage() {
  const { data } = useTareas();
  const createMutation = useCreateTarea();
  const toggleMutation = useToggleTarea();
  const deleteMutation = useDeleteTarea();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    descripcion: "",
    hora: "09:00",
    diasSemana: [] as string[],
    accion: "notificar",
    botComando: "",
  });

  const handleToggleDia = (dia: string) => {
    setForm(f => ({
      ...f,
      diasSemana: f.diasSemana.includes(dia) ? f.diasSemana.filter(d => d !== dia) : [...f.diasSemana, dia],
    }));
  };

  const handleCreate = async () => {
    if (!form.descripcion.trim() || !form.hora) return;
    await createMutation.mutateAsync({
      descripcion: form.descripcion,
      hora: form.hora,
      diasSemana: form.diasSemana.length > 0 ? form.diasSemana : null,
      accion: form.accion,
      payload: form.accion === "bot_comando" ? { tipo: form.botComando } : {},
    });
    setForm({ descripcion: "", hora: "09:00", diasSemana: [], accion: "notificar", botComando: "" });
    setShowForm(false);
  };

  const tareas = data?.tareas ?? [];

  return (
    <Layout>
      <PageTransition className="flex flex-col h-full overflow-hidden">
        <header className="px-6 py-4 border-b border-border/50 glass-panel z-20 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <CalendarCheck className="w-5 h-5 text-primary" />
            <h2 className="font-display text-xl text-foreground font-semibold">Tareas Programadas</h2>
          </div>
          <button
            onClick={() => setShowForm(s => !s)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            Nueva Tarea
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {/* Create form */}
          <AnimatePresence>
            {showForm && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="glass-panel rounded-2xl p-5 border border-primary/20 space-y-4"
              >
                <h3 className="font-display text-primary font-semibold">Nueva Tarea Programada</h3>

                <input
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Descripción de la tarea..."
                  className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />

                <div className="flex gap-3 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-mono">HORA</label>
                    <input
                      type="time"
                      value={form.hora}
                      onChange={e => setForm(f => ({ ...f, hora: e.target.value }))}
                      className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-mono">ACCIÓN</label>
                    <select
                      value={form.accion}
                      onChange={e => setForm(f => ({ ...f, accion: e.target.value }))}
                      className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    >
                      <option value="notificar">Notificación</option>
                      <option value="bot_comando">Comando Bot</option>
                    </select>
                  </div>
                  {form.accion === "bot_comando" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground font-mono">TIPO COMANDO</label>
                      <input
                        value={form.botComando}
                        onChange={e => setForm(f => ({ ...f, botComando: e.target.value }))}
                        placeholder="screenshot, run_command..."
                        className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-foreground focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs text-muted-foreground font-mono">DÍAS (vacío = todos los días)</label>
                  <div className="flex gap-2">
                    {DIAS.map(dia => (
                      <button
                        key={dia}
                        onClick={() => handleToggleDia(dia)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all",
                          form.diasSemana.includes(dia)
                            ? "bg-primary/20 border-primary/50 text-primary"
                            : "bg-black/30 border-white/10 text-muted-foreground hover:border-white/20"
                        )}
                      >
                        {DIAS_LABEL[dia]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={createMutation.isPending}
                    className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/80 transition-all disabled:opacity-50"
                  >
                    {createMutation.isPending ? "Creando..." : "Crear Tarea"}
                  </button>
                  <button
                    onClick={() => setShowForm(false)}
                    className="px-5 py-2 rounded-xl border border-white/10 text-muted-foreground text-sm hover:border-white/20 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Task list */}
          {tareas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center opacity-50">
              <Clock className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="font-display text-lg text-muted-foreground">Sin tareas programadas</p>
              <p className="text-sm text-muted-foreground/60 font-mono mt-1">Crea tareas automáticas para que N.O.V.A las ejecute</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tareas.map((tarea: any) => (
                <motion.div
                  key={tarea.id}
                  layout
                  className={cn(
                    "glass-panel rounded-2xl p-4 border transition-all",
                    tarea.activa ? "border-white/10" : "border-white/5 opacity-50"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {tarea.accion === "bot_comando"
                          ? <Bot className="w-4 h-4 text-cyan-400 shrink-0" />
                          : <Bell className="w-4 h-4 text-yellow-400 shrink-0" />
                        }
                        <span className="font-medium text-foreground truncate">{tarea.descripcion}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="flex items-center gap-1 text-xs text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3" /> {tarea.hora}
                        </span>
                        {tarea.diasSemana?.length > 0
                          ? tarea.diasSemana.map((d: string) => (
                            <span key={d} className="text-xs text-muted-foreground font-mono bg-white/5 px-2 py-0.5 rounded-full">{DIAS_LABEL[d] ?? d}</span>
                          ))
                          : <span className="text-xs text-muted-foreground font-mono bg-white/5 px-2 py-0.5 rounded-full">Todos los días</span>
                        }
                        <span className={cn("text-[10px] font-mono px-2 py-0.5 rounded-full", tarea.accion === "bot_comando" ? "bg-cyan-500/10 text-cyan-400" : "bg-yellow-500/10 text-yellow-400")}>
                          {tarea.accion === "bot_comando" ? `BOT: ${(tarea.payload as any)?.tipo ?? ""}` : "NOTIF"}
                        </span>
                      </div>
                      {tarea.ultimaEjecucion && (
                        <p className="text-[10px] text-muted-foreground/50 font-mono mt-1">
                          Última ejecución: {new Date(tarea.ultimaEjecucion).toLocaleString("es-DO")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleMutation.mutate({ id: tarea.id, activa: !tarea.activa })}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title={tarea.activa ? "Desactivar" : "Activar"}
                      >
                        {tarea.activa ? <ToggleRight className="w-6 h-6 text-primary" /> : <ToggleLeft className="w-6 h-6" />}
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(tarea.id)}
                        className="text-muted-foreground hover:text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </PageTransition>
    </Layout>
  );
}
