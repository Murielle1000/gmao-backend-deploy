import { PrismaClient } from '@prisma/client';

// Une seule instance de PrismaClient, réutilisée dans toute l'app (évite
// d'ouvrir trop de connexions en développement avec le rechargement à chaud).
export const prisma = new PrismaClient();