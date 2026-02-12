export interface RateLimiterStore {
  check(key: string): Promise<boolean>;
  prune(): Promise<number>;
}
