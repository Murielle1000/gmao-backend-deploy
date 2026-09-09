import { TypeIncident } from '@prisma/client';

// Suggestion IA du type d'incident à partir de la description libre saisie
// par le locataire (besoin : aujourd'hui le champ "type" est un menu
// déroulant purement manuel — voir POST /incidents/suggerer-type). Le
// niveau d'urgence, lui, reste calculé par le moteur déterministe existant
// (`priority-engine.ts`) une fois le type connu : pas besoin d'IA pour ça.
//
// Utilise l'API Gemini (Google AI Studio, palier gratuit sans carte
// bancaire — voir aistudio.google.com) en sortie structurée contrainte par
// un schéma JSON (`responseSchema`) plutôt que du texte libre à parser : le
// type renvoyé est garanti appartenir à l'énumération Prisma, ce qui évite
// toute valeur inventée par le modèle. Appel fait en HTTP brut (fetch natif
// de Node) plutôt qu'avec un SDK, pour ne pas ajouter de dépendance.

const TYPES_VALIDES = Object.values(TypeIncident);

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

// Modèle rapide, gratuit sur le palier gratuit de Google AI Studio :
// suffisant pour une classification à 8 catégories.
const MODELE = 'gemini-2.0-flash';
const URL_GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODELE}:generateContent`;

export interface SuggestionType {
  type: TypeIncident;
  justification: string;
}

/// Lève une erreur si la classification échoue (clé absente, description
/// trop courte, panne réseau, réponse inexploitable...) — c'est à
/// l'appelant (la route) de décider comment réagir ; on ne renvoie jamais
/// une valeur par défaut silencieuse qui pourrait passer pour un vrai avis
/// de l'IA.
export async function suggererTypeIncident(description: string): Promise<SuggestionType> {
  const texte = description.trim();
  if (texte.length < 10) {
    throw new Error('Description trop courte pour être analysée.');
  }

  const cle = process.env.GEMINI_API_KEY;
  if (!cle) {
    throw new Error(
      "GEMINI_API_KEY absente de la configuration : la suggestion IA n'est pas disponible.",
    );
  }

  const listeCategories = TYPES_VALIDES.map((t) => `- ${t} : ${LABEL_TYPE[t]}`).join('\n');

  const reponse = await fetch(`${URL_GEMINI}?key=${cle}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "Tu aides à trier des signalements d'incidents de maintenance dans un immeuble, à partir " +
              "de la description écrite par un locataire (souvent informelle, parfois imprécise). Choisis " +
              'toujours la catégorie la plus adaptée dans la liste fournie, même en cas de doute — utilise ' +
              '"autre" seulement si vraiment aucune catégorie ne correspond.',
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Catégories disponibles :\n${listeCategories}\n\nDescription du locataire :\n"""${texte}"""`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            type: {
              type: 'STRING',
              enum: TYPES_VALIDES,
              description: 'Catégorie la plus adaptée parmi celles proposées.',
            },
            justification: {
              type: 'STRING',
              description: 'Courte explication en français (une phrase) de pourquoi cette catégorie a été choisie.',
            },
          },
          required: ['type', 'justification'],
        },
      },
    }),
  });

  if (!reponse.ok) {
    const corpsErreur = await reponse.text();
    throw new Error(`Appel Gemini échoué (HTTP ${reponse.status}) : ${corpsErreur}`);
  }

  const donnees = (await reponse.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const texteJson = donnees.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof texteJson !== 'string') {
    throw new Error("L'IA n'a renvoyé aucune classification exploitable.");
  }

  let entree: { type?: string; justification?: string };
  try {
    entree = JSON.parse(texteJson);
  } catch {
    throw new Error("Réponse de l'IA illisible (JSON invalide).");
  }

  if (!entree.type || !TYPES_VALIDES.includes(entree.type as TypeIncident)) {
    throw new Error('Type suggéré par l’IA invalide.');
  }

  return {
    type: entree.type as TypeIncident,
    justification: typeof entree.justification === 'string' ? entree.justification.trim() : '',
  };
}
