import { History, Search, User, Terminal } from "lucide-react";
import { format } from "date-fns";
import { Layout } from "@/components/layout";
import { Card, Input, Spinner, PageTransition } from "@/components/ui-elements";
import { useHistorial } from "@/hooks/use-asistente";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

export default function HistorialPage() {
  const { data, isLoading } = useHistorial();
  const [search, setSearch] = useState("");

  const filteredHistory = data?.historial?.filter(item => 
    item.contenido.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime()) || [];

  return (
    <Layout>
      <PageTransition className="flex flex-col h-full">
        <header className="px-6 md:px-10 py-8 border-b border-border/50 shrink-0">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
                <History className="w-8 h-8 text-secondary-foreground/50" />
                Registros del Sistema
              </h1>
              <p className="text-muted-foreground mt-1 font-mono text-xs">
                Log completo de interacciones pasadas.
              </p>
            </div>
            
            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Buscar en registros..." 
                className="pl-9 bg-black/40 border-white/10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="max-w-4xl mx-auto space-y-6">
            {isLoading ? (
              <div className="flex justify-center p-12"><Spinner className="w-8 h-8 text-primary" /></div>
            ) : filteredHistory.length === 0 ? (
              <Card className="p-12 text-center border-dashed border-white/10 flex flex-col items-center">
                <History className="w-12 h-12 text-muted-foreground mb-4 opacity-30" />
                <p className="text-muted-foreground font-mono">No se encontraron registros.</p>
              </Card>
            ) : (
              <div className="relative border-l border-white/10 pl-6 ml-3 space-y-8 pb-12">
                {filteredHistory.map((item) => (
                  <div key={item.id} className="relative">
                    {/* Timeline dot */}
                    <div className="absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 border-background bg-card flex items-center justify-center">
                      <div className={`w-1.5 h-1.5 rounded-full ${item.rol === 'user' ? 'bg-foreground' : 'bg-primary shadow-[0_0_8px_hsl(var(--primary))]'}`} />
                    </div>
                    
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-xs font-mono font-semibold uppercase tracking-wider flex items-center gap-1 ${item.rol === 'user' ? 'text-foreground/70' : 'text-primary'}`}>
                        {item.rol === 'user' ? <User className="w-3 h-3"/> : <Terminal className="w-3 h-3" />}
                        {item.rol === 'user' ? 'Usuario' : 'N.O.V.A'}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {item.creadoEn ? format(new Date(item.creadoEn), 'dd/MM/yyyy HH:mm:ss') : ''}
                      </span>
                    </div>
                    
                    <Card className="p-4 bg-black/20 border-white/5">
                      <div className="prose prose-sm prose-invert max-w-none font-mono text-sm opacity-90">
                        <ReactMarkdown>{item.contenido}</ReactMarkdown>
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageTransition>
    </Layout>
  );
}
