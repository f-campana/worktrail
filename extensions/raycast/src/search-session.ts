export type SearchRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  cancel: () => void;
};

/** Owns one interactive search at a time and invalidates every older request. */
export class SearchRequestCoordinator {
  private generation = 0;
  private controller?: AbortController;

  begin(): SearchRequest {
    this.controller?.abort();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () =>
        generation === this.generation && !controller.signal.aborted,
      cancel: () => {
        controller.abort();
        if (generation === this.generation) this.generation += 1;
      },
    };
  }
}
