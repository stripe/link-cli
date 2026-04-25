export function notifyUpdate(
  update: { current: string; latest: string } | undefined,
  cliName: string,
  isJsonMode: boolean,
): void {
  if (!update) return;

  if (isJsonMode) {
    process.stderr.write(
      `${JSON.stringify({
        type: 'update_available',
        current_version: update.current,
        latest_version: update.latest,
        update_command: `npm install -g ${cliName}`,
      })}\n`,
    );
  }
  // interactive mode: update-notifier calls notifier.notify() itself
}
