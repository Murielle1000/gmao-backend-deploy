import { Role, Specialite } from '@prisma/client';
import { Response, Router } from 'express';

import { comparePassword, hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest, authenticate, requireRole } from '../../middleware/auth';

export const usersRouter = Router();

usersRouter.use(authenticate);

/// Longueur minimale volontairement modeste (usage interne RPI-PAD, pas
/// de politique de mot de passe imposée par le cahier des charges) : ce
/// qui compte est que l'administrateur choisisse lui-même le mot de passe
/// (plus de génération aléatoire "temporaire") et que chaque utilisateur
/// puisse ensuite le changer lui-même — voir /moi/mot-de-passe ci-dessous.
function validerMotDePasse(motDePasse: string): string | null {
  if (motDePasse.length < 6) {
    return 'Le mot de passe doit contenir au moins 6 caractères.';
  }
  return null;
}

function sansMotDePasse<T extends { passwordHash: string }>(utilisateur: T) {
  const { passwordHash: _passwordHash, ...reste } = utilisateur;
  return reste;
}

usersRouter.get('/', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const role = req.query.role as Role | undefined;
  const utilisateurs = await prisma.user.findMany({
    where: role ? { role } : undefined,
    orderBy: { dateCreation: 'desc' },
  });
  res.json(utilisateurs.map(sansMotDePasse));
});

// PATCH /moi — chaque utilisateur connecté modifie ses propres
// informations (nom, prénom, email, téléphone), quel que soit son rôle.
// Le rôle, la spécialité et le rattachement à une chambre restent
// exclusivement gérés par l'administrateur via PATCH /:id (ce ne sont pas
// de simples informations de contact, mais des attributs de gestion des
// droits / du référentiel des logements).
//
// IMPORTANT : cette route doit rester déclarée AVANT les routes
// paramétrées `/:id` ci-dessous, sinon Express interpréterait "moi" comme
// une valeur de `:id`.
usersRouter.patch('/moi', async (req: AuthenticatedRequest, res: Response) => {
  const { nom, prenom, email, telephone, photoUrl } = req.body as {
    nom?: string;
    prenom?: string;
    email?: string;
    telephone?: string;
    // Photo de profil encodée en base64 (data URI, ex.
    // "data:image/jpeg;base64,...") — voir la limite de taille du corps
    // JSON dans app.ts. Pas de service de stockage de fichiers séparé :
    // stockée telle quelle dans la colonne `photoUrl`.
    photoUrl?: string | null;
  };

  if (photoUrl !== undefined && photoUrl !== null) {
    if (!photoUrl.startsWith('data:image/')) {
      res.status(400).json({ message: 'Format de photo invalide.' });
      return;
    }
    if (photoUrl.length > 2_800_000) {
      res.status(400).json({ message: 'Photo trop volumineuse.' });
      return;
    }
  }

  const existant = await prisma.user.findUnique({ where: { id: req.utilisateur!.id } });
  if (!existant) {
    res.status(404).json({ message: 'Utilisateur introuvable.' });
    return;
  }

  const emailNormalise = email ? email.toLowerCase().trim() : existant.email;
  if (email) {
    const autre = await prisma.user.findUnique({ where: { email: emailNormalise } });
    if (autre && autre.id !== existant.id) {
      res.status(409).json({ message: 'Un compte existe déjà avec cet email.' });
      return;
    }
  }

  const utilisateur = await prisma.user.update({
    where: { id: existant.id },
    data: {
      nom: nom ?? existant.nom,
      prenom: prenom ?? existant.prenom,
      email: emailNormalise,
      telephone: telephone ?? existant.telephone,
      photoUrl: photoUrl === undefined ? existant.photoUrl : photoUrl,
    },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: existant.id,
      action: 'Modification de son profil',
      cible: `${utilisateur.prenom} ${utilisateur.nom}`,
    },
  });

  res.json(sansMotDePasse(utilisateur));
});

