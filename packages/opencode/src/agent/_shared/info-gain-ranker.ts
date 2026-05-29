export interface Candidate {
  text: string
  resolves: string
  branches: string[]
}

export interface Ranked extends Candidate {
  expected_gain: number
}

export function rank(candidates: Candidate[]): Ranked[] {
  return candidates
    .map((c) => ({ ...c, expected_gain: 1 / (c.branches.length || 1) }))
    .sort((a, b) => b.expected_gain - a.expected_gain)
}

export * as InfoGainRanker from "./info-gain-ranker"
