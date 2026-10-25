export {bucket, rawDatabase, getDatabase} from './storage.mjs';
import {env as runtimeEnv} from './storage.mjs';
export const env = runtimeEnv as Record<string, any>;
