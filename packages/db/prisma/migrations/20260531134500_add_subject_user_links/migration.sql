ALTER TABLE "Student" ADD COLUMN "userId" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "userId" TEXT;
ALTER TABLE "Guardian" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");
CREATE UNIQUE INDEX "Teacher_userId_key" ON "Teacher"("userId");
CREATE UNIQUE INDEX "Guardian_userId_key" ON "Guardian"("userId");

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Teacher"
  ADD CONSTRAINT "Teacher_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Guardian"
  ADD CONSTRAINT "Guardian_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