// PATCH /moi/mot-de-passe — chaque utilisateur change lui-même son mot de
// passe, en reconfirmant l'actuel (protection contre une session laissée
// ouverte sur un appareil emprunté). C'est la seule route qui met à jour
// un mot de passe sans passer par l'administrateur : une fois qu'un
// utilisateur l'a utilisée, l'administrateur ne connaît plus son mot de
// passe réel (il peut seulement le réinitialiser en dépannage, voir
// PATCH /:id/reinitialiser-mot-de-passe).
usersRouter.patch('/moi/mot-de-passe', async (req: AuthenticatedRequest, res: Response) => {
  const { motDePasseActuel, nouveauMotDePasse } = req.body as {
    motDePasseActuel?: string;
    nouveauMotDePasse?: string;
  };

  if (!motDePasseActuel || !nouveauMotDePasse) {
    res.status(400).json({ message: 'Mot de passe actuel et nouveau mot de passe requis.' });
    return;
  }

  const erreurValidation = validerMotDePasse(nouveauMotDePasse);
  if (erreurValidation) {
    res.status(400).json({ message: erreurValidation });
    return;
  }

  const existant = await prisma.user.findUnique({ where: { id: req.utilisateur!.id } });
  if (!existant) {
    res.status(404).json({ message: 'Utilisateur introuvable.' });
    return;
  }

  const motDePasseValide = await comparePassword(motDePasseActuel, existant.passwordHash);
  if (!motDePasseValide) {
    res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
    return;
  }

  const passwordHash = await hashPassword(nouveauMotDePasse);
  await prisma.user.update({ where: { id: existant.id }, data: { passwordHash } });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: existant.id,
      action: 'Changement de mot de passe',
      cible: `${existant.prenom} ${existant.nom}`,
    },
  });

  res.json({ message: 'Mot de passe mis à jour.' });
});

usersRouter.get('/:id', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const utilisateur = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!utilisateur) {
    res.status(404).json({ message: 'Utilisateur introuvable.' });
    return;
  }
  res.json(sansMotDePasse(utilisateur));
});

usersRouter.post('/', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const { nom, prenom, email, telephone, role, specialite, chambreId, motDePasse } = req.body as {
    nom?: string;
    prenom?: string;
    email?: string;
    telephone?: string;
    role?: Role;
    specialite?: Specialite | null;
    chambreId?: string | null;
    motDePasse?: string;
  };

  if (!nom || !prenom || !email || !telephone || !role || !motDePasse) {
    res.status(400).json({ message: 'Champs obligatoires manquants.' });
    return;
  }

  const erreurValidation = validerMotDePasse(motDePasse);
  if (erreurValidation) {
    res.status(400).json({ message: erreurValidation });
    return;
  }

  const emailNormalise = email.toLowerCase().trim();
  const existant = await prisma.user.findUnique({ where: { email: emailNormalise } });
  if (existant) {
    res.status(409).json({ message: 'Un compte existe déjà avec cet email.' });
    return;
  }

  const passwordHash = await hashPassword(motDePasse);

  const utilisateur = await prisma.user.create({
    data: {
      nom,
      prenom,
      email: emailNormalise,
      telephone,
      role,
      specialite: role === Role.technicien ? (specialite ?? null) : null,
      chambreId: role === Role.locataire ? (chambreId ?? null) : null,
      passwordHash,
    },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: "Création d'un utilisateur",
      cible: `${utilisateur.prenom} ${utilisateur.nom}`,
      details: role,
    },
  });

  res.status(201).json(sansMotDePasse(utilisateur));
});

usersRouter.patch('/:id', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const { nom, prenom, email, telephone, role, specialite, chambreId } = req.body as {
    nom?: string;
    prenom?: string;
    email?: string;
    telephone?: string;
    role?: Role;
    specialite?: Specialite | null;
    chambreId?: string | null;
  };

  const existant = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existant) {
    res.status(404).json({ message: 'Utilisateur introuvable.' });
    return;
  }

  const roleFinal = role ?? existant.role;

  const utilisateur = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      nom: nom ?? existant.nom,
      prenom: prenom ?? existant.prenom,
      email: email ? email.toLowerCase().trim() : existant.email,
      telephone: telephone ?? existant.telephone,
      role: roleFinal,
      specialite: roleFinal === Role.technicien ? (specialite ?? existant.specialite) : null,
      chambreId: roleFinal === Role.locataire ? (chambreId ?? existant.chambreId) : null,
    },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: "Modification d'un utilisateur",
      cible: `${utilisateur.prenom} ${utilisateur.nom}`,
    },
  });

  res.json(sansMotDePasse(utilisateur));
});

