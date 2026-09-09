import { Response, Router } from 'express';

import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest, authenticate, requireRole } from '../../middleware/auth';

export const auditRouter = Router();

auditRouter.use(authenticate, requireRole('administrateur'));

auditRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const limiteParam = req.query.limite;
  let limite: number | undefined;
  if (typeof limiteParam === 'string') {
    const parsed = Number(limiteParam);
    if (!Number.isNaN(parsed) && parsed > 0) limite = parsed;
  }

  const journal = await prisma.auditLogEntry.findMany({
    orderBy: { date: 'desc' },
    ...(limite ? { take: limite } : {}),
  });

  res.json(journal);
});