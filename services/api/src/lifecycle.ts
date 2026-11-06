/** Whether the process is serving or draining for shutdown; `/readyz` reports 503 once draining. */
export class Lifecycle {
  #draining = false;

  get draining(): boolean {
    return this.#draining;
  }

  drain(): void {
    this.#draining = true;
  }
}
