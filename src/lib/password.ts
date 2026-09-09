import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(motDePasse: string): Promise<string> {
  return bcrypt.hash(motDePasse, SALT_ROUNDS);
}

export function comparePassword(motDePasse: string, hash: string): Promise<boolean> {
  return bcrypt.compare(motDePasse, hash);
}