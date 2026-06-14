import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { PaymentController } from "./payment.controller.js";
import { createPaymentPlanStore, paymentPlanStoreToken } from "./payment-store.js";
import { PaymentService } from "./payment.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    {
      provide: paymentPlanStoreToken,
      useFactory: createPaymentPlanStore,
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
