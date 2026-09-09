import { Response, Router } from 'express';
import {
  ChangementStatut,
  CompteRendu,
  Incident,
  NiveauUrgence,
  StatutIncident,
  TypeIncident,
} from '@prisma/client';

import { suggererTypeIncident } from '../../lib/incident-classifier';
import { evaluerUrgence } from '../../lib/priority-engine';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest, authenticate, requireRole } from '../../middleware/auth';

export const incidentsRouter = Router();

incidentsRouter.use(authenticate);

const LABEL_TYPE: Record<TypeIncident, string> = {
  fuiteEau: "Fuite d'eau",
  panneElectrique: 'Panne électrique',
  degradationStructurelle: 'Dégradation structurelle',
  panneClimatisation: 'Panne de climatisation',
  problemePlomberie: 'Problème de plomberie',
  panneAscenseur: "Panne d'ascenseur",
  securiteIncendie: 'Sécurité incendie',
  autre: 'Autre',
};

const LABEL_URGENCE: Record<NiveauUrgence, string> = {
  faible: 'Faible',
  moyenne: 'Moyenne',
  elevee: 'Élevée',
  critique: 'Critique',
};

const LABEL_STATUT: Record<StatutIncident, string> = {
  nouveau: 'Nouveau',
  affecte: 'Affecté',
  enCours: 'En cours',
  enAttenteDePiece: 'En attente de pièce',
  resolu: 'Résolu',
  enAttenteValidation: 'En attente de validation',
  cloture: 'Clôturé',
};

function toIncidentJson(incident: Incident & { historique: ChangementStatut[] }) {
  return {
    id: incident.id,
    batimentId: incident.batimentId,
    localisationPrecise: incident.localisationPrecise,
    type: incident.type,
    description: incident.description,
    photos: incident.photos,
    urgence: incident.urgence,
    scoreUrgence: incident.scoreUrgence,
    facteursUrgence: incident.facteursUrgence,
    statut: incident.statut,
    signalantId: incident.locataireId,
    technicienAssigneId: incident.technicienAssigneId,
    dateSignalement: incident.dateSignalement,
    historique: incident.historique.map((h: ChangementStatut) => ({
      statut: h.statut,
      date: h.date,
      auteurId: h.auteurId,
      commentaire: h.commentaire,
    })),
  };
}

function toCompteRenduJson(compteRendu: CompteRendu) {
  return {
    id: compteRendu.id,
    incidentId: compteRendu.incidentId,
    technicienId: compteRendu.technicienId,
    description: compteRendu.description,
    dateIntervention: compteRendu.date,
    piecesUtilisees: compteRendu.piecesUtilisees,
    dureeMinutes: compteRendu.dureeMinutes,
  };
}

const INCLUDE_HISTORIQUE = { historique: { orderBy: { date: 'asc' as const } } };

function genererIdIncident(totalExistant: number): string {
  const numero = String(totalExistant + 1).padStart(4, '0');
  const suffixe = Math.random().toString(36).slice(2, 6);
  return `INC-${numero}-${suffixe}`;
}

incidentsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const { batimentId, statut, urgence, technicienId, signalantId, depuisLe, jusquAu, texteRecherche } =
    req.query;

  if (statut !== undefined && !Object.values(StatutIncident).includes(statut as StatutIncident)) {
    res.status(400).json({ message: 'Statut invalide.' });
    return;
  }
  if (urgence !== undefined && !Object.values(NiveauUrgence).includes(urgence as NiveauUrgence)) {
    res.status(400).json({ message: 'Urgence invalide.' });
    return;
  }

  const where: Record<string, unknown> = {};
  if (typeof batimentId === 'string') where.batimentId = batimentId;
  if (typeof statut === 'string') where.statut = statut;
  if (typeof urgence === 'string') where.urgence = urgence;
  if (typeof technicienId === 'string') where.technicienAssigneId = technicienId;
  if (typeof signalantId === 'string') where.locataireId = signalantId;

  if (typeof depuisLe === 'string' || typeof jusquAu === 'string') {
    const dateSignalement: Record<string, Date> = {};
    if (typeof depuisLe === 'string') {
      const date = new Date(depuisLe);
      if (Number.isNaN(date.getTime())) {
        res.status(400).json({ message: 'Paramètre depuisLe invalide.' });
        return;
      }
      dateSignalement.gte = date;
    }
    if (typeof jusquAu === 'string') {
      const date = new Date(jusquAu);
      if (Number.isNaN(date.getTime())) {
        res.status(400).json({ message: 'Paramètre jusquAu invalide.' });
        return;
      }
      dateSignalement.lte = date;
    }
    where.dateSignalement = dateSignalement;
  }

  if (typeof texteRecherche === 'string' && texteRecherche.trim() !== '') {
    const texte = texteRecherche.trim();
    where.OR = [
      { description: { contains: texte, mode: 'insensitive' } },
      { localisationPrecise: { contains: texte, mode: 'insensitive' } },
      { id: { contains: texte, mode: 'insensitive' } },
    ];
  }

  if (req.utilisateur!.role === 'locataire') {
    where.locataireId = req.utilisateur!.id;
  }

  const incidents = await prisma.incident.findMany({
    where,
    include: INCLUDE_HISTORIQUE,
    orderBy: [{ urgence: 'desc' }, { dateSignalement: 'desc' }],
  });

  res.json(incidents.map(toIncidentJson));
});

incidentsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const incident = await prisma.incident.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_HISTORIQUE,
  });

  if (!incident) {
    res.status(404).json({ message: 'Incident introuvable.' });
    return;
  }
  if (req.utilisateur!.role === 'locataire' && incident.locataireId !== req.utilisateur!.id) {
    res.status(403).json({ message: 'Accès refusé.' });
    return;
  }

  res.json(toIncidentJson(incident));
});

// POST /suggerer-type — suggestion IA du type d'incident à partir de la
// description libre saisie par le locataire (voir lib/incident-classifier
// .ts). Ouvert à tout utilisateur authentifié : le locataire l'utilise en
// remplissant le formulaire de signalement, l'administrateur aussi
// lorsqu'il signale au nom d'un tiers. Une panne côté IA (clé absente,
// réseau, réponse inexploitable) renvoie un 503 dédié plutôt que l'erreur
// générique 500 du filet de sécurité global : le client Flutter retombe
// alors simplement sur la sélection manuelle, sans bloquer le signalement.
incidentsRouter.post('/suggerer-type', async (req: AuthenticatedRequest, res: Response) => {
  const { description } = req.body as { description?: string };
  if (!description?.trim()) {
    res.status(400).json({ message: 'Description obligatoire.' });
    return;
  }

  try {
    const suggestion = await suggererTypeIncident(description);
    res.json(suggestion);
  } catch (erreur) {
    console.error('Suggestion IA indisponible :', erreur);
    res.status(503).json({
      message: 'Suggestion automatique indisponible pour le moment. Choisissez le type manuellement.',
    });
  }
});

incidentsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { batimentId, localisationPrecise, type, description, photos, locataireId } = req.body as {
    batimentId?: string;
    localisationPrecise?: string;
    type?: TypeIncident;
    description?: string;
    photos?: string[];
    locataireId?: string;
  };

  if (!batimentId || !localisationPrecise?.trim() || !type || !description?.trim()) {
    res.status(400).json({ message: 'Champs obligatoires manquants.' });
    return;
  }
  if (!Object.values(TypeIncident).includes(type)) {
    res.status(400).json({ message: "Type d'incident invalide." });
    return;
  }

  const batiment = await prisma.batiment.findUnique({ where: { id: batimentId } });
  if (!batiment) {
    res.status(404).json({ message: 'Bâtiment introuvable.' });
    return;
  }

  // Saisie au nom d'un tiers (besoin fonctionnel administrateur :
  // signalement téléphonique). Seul un administrateur peut désigner un
  // autre locataire comme signalant ; pour tout autre rôle, le champ
  // `locataireId` du corps de requête est ignoré et le signalant reste
  // toujours l'utilisateur authentifié (protection anti-usurpation déjà
  // en place, inchangée).
  let locataireCibleId = req.utilisateur!.id;
  let locataireCible: { id: string; nom: string; prenom: string } | null = null;
  if (req.utilisateur!.role === 'administrateur' && locataireId) {
    const cible = await prisma.user.findUnique({ where: { id: locataireId } });
    if (!cible || cible.role !== 'locataire') {
      res.status(400).json({ message: 'Locataire cible invalide.' });
      return;
    }
    locataireCibleId = cible.id;
    locataireCible = cible;
  }

  const evaluation = evaluerUrgence({
    type,
    description,
    criticiteBatiment: batiment.criticite,
  });

  const maintenant = new Date();
  const total = await prisma.incident.count();

  const incident = await prisma.incident.create({
    data: {
      id: genererIdIncident(total),
      batimentId,
      localisationPrecise: localisationPrecise.trim(),
      type,
      description: description.trim(),
      photos: Array.isArray(photos) ? photos : [],
      urgence: evaluation.niveau,
      scoreUrgence: evaluation.score,
      facteursUrgence: evaluation.facteursDeclenches,
      statut: StatutIncident.nouveau,
      locataireId: locataireCibleId,
      dateSignalement: maintenant,
      historique: {
        create: {
          statut: StatutIncident.nouveau,
          date: maintenant,
          auteurId: req.utilisateur!.id,
          commentaire: locataireCible
            ? `Signalé par l'administrateur au nom de ${locataireCible.prenom} ${locataireCible.nom}.`
            : null,
        },
      },
    },
    include: INCLUDE_HISTORIQUE,
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: "Signalement d'un incident",
      cible: `Incident ${incident.id}`,
      details: locataireCible
        ? `${LABEL_TYPE[type]} — urgence ${LABEL_URGENCE[evaluation.niveau]} — au nom de ${locataireCible.prenom} ${locataireCible.nom}`
        : `${LABEL_TYPE[type]} — urgence ${LABEL_URGENCE[evaluation.niveau]}`,
    },
  });

  if (locataireCible) {
    await prisma.notification.create({
      data: {
        utilisateurId: locataireCible.id,
        message: `Un incident a été signalé en votre nom par l'administrateur : ${LABEL_TYPE[type]} (${incident.id}).`,
        incidentId: incident.id,
      },
    });
  }

  res.status(201).json(toIncidentJson(incident));
});

incidentsRouter.patch(
  '/:id/affecter',
  requireRole('administrateur', 'technicien'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { technicienId } = req.body as { technicienId?: string };
    if (!technicienId) {
      res.status(400).json({ message: 'technicienId requis.' });
      return;
    }

    const incidentActuel = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incidentActuel) {
      res.status(404).json({ message: 'Incident introuvable.' });
      return;
    }

    const technicien = await prisma.user.findUnique({ where: { id: technicienId } });
    if (!technicien) {
      res.status(404).json({ message: 'Technicien introuvable.' });
      return;
    }

    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data: {
        statut: StatutIncident.affecte,
        technicienAssigneId: technicienId,
        historique: {
          create: {
            statut: StatutIncident.affecte,
            date: new Date(),
            auteurId: req.utilisateur!.id,
            commentaire: `Affecté à ${technicien.prenom} ${technicien.nom}.`,
          },
        },
      },
      include: INCLUDE_HISTORIQUE,
    });

    await prisma.auditLogEntry.create({
      data: {
        utilisateurId: req.utilisateur!.id,
        action: "Affectation d'un incident",
        cible: `Incident ${req.params.id}`,
        details: `Technicien : ${technicien.prenom} ${technicien.nom}`,
      },
    });

    // Notification in-app pour le technicien qui vient de recevoir
    // l'affectation.
    await prisma.notification.create({
      data: {
        utilisateurId: technicienId,
        message: `Nouvel incident affecté : ${LABEL_TYPE[incidentActuel.type]} (${incidentActuel.id}).`,
        incidentId: incidentActuel.id,
      },
    });

    res.json(toIncidentJson(incident));
  },
);

