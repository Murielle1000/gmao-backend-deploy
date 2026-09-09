import { Response, Router } from 'express';

import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest, authenticate } from '../../middleware/auth';

export const notificationsRouter = Router();

// Chaque utilisateur ne voit que ses propres notifications, quel que soit
// son rôle (contrairement à /audit qui reste réservé à l'administrateur).
notificationsRouter.use(authenticate);

function toNotificationJson(notification: {
  id: string;
  utilisateurId: string;
  message: string;
  incidentId: string | null;
  lu: boolean;
  date: Date;
}) {
  return {
    id: notification.id,
    utilisateurId: notification.utilisateurId,
    message: notification.message,
    incidentId: notification.incidentId,
    lu: notification.lu,
    date: notification.date,
  };
}

// GET /notifications — les siennes, les plus récentes en premier.
notificationsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const notifications = await prisma.notification.findMany({
    where: { utilisateurId: req.utilisateur!.id },
    orderBy: { date: 'desc' },
  });

  res.json(notifications.map(toNotificationJson));
});

// PATCH /notifications/lu-tout — marque toutes les notifications de
// l'utilisateur connecté comme lues (route à un seul segment, ne peut pas
// être confondue avec /:id/lu ci-dessous qui en a deux).
notificationsRouter.patch('/lu-tout', async (req: AuthenticatedRequest, res: Response) => {
  await prisma.notification.updateMany({
    where: { utilisateurId: req.utilisateur!.id, lu: false },
    data: { lu: true },
  });

  res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
});

// PATCH /notifications/:id/lu — marque une notification précise comme lue.
notificationsRouter.patch('/:id/lu', async (req: AuthenticatedRequest, res: Response) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification) {
    res.status(404).json({ message: 'Notification introuvable.' });
    return;
  }
  if (notification.utilisateurId !== req.utilisateur!.id) {
    res.status(403).json({ message: 'Accès refusé.' });
    return;
  }

  const misAJour = await prisma.notification.update({
    where: { id: req.params.id },
    data: { lu: true },
  });

  res.json(toNotificationJson(misAJour));
});