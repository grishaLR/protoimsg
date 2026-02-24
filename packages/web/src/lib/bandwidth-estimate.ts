/** Module-level singleton for sharing bandwidth estimates between HLS instances. */

let estimate: number | undefined;

export function getBandwidthEstimate(): number | undefined {
  return estimate;
}

export function setBandwidthEstimate(bps: number): void {
  estimate = bps;
}
