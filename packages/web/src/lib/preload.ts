/** Kick off dynamic imports for chunks needed after auth.
 *  Called from ConnectingScreen so they load while the user watches the progress bar. */
export function preloadApp(): void {
  void import('../AuthenticatedApp');
}
