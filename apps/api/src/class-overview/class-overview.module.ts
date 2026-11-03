import { Module } from "@nestjs/common";
import { ClassOverviewController } from "./class-overview.controller.js";
import { ClassOverviewService } from "./class-overview.service.js";
import { classOverviewStoreToken, createClassOverviewStore } from "./class-overview.store.js";

@Module({
  controllers: [ClassOverviewController],
  providers: [{ provide: classOverviewStoreToken, useFactory: createClassOverviewStore }, ClassOverviewService],
})
export class ClassOverviewModule {}
