import { Role, Specialite } from '@prisma/client';
import { Response, Router } from 'express';

import { dateExpirationActivation, genererCodeActivation } from '../../lib/code-activation';
import { envoyerEmailActivation } from '../../lib/mailer';
import { comparePassword, hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest, authenticate, requireRole } from '../../middleware/auth';

export const usersRouter = Router();

usersRouter.use(authenticate);

/// Longueur minimale volontairement modeste (usage interne RPI-PAD, pas
/// de politique de mot de passe imposée par le cahier des charges) —
/// utilisée pour le mot de passe choisi par l'utilisateur lui-même, à
/// l'activation (POST /auth/activer) ou à un changement volontaire
/// (PATCH /moi/mot-de-passe). L'administrateur ne choisit plus jamais de
/// mot de passe : voir /:id/regenerer-code-activation ci-dessous.
function validerMotDePasse(motDePasse: string): string | null {
  if (motDePasse.length < 6) {
    return 'Le mot de passe doit contenir au moins 6 caractères.';
  }
  return null;
}

function sansMotDePasse<T extends { passwordHash: string | null; codeActivationHash: string | null }>(
  utilisateur: T,
) {
  const { passwordHash: _passwordHash, codeActivationHash: _codeActivationHash, ...reste } = utilisateur;
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
// passe réel (il peut seulement lui envoyer un nouveau code d'activation
// en dépannage, voir PATCH /:id/regenerer-code-activation).
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

  if (!existant.passwordHash) {
    res.status(409).json({ message: 'Compte pas encore activé — utilisez le code d’activation reçu.' });
    return;
  }

  const motDePasseValide = await comparePassword(motDePasseActuel, existant.passwordHash);
  if (!motDePasseValide) {
    res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
    return;
  }

  const passwordHash = await hashPassword(nouveauMotDePasse);
  await prisma.user.update({
    where: { id: existant.id },
    data: { passwordHash },
  });

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
  const { nom, prenom, email, telephone, role, specialite, chambreId } = req.body as {
    nom?: string;
    prenom?: string;
    email?: string;
    telephone?: string;
    role?: Role;
    specialite?: Specialite | null;
    chambreId?: string | null;
  };

  if (!nom || !prenom || !email || !telephone || !role) {
    res.status(400).json({ message: 'Champs obligatoires manquants.' });
    return;
  }

  const emailNormalise = email.toLowerCase().trim();
  const existant = await prisma.user.findUnique({ where: { email: emailNormalise } });
  if (existant) {
    res.status(409).json({ message: 'Un compte existe déjà avec cet email.' });
    return;
  }

  // Pas de mot de passe choisi par l'administrateur : un code d'activation
  // à usage unique est généré, affiché une seule fois dans la réponse, et
  // transmis par email en best-effort — voir POST /auth/activer, où
  // l'utilisateur choisira lui-même son mot de passe définitif.
  const codeActivation = genererCodeActivation();
  const codeActivationHash = await hashPassword(codeActivation);

  const utilisateur = await prisma.user.create({
    data: {
      nom,
      prenom,
      email: emailNormalise,
      telephone,
      role,
      specialite: role === Role.technicien ? (specialite ?? null) : null,
      chambreId: role === Role.locataire ? (chambreId ?? null) : null,
      passwordHash: null,
      codeActivationHash,
      codeActivationExpiration: dateExpirationActivation(),
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

  const emailEnvoye = await envoyerEmailActivation({
    destinataire: utilisateur.email,
    prenom: utilisateur.prenom,
    codeActivation,
  });

  res.status(201).json({
    utilisateur: sansMotDePasse(utilisateur),
    codeActivation,
    emailEnvoye,
  });
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

// PATCH /:id/regenerer-code-activation — dépannage administrateur : un
// utilisateur bloqué (compte jamais activé, code expiré, ou mot de passe
// oublié) reçoit un nouveau code d'activation à usage unique. Contrairement
// à /moi/mot-de-passe, aucune vérification de l'ancien mot de passe n'est
// nécessaire ici (l'administrateur agit sur un compte qui n'est pas le
// sien). Le compte repasse par le flux d'activation (POST /auth/activer,
// passwordHash remis à null) : l'administrateur ne choisit et ne connaît
// donc jamais le mot de passe que l'utilisateur se donnera ensuite.
usersRouter.patch(
  '/:id/regenerer-code-activation',
  requireRole('administrateur'),
  async (req: AuthenticatedRequest, res: Response) => {
    const existant = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existant) {
      res.status(404).json({ message: 'Utilisateur introuvable.' });
      return;
    }

    const codeActivation = genererCodeActivation();
    const codeActivationHash = await hashPassword(codeActivation);

    const utilisateur = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        passwordHash: null,
        codeActivationHash,
        codeActivationExpiration: dateExpirationActivation(),
      },
    });

    await prisma.auditLogEntry.create({
      data: {
        utilisateurId: req.utilisateur!.id,
        action: "Régénération du code d'activation",
        cible: `${utilisateur.prenom} ${utilisateur.nom}`,
      },
    });

    const emailEnvoye = await envoyerEmailActivation({
      destinataire: utilisateur.email,
      prenom: utilisateur.prenom,
      codeActivation,
    });

    res.json({
      utilisateur: sansMotDePasse(utilisateur),
      codeActivation,
      emailEnvoye,
    });
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
