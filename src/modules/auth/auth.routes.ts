import { Router } from 'express';

import { signToken } from '../../lib/jwt';
import { comparePassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';

export const authRouter = Router();

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

  const motDePasseValide = await comparePassword(motDePasse, utilisateur.passwordHash);
  if (!motDePasseValide) {
    res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    return;
  }

  const token = signToken({ id: utilisateur.id, role: utilisateur.role });
  const { passwordHash: _passwordHash, ...utilisateurSansMotDePasse } = utilisateur;

  res.json({ token, utilisateur: utilisateurSansMotDePasse });
});