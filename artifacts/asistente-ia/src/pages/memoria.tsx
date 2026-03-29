import { useState } from "react";
import { Database, Plus, Trash2, Brain, Tag } from "lucide-react";
import { format } from "date-fns";
import { Layout } from "@/components/layout";
import { Button, Input, Textarea, Card, Badge, Spinner, PageTransition } from "@/components/ui-elements";
import { useMemoria, useAddMemoria, useDeleteMemoria } from "@/hooks/use-asistente";
import { useToast } from "@/hooks/use-toast";

export default function MemoriaPage() {
  const { data, isLoading } = useMemoria();
  const addMutation = useAddMemoria();
  const deleteMutation = useDeleteMemoria();
  const { toast } = useToast();

  const [clave, setClave] = useState("");
  const [valor, setValor] = useState("");
  const [categoria, setCategoria] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clave || !valor || !categoria) return;

    addMutation.mutate({ data: { clave, valor, categoria } }, {
      onSuccess: () => {
        setClave("");
        setValor("");
        setCategoria("");
        toast({ title: "Dato memorizado", description: "Agregado al banco de memoria de la IA." });
      },
      onError: () => toast({ variant: "destructive", title: "Error", description: "Fallo al guardar." })
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => toast({ title: "Memoria purgada" })
    });
  };

  return (
    <Layout>
      <PageTransition className="p-6 md:p-10 h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-8">
          
          <header className="mb-8">
            <h1 className="text-4xl font-display font-bold text-foreground flex items-center gap-3">
              <Brain className="w-10 h-10 text-primary" />
              Núcleo de Memoria
            </h1>
            <p className="text-muted-foreground mt-2 font-mono text-sm max-w-2xl">
              Almacenamiento persistente a largo plazo. N.O.V.A utiliza estos datos como contexto en cada interacción.
            </p>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Form */}
            <div className="lg:col-span-4">
              <Card className="p-6 border-primary/20 sticky top-6">
                <h3 className="font-display text-lg font-semibold mb-4 text-primary flex items-center gap-2">
                  <Database className="w-5 h-5" /> Inyectar Dato
                </h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="text-xs font-mono text-muted-foreground mb-1 block">IDENTIFICADOR (CLAVE)</label>
                    <Input 
                      placeholder="Ej: mi_nombre" 
                      value={clave}
                      onChange={e => setClave(e.target.value)}
                      className="bg-black/50 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-muted-foreground mb-1 block">VALOR</label>
                    <Textarea 
                      placeholder="El valor a recordar..." 
                      value={valor}
                      onChange={e => setValor(e.target.value)}
                      className="bg-black/50 min-h-[100px]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-muted-foreground mb-1 block">CATEGORÍA</label>
                    <Input 
                      placeholder="Ej: personal, preferencias, trabajo" 
                      value={categoria}
                      onChange={e => setCategoria(e.target.value)}
                      className="bg-black/50"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    variant="neon"
                    className="w-full mt-2" 
                    disabled={addMutation.isPending || !clave || !valor || !categoria}
                  >
                    {addMutation.isPending ? <Spinner /> : "Almacenar"}
                  </Button>
                </form>
              </Card>
            </div>

            {/* Grid */}
            <div className="lg:col-span-8">
              {isLoading ? (
                <div className="flex justify-center p-12"><Spinner className="w-8 h-8 text-primary" /></div>
              ) : data?.memoria.length === 0 ? (
                <Card className="p-12 text-center border-dashed border-white/10 flex flex-col items-center">
                  <Database className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                  <p className="text-muted-foreground font-mono">El banco de memoria está vacío.</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data?.memoria.map((item) => (
                    <Card key={item.id} className="p-5 flex flex-col group relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:bg-destructive/20"
                          onClick={() => handleDelete(item.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="default" className="font-mono text-[10px] tracking-wider uppercase">
                          {item.clave}
                        </Badge>
                      </div>
                      
                      <p className="text-foreground/90 flex-1 mb-4 text-sm leading-relaxed">
                        {item.valor}
                      </p>
                      
                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Tag className="w-3 h-3" /> {item.categoria}
                        </div>
                        <span className="text-[10px] text-muted-foreground/50 font-mono">
                          {item.creadaEn ? format(new Date(item.creadaEn), 'dd/MM/yyyy HH:mm') : ''}
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </PageTransition>
    </Layout>
  );
}
