import { eveChannel } from 'eve/channels/eve';
import { getLocalDevCapability } from 'eve/local-dev';
import { config, getTerminalSession } from '../lib/auth';

export default eveChannel({
  async auth() {
    if (!getLocalDevCapability()) return null;
    const { response } = await getTerminalSession();
    return {
      principalType: 'user' as const,
      principalId: response.user.id,
      issuer: config().origin,
      authenticator: 'local-better-auth',
      attributes: {},
    };
  },
});
