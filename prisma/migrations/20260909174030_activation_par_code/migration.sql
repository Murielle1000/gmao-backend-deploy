-- AlterTable
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN     "codeActivationHash" TEXT;
ALTER TABLE "users" ADD COLUMN     "codeActivationExpiration" TIMESTAMP(3);
ALTER TABLE "users" DROP COLUMN "doitChangerMotDePasse";
