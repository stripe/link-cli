import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { linkAgent } from './agents/link';

export const mastra = new Mastra({
  agents: { linkAgent },
  storage: new LibSQLStore({ id: 'link-example', url: 'file:./link.db' }),
  server: { host: 'localhost', port: 4111 },
});
