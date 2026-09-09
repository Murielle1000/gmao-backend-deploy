import { Router } from 'express';

import { signToken } from '../../lib/jwt';
import { comparePassword, hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';

export const authRouter = Router();

function sansSecrets<T extends { passwordHash: string | null; codeActivationHash: string | null }>(
  utilisateur: T,
) {
  const { passwordHash: _passwordHash, codeActivationHash: _codeActivationHash, ...reste } = utilisateur;
  return reste;
}

authRouter.post('/login', async (req, res) => {
  const { email, motDePasse } = req.body as { email?: string; motDePasse?: string };

  if (!email || !motDePasse) {
    res.status(400).json({ message: 'Email et mot de passe requis.' });
    return;
  }

  const utilisateur = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!utilisateur) {
    res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    return;
  }

  if (!utilisateur.actif) {
    res.status(403).json({ message: 'Ce compte a été désactivé. Contactez un administrateur.' });
    return;
  }

  // Compte créé par un administrateur mais jamais encore activé (ou
  // réinitialisé en dépannage, voir PATCH /:id/regenerer-code-activation) :
  // il n'a pas encore de mot de passe, seulement un code d'activation.
  if (!utilisateur.passwordHash) {
    res.status(409).json({
      message:
        "Ce compte n'a pas encore été activé. Utilisez le code d'activation reçu (écran de connexion → « Première connexion ? »).",
    });
    return;
  }

  const motDePasseValide = await comparePassword(motDePasse, utilisateur.passwordHash);
  if (!motDePasseValide) {
    res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    return;
  }

  const token = signToken({ id: utilisateur.id, role: utilisateur.role });
  res.json({ token, utilisateur: sansSecrets(utilisateur) });
});

/// Activation d'un compte créé par un administrateur : première (ou
/// nouvelle, après un dépannage) mise en place d'un mot de passe, choisi
/// par l'utilisateur lui-même — jamais par l'administrateur. Route
/// publique (pas de JWT : l'utilisateur n'est pas encore connecté), mais
/// protégée par le code d'activation à usage unique et limité dans le
/// temps (voir code-activation.ts).
authRouter.post('/activer', async (req, res) => {
  const { email, codeActivation, motDePasse } = req.body as {
    email?: string;
    codeActivation?: string;
    motDePasse?: string;
  };

  if (!email || !codeActivation || !motDePasse) {
    res.status(400).json({ message: 'Email, code d’activation et mot de passe requis.' });
    return;
  }

  if (motDePasse.length < 6) {
    res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
    return;
  }

  const utilisateur = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  // Message volontairement générique (n'indique pas si c'est l'email ou le
  // code qui est en cause) : évite de confirmer à un tiers qu'un email
  // donné a bien un compte dans le système.
  const messageInvalide = { message: 'Email ou code d’activation invalide.' };

  if (!utilisateur || !utilisateur.codeActivationHash || !utilisateur.codeActivationExpiration) {
    res.status(401).json(messageInvalide);
    return;
  }

  if (utilisateur.passwordHash) {
    res.status(409).json({ message: 'Ce compte est déjà activé — connectez-vous normalement.' });
    return;
  }

  if (utilisateur.codeActivationExpiration.getTime() < Date.now()) {
    res.status(410).json({
      message: "Ce code d'activation a expiré. Demandez à un administrateur d'en générer un nouveau.",
    });
    return;
  }

  const codeValide = await comparePassword(
    codeActivation.trim().toUpperCase(),
    utilisateur.codeActivationHash,
  );
  if (!codeValide) {
    res.status(401).json(messageInvalide);
    return;
  }

  const passwordHash = await hashPassword(motDePasse);
  const utilisateurActive = await prisma.user.update({
    where: { id: utilisateur.id },
    data: {
      passwordHash,
      codeActivationHash: null,
      codeActivationExpiration: null,
    },
  });

  await prisma.auditLogEntry.create({
    data: {
      utilisateurId: utilisateurActive.id,
      action: 'Activation du compte',
      cible: `${utilisateurActive.prenom} ${utilisateurActive.nom}`,
    },
  });

  const token = signToken({ id: utilisateurActive.id, role: utilisateurActive.role });
  res.status(201).json({ token, utilisateur: sansSecrets(utilisateurActive) });
});