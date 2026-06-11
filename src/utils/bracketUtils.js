export function pow2(n) { let p = 1; while (p < n) p *= 2; return p; }

export function getRoundLabel(matchesInRound) {
  if (matchesInRound === 1) return 'FINAL';
  if (matchesInRound === 2) return 'SEMIFINAL';
  if (matchesInRound === 4) return 'CUARTOS';
  return `RONDA ${matchesInRound}`;
}

export function buildSeeds(groups, matchesByGroup, calcStandings, advancePer, crossingMode) {
  const byRank = Array.from({ length: advancePer }, () => []);
  groups.forEach(group => {
    const standings = calcStandings(group.playerIds ?? [], matchesByGroup[group.id] ?? []);
    standings.slice(0, advancePer).forEach((row, rank) => {
      byRank[rank].push({ playerId: row.id, pts: row.pts, groupName: group.name });
    });
  });
  byRank.forEach(rank => rank.sort((a, b) => b.pts - a.pts));
  if (crossingMode === 'cruzado') {
    const seeds = [];
    byRank.forEach((rank, i) => {
      seeds.push(...(i % 2 === 0 ? rank : [...rank].reverse()));
    });
    return seeds;
  }
  return byRank.flat();
}