incidentsRouter.patch(
  '/:id/statut',
  requireRole('administrateur', 'technicien'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { statut, commentaire } = req.body as { statut?: StatutIncident; commentaire?: string };
    if (!statut || !Object.values(StatutIncident).includes(statut)) {
      res.status(400).json({ message: 'Statut invalide.' });
      return;
    }

    // Validation de clôture (besoin fonctionnel locataire) : seul un
    // administrateur peut clôturer directement un incident depuis cette
    // route générique (cas exceptionnel, ex. locataire injoignable). Un
    // technicien doit passer par « en attente de validation » puis
    // laisser le locataire valider via /valider-cloture, ou le locataire
    // peut rouvrir via /refuser-cloture.
    if (statut === StatutIncident.cloture && req.utilisateur!.role !== 'administrateur') {
      res.status(403).json({
        message:
          "Seul un administrateur peut clôturer directement un incident. Passez l'incident en « En attente de validation » pour que le locataire confirme la clôture.",
      });
      return;
    }

    const incidentActuel = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incidentActuel) {
      res.status(404).json({ message: 'Incident introuvable.' });
      return;
    }

    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data: {
        statut,
        historique: {
          create: {
            statut,
            date: new Date(),
            auteurId: req.utilisateur!.id,
            commentaire: commentaire ?? null,
          },
        },
      },
      include: INCLUDE_HISTORIQUE,
    });

    await prisma.auditLogEntry.create({
      data: {
        utilisateurId: req.utilisateur!.id,
        action: 'Changement de statut',
        cible: `Incident ${req.params.id}`,
        details: `Nouveau statut : ${LABEL_STATUT[statut]}`,
      },
    });

    // Notification in-app pour le locataire qui a signalé l'incident.
    await prisma.notification.create({
      data: {
        utilisateurId: incidentActuel.locataireId,
        message: `Le statut de votre incident ${incidentActuel.id} est passé à « ${LABEL_STATUT[statut]} ».`,
        incidentId: incidentActuel.id,
      },
    });

    res.json(toIncidentJson(incident));
  },
);

// PATCH /:id/valider-cloture — le locataire confirme que l'incident est
// réellement résolu : l'incident passe définitivement à « Clôturé ».
// Réservé au locataire propriétaire de l'incident (besoin fonctionnel
// "Valider la clôture d'un incident avant fermeture définitive").
incidentsRouter.patch(
  '/:id/valider-cloture',
  requireRole('locataire'),
  async (req: AuthenticatedRequest, res: Response) => {
    const incidentActuel = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incidentActuel) {
      res.status(404).json({ message: 'Incident introuvable.' });
      return;
    }
    if (incidentActuel.locataireId !== req.utilisateur!.id) {
      res.status(403).json({ message: 'Accès refusé.' });
      return;
    }
    if (incidentActuel.statut !== StatutIncident.enAttenteValidation) {
      res.status(400).json({
        message: "Cet incident n'est pas en attente de votre validation.",
      });
      return;
    }

    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data: {
        statut: StatutIncident.cloture,
        historique: {
          create: {
            statut: StatutIncident.cloture,
            date: new Date(),
            auteurId: req.utilisateur!.id,
            commentaire: 'Clôture validée par le locataire.',
          },
        },
      },
      include: INCLUDE_HISTORIQUE,
    });

    await prisma.auditLogEntry.create({
      data: {
        utilisateurId: req.utilisateur!.id,
        action: 'Validation de la clôture',
        cible: `Incident ${req.params.id}`,
      },
    });

    if (incidentActuel.technicienAssigneId) {
      await prisma.notification.create({
        data: {
          utilisateurId: incidentActuel.technicienAssigneId,
          message: `Le locataire a confirmé la clôture de l'incident ${incidentActuel.id}.`,
          incidentId: incidentActuel.id,
        },
      });
    }

    res.json(toIncidentJson(incident));
  },
);

