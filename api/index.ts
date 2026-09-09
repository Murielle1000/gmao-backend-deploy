// Point d'entrée pour l'hébergement serverless sur Vercel : Vercel invoque
// une fonction par requête au lieu d'un process qui écoute en continu
// (contrairement à src/server.ts, utilisé pour `npm run dev` / `npm start`
// en local ou sur un hébergeur classique comme Render). Express étant déjà
// compatible avec la signature (req, res), il suffit d'exporter `app`
// directement — aucune duplication de logique.
import { app } from '../src/app';

export default app;
