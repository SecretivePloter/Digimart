import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export function passwordHash(password: string) {
  const salt=randomBytes(16).toString('hex');
  return salt+':'+scryptSync(password,salt,64).toString('hex');
}
export function passwordMatches(password: string, hash: string) {
  const [salt,encoded]=hash.split(':');
  if (!salt || !encoded || password.length>256) return false;
  const expected=Buffer.from(encoded,'hex'); const actual=scryptSync(password,salt,64);
  return expected.length===actual.length && timingSafeEqual(expected,actual);
}