// PATCH /:id/refuser-cloture — le locataire estime que le problème n'est
// pas réellement résolu : l'incident est rouvert (repasse « En cours »)
// avec un commentaire obligatoire, et le technicien assigné est notifié.
incidentsRouter.patch(
  '/:id/refuser-cloture',
  requireRole('locataire'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { commentaire } = req.body as { commentaire?: string };
    if (!commentaire?.trim()) {
      res.status(400).json({ message: 'Un commentaire expliquant le refus est obligatoire.' });
      return;
    }

    const incidentActuel = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incidentActuel) {
      res.status(404).json({ message: 'Incident introuvable.' });
      return;
    }
    if (incidentActuel.locataireId !== req.utilisateur!.id) {
      res.status(403).json({ message: 'Accès refusé.' });
      return;
    }
    if (incidentActuel.statut !== StatutIncident.enAttenteValidation) {
      res.status(400).json({
        message: "Cet incident n'est pas en attente de votre validation.",
      });
      return;
    }

    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data: {
        statut: StatutIncident.enCours,
        historique: {
          create: {
            statut: StatutIncident.enCours,
            date: new Date(),
            auteurId: req.utilisateur!.id,
            commentaire: `Clôture refusée par le locataire : ${commentaire.trim()}`,
          },
        },
      },
      include: INCLUDE_HISTORIQUE,
    });

    await prisma.auditLogEntry.create({
      data: {
        utilisateurId: req.utilisateur!.id,
        action: 'Refus de la clôture',
        cible: `Incident ${req.params.id}`,
        details: commentaire.trim(),
      },
    });

    if (incidentActuel.technicienAssigneId) {
      await prisma.notification.create({
        data: {
          utilisateurId: incidentActuel.technicienAssigneId,
          message: `Le locataire a refusé la clôture de l'incident ${incidentActuel.id} : ${commentaire.trim()}`,
          incidentId: incidentActuel.id,
        },
      });
    }

    res.json(toIncidentJson(incident));
  },
);

incidentsRouter.post(
  '/:id/comptes-rendus',
  requireRole('administrateur', 'technicien'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { description, piecesUtilisees, dureeMinutes, technicienId } = req.body as {
      description?: string;
      piecesUtilisees?: string;
      dureeMinutes?: number;
      technicienId?: string;
    };

    if (!description?.trim()) {
      res.status(400).json({ message: 'Description obligatoire.' });
      return;
    }

    const technicienEffectifId = req.utilisateur!.role === 'technicien' ? req.utilisateur!.id : technicienId;
    if (!technicienEffectifId) {
      res.status(400).json({ message: 'technicienId requis.' });
      return;
    }

    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) {
      res.status(404).json({ message: 'Incident introuvable.' });
      return;
    }

    const compteRendu = await prisma.compteRendu.create({
      data: {
        incidentId: req.params.id,
        technicienId: technicienEffectifId,
        description: description.trim(),
        piecesUtilisees: piecesUtilisees ?? null,
        dureeMinutes: dureeMinutes ?? null,
        date: new Date(),
      },
    });

    await prisma.auditLogEntry.create({
      data: {
        utilisateurId: technicienEffectifId,
        action: "Ajout d'un compte-rendu",
        cible: `Incident ${req.params.id}`,
      },
    });

    // Notification in-app pour le locataire qui a signalé l'incident.
    await prisma.notification.create({
      data: {
        utilisateurId: incident.locataireId,
        message: `Un compte-rendu a été ajouté pour votre incident ${incident.id}.`,
        incidentId: incident.id,
      },
    });

    res.status(201).json(toCompteRenduJson(compteRendu));
  },
);

incidentsRouter.get('/:id/comptes-rendus', async (req: AuthenticatedRequest, res: Response) => {
  const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
  if (!incident) {
    res.status(404).json({ message: 'Incident introuvable.' });
    return;
  }
  if (req.utilisateur!.role === 'locataire' && incident.locataireId !== req.utilisateur!.id) {
    res.status(403).json({ message: 'Accès refusé.' });
    return;
  }

  const comptesRendus = await prisma.compteRendu.findMany({
    where: { incidentId: req.params.id },
    orderBy: { date: 'desc' },
  });

  res.json(comptesRendus.map(toCompteRenduJson));
});