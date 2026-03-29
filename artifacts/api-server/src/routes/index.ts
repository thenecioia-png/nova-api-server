import { Router, type IRouter } from "express";
import healthRouter from "./health";
import asistenteRouter from "./asistente";
import botRouter from "./bot";
import tareasRouter from "./tareas";

const router: IRouter = Router();

router.use(healthRouter);
router.use(asistenteRouter);
router.use(botRouter);
router.use(tareasRouter);

export default router;
