import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  ScrollView, ActivityIndicator, Modal, Animated,
} from 'react-native';
import { doc, onSnapshot, updateDoc, collection, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../config/firebase';

const P1_COLOR  = '#3b82f6';
const P2_COLOR  = '#e63946';
const FINISHES  = [
  { key: 'burst',   label: 'Burst Finish',   pts: 2 },
  { key: 'extreme', label: 'Extreme Finish',  pts: 3 },
  { key: 'spin',    label: 'Spin Finish',     pts: 1 },
  { key: 'over',    label: 'Over Finish',     pts: 2 },
];
const MAX_ROUNDS    = 3;
const ROUNDS_TO_WIN = 2;

function Pips({ score, total, color }) {
  return (
    <View style={s.pipsRow}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[s.pip, i < Math.min(score, total) && { backgroundColor: color, borderColor: color }]} />
      ))}
    </View>
  );
}

function RoundDots({ won, color }) {
  return (
    <View style={s.roundDots}>
      {Array.from({ length: ROUNDS_TO_WIN }, (_, i) => (
        <View key={i} style={[s.roundDot, i < won && { backgroundColor: color, borderColor: color }]} />
      ))}
    </View>
  );
}

function FaultDots({ count }) {
  return (
    <View style={s.faultRow}>
      <View style={[s.faultDot, count >= 1 && s.faultDotActive]} />
      <View style={[s.faultDot, count >= 2 && s.faultDotActive]} />
    </View>
  );
}

export default function MatchScorerScreen({ navigation, route }) {
  const { tournamentId, source = 'group', groupId, matchId, bracketMatchId, matchPoints = 5 } = route.params;

  const [match, setMatch]               = useState(null);
  const [p1Name, setP1Name]             = useState('Jugador 1');
  const [p2Name, setP2Name]             = useState('Jugador 2');
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [showCorrect, setShowCorrect]   = useState(false);
  const [showEndRound, setShowEndRound] = useState(false);
  const [floatText1, setFloatText1]     = useState('');
  const [floatText2, setFloatText2]     = useState('');

  const scoreScale1   = useRef(new Animated.Value(1)).current;
  const scoreScale2   = useRef(new Animated.Value(1)).current;
  const flashOpacity1 = useRef(new Animated.Value(0)).current;
  const flashOpacity2 = useRef(new Animated.Value(0)).current;
  const floatY1       = useRef(new Animated.Value(0)).current;
  const floatOp1      = useRef(new Animated.Value(0)).current;
  const floatY2       = useRef(new Animated.Value(0)).current;
  const floatOp2      = useRef(new Animated.Value(0)).current;

  const matchRef = source === 'bracket'
    ? doc(db, 'tournaments', tournamentId, 'bracket', bracketMatchId)
    : doc(db, 'tournaments', tournamentId, 'groups', groupId, 'matches', matchId);

  useEffect(() => {
    let unsub = null;
    getDocs(collection(db, 'tournaments', tournamentId, 'participants')).then(snap => {
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data().name; });
      unsub = onSnapshot(matchRef, mSnap => {
        const m = { id: mSnap.id, ...mSnap.data() };
        setMatch(m);
        setP1Name(map[m.player1Id] || 'Jugador 1');
        setP2Name(map[m.player2Id] || 'Jugador 2');
        setLoading(false);
      });
    });
    return () => { if (unsub) unsub(); };
  }, []);

  function triggerAnim(player, pts) {
    const scaleAnim = player === 1 ? scoreScale1 : scoreScale2;
    const flashAnim = player === 1 ? flashOpacity1 : flashOpacity2;
    const floatY    = player === 1 ? floatY1 : floatY2;
    const floatOp   = player === 1 ? floatOp1 : floatOp2;
    const setText   = player === 1 ? setFloatText1 : setFloatText2;

    setText(`+${pts}`);
    floatY.setValue(0);
    floatOp.setValue(1);

    Animated.parallel([
      Animated.sequence([
        Animated.spring(scaleAnim, { toValue: 1.45, useNativeDriver: true, speed: 80, bounciness: 16 }),
        Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, speed: 12, bounciness: 6  }),
      ]),
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 60,  useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
      Animated.timing(floatY,  { toValue: -60, duration: 700, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(250),
        Animated.timing(floatOp, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]),
    ]).start();
  }

  async function addScore(player, finish) {
    if (saving) return;
    triggerAnim(player, finish.pts);
    const s1 = match.score1 ?? 0, s2 = match.score2 ?? 0;
    const f1 = match.faults1 ?? 0, f2 = match.faults2 ?? 0;
    const newS1 = player === 1 ? s1 + finish.pts : s1;
    const newS2 = player === 2 ? s2 + finish.pts : s2;
    const entry = {
      type: 'score', player, label: finish.label, pts: finish.pts,
      score1After: newS1, score2After: newS2,
      faults1After: f1, faults2After: f2, ts: Date.now(),
    };
    setSaving(true);
    try {
      await updateDoc(matchRef, {
        score1: newS1, score2: newS2,
        log: [...(match.log ?? []), entry], status: 'ongoing',
      });
    } finally { setSaving(false); }
  }

  async function addFault(player) {
    if (saving) return;
    let s1 = match.score1 ?? 0, s2 = match.score2 ?? 0;
    let f1 = match.faults1 ?? 0, f2 = match.faults2 ?? 0;
    let type = 'fault', label = `Falta J${player}`;

    if (player === 1) {
      f1++;
      if (f1 >= 2) { f1 = 0; s2++; type = 'fault_penalty'; label = 'Falta ×2 J1 → +1 J2'; triggerAnim(2, 1); }
    } else {
      f2++;
      if (f2 >= 2) { f2 = 0; s1++; type = 'fault_penalty'; label = 'Falta ×2 J2 → +1 J1'; triggerAnim(1, 1); }
    }

    const entry = {
      type, player, label, pts: type === 'fault_penalty' ? 1 : 0,
      score1After: s1, score2After: s2, faults1After: f1, faults2After: f2, ts: Date.now(),
    };
    setSaving(true);
    try {
      await updateDoc(matchRef, {
        score1: s1, score2: s2, faults1: f1, faults2: f2,
        log: [...(match.log ?? []), entry], status: 'ongoing',
      });
    } finally { setSaving(false); }
  }

  async function handleUndo() {
    if (saving) return;
    const log = match.log ?? [];
    if (log.length === 0) return;
    const newLog = log.slice(0, -1);
    const prev   = newLog.length > 0 ? newLog[newLog.length - 1] : null;
    setSaving(true);
    try {
      await updateDoc(matchRef, {
        score1: prev?.score1After ?? 0, score2: prev?.score2After ?? 0,
        faults1: prev?.faults1After ?? 0, faults2: prev?.faults2After ?? 0,
        log: newLog,
        status: newLog.length === 0 && (match.rounds ?? []).length === 0 ? 'pending' : 'ongoing',
      });
    } finally { setSaving(false); setShowCorrect(false); }
  }

  function onUndoPress() {
    if (roundLocked) setShowCorrect(true);
    else handleUndo();
  }

  async function handleEndRound() {
    if (saving) return;
    const s1 = match.score1 ?? 0, s2 = match.score2 ?? 0;
    const roundWinner = s1 >= s2 ? 1 : 2;
    const prevRounds  = match.rounds ?? [];
    const rw1 = (match.roundsWon1 ?? 0) + (roundWinner === 1 ? 1 : 0);
    const rw2 = (match.roundsWon2 ?? 0) + (roundWinner === 2 ? 1 : 0);
    const matchOver = rw1 >= ROUNDS_TO_WIN || rw2 >= ROUNDS_TO_WIN;
    setSaving(true);
    try {
      await updateDoc(matchRef, {
        rounds: [...prevRounds, { round: match.currentRound ?? 1, score1: s1, score2: s2, winner: roundWinner }],
        roundsWon1: rw1, roundsWon2: rw2,
        currentRound: (match.currentRound ?? 1) + 1,
        score1: 0, score2: 0, faults1: 0, faults2: 0, log: [],
        status: matchOver ? 'done' : 'ongoing',
      });

      // Advance winner in bracket
      if (matchOver && source === 'bracket' && match.nextMatchId) {
        const winnerId  = roundWinner === 1 ? match.player1Id : match.player2Id;
        const nextRef   = doc(db, 'tournaments', tournamentId, 'bracket', match.nextMatchId);
        const slotField = match.nextMatchSlot === 1 ? 'player1Id' : 'player2Id';
        await runTransaction(db, async tx => {
          const nextDoc  = await tx.get(nextRef);
          const nextData = nextDoc.data() ?? {};
          const p1 = slotField === 'player1Id' ? winnerId : (nextData.player1Id ?? null);
          const p2 = slotField === 'player2Id' ? winnerId : (nextData.player2Id ?? null);
          tx.update(nextRef, { [slotField]: winnerId, ...(p1 && p2 ? { status: 'pending' } : {}) });
        });
      }
    } finally { setSaving(false); setShowEndRound(false); }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color={P2_COLOR} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const score1       = match.score1  ?? 0;
  const score2       = match.score2  ?? 0;
  const faults1      = match.faults1 ?? 0;
  const faults2      = match.faults2 ?? 0;
  const roundsWon1   = match.roundsWon1 ?? 0;
  const roundsWon2   = match.roundsWon2 ?? 0;
  const currentRound = match.currentRound ?? 1;
  const rounds       = match.rounds ?? [];
  const log          = match.log ?? [];
  const done         = match.status === 'done';
  const roundLocked  = score1 >= matchPoints || score2 >= matchPoints;
  const canAct       = !done && !roundLocked && !saving;
  const canUndo      = log.length > 0 && !saving && !done;
  const willEndMatch =
    (roundsWon1 + (score1 >= matchPoints ? 1 : 0)) >= ROUNDS_TO_WIN ||
    (roundsWon2 + (score2 >= matchPoints ? 1 : 0)) >= ROUNDS_TO_WIN;

  // ── DONE ─────────────────────────────────────────────────────────────
  if (done) {
    const isP1Winner  = roundsWon1 >= ROUNDS_TO_WIN;
    const winnerName  = isP1Winner ? p1Name : p2Name;
    const winnerColor = isP1Winner ? P1_COLOR : P2_COLOR;
    return (
      <SafeAreaView style={s.container}>
        <View style={s.topbar}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={s.back}>←</Text>
          </TouchableOpacity>
          <Text style={s.topTitle}>RESULTADO</Text>
          <View style={{ width: 32 }} />
        </View>
        <ScrollView contentContainerStyle={s.doneContent}>
          <Text style={s.doneLabel}>GANADOR</Text>
          <Text style={[s.doneWinner, { color: winnerColor }]}>{winnerName}</Text>
          <Text style={[s.doneScore, { color: winnerColor }]}>{roundsWon1} — {roundsWon2}</Text>
          <Text style={s.doneScoreLabel}>rondas</Text>
          <View style={s.historyCard}>
            {rounds.map(r => (
              <View key={r.round} style={s.historyRow}>
                <Text style={s.historyRound}>Ronda {r.round}</Text>
                <Text style={s.historyScore}>{r.score1} — {r.score2}</Text>
                <Text style={[s.historyWinner, { color: r.winner === 1 ? P1_COLOR : P2_COLOR }]}>
                  {r.winner === 1 ? p1Name : p2Name}
                </Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={[s.backBtn, { backgroundColor: winnerColor }]} onPress={() => navigation.goBack()}>
            <Text style={s.backBtnText}>Volver al torneo</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── SCORER ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <View style={s.topbar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.topTitle}>RONDA {currentRound} / {MAX_ROUNDS}</Text>
        <TouchableOpacity
          style={[s.undoTopBtn, !canUndo && s.btnDisabled]}
          disabled={!canUndo}
          onPress={onUndoPress}
        >
          <Text style={s.undoTopText}>↩ Deshacer</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>

        {/* Rounds won */}
        <View style={s.roundsBar}>
          <RoundDots won={roundsWon1} color={P1_COLOR} />
          <Text style={s.roundsBarLabel}>RONDAS GANADAS</Text>
          <RoundDots won={roundsWon2} color={P2_COLOR} />
        </View>

        {/* Scoreboard */}
        <View style={s.scoreboard}>
          {/* P1 */}
          <View style={[s.playerSide, { backgroundColor: 'rgba(59,130,246,0.06)' }]}>
            <Animated.View style={[s.flashOverlay, { opacity: flashOpacity1, backgroundColor: P1_COLOR }]} pointerEvents="none" />
            <Text style={[s.playerName, { color: P1_COLOR }]} numberOfLines={1}>{p1Name}</Text>
            <View style={s.scoreWrap}>
              <Animated.Text style={[s.scoreNum, { color: P1_COLOR, transform: [{ scale: scoreScale1 }] }]}>
                {score1}
              </Animated.Text>
              <Animated.Text style={[s.floatPts, { color: P1_COLOR, transform: [{ translateY: floatY1 }], opacity: floatOp1 }]}>
                {floatText1}
              </Animated.Text>
            </View>
            <Pips score={score1} total={matchPoints} color={P1_COLOR} />
            <View style={s.faultSection}>
              <FaultDots count={faults1} />
              <Text style={s.faultLabel}>faltas</Text>
            </View>
          </View>

          <View style={s.centerDivider}>
            <Text style={s.vsText}>VS</Text>
          </View>

          {/* P2 */}
          <View style={[s.playerSide, { backgroundColor: 'rgba(230,57,70,0.06)' }]}>
            <Animated.View style={[s.flashOverlay, { opacity: flashOpacity2, backgroundColor: P2_COLOR }]} pointerEvents="none" />
            <Text style={[s.playerName, { color: P2_COLOR }]} numberOfLines={1}>{p2Name}</Text>
            <View style={s.scoreWrap}>
              <Animated.Text style={[s.scoreNum, { color: P2_COLOR, transform: [{ scale: scoreScale2 }] }]}>
                {score2}
              </Animated.Text>
              <Animated.Text style={[s.floatPts, { color: P2_COLOR, transform: [{ translateY: floatY2 }], opacity: floatOp2 }]}>
                {floatText2}
              </Animated.Text>
            </View>
            <Pips score={score2} total={matchPoints} color={P2_COLOR} />
            <View style={s.faultSection}>
              <FaultDots count={faults2} />
              <Text style={s.faultLabel}>faltas</Text>
            </View>
          </View>
        </View>

        {/* Prev rounds */}
        {rounds.length > 0 && (
          <View style={s.prevRounds}>
            {rounds.map(r => (
              <View key={r.round} style={s.prevRoundRow}>
                <Text style={s.prevRoundLabel}>R{r.round}</Text>
                <Text style={s.prevRoundScore}>{r.score1} — {r.score2}</Text>
                <Text style={[s.prevRoundWinner, { color: r.winner === 1 ? P1_COLOR : P2_COLOR }]}>
                  {r.winner === 1 ? p1Name : p2Name}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Lock banner */}
        {roundLocked && (
          <View style={[s.lockBanner, { borderColor: score1 >= matchPoints ? P1_COLOR : P2_COLOR }]}>
            <Text style={[s.lockTitle, { color: score1 >= matchPoints ? P1_COLOR : P2_COLOR }]}>
              {score1 >= matchPoints ? p1Name : p2Name} gana la ronda {currentRound}
            </Text>
            <Text style={s.lockSub}>Confirma para continuar</Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={s.actions}>
          {FINISHES.map(f => (
            <View key={f.key} style={s.finishRow}>
              <TouchableOpacity
                style={[s.finishBtn, { borderColor: P1_COLOR }, !canAct && s.btnDisabled]}
                disabled={!canAct}
                onPress={() => addScore(1, f)}
              >
                <Text style={[s.finishBtnText, { color: P1_COLOR }]}>{p1Name.split(' ')[0]}</Text>
              </TouchableOpacity>
              <View style={s.finishLabel}>
                <Text style={s.finishLabelText}>{f.label}</Text>
                <Text style={s.finishLabelPts}>+{f.pts} pts</Text>
              </View>
              <TouchableOpacity
                style={[s.finishBtn, { borderColor: P2_COLOR }, !canAct && s.btnDisabled]}
                disabled={!canAct}
                onPress={() => addScore(2, f)}
              >
                <Text style={[s.finishBtnText, { color: P2_COLOR }]}>{p2Name.split(' ')[0]}</Text>
              </TouchableOpacity>
            </View>
          ))}

          <View style={s.finishRow}>
            <TouchableOpacity
              style={[s.finishBtn, { borderColor: '#fb923c' }, !canAct && s.btnDisabled]}
              disabled={!canAct}
              onPress={() => addFault(1)}
            >
              <Text style={[s.finishBtnText, { color: '#fb923c' }]}>Falta</Text>
              <FaultDots count={faults1} />
            </TouchableOpacity>
            <View style={s.finishLabel}>
              <Text style={s.finishLabelText}>Falta</Text>
              <Text style={s.finishLabelPts}>×2 = +1 rival</Text>
            </View>
            <TouchableOpacity
              style={[s.finishBtn, { borderColor: '#fb923c' }, !canAct && s.btnDisabled]}
              disabled={!canAct}
              onPress={() => addFault(2)}
            >
              <Text style={[s.finishBtnText, { color: '#fb923c' }]}>Falta</Text>
              <FaultDots count={faults2} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Log */}
        {log.length > 0 && (
          <View style={s.logContainer}>
            <Text style={s.sectionLabel}>HISTORIAL R{currentRound}</Text>
            {[...log].reverse().slice(0, 5).map((e, i) => (
              <View key={i} style={s.logRow}>
                <View style={[s.logDot, { backgroundColor: e.player === 1 ? P1_COLOR : P2_COLOR }]} />
                <Text style={s.logLabel}>{e.label}</Text>
                <Text style={s.logScore}>{e.score1After} — {e.score2After}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={s.footer}>
        {!roundLocked ? (
          <View style={[s.endBtn, s.btnDisabled]}>
            <Text style={s.endBtnText}>Finalizar Ronda</Text>
          </View>
        ) : (
          <TouchableOpacity style={s.endBtn} onPress={() => setShowEndRound(true)} disabled={saving}>
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.endBtnText}>{willEndMatch ? 'Finalizar Match' : `Finalizar Ronda ${currentRound}`}</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      {/* Correct modal */}
      <Modal visible={showCorrect} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>¿Deshacer último evento?</Text>
            <Text style={s.modalSub}>La ronda se desbloqueará si el marcador baja de {matchPoints}.</Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowCorrect(false)}>
                <Text style={s.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalConfirm} onPress={handleUndo} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.modalConfirmText}>Deshacer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* End round modal */}
      <Modal visible={showEndRound} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{willEndMatch ? 'Finalizar Match' : `Finalizar Ronda ${currentRound}`}</Text>
            <View style={s.modalScoreRow}>
              <Text style={[s.modalPlayerName, { color: P1_COLOR }]}>{p1Name}</Text>
              <Text style={s.modalScore}>{score1} — {score2}</Text>
              <Text style={[s.modalPlayerName, { color: P2_COLOR, textAlign: 'right' }]}>{p2Name}</Text>
            </View>
            <Text style={[s.modalWinner, { color: score1 >= matchPoints ? P1_COLOR : P2_COLOR }]}>
              Gana: {score1 >= matchPoints ? p1Name : p2Name}
            </Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowEndRound(false)}>
                <Text style={s.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalConfirm} onPress={handleEndRound} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.modalConfirmText}>Confirmar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0a0a0f' },
  topbar:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 12, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  back:            { fontSize: 22, color: '#555', width: 32 },
  topTitle:        { fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  undoTopBtn:      { backgroundColor: '#111', borderWidth: 0.5, borderColor: '#222', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  undoTopText:     { fontSize: 11, fontWeight: '600', color: '#888' },

  roundsBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#0d0d14' },
  roundsBarLabel:  { fontSize: 9, letterSpacing: 3, color: '#333', textTransform: 'uppercase' },
  roundDots:       { flexDirection: 'row', gap: 8 },
  roundDot:        { width: 14, height: 14, borderRadius: 7, backgroundColor: '#111', borderWidth: 1.5, borderColor: '#222' },

  scoreboard:      { flexDirection: 'row', marginHorizontal: 12, marginTop: 10, marginBottom: 8, gap: 6 },
  playerSide:      { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center', overflow: 'hidden' },
  flashOverlay:    { ...StyleSheet.absoluteFillObject, borderRadius: 16 },
  playerName:      { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 4, textAlign: 'center' },
  scoreWrap:       { alignItems: 'center', justifyContent: 'center', height: 110 },
  scoreNum:        { fontSize: 96, fontWeight: '900', lineHeight: 108 },
  floatPts:        { position: 'absolute', top: 0, fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  pipsRow:         { flexDirection: 'row', gap: 5, marginTop: 2 },
  pip:             { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1a1a2a', borderWidth: 1, borderColor: '#222' },
  faultSection:    { alignItems: 'center', marginTop: 8, gap: 3 },
  faultRow:        { flexDirection: 'row', gap: 6 },
  faultDot:        { width: 10, height: 10, borderRadius: 5, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  faultDotActive:  { backgroundColor: '#fb923c', borderColor: '#fb923c' },
  faultLabel:      { fontSize: 8, letterSpacing: 2, color: '#333', textTransform: 'uppercase' },
  centerDivider:   { justifyContent: 'center', alignItems: 'center', paddingTop: 44 },
  vsText:          { fontSize: 10, fontWeight: '900', color: '#1e1e2e', letterSpacing: 2 },

  prevRounds:      { marginHorizontal: 12, marginBottom: 6, backgroundColor: '#0d0d14', borderRadius: 10, padding: 8, gap: 4 },
  prevRoundRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  prevRoundLabel:  { fontSize: 9, color: '#333', width: 24, fontWeight: '700' },
  prevRoundScore:  { fontSize: 13, fontWeight: '700', color: '#555', letterSpacing: 2 },
  prevRoundWinner: { fontSize: 10, fontWeight: '600', width: 90, textAlign: 'right' },

  lockBanner:      { marginHorizontal: 12, marginBottom: 6, backgroundColor: '#0d0d14', borderWidth: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  lockTitle:       { fontSize: 12, fontWeight: '700' },
  lockSub:         { fontSize: 10, color: '#555', marginTop: 2 },

  actions:         { paddingHorizontal: 12, gap: 6 },
  finishRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d0d14', borderRadius: 10, overflow: 'hidden' },
  finishBtn:       { flex: 1, paddingVertical: 13, alignItems: 'center', borderRightWidth: 0.5, borderColor: '#111', gap: 3 },
  finishBtnText:   { fontSize: 11, fontWeight: '700' },
  finishLabel:     { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  finishLabelText: { fontSize: 10, fontWeight: '700', color: '#777', textAlign: 'center' },
  finishLabelPts:  { fontSize: 9, color: '#444', marginTop: 1 },
  btnDisabled:     { opacity: 0.25 },

  logContainer:    { marginHorizontal: 12, marginTop: 12 },
  sectionLabel:    { fontSize: 9, letterSpacing: 4, color: '#333', textTransform: 'uppercase', marginBottom: 6 },
  logRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#0d0d14', gap: 8 },
  logDot:          { width: 6, height: 6, borderRadius: 3 },
  logLabel:        { flex: 1, fontSize: 11, color: '#444' },
  logScore:        { fontSize: 11, fontWeight: '700', color: '#666', letterSpacing: 2 },

  footer:          { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, paddingBottom: 26, borderTopWidth: 0.5, borderTopColor: '#0d0d14', backgroundColor: '#0a0a0f' },
  endBtn:          { backgroundColor: P2_COLOR, borderRadius: 12, padding: 14, alignItems: 'center' },
  endBtnText:      { color: '#fff', fontSize: 14, fontWeight: '700' },

  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal:           { backgroundColor: '#12121a', borderRadius: 20, padding: 24, width: '100%' },
  modalTitle:      { fontSize: 17, fontWeight: '900', color: '#fff', marginBottom: 8 },
  modalSub:        { fontSize: 12, color: '#555', marginBottom: 20 },
  modalScoreRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalPlayerName: { fontSize: 11, fontWeight: '700', flex: 1 },
  modalScore:      { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: 4 },
  modalWinner:     { fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  modalBtns:       { flexDirection: 'row', gap: 10 },
  modalCancel:     { flex: 1, backgroundColor: '#1e1e2e', borderRadius: 12, padding: 12, alignItems: 'center' },
  modalCancelText: { color: '#666', fontSize: 13, fontWeight: '600' },
  modalConfirm:    { flex: 2, backgroundColor: P2_COLOR, borderRadius: 12, padding: 12, alignItems: 'center' },
  modalConfirmText:{ color: '#fff', fontSize: 13, fontWeight: '600' },

  doneContent:     { alignItems: 'center', padding: 32, paddingTop: 48 },
  doneLabel:       { fontSize: 10, letterSpacing: 4, color: '#555', marginBottom: 8 },
  doneWinner:      { fontSize: 28, fontWeight: '900', letterSpacing: 1, textAlign: 'center', marginBottom: 12 },
  doneScore:       { fontSize: 60, fontWeight: '900', letterSpacing: 8, marginBottom: 4 },
  doneScoreLabel:  { fontSize: 10, letterSpacing: 4, color: '#555', marginBottom: 32 },
  historyCard:     { width: '100%', backgroundColor: '#12121a', borderRadius: 14, overflow: 'hidden', marginBottom: 32 },
  historyRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  historyRound:    { fontSize: 11, color: '#555', width: 60 },
  historyScore:    { fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  historyWinner:   { fontSize: 11, fontWeight: '600', width: 100, textAlign: 'right' },
  backBtn:         { width: '100%', borderRadius: 12, padding: 16, alignItems: 'center' },
  backBtnText:     { color: '#fff', fontSize: 14, fontWeight: '700' },
});
