'use client';

import { useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';

type LinkedAccount = NonNullable<
  Awaited<ReturnType<typeof authClient.listAccounts>>['data']
>[number];

export default function Page() {
  const {
    data: session,
    isPending,
    error: sessionError,
  } = authClient.useSession();
  const user = session?.user;
  const userId = user?.id;
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const linkAccount = accounts.find((account) => account.providerId === 'link');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('error'));
  }, []);

  useEffect(() => {
    let active = true;
    setAccounts([]);
    setProfile(null);
    if (userId) {
      authClient
        .listAccounts()
        .then(({ data, error }) => {
          if (!active) return;
          if (error)
            setError(error.message ?? 'Unable to load linked accounts.');
          else setAccounts(data ?? []);
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
      setAccounts([]);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadProfile(accountRecordId: string) {
    setBusy(true);
    setError(null);
    try {
      // Better Auth fetches Link userinfo on the server and refreshes the token if needed.
      const result = await authClient.accountInfo({
        query: { accountId: accountRecordId },
      });
      if (result.error) throw new Error(result.error.message);
      // Show the provider response, including fields omitted from the mapped user.
      setProfile(JSON.stringify(result.data?.data, null, 2));
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
      <p>Sign in with Link or with email and password.</p>
      {(error || sessionError) && (
        <p role="alert">{error ?? sessionError?.message}</p>
      )}
      {isPending ? (
        <p>Loading…</p>
      ) : !user ? (
        <section>
          <h2>{creating ? 'Create an account' : 'Sign in'}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(() =>
                authClient.signIn.social({
                  provider: 'link',
                  callbackURL: '/',
                  errorCallbackURL: '/',
                }),
              )
            }
          >
            Continue with Link
          </button>
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
                <p>
                  Link user ID: <code>{linkAccount.accountId}</code>
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadProfile(linkAccount.id)}
                >
                  Load Link profile
                </button>
                <button
                  type="button"
                  disabled={busy || accounts.length === 1}
                  onClick={() =>
                    void perform(() =>
                      authClient.link.disconnect({ accountId: linkAccount.id }),
                    )
                  }
                >
                  Disconnect Link
                </button>
                {accounts.length === 1 && (
                  <p>Add another sign-in method before disconnecting Link.</p>
                )}
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
                      authClient.link.connect({
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
