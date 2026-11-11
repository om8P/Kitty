-- Allowed stores now live in member_stores (0001 copied them over).
ALTER TABLE "pool_members" DROP COLUMN "allowed_stores";
