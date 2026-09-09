import 'express-async-errors';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';

import { auditRouter } from './modules/audit/audit.routes';
import { authRouter } from './modules/auth/auth.routes';
import { batimentsRouter } from './modules/batiments/batiments.routes';
import { incidentsRouter } from './modules/incidents/incidents.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { usersRouter } from './modules/users/users.routes';

export const app = express();
app.use(cors());
// Limite relevée par rapport au défaut (100kb) : la photo de profil est
// encodée en base64 directement dans le corps JSON de PATCH /users/moi
// (voir users.routes.ts) — pas de service de stockage de fichiers séparé.
app.use(express.json({ limit: '3mb' }));
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/batiments', batimentsRouter);
app.use('/incidents', incidentsRouter);
app.use('/audit', auditRouter);
app.use('/notifications', notificationsRouter);

// Filet de sécurité global : toute erreur non gérée dans une route (bug de
// code, base de données injoignable, ...) atterrit ici au lieu de faire
// planter tout le serveur. `express-async-errors` (importé tout en haut de
// ce fichier) fait en sorte que les erreurs levées dans les handlers async
// soient bien transmises jusqu'à ce middleware.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);

  const nomErreur = err instanceof Error ? err.constructor.name : '';
  if (nomErreur.startsWith('PrismaClientInitializationError')) {
    res.status(503).json({
      message:
        "Base de données momentanément injoignable (elle se réveille peut-être après une période d'inactivité). Réessaie dans quelques secondes.",
    });
    return;
  }

  res.status(500).json({ message: 'Erreur interne du serveur.' });
});