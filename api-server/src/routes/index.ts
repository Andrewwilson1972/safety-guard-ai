import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import detectRouter from "./detect";
import analyticsRouter from "./analytics";
import historyRouter from "./history";
import chatRouter from "./chat";
import reportRouter from "./report";
import streamRouter from "./stream";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(detectRouter);
router.use(analyticsRouter);
router.use(historyRouter);
router.use(chatRouter);
router.use(reportRouter);
router.use(streamRouter);

export default router;
