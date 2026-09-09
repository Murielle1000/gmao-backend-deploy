-- CreateEnum
CREATE TYPE "Role" AS ENUM ('administrateur', 'technicien', 'locataire');

-- CreateEnum
CREATE TYPE "Specialite" AS ENUM ('plomberie', 'electricite', 'batiment', 'climatisation', 'generale');

-- CreateEnum
CREATE TYPE "CriticiteBatiment" AS ENUM ('standard', 'importante', 'strategique');

-- CreateEnum
CREATE TYPE "TypeIncident" AS ENUM ('fuiteEau', 'panneElectrique', 'degradationStructurelle', 'panneClimatisation', 'problemePlomberie', 'panneAscenseur', 'securiteIncendie', 'autre');

-- CreateEnum
CREATE TYPE "NiveauUrgence" AS ENUM ('faible', 'moyenne', 'elevee', 'critique');

-- CreateEnum
CREATE TYPE "StatutIncident" AS ENUM ('nouveau', 'affecte', 'enCours', 'enAttenteDePiece', 'resolu', 'cloture');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "specialite" "Specialite",
    "chambreId" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photoUrl" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batiments" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "criticite" "CriticiteBatiment" NOT NULL DEFAULT 'standard',

    CONSTRAINT "batiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chambres" (
    "id" TEXT NOT NULL,
    "batimentId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "chambres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "batimentId" TEXT NOT NULL,
    "localisationPrecise" TEXT NOT NULL,
    "type" "TypeIncident" NOT NULL,
    "description" TEXT NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "urgence" "NiveauUrgence" NOT NULL,
    "scoreUrgence" DOUBLE PRECISION NOT NULL,
    "facteursUrgence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statut" "StatutIncident" NOT NULL DEFAULT 'nouveau',
    "locataireId" TEXT NOT NULL,
    "technicienAssigneId" TEXT,
    "dateSignalement" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changements_statut" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "statut" "StatutIncident" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auteurId" TEXT NOT NULL,
    "commentaire" TEXT,

    CONSTRAINT "changements_statut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comptes_rendus" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "technicienId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "piecesUtilisees" TEXT,
    "dureeMinutes" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comptes_rendus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisateurId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "cible" TEXT NOT NULL,
    "details" TEXT,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "batiments_code_key" ON "batiments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "chambres_batimentId_numero_key" ON "chambres"("batimentId", "numero");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_chambreId_fkey" FOREIGN KEY ("chambreId") REFERENCES "chambres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chambres" ADD CONSTRAINT "chambres_batimentId_fkey" FOREIGN KEY ("batimentId") REFERENCES "batiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_batimentId_fkey" FOREIGN KEY ("batimentId") REFERENCES "batiments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_locataireId_fkey" FOREIGN KEY ("locataireId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_technicienAssigneId_fkey" FOREIGN KEY ("technicienAssigneId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changements_statut" ADD CONSTRAINT "changements_statut_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changements_statut" ADD CONSTRAINT "changements_statut_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comptes_rendus" ADD CONSTRAINT "comptes_rendus_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comptes_rendus" ADD CONSTRAINT "comptes_rendus_technicienId_fkey" FOREIGN KEY ("technicienId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
