import nodemailer, { Transporter } from 'nodemailer';

// Envoi de l'email d'activation de compte (code + instructions), via le
// SMTP de Gmail (compte existant de la RPI-PAD/Murielle, pas de nouveau
// service tiers à créer) — nécessite un "mot de passe d'application"
// Google (Compte Google > Sécurité > Validation en deux étapes > Mots de
// passe des applications), PAS le mot de passe du compte Gmail lui-même.
//
// Volontairement best-effort : un échec d'envoi (config absente, Gmail
// indisponible, ...) ne doit JAMAIS empêcher la création du compte côté
// admin — le code d'activation reste de toute façon affiché à l'écran
// pour une transmission manuelle. Voir l'appel dans users.routes.ts.

let transporteur: Transporter | null = null;

function obtenirTransporteur(): Transporter | null {
  const utilisateur = process.env.GMAIL_USER;
  const motDePasseApplication = process.env.GMAIL_APP_PASSWORD;
  if (!utilisateur || !motDePasseApplication) {
    return null;
  }
  if (!transporteur) {
    transporteur = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: utilisateur, pass: motDePasseApplication },
    });
  }
  return transporteur;
}

export interface EnvoiActivation {
  destinataire: string;
  prenom: string;
  codeActivation: string;
}

/// Renvoie `true` si l'email a bien été envoyé, `false` sinon (config
/// absente ou échec d'envoi — jamais d'exception propagée à l'appelant).
export async function envoyerEmailActivation({
  destinataire,
  prenom,
  codeActivation,
}: EnvoiActivation): Promise<boolean> {
  const transport = obtenirTransporteur();
  if (!transport) {
    return false;
  }

  try {
    await transport.sendMail({
      from: `"RPI-GMAO" <${process.env.GMAIL_USER}>`,
      to: destinataire,
      subject: 'Activez votre compte RPI-GMAO',
      text:
        `Bonjour ${prenom},\n\n` +
        `Un compte RPI-GMAO a été créé pour vous par un administrateur.\n\n` +
        `Pour l'activer :\n` +
        `1. Ouvrez l'application RPI-GMAO\n` +
        `2. Sur l'écran de connexion, appuyez sur "Première connexion ? Activer mon compte"\n` +
        `3. Renseignez votre email et le code d'activation ci-dessous\n` +
        `4. Choisissez votre propre mot de passe\n\n` +
        `Code d'activation : ${codeActivation}\n\n` +
        `Ce code est valable 7 jours. Si vous ne l'avez pas demandé, ignorez cet email.`,
      html:
        `<p>Bonjour ${prenom},</p>` +
        `<p>Un compte <strong>RPI-GMAO</strong> a été créé pour vous par un administrateur.</p>` +
        `<p>Pour l'activer :</p>` +
        `<ol>` +
        `<li>Ouvrez l'application RPI-GMAO</li>` +
        `<li>Sur l'écran de connexion, appuyez sur « Première connexion ? Activer mon compte »</li>` +
        `<li>Renseignez votre email et le code d'activation ci-dessous</li>` +
        `<li>Choisissez votre propre mot de passe</li>` +
        `</ol>` +
        `<p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${codeActivation}</p>` +
        `<p style="color:#666;font-size:13px;">Ce code est valable 7 jours. Si vous ne l'avez pas demandé, ignorez cet email.</p>`,
    });
    return true;
  } catch (erreur) {
    console.error("Échec de l'envoi de l'email d'activation :", erreur);
    return false;
  }
}
