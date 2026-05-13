import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../');
const envPath = path.join(projectRoot, '.env');

import dotenv from 'dotenv';
dotenv.config({ path: envPath });

console.log('[setup] GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'SET' : 'NOT SET');
console.log('[setup] MICROSOFT_CLIENT_ID:', process.env.MICROSOFT_CLIENT_ID ? 'SET' : 'NOT SET');
