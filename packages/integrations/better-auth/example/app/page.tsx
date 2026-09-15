'use client';

import { useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';

export default function Page() {
  const {
    data: session,
    isPending,
    error: sessionError,
  } = authClient.useSession();
  const user = session?.user;
  const userId = user?.id;
  const [linkAccount, setLinkAccount] = useState<{
    id: string;
    accountId: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('error'));
  }, []);

  useEffect(() => {
    let active = true;
    setLinkAccount(null);
    setProfile(null);
    if (userId) {
      authClient
        .listAccounts()
        .then(({ data, error }) => {
          if (!active) return;
          if (error)
            setError(error.message ?? 'Unable to load linked accounts.');
          else
            setLinkAccount(
              data?.find((account) => account.providerId === 'link') ?? null,
            );
        })
        .catch(() => {
          if (active) setError('Unable to load linked accounts.');
        });
    }
    return () => {
      active = false;
    };
  }, [userId]);

  async function perform(
    action: () => Promise<{ error: { message?: string } | null }>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result.error)
        throw new Error(result.error.message ?? 'Something went wrong.');
      setProfile(null);
      setLinkAccount(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadProfile(accountId: string) {
    setBusy(true);
    setError(null);
    try {
      // Better Auth fetches Link userinfo on the server and refreshes the token if needed.
      const result = await authClient.accountInfo({ query: { accountId } });
      if (result.error) throw new Error(result.error.message);
      setProfile(JSON.stringify(result.data?.user, null, 2));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to load your Link profile.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Better Auth + Link</h1>
      <p>Sign in to the app, then connect your Link wallet when you need it.</p>
      {(error || sessionError) && (
        <p role="alert">{error ?? sessionError?.message}</p>
      )}
      {isPending ? (
        <p>Loading…</p>
      ) : !user ? (
        <section>
          <h2>{creating ? 'Create an account' : 'Sign in'}</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const credentials = {
                email: String(data.get('email')),
                password: String(data.get('password')),
              };
              void perform(() =>
                creating
                  ? authClient.signUp.email({
                      ...credentials,
                      name: String(data.get('name')),
                    })
                  : authClient.signIn.email(credentials),
              );
            }}
          >
            {creating && (
              <label>
                Name
                <input name="name" autoComplete="name" required />
              </label>
            )}
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={8}
                autoComplete={creating ? 'new-password' : 'current-password'}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {creating ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCreating(!creating);
              setError(null);
            }}
          >
            {creating
              ? 'Already have an account? Sign in'
              : 'New here? Create an account'}
          </button>
        </section>
      ) : (
        <>
          <section>
            <h2>Signed in as {user.name}</h2>
            <p>{user.email}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void perform(() => authClient.signOut())}
            >
              Sign out
            </button>
          </section>
          <section>
            <h2>Your Link wallet</h2>
            {linkAccount ? (
              <>
                <p>Connected as {linkAccount.accountId}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadProfile(linkAccount.id)}
                >
                  Load Link profile
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      authClient.unlinkAccount({ accountId: linkAccount.id }),
                    )
                  }
                >
                  Disconnect Link
                </button>
                {profile && <pre>{profile}</pre>}
              </>
            ) : (
              <>
                <p>Connect Link to give this app access to your wallet.</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      authClient.linkSocial({
                        provider: 'link',
                        callbackURL: '/',
                        errorCallbackURL: '/',
                      }),
                    )
                  }
                >
                  Connect Link
                </button>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