// PATCH /:id/reinitialiser-mot-de-passe — dépannage administrateur : un
// utilisateur bloqué (mot de passe oublié, compte jamais activé) reçoit
// un nouveau mot de passe choisi par l'administrateur, à lui transmettre
// directement. Contrairement à /moi/mot-de-passe, aucune vérification de
// l'ancien mot de passe n'est nécessaire ici (l'administrateur agit sur
// un compte qui n'est pas le sien) — c'est la seule façon pour lui de
// "gérer l'accès" d'un utilisateur sans jamais connaître le mot de passe
// que cet utilisateur choisira ensuite lui-même.
usersRouter.patch(
  '/:id/reinitialiser-mot-de-passe',
  requireRole('administrateur'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { motDePasse } = req.body as { motDePasse?: string };
    if (!motDePasse) {
      res.status(400).json({ message: 'motDePasse requis.' });
      return;
    }

    const erreurValidation = validerMotDePasse(motDePasse);
    if (erreurValidation) {
      res.status(400).json({ message: erreurValidation });
      return;
    }

    const existant = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existant) {
      res.status(404).json({ message: 'Utilisateur introuvable.' });
      return;
    }

    const passwordHash = await hashPassword(motDePasse);

    const utilisateur = await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash },
    });

    await prisma.auditLogEntry.create({
      data: {
        utilisateurId: req.utilisateur!.id,
        action: 'Réinitialisation du mot de passe',
        cible: `${utilisateur.prenom} ${utilisateur.nom}`,
      },
    });

    res.json(sansMotDePasse(utilisateur));
  },
);

// DELETE /:id — suppression définitive, réservée aux comptes sans aucun
// historique associé (incidents signalés/affectés, comptes-rendus,
// changements de statut) : le cahier des charges exige la non-répudiation
// et la traçabilité complète, donc supprimer un compte ayant déjà agi
// dans l'application casserait soit une contrainte de clé étrangère, soit
// (en cascade) l'historique lui-même. Dans ce cas, l'administrateur doit
// désactiver le compte plutôt que le supprimer. Les notifications
// personnelles du compte sont supprimées en cascade (`onDelete: Cascade`
// dans le schéma) : elles ne bloquent jamais la suppression.
usersRouter.delete('/:id', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  if (req.params.id === req.utilisateur!.id) {
    res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte.' });
    return;
  }

  const existant = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existant) {
    res.status(404).json({ message: 'Utilisateur introuvable.' });
    return;
  }

  const [incidentsSignales, incidentsAffectes, changementsStatut, comptesRendus] = await Promise.all([
    prisma.incident.count({ where: { locataireId: req.params.id } }),
    prisma.incident.count({ where: { technicienAssigneId: req.params.id } }),
    prisma.changementStatut.count({ where: { auteurId: req.params.id } }),
    prisma.compteRendu.count({ where: { technicienId: req.params.id } }),
  ]);

  const aUnHistorique =
    incidentsSignales > 0 || incidentsAffectes > 0 || changementsStatut > 0 || comptesRendus > 0;

  if (aUnHistorique) {
    res.status(409).json({
      message:
        "Impossible de supprimer ce compte : il a un historique associé (incidents, comptes-rendus ou changements de statut). Désactivez-le à la place pour conserver la traçabilité.",
    });
    return;
  }

  await prisma.user.delete({ where: { id: req.params.id } });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: "Suppression d'un utilisateur",
      cible: `${existant.prenom} ${existant.nom}`,
    },
  });

  res.json({ message: 'Utilisateur supprimé.' });
});

usersRouter.patch('/:id/activation', requireRole('administrateur'), async (req: AuthenticatedRequest, res: Response) => {
  const { actif } = req.body as { actif?: boolean };
  if (typeof actif !== 'boolean') {
    res.status(400).json({ message: 'Le champ actif (booléen) est requis.' });
    return;
  }

  const existant = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existant) {
    res.status(404).json({ message: 'Utilisateur introuvable.' });
    return;
  }

  const utilisateur = await prisma.user.update({
    where: { id: req.params.id },
    data: { actif },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: req.utilisateur!.id,
      action: actif ? "Réactivation d'un compte" : "Désactivation d'un compte",
      cible: `${utilisateur.prenom} ${utilisateur.nom}`,
    },
  });

  res.json(sansMotDePasse(utilisateur));
});
