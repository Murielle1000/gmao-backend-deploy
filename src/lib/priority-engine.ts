import { CriticiteBatiment, NiveauUrgence, TypeIncident } from '@prisma/client';

// Portage TypeScript exact de `PriorityEngine` (lib/core/utils/priority_engine.dart) :
// mêmes poids, mêmes mots-clés, mêmes seuils, pour que le score calculé
// côté serveur reste identique à celui que l'app Flutter affichait en
// aperçu côté client.

export interface EvaluationUrgence {
  niveau: NiveauUrgence;
  score: number;
  facteursDeclenches: string[];
}

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

// Poids de base (0 à 40 points) : dangerosité / risque de dégradation
// intrinsèque au type d'incident.
const POIDS_BASE_TYPE: Record<TypeIncident, number> = {
  securiteIncendie: 40,
  panneElectrique: 32,
  fuiteEau: 28,
  degradationStructurelle: 25,
  panneAscenseur: 20,
  problemePlomberie: 15,
  panneClimatisation: 10,
  autre: 8,
};

const LABEL_CRITICITE: Record<CriticiteBatiment, string> = {
  standard: 'Standard',
  importante: 'Importante',
  strategique: 'Stratégique',
};

// Pondération de la criticité stratégique du bâtiment (0 à 15 points).
const POIDS_CRITICITE_BATIMENT: Record<CriticiteBatiment, number> = {
  standard: 0,
  importante: 8,
  strategique: 15,
};

// Mots-clés (en minuscules) détectés dans la description libre, avec leur
// poids. Plus un mot-clé traduit un danger immédiat ou une aggravation
// rapide, plus son poids est élevé.
const MOTS_CLES_URGENCE: Record<string, number> = {
  'blessé': 25,
  'blessure': 25,
  'électrocution': 25,
  'incendie': 25,
  'feu': 22,
  'fumée': 18,
  'effondrement': 25,
  'court-circuit': 20,
  'inondation': 18,
  'fuite importante': 18,
  'urgent': 15,
  'urgence': 15,
  'danger': 18,
  'dangereux': 16,
  'grave': 12,
  'sécurité': 12,
  'important': 8,
  'plusieurs bureaux': 8,
  'tout le bâtiment': 15,
};

// Plafond appliqué à la somme des points issus des mots-clés, afin qu'une
// description très longue ne domine pas artificiellement le score.
const PLAFOND_MOTS_CLES = 30;

const SEUIL_CRITIQUE = 60;
const SEUIL_ELEVEE = 40;
const SEUIL_MOYENNE = 20;

function niveauDepuisScore(score: number): NiveauUrgence {
  if (score >= SEUIL_CRITIQUE) return NiveauUrgence.critique;
  if (score >= SEUIL_ELEVEE) return NiveauUrgence.elevee;
  if (score >= SEUIL_MOYENNE) return NiveauUrgence.moyenne;
  return NiveauUrgence.faible;
}

export function evaluerUrgence(params: {
  type: TypeIncident;
  description: string;
  criticiteBatiment?: CriticiteBatiment;
}): EvaluationUrgence {
  const criticite = params.criticiteBatiment ?? CriticiteBatiment.standard;
  const facteurs: string[] = [];

  const poidsType = POIDS_BASE_TYPE[params.type];
  facteurs.push(`Type "${LABEL_TYPE[params.type]}" : +${poidsType} pts`);

  const descriptionNormalisee = params.description.toLowerCase();
  let pointsMotsCles = 0;
  for (const [motCle, poids] of Object.entries(MOTS_CLES_URGENCE)) {
    if (descriptionNormalisee.includes(motCle)) {
      pointsMotsCles += poids;
      facteurs.push(`Mot-clé "${motCle}" détecté : +${poids} pts`);
    }
  }
  const pointsMotsClesPlafonnes = Math.min(pointsMotsCles, PLAFOND_MOTS_CLES);
  if (pointsMotsCles > PLAFOND_MOTS_CLES) {
    facteurs.push(
      `Score mots-clés plafonné à ${PLAFOND_MOTS_CLES} pts (brut : ${pointsMotsCles})`,
    );
  }

  const poidsBatiment = POIDS_CRITICITE_BATIMENT[criticite];
  if (poidsBatiment > 0) {
    facteurs.push(
      `Bâtiment de criticité "${LABEL_CRITICITE[criticite]}" : +${poidsBatiment} pts`,
    );
  }

  const score = poidsType + pointsMotsClesPlafonnes + poidsBatiment;
  const niveau = niveauDepuisScore(score);

  return { niveau, score, facteursDeclenches: facteurs };
}