import { Router, type IRouter } from "express";
import healthRouter from "./health";
import conversationRouter from "./conversation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(conversationRouter);

export default router;
