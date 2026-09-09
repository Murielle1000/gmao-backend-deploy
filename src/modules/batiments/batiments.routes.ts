import { CriticiteBatiment } from '@prisma/client';
import { Response, Router } from 'express';

import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest, authenticate, requireRole } from '../../middleware/auth';

export const batimentsRouter = Router();

batimentsRouter.use(authenticate);

batimentsRouter.get('/', async (_req: AuthenticatedRequest, res: Response) => {
  const batiments = await prisma.batiment.findMany({ orderBy: { nom: 'asc' } });
  res.json(batiments);
});

batimentsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const batiment = await prisma.batiment.findUnique({ where: { id: req.params.id } });
  if (!batiment) {
    res.status(404).json({ message: 'Bâtiment introuvable.' });
    return;
  }
  res.json(batiment);
});

batimentsRouter.post('/', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const { nom, code, adresse, criticite } = req.body as {
    nom?: string;
    code?: string;
    adresse?: string;
    criticite?: CriticiteBatiment;
  };

  if (!nom || !code || !adresse) {
    res.status(400).json({ message: 'Champs obligatoires manquants.' });
    return;
  }

  const codeNormalise = code.trim();
  const existant = await prisma.batiment.findUnique({ where: { code: codeNormalise } });
  if (existant) {
    res.status(409).json({ message: 'Un bâtiment existe déjà avec ce code.' });
    return;
  }

  const batiment = await prisma.batiment.create({
    data: {
      nom,
      code: codeNormalise,
      adresse,
      criticite: criticite ?? CriticiteBatiment.standard,
    },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: "Création d'un bâtiment",
      cible: batiment.nom,
    },
  });

  res.status(201).json(batiment);
});

batimentsRouter.patch('/:id', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const { nom, code, adresse, criticite } = req.body as {
    nom?: string;
    code?: string;
    adresse?: string;
    criticite?: CriticiteBatiment;
  };

  const existant = await prisma.batiment.findUnique({ where: { id: req.params.id } });
  if (!existant) {
    res.status(404).json({ message: 'Bâtiment introuvable.' });
    return;
  }

  const batiment = await prisma.batiment.update({
    where: { id: req.params.id },
    data: {
      nom: nom ?? existant.nom,
      code: code ? code.trim() : existant.code,
      adresse: adresse ?? existant.adresse,
      criticite: criticite ?? existant.criticite,
    },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: "Modification d'un bâtiment",
      cible: batiment.nom,
    },
  });

  res.json(batiment);
});

batimentsRouter.get('/:id/chambres', async (req: AuthenticatedRequest, res: Response) => {
  const chambres = await prisma.chambre.findMany({
    where: { batimentId: req.params.id },
    orderBy: { numero: 'asc' },
  });
  res.json(chambres);
});

batimentsRouter.post('/:id/chambres', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const { numero, description } = req.body as { numero?: string; description?: string | null };

  if (!numero) {
    res.status(400).json({ message: 'Le numéro de chambre est obligatoire.' });
    return;
  }

  const batiment = await prisma.batiment.findUnique({ where: { id: req.params.id } });
  if (!batiment) {
    res.status(404).json({ message: 'Bâtiment introuvable.' });
    return;
  }

  const existante = await prisma.chambre.findFirst({
    where: { batimentId: req.params.id, numero: numero.trim() },
  });
  if (existante) {
    res.status(409).json({ message: 'Une chambre avec ce numéro existe déjà dans ce bâtiment.' });
    return;
  }

  const chambre = await prisma.chambre.create({
    data: {
      batimentId: req.params.id,
      numero: numero.trim(),
      description: description ?? null,
    },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: "Création d'une chambre",
      cible: `${batiment.nom} — Chambre ${chambre.numero}`,
    },
  });

  res.status(201).json(chambre);
});