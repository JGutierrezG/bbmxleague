import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import {
  doc, collection, onSnapshot, writeBatch, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { pow2, getRoundLabel, buildSeeds } from '../utils/bracketUtils';

// ─── Standings ────────────────────────────────────────────────────────────────
function calcStandings(playerIds, matches) {
  const stats = {};
  playerIds.forEach(id => { stats[id] = { j: 0, g: 0, p: 0, pf: 0, pts: 0 }; });
  matches.forEach(m => {
    if (m.status !== 'done') return;
    if (!stats[m.player1Id] || !stats[m.player2Id]) return;
    stats[m.player1Id].j++;
    stats[m.player2Id].j++;
    const rw1 = m.roundsWon1 ?? (m.score1 > m.score2 ? 1 : 0);
    const rw2 = m.roundsWon2 ?? (m.score2 > m.score1 ? 1 : 0);
    if (rw1 > rw2) {
      stats[m.player1Id].g++;
      stats[m.player1Id].pts += 2;
      stats[m.player2Id].p++;
    } else {
      stats[m.player2Id].g++;
      stats[m.player2Id].pts += 2;
      stats[m.player1Id].p++;
    }
    (m.rounds ?? []).forEach(r => {
      stats[m.player1Id].pf += r.score1 ?? 0;
      stats[m.player2Id].pf += r.score2 ?? 0;
    });
  });
  return playerIds
    .map(id => ({ id, ...stats[id] }))
    .sort((a, b) => b.pts - a.pts || b.g - a.g || b.pf - a.pf);
}

// ─── Bracket display constants ────────────────────────────────────────────────
const CARD_H    = 82;
const CARD_W    = 196;
const BASE_SLOT = 100;
const CON_W     = 28;
const ROUND_W   = CARD_W + CON_W;

function slotH(round) { return BASE_SLOT * Math.pow(2, round); }

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function TournamentScreen({ navigation, route }) {
  const { tournamentId } = route.params;

  const [tournament, setTournament]           = useState(null);
  const [participantsMap, setParticipantsMap] = useState({});
  const [groups, setGroups]                   = useState([]);
  const [matchesByGroup, setMatchesByGroup]   = useState({});
  const [bracketMatches, setBracketMatches]   = useState([]);
  const [generatingBracket, setGenerating]    = useState(false);
  const [activeTab, setActiveTab]             = useState('groups');
  const [activeGroupIdx, setActiveGroupIdx]   = useState(0);
  const [loading, setLoading]                 = useState(true);

  const matchUnsubsRef = useRef({});

  useEffect(() => {
    const unsubT = onSnapshot(doc(db, 'tournaments', tournamentId), snap => {
      setTournament({ id: snap.id, ...snap.data() });
      setLoading(false);
    });
    const unsubP = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'participants'),
      snap => {
        const map = {};
        snap.docs.forEach(d => { map[d.id] = d.data(); });
        setParticipantsMap(map);
      },
    );
    const unsubG = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'groups'),
      snap => {
        const newGroups = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setGroups(newGroups);
        const currentIds = new Set(newGroups.map(g => g.id));
        Object.keys(matchUnsubsRef.current).forEach(gid => {
          if (!currentIds.has(gid)) { matchUnsubsRef.current[gid](); delete matchUnsubsRef.current[gid]; }
        });
        newGroups.forEach(group => {
          if (matchUnsubsRef.current[group.id]) return;
          matchUnsubsRef.current[group.id] = onSnapshot(
            collection(db, 'tournaments', tournamentId, 'groups', group.id, 'matches'),
            mSnap => {
              setMatchesByGroup(prev => ({
                ...prev,
                [group.id]: mSnap.docs.map(d => ({ id: d.id, ...d.data() })),
              }));
            },
          );
        });
      },
    );
    const unsubB = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'bracket'),
      snap => setBracketMatches(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    );
    return () => {
      unsubT(); unsubP(); unsubG(); unsubB();
      Object.values(matchUnsubsRef.current).forEach(u => u());
    };
  }, [tournamentId]);

  const playerName   = id => participantsMap[id]?.name ?? '—';
  const isOrganizer  = tournament?.createdBy === auth.currentUser?.uid;
  const isReferee    = tournament?.refereeUids?.includes(auth.currentUser?.uid) ?? false;
  const canManage    = isOrganizer || isReferee;
  const allGroupsDone = groups.length > 0 && groups.every(g => {
    const ms = matchesByGroup[g.id] ?? [];
    return ms.length > 0 && ms.every(m => m.status === 'done');
  });

  // ── General standings ──────────────────────────────────────────────────────
  const generalStandings = (() => {
    const allStats = {};
    groups.forEach(group => {
      calcStandings(group.playerIds ?? [], matchesByGroup[group.id] ?? []).forEach(row => {
        if (!allStats[row.id]) allStats[row.id] = { j: 0, g: 0, p: 0, pf: 0, pts: 0 };
        allStats[row.id].j   += row.j;
        allStats[row.id].g   += row.g;
        allStats[row.id].p   += row.p;
        allStats[row.id].pf  += row.pf;
        allStats[row.id].pts += row.pts;
      });
    });
    return Object.entries(allStats)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.pts - a.pts || b.g - a.g || b.pf - a.pf);
  })();

  // ── Generate bracket ────────────────────────────────────────────────────────
  async function generateBracket() {
    if (generatingBracket) return;
    setGenerating(true);
    try {
      const advancePer   = tournament.advancePer ?? 2;
      const crossingMode = tournament.crossingMode ?? 'cruzado';
      const seeds        = buildSeeds(groups, matchesByGroup, calcStandings, advancePer, crossingMode);

      if (seeds.length < 2) return;

      const bracketSize  = pow2(seeds.length);
      const totalRounds  = Math.log2(bracketSize);

      // Pad with byes
      const padded = [...seeds];
      while (padded.length < bracketSize) padded.push(null);

      // Pre-generate all refs
      const refs = [];
      for (let r = 0; r < totalRounds; r++) {
        const count = bracketSize / Math.pow(2, r + 1);
        refs[r] = Array.from({ length: count }, () =>
          doc(collection(db, 'tournaments', tournamentId, 'bracket')),
        );
      }

      // Pre-compute player slots (propagate byes)
      const slots = refs.map(round => round.map(() => ({ p1: null, p2: null })));
      for (let pos = 0; pos < bracketSize / 2; pos++) {
        slots[0][pos].p1 = padded[pos * 2]?.playerId ?? null;
        slots[0][pos].p2 = padded[pos * 2 + 1]?.playerId ?? null;
      }
      for (let r = 0; r < totalRounds - 1; r++) {
        slots[r].forEach(({ p1, p2 }, pos) => {
          const winner = (p1 && !p2) ? p1 : (!p1 && p2) ? p2 : null;
          if (winner) {
            const nPos  = Math.floor(pos / 2);
            const nSlot = pos % 2 === 0 ? 'p1' : 'p2';
            slots[r + 1][nPos][nSlot] = winner;
          }
        });
      }

      // Build batch
      const batch = writeBatch(db);
      for (let r = 0; r < totalRounds; r++) {
        refs[r].forEach((ref, pos) => {
          const { p1, p2 } = slots[r][pos];
          const nextRef   = r < totalRounds - 1 ? refs[r + 1][Math.floor(pos / 2)] : null;
          const isBye     = r === 0 && ((p1 && !p2) || (!p1 && p2));
          const status    = isBye ? 'bye' : (p1 && p2) ? 'pending' : 'tbd';
          batch.set(ref, {
            round: r, position: pos,
            player1Id: p1, player2Id: p2,
            score1: 0, score2: 0,
            roundsWon1: 0, roundsWon2: 0,
            faults1: 0, faults2: 0,
            currentRound: 1, rounds: [], log: [],
            status,
            nextMatchId:   nextRef?.id ?? null,
            nextMatchSlot: (pos % 2) + 1,
            createdAt: serverTimestamp(),
          });
        });
      }
      batch.update(doc(db, 'tournaments', tournamentId), { status: 'bracket' });
      await batch.commit();
      setActiveTab('bracket');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color="#e63946" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  // ── TAB: GRUPOS ────────────────────────────────────────────────────────────
  function GroupsTab() {
    const group      = groups[activeGroupIdx];
    const matches    = group ? (matchesByGroup[group.id] ?? []) : [];
    const standings  = group ? calcStandings(group.playerIds ?? [], matches) : [];
    const advancePer = tournament?.advancePer ?? 2;
    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.subTabBar} contentContainerStyle={s.subTabContent}>
          {groups.map((g, i) => (
            <TouchableOpacity key={g.id} style={[s.subTab, activeGroupIdx === i && s.subTabActive]} onPress={() => setActiveGroupIdx(i)}>
              <Text style={[s.subTabText, activeGroupIdx === i && s.subTabTextActive]}>Grupo {g.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <Text style={s.sectionLabel}>POSICIONES</Text>
          <View style={s.table}>
            <View style={[s.tableRow, s.tableHeader]}>
              <Text style={[s.tableCell, s.tableCellPos]}>#</Text>
              <Text style={[s.tableCell, { flex: 1 }]}>Jugador</Text>
              <Text style={[s.tableCell, s.tableCellStat]}>G</Text>
              <Text style={[s.tableCell, s.tableCellStat]}>P</Text>
              <Text style={[s.tableCell, s.tableCellStatWide]}>PF</Text>
              <Text style={[s.tableCell, s.tableCellStat]}>Pts</Text>
            </View>
            {standings.map((row, i) => (
              <View key={row.id} style={[s.tableRow, i < advancePer && s.tableRowAdvance, i === advancePer - 1 && s.tableRowCutoff]}>
                <Text style={[s.tableCell, s.tableCellPos, i < advancePer && s.textAdvance]}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.playerNameCell, i < advancePer && s.textAdvance]} numberOfLines={1}>{playerName(row.id)}</Text>
                  {!!participantsMap[row.id]?.beyName && <Text style={s.beyNameCell}>{participantsMap[row.id].beyName}</Text>}
                </View>
                <Text style={[s.tableCell, s.tableCellStat]}>{row.g}</Text>
                <Text style={[s.tableCell, s.tableCellStat]}>{row.p}</Text>
                <Text style={[s.tableCell, s.tableCellStatWide]}>{row.pf}</Text>
                <Text style={[s.tableCell, s.tableCellStat, s.textPts]}>{row.pts}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>PARTIDAS</Text>
          {matches.map(m => {
            const done  = m.status === 'done';
            const p1Won = done && (m.roundsWon1 ?? 0) > (m.roundsWon2 ?? 0);
            const p2Won = done && (m.roundsWon2 ?? 0) > (m.roundsWon1 ?? 0);
            return (
              <TouchableOpacity key={m.id} style={s.matchCard} onPress={() => navigation.navigate('MatchScorer', { tournamentId, groupId: group.id, matchId: m.id, matchPoints: tournament?.matchPoints ?? 5 })}>
                <View style={s.matchRow}>
                  <Text style={[s.matchPlayer, p1Won && s.matchWinner, p2Won && s.matchLoser]} numberOfLines={1}>{playerName(m.player1Id)}</Text>
                  <View style={s.matchScore}>
                    {done ? <Text style={s.matchScoreText}>{m.roundsWon1 ?? 0} — {m.roundsWon2 ?? 0}</Text>
                           : <Text style={s.matchPending}>VS</Text>}
                  </View>
                  <Text style={[s.matchPlayer, s.matchPlayerRight, p2Won && s.matchWinner, p1Won && s.matchLoser]} numberOfLines={1}>{playerName(m.player2Id)}</Text>
                </View>
                <View style={s.matchMeta}>
                  <View style={[s.matchBadge, done ? s.badgeDone : s.badgePending]}>
                    <Text style={[s.matchBadgeText, done ? s.badgeDoneText : s.badgePendingText]}>{done ? 'FINALIZADO' : 'PENDIENTE'}</Text>
                  </View>
                  {!done && <Text style={s.tapHint}>Toca para jugar →</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </>
    );
  }

  // ── TAB: GENERAL ──────────────────────────────────────────────────────────
  function GeneralTab() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={s.sectionLabel}>TABLA GENERAL</Text>
        <View style={s.table}>
          <View style={[s.tableRow, s.tableHeader]}>
            <Text style={[s.tableCell, s.tableCellPos]}>#</Text>
            <Text style={[s.tableCell, { flex: 1 }]}>Jugador</Text>
            <Text style={[s.tableCell, s.tableCellStat]}>G</Text>
            <Text style={[s.tableCell, s.tableCellStat]}>P</Text>
            <Text style={[s.tableCell, s.tableCellStatWide]}>PF</Text>
            <Text style={[s.tableCell, s.tableCellStat]}>Pts</Text>
          </View>
          {generalStandings.map((row, i) => (
            <View key={row.id} style={s.tableRow}>
              <Text style={[s.tableCell, s.tableCellPos, i < 3 && s.textGold]}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.playerNameCell, i < 3 && s.textGold]} numberOfLines={1}>{playerName(row.id)}</Text>
                {!!participantsMap[row.id]?.beyName && <Text style={s.beyNameCell}>{participantsMap[row.id].beyName}</Text>}
              </View>
              <Text style={[s.tableCell, s.tableCellStat]}>{row.g}</Text>
              <Text style={[s.tableCell, s.tableCellStat]}>{row.p}</Text>
              <Text style={[s.tableCell, s.tableCellStatWide]}>{row.pf}</Text>
              <Text style={[s.tableCell, s.tableCellStat, s.textPts]}>{row.pts}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  // ── TAB: BRACKET ──────────────────────────────────────────────────────────
  function BracketTab() {
    const advancePer = tournament?.advancePer ?? 2;

    // Compute projected seeds from current standings (always available)
    const projectedSeeds = buildSeeds(
      groups, matchesByGroup, calcStandings,
      advancePer, tournament?.crossingMode ?? 'cruzado',
    );

    // ── PRE-BRACKET VIEW ────────────────────────────────────────────────
    if (tournament?.status !== 'bracket') {
      return (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

          {/* Classified per group */}
          <Text style={s.sectionLabel}>CLASIFICADOS POR GRUPO</Text>
          <View style={s.groupGridRow}>
            {groups.map(group => {
              const gMatches  = matchesByGroup[group.id] ?? [];
              const standings = calcStandings(group.playerIds ?? [], gMatches);
              const groupDone = gMatches.length > 0 && gMatches.every(m => m.status === 'done');
              return (
                <View key={group.id} style={[s.groupClassCard, groupDone && s.groupClassCardDone]}>
                  <View style={s.groupClassHeader}>
                    <Text style={s.groupClassTitle}>Grupo {group.name}</Text>
                    {groupDone && <View style={s.groupDoneBadge}><Text style={s.groupDoneBadgeText}>✓</Text></View>}
                  </View>
                  {standings.map((row, i) => (
                    <View key={row.id} style={[s.groupClassRow, i < advancePer && s.groupClassRowAdvance]}>
                      <Text style={[s.groupClassPos, i < advancePer && s.textAdvance]}>{i + 1}°</Text>
                      <Text style={[s.groupClassPlayer, i < advancePer && s.textAdvance]} numberOfLines={1}>
                        {playerName(row.id)}
                      </Text>
                      <Text style={s.groupClassPts}>{row.pts}pts</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>

          {/* Projected bracket preview */}
          {projectedSeeds.length >= 2 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>BRACKET PROYECTADO</Text>
              <Text style={s.bracketPreviewSub}>
                {allGroupsDone ? 'Posiciones finales · listo para generar' : 'Basado en posiciones actuales · puede cambiar'}
              </Text>
              <View style={s.seedList}>
                {projectedSeeds.map((seed, i) => (
                  <View key={seed.playerId} style={[s.seedRow, i % 2 === 1 && s.seedRowAlt]}>
                    <View style={[s.seedBadge, i < 2 && s.seedBadgeTop]}>
                      <Text style={[s.seedNum, i < 2 && s.seedNumTop]}>{i + 1}</Text>
                    </View>
                    <Text style={s.seedName} numberOfLines={1}>{playerName(seed.playerId)}</Text>
                    <Text style={s.seedGroup}>Grupo {seed.groupName}</Text>
                    {i % 2 === 0 && i + 1 < projectedSeeds.length && (
                      <Text style={s.seedVs}>vs {i + 2}</Text>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Generate button */}
          {allGroupsDone && canManage && (
            <TouchableOpacity style={s.generateBtn} onPress={generateBracket} disabled={generatingBracket}>
              {generatingBracket
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.generateBtnText}>Generar Bracket Oficial</Text>}
            </TouchableOpacity>
          )}
          {!allGroupsDone && (
            <View style={s.pendingNotice}>
              <Text style={s.pendingNoticeText}>
                Faltan partidos de grupos por completar
              </Text>
            </View>
          )}
        </ScrollView>
      );
    }

    // ── OFFICIAL BRACKET VIEW ────────────────────────────────────────────
    const totalRounds = Math.max(...bracketMatches.map(m => m.round), 0) + 1;
    const rounds      = Array.from({ length: totalRounds }, (_, r) =>
      bracketMatches.filter(m => m.round === r).sort((a, b) => a.position - b.position),
    );
    const finalMatch = rounds[totalRounds - 1]?.[0];
    const championId = finalMatch?.status === 'done'
      ? ((finalMatch.roundsWon1 ?? 0) > (finalMatch.roundsWon2 ?? 0) ? finalMatch.player1Id : finalMatch.player2Id)
      : null;

    // Assign seed numbers from first-round position
    const seedMap = {};
    rounds[0]?.forEach((m, i) => {
      if (m.player1Id) seedMap[m.player1Id] = i * 2 + 1;
      if (m.player2Id) seedMap[m.player2Id] = i * 2 + 2;
    });

    function BracketCard({ match, round }) {
      const done    = match.status === 'done';
      const tbd     = match.status === 'tbd' || match.status === 'bye';
      const canPlay = match.status === 'pending' && !!(match.player1Id && match.player2Id);
      const p1Won   = done && (match.roundsWon1 ?? 0) > (match.roundsWon2 ?? 0);
      const p2Won   = done && (match.roundsWon2 ?? 0) > (match.roundsWon1 ?? 0);
      const slot    = slotH(round);
      const topPad  = (slot - CARD_H) / 2;

      function PlayerSlot({ playerId, won, lost, rw }) {
        const seed = seedMap[playerId];
        return (
          <View style={[s.bSlot, won && s.bSlotWin, lost && s.bSlotLost]}>
            <View style={[s.bSeedBadge, won && s.bSeedBadgeWin]}>
              <Text style={[s.bSeedNum, won && s.bSeedNumWin]}>{seed ?? '?'}</Text>
            </View>
            <Text style={[s.bPlayerName, won && s.bWinner, lost && s.bLoser]} numberOfLines={1}>
              {playerId ? playerName(playerId) : (tbd ? '···' : 'TBD')}
            </Text>
            {done && (
              <View style={[s.bRoundsWon, won && s.bRoundsWonActive]}>
                <Text style={[s.bRoundsText, won && s.bRoundsTextActive]}>{rw}</Text>
              </View>
            )}
          </View>
        );
      }

      return (
        <TouchableOpacity
          activeOpacity={canPlay ? 0.7 : 1}
          style={[
            s.bCard,
            { marginTop: topPad, height: CARD_H, width: CARD_W },
            canPlay  && s.bCardPlayable,
            done     && s.bCardDone,
            tbd      && s.bCardTbd,
          ]}
          disabled={!canPlay}
          onPress={() => navigation.navigate('MatchScorer', {
            tournamentId,
            source: 'bracket',
            bracketMatchId: match.id,
            matchPoints: tournament?.matchPoints ?? 5,
          })}
        >
          <PlayerSlot playerId={match.player1Id} won={p1Won} lost={p2Won} rw={match.roundsWon1 ?? 0} />
          <View style={s.bDivider} />
          <PlayerSlot playerId={match.player2Id} won={p2Won} lost={p1Won} rw={match.roundsWon2 ?? 0} />
          {canPlay && (
            <View style={s.bPlayBadge}>
              <Text style={s.bPlayBadgeText}>▶ JUGAR</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    }

    function Connector({ round }) {
      const nextRound = rounds[round + 1];
      if (!nextRound) return null;
      const cur = slotH(round);
      return (
        <View style={{ width: CON_W }}>
          {nextRound.map((_, i) => {
            const mid = cur;
            return (
              <View key={i} style={{ height: cur * 2, width: CON_W }}>
                <View style={[s.conLine, { top: cur / 2,       left: 0, width: 1, height: mid - cur / 2 }]} />
                <View style={[s.conLine, { top: mid,           left: 0, width: 1, height: cur / 2 }]} />
                <View style={[s.conLine, { top: mid - 0.5,     left: 0, width: CON_W, height: 1 }]} />
              </View>
            );
          })}
        </View>
      );
    }

    async function finalizeTournament() {
      if (!championId) return;
      await updateDoc(doc(db, 'tournaments', tournamentId), {
        status: 'finished',
        winnerId: championId,
      });
    }

    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 16, paddingBottom: 40 }}>
        {/* Champion banner */}
        {championId && (
          <View style={s.championBanner}>
            <Text style={s.championTrophy}>🏆</Text>
            <Text style={s.championLabel}>CAMPEÓN DEL TORNEO</Text>
            <Text style={s.championName}>{playerName(championId)}</Text>
            {participantsMap[championId]?.beyName && (
              <Text style={s.championBey}>{participantsMap[championId].beyName}</Text>
            )}
            {tournament?.status !== 'finished' && canManage && (
              <TouchableOpacity style={s.finalizeBtn} onPress={finalizeTournament}>
                <Text style={s.finalizeBtnText}>Finalizar torneo</Text>
              </TouchableOpacity>
            )}
            {tournament?.status === 'finished' && (
              <View style={s.finishedBadge}>
                <Text style={s.finishedBadgeText}>TORNEO FINALIZADO</Text>
              </View>
            )}
          </View>
        )}

        {/* Round labels + tree */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          <View>
            {/* Round headers */}
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              {rounds.map((round, r) => (
                <View key={r} style={{ width: ROUND_W, alignItems: 'center' }}>
                  <Text style={s.roundLabel}>{getRoundLabel(round.length)}</Text>
                  <View style={[s.roundLabelBar, round.some(m => m.status === 'ongoing') && s.roundLabelBarActive]} />
                </View>
              ))}
            </View>
            {/* Match tree */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              {rounds.map((round, r) => (
                <React.Fragment key={r}>
                  <View style={{ width: CARD_W }}>
                    {round.map(match => (
                      <BracketCard key={match.id} match={match} round={r} />
                    ))}
                  </View>
                  <Connector round={r} />
                </React.Fragment>
              ))}
            </View>
          </View>
        </ScrollView>
      </ScrollView>
    );
  }

  const tabs = [
    { key: 'groups',  label: 'Grupos' },
    { key: 'general', label: 'General' },
    { key: 'bracket', label: 'Bracket' },
  ];

  return (
    <SafeAreaView style={s.container}>
      <View style={s.topbar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>{tournament?.name}</Text>
        <View style={{ width: 32 }} />
      </View>
      <View style={s.tabBar}>
        {tabs.map(t => (
          <TouchableOpacity key={t.key} style={[s.tab, activeTab === t.key && s.tabActive]} onPress={() => setActiveTab(t.key)}>
            <Text style={[s.tabText, activeTab === t.key && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {groups.length === 0
        ? <View style={s.center}><ActivityIndicator color="#e63946" /></View>
        : activeTab === 'groups'  ? <GroupsTab />
        : activeTab === 'general' ? <GeneralTab />
        : <BracketTab />
      }
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0a0a0f' },
  topbar:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 16, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  back:              { fontSize: 22, color: '#555', width: 32 },
  topTitle:          { flex: 1, fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 2, textAlign: 'center' },
  center:            { flex: 1, alignItems: 'center', justifyContent: 'center' },

  tabBar:            { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#111' },
  tab:               { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:         { borderBottomWidth: 2, borderBottomColor: '#e63946' },
  tabText:           { fontSize: 12, fontWeight: '600', color: '#555', letterSpacing: 1 },
  tabTextActive:     { color: '#fff' },

  subTabBar:         { borderBottomWidth: 0.5, borderBottomColor: '#111', maxHeight: 44 },
  subTabContent:     { paddingHorizontal: 12, gap: 4 },
  subTab:            { paddingHorizontal: 14, paddingVertical: 10 },
  subTabActive:      { borderBottomWidth: 2, borderBottomColor: '#e63946' },
  subTabText:        { fontSize: 12, fontWeight: '600', color: '#555' },
  subTabTextActive:  { color: '#fff' },

  sectionLabel:      { fontSize: 10, letterSpacing: 4, color: '#555', textTransform: 'uppercase', marginBottom: 10 },

  table:             { backgroundColor: '#12121a', borderRadius: 14, overflow: 'hidden', borderWidth: 0.5, borderColor: '#1e1e2e', marginBottom: 4 },
  tableHeader:       { backgroundColor: '#0a0a0f' },
  tableRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  tableRowAdvance:   { backgroundColor: '#0a1a0a' },
  tableRowCutoff:    { borderBottomWidth: 1, borderBottomColor: '#1a3a1a' },
  tableCell:         { fontSize: 12, color: '#888', textAlign: 'center' },
  tableCellPos:      { width: 24, fontWeight: '700' },
  tableCellStat:     { width: 26, textAlign: 'center' },
  tableCellStatWide: { width: 32, textAlign: 'center', color: '#6aaccd' },
  playerNameCell:    { fontSize: 13, fontWeight: '600', color: '#ccc' },
  beyNameCell:       { fontSize: 10, color: '#444', marginTop: 1 },
  textAdvance:       { color: '#4ade80' },
  textGold:          { color: '#fbbf24' },
  textPts:           { color: '#fff', fontWeight: '700' },

  matchCard:         { backgroundColor: '#12121a', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#1e1e2e' },
  matchRow:          { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  matchPlayer:       { flex: 1, fontSize: 13, fontWeight: '600', color: '#ccc' },
  matchPlayerRight:  { textAlign: 'right' },
  matchWinner:       { color: '#4ade80' },
  matchLoser:        { color: '#444' },
  matchScore:        { paddingHorizontal: 12 },
  matchScoreText:    { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  matchPending:      { fontSize: 13, fontWeight: '900', color: '#333', letterSpacing: 2 },
  matchMeta:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchBadge:        { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeDone:         { backgroundColor: '#0f3d1f' },
  badgePending:      { backgroundColor: '#1e1e1e' },
  badgeDoneText:     { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: '#4ade80' },
  badgePendingText:  { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: '#444' },
  tapHint:           { fontSize: 10, color: '#e63946' },

  // Pre-bracket: group classified cards
  groupGridRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  groupClassCard:       { flex: 1, minWidth: 140, backgroundColor: '#12121a', borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#1e1e2e' },
  groupClassCardDone:   { borderColor: '#1a3a1a' },
  groupClassHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  groupClassTitle:      { fontSize: 11, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  groupDoneBadge:       { backgroundColor: '#0f3d1f', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  groupDoneBadgeText:   { fontSize: 10, color: '#4ade80', fontWeight: '700' },
  groupClassRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 6 },
  groupClassRowAdvance: { opacity: 1 },
  groupClassPos:        { fontSize: 10, color: '#555', width: 20, fontWeight: '700' },
  groupClassPlayer:     { flex: 1, fontSize: 12, color: '#555', fontWeight: '500' },
  groupClassPts:        { fontSize: 10, color: '#444' },

  // Pre-bracket: seed list
  bracketPreviewSub:    { fontSize: 11, color: '#444', marginBottom: 10 },
  seedList:             { backgroundColor: '#12121a', borderRadius: 12, overflow: 'hidden', borderWidth: 0.5, borderColor: '#1e1e2e', marginBottom: 20 },
  seedRow:              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  seedRowAlt:           { backgroundColor: '#0d0d14' },
  seedBadge:            { width: 22, height: 22, borderRadius: 11, backgroundColor: '#1e1e2e', alignItems: 'center', justifyContent: 'center' },
  seedBadgeTop:         { backgroundColor: '#3d0a0a' },
  seedNum:              { fontSize: 10, fontWeight: '900', color: '#555' },
  seedNumTop:           { color: '#e63946' },
  seedName:             { flex: 1, fontSize: 13, fontWeight: '600', color: '#ccc' },
  seedGroup:            { fontSize: 10, color: '#444' },
  seedVs:               { fontSize: 9, color: '#333', letterSpacing: 1 },

  generateBtn:          { backgroundColor: '#e63946', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4 },
  generateBtnText:      { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  pendingNotice:        { backgroundColor: '#111', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
  pendingNoticeText:    { fontSize: 12, color: '#444' },

  // Bracket tree
  roundLabel:           { fontSize: 9, letterSpacing: 3, color: '#555', textTransform: 'uppercase' },
  roundLabelBar:        { height: 2, width: 32, backgroundColor: '#1e1e2e', borderRadius: 1, marginTop: 3 },
  roundLabelBarActive:  { backgroundColor: '#e63946' },

  bCard:                { backgroundColor: '#12121a', borderRadius: 12, borderWidth: 0.5, borderColor: '#1e1e2e', overflow: 'hidden' },
  bCardPlayable:        { borderColor: '#e63946', borderWidth: 1 },
  bCardDone:            { borderColor: '#1a2e1a' },
  bCardTbd:             { opacity: 0.5 },
  bSlot:                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: (CARD_H / 2) - 1, gap: 6 },
  bSlotWin:             { backgroundColor: 'rgba(74,222,128,0.07)' },
  bSlotLost:            { opacity: 0.5 },
  bSeedBadge:           { width: 18, height: 18, borderRadius: 9, backgroundColor: '#1e1e2e', alignItems: 'center', justifyContent: 'center' },
  bSeedBadgeWin:        { backgroundColor: 'rgba(74,222,128,0.2)' },
  bSeedNum:             { fontSize: 9, fontWeight: '900', color: '#555' },
  bSeedNumWin:          { color: '#4ade80' },
  bPlayerName:          { flex: 1, fontSize: 11, fontWeight: '600', color: '#888' },
  bWinner:              { color: '#4ade80' },
  bLoser:               { color: '#333' },
  bRoundsWon:           { width: 20, height: 20, borderRadius: 10, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  bRoundsWonActive:     { backgroundColor: 'rgba(74,222,128,0.15)' },
  bRoundsText:          { fontSize: 11, fontWeight: '900', color: '#444' },
  bRoundsTextActive:    { color: '#4ade80' },
  bDivider:             { height: 0.5, backgroundColor: '#111' },
  bPlayBadge:           { position: 'absolute', bottom: 3, right: 8 },
  bPlayBadgeText:       { fontSize: 8, fontWeight: '900', color: '#e63946', letterSpacing: 1 },
  conLine:              { position: 'absolute', backgroundColor: '#2a2a3e' },

  // Champion
  championBanner:       { marginHorizontal: 16, marginBottom: 16, backgroundColor: '#12100a', borderWidth: 1, borderColor: '#fbbf24', borderRadius: 16, padding: 20, alignItems: 'center', gap: 4 },
  championTrophy:       { fontSize: 36, marginBottom: 4 },
  championLabel:        { fontSize: 9, letterSpacing: 4, color: '#92741a', textTransform: 'uppercase' },
  championName:         { fontSize: 26, fontWeight: '900', color: '#fbbf24', letterSpacing: 1 },
  championBey:          { fontSize: 12, color: '#92741a', fontStyle: 'italic' },
  finalizeBtn:          { marginTop: 12, backgroundColor: '#e63946', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  finalizeBtnText:      { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  finishedBadge:        { marginTop: 10, backgroundColor: '#1a1a0f', borderWidth: 1, borderColor: '#92741a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  finishedBadgeText:    { fontSize: 9, letterSpacing: 3, color: '#92741a', fontWeight: '700' },
});
