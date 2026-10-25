import {AsyncLocalStorage} from 'node:async_hooks';
export const workspaceContext = new AsyncLocalStorage();
