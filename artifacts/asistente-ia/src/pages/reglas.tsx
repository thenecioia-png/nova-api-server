import { useState } from "react";
import { Plus, Trash2, ShieldAlert } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button, Input, Textarea, Card, Badge, Spinner, PageTransition } from "@/components/ui-elements";
import { useReglas, useAddRegla, useDeleteRegla } from "@/hooks/use-asistente";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

export default function ReglasPage() {
  const { data, isLoading } = useReglas();
  const addMutation = useAddRegla();
  const deleteMutation = useDeleteRegla();
  const { toast } = useToast();

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo || !descripcion) return;

    addMutation.mutate({ data: { titulo, descripcion } }, {
      onSuccess: () => {
        setTitulo("");
        setDescripcion("");
        toast({ title: "Directiva añadida", description: "El asistente ahora seguirá esta regla." });
      },
      onError: () => toast({ variant: "destructive", title: "Error", description: "No se pudo guardar la regla." })
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => toast({ title: "Directiva eliminada" }),
      onError: () => toast({ variant: "destructive", title: "Error", description: "No se pudo eliminar." })
    });
  };

  return (
    <Layout>
      <PageTransition className="p-6 md:p-10 h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-8">
          
          <header className="mb-8">
            <h1 className="text-4xl font-display font-bold text-foreground flex items-center gap-3">
              <ShieldAlert className="w-10 h-10 text-accent" />
              Directivas Principales
            </h1>
            <p className="text-muted-foreground mt-2 font-mono text-sm max-w-2xl">
              Define las reglas de comportamiento base para N.O.V.A. Estas instrucciones tienen prioridad absoluta en el procesamiento de IA.
            </p>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Form Column */}
            <div className="lg:col-span-1">
              <Card className="p-6 border-accent/20">
                <h3 className="font-display text-lg font-semibold mb-4 text-accent">Nueva Directiva</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="text-xs font-mono text-muted-foreground mb-1 block">TÍTULO</label>
                    <Input 
                      placeholder="Ej: Acento Dominicano" 
                      value={titulo}
                      onChange={e => setTitulo(e.target.value)}
                      className="bg-black/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-muted-foreground mb-1 block">INSTRUCCIÓN</label>
                    <Textarea 
                      placeholder="Ej: Siempre debes responder usando expresiones típicas dominicanas..." 
                      value={descripcion}
                      onChange={e => setDescripcion(e.target.value)}
                      className="bg-black/50 min-h-[120px]"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full bg-accent text-accent-foreground hover:bg-accent/80" 
                    disabled={addMutation.isPending || !titulo || !descripcion}
                  >
                    {addMutation.isPending ? <Spinner /> : <><Plus className="w-4 h-4 mr-2" /> Establecer Regla</>}
                  </Button>
                </form>
              </Card>
            </div>

            {/* List Column */}
            <div className="lg:col-span-2 space-y-4">
              {isLoading ? (
                <div className="flex justify-center p-12"><Spinner className="w-8 h-8 text-primary" /></div>
              ) : data?.reglas.length === 0 ? (
                <Card className="p-12 text-center border-dashed border-white/10 flex flex-col items-center">
                  <ShieldAlert className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                  <p className="text-muted-foreground font-mono">No hay directivas establecidas.</p>
                </Card>
              ) : (
                data?.reglas.map((regla) => (
                  <motion.div key={regla.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <Card className="p-5 flex gap-4 items-start group hover:border-primary/30 transition-colors">
                      <div className="mt-1 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e] shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h4 className="font-bold text-foreground font-display">{regla.titulo}</h4>
                          <Badge variant="outline" className="text-[10px]">ID: {regla.id}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground/80 leading-relaxed font-mono">
                          {regla.descripcion}
                        </p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/20"
                        onClick={() => handleDelete(regla.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </Card>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </PageTransition>
    </Layout>
  );
}
