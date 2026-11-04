import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { bcryptRounds } from '../config/env';

export const hashPassword = (password: string) => bcrypt.hash(password, bcryptRounds());
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
/** Refresh secrets are 256 random bits: a fast hash is enough, bcrypt would only cost time. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');
