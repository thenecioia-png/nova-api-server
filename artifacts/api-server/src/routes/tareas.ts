import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tareasTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/tareas", async (req, res) => {
  try {
    const tareas = await db.select().from(tareasTable).orderBy(tareasTable.creadaEn);
    res.json({ tareas });
  } catch (err) {
    req.log.error({ err }, "Error obteniendo tareas");
    res.status(500).json({ error: "Error interno" });
  }
});

router.post("/tareas", async (req, res) => {
  try {
    const { descripcion, hora, diasSemana, accion, payload } = req.body;
    const [tarea] = await db.insert(tareasTable).values({
      descripcion,
      hora,
      diasSemana: diasSemana ?? null,
      accion: accion ?? "notificar",
      payload: payload ?? {},
    }).returning();
    res.status(201).json(tarea);
  } catch (err) {
    req.log.error({ err }, "Error creando tarea");
    res.status(400).json({ error: "Datos inválidos" });
  }
});

router.patch("/tareas/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { activa } = req.body;
    const [updated] = await db.update(tareasTable).set({ activa }).where(eq(tareasTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Error actualizando tarea" });
  }
});

router.delete("/tareas/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(tareasTable).where(eq(tareasTable.id, id));
    res.json({ mensaje: "Tarea eliminada" });
  } catch (err) {
    res.status(500).json({ error: "Error eliminando tarea" });
  }
});

export default router;
