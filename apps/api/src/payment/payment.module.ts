import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
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
      inject: [studentStoreToken].slice(),
      // In-memory driver resolves the F-33 student label through the student store; Postgres reads it under RLS.
      useFactory: (students: StudentStore) => createPaymentPlanStore((id) => students.findById(id)),
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
