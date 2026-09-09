import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const emailAdmin = 'admin@rpi-pad.cm';
  const motDePasse = 'admin123';

  const existant = await prisma.user.findUnique({ where: { email: emailAdmin } });
  if (existant) {
    console.log('Un compte administrateur existe déjà :', emailAdmin);
    return;
  }

  const passwordHash = await bcrypt.hash(motDePasse, 10);

  await prisma.user.create({
    data: {
      nom: 'Admin',
      prenom: 'RPI-PAD',
      email: emailAdmin,
      telephone: '+237600000000',
      passwordHash,
      role: Role.administrateur,
    },
  });

  console.log('Compte administrateur créé :');
  console.log('  email :', emailAdmin);
  console.log('  mot de passe :', motDePasse);
  console.log('⚠️  Change ce mot de passe après la première connexion.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });