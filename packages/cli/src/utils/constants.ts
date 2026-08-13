/**
 * Delay (in milliseconds) before exiting a component after displaying
 * a success or error message, giving the user time to read it.
 */
export const DISPLAY_DELAY_MS = 1500;

/**
 * Interval and max wait time for polling a spend request stuck in
 * `requires_action` with an `auto_resume` resolution (e.g. 3D Secure).
 */
export const RESUME_POLL_INTERVAL_MS = 2000;
export const RESUME_TIMEOUT_MS = 600_000;
