import { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../lib/jwt';

export interface AuthenticatedRequest extends Request {
  utilisateur?: { id: string; role: string };
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentification requise.' });
    return;
  }

  const token = header.slice('Bearer '.length);
  try {
    req.utilisateur = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ message: 'Token invalide ou expiré.' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.utilisateur || !roles.includes(req.utilisateur.role)) {
      res.status(403).json({ message: 'Accès refusé.' });
      return;
    }
    next();
  };
}