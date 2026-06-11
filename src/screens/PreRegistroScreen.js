import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator, Modal, Share,
} from 'react-native';
import {
  doc, onSnapshot, collection, addDoc, deleteDoc, getDoc, getDocs,
  serverTimestamp, writeBatch, updateDoc, arrayUnion, arrayRemove, query,
  where, limit,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roundRobinMatches(playerIds) {
  const matches = [];
  for (let i = 0; i < playerIds.length; i++)
    for (let j = i + 1; j < playerIds.length; j++)
      matches.push({ player1Id: playerIds[i], player2Id: playerIds[j] });
  return matches;
}

export default function PreRegistroScreen({ navigation, route }) {
  const { tournamentId } = route.params;

  const [tournament, setTournament]       = useState(null);
  const [participants, setParticipants]   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [addName, setAddName]             = useState('');
  const [addBey, setAddBey]               = useState('');
  const [addLoading, setAddLoading]       = useState(false);
  const [showClose, setShowClose]         = useState(false);
  const [numGroups, setNumGroups]         = useState(4);
  const [closingLoading, setClosingLoading] = useState(false);

  const [refereeUsers, setRefereeUsers]   = useState([]);
  const [refSearch, setRefSearch]         = useState('');
  const [refResults, setRefResults]       = useState([]);
  const [refSearching, setRefSearching]   = useState(false);
  const [allUsers, setAllUsers]           = useState([]);
  const [usersLoaded, setUsersLoaded]     = useState(false);

  useEffect(() => {
    const unsubT = onSnapshot(doc(db, 'tournaments', tournamentId), async snap => {
      const data = { id: snap.id, ...snap.data() };
      setTournament(data);
      setNumGroups(data.numGroups ?? 4);
      setLoading(false);

      const uids = data.refereeUids ?? [];
      if (uids.length > 0) {
        const docs = await Promise.all(uids.map(uid => getDoc(doc(db, 'users', uid))));
        setRefereeUsers(docs.filter(d => d.exists()).map(d => ({ uid: d.id, ...d.data() })));
      } else {
        setRefereeUsers([]);
      }
    });
    const unsubP = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'participants'),
      snap => setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    );
    return () => { unsubT(); unsubP(); };
  }, [tournamentId]);

  async function loadUsersIfNeeded() {
    if (usersLoaded) return;
    setRefSearching(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      setAllUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
      setUsersLoaded(true);
    } finally {
      setRefSearching(false);
    }
  }

  function searchReferees(text) {
    setRefSearch(text);
    if (text.trim().length < 2) { setRefResults([]); return; }
    const q = text.trim().toLowerCase();
    const current = tournament?.refereeUids ?? [];
    setRefResults(
      allUsers
        .filter(u =>
          u.uid !== auth.currentUser.uid &&
          !current.includes(u.uid) &&
          (
            (u.displayName || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q)
          ),
        )
        .slice(0, 6),
    );
  }

  async function addReferee(u) {
    await updateDoc(doc(db, 'tournaments', tournamentId), {
      refereeUids: arrayUnion(u.uid),
    });
    setRefSearch('');
    setRefResults([]);
  }

  async function removeReferee(uid) {
    await updateDoc(doc(db, 'tournaments', tournamentId), {
      refereeUids: arrayRemove(uid),
    });
  }

  async function handleAddPlayer() {
    if (!addName.trim()) return;
    setAddLoading(true);
    try {
      await addDoc(collection(db, 'tournaments', tournamentId, 'participants'), {
        name:     addName.trim(),
        beyName:  addBey.trim(),
        source:   'manual',
        addedBy:  auth.currentUser.uid,
        addedAt:  serverTimestamp(),
      });
      setAddName('');
      setAddBey('');
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRemove(pid) {
    await deleteDoc(doc(db, 'tournaments', tournamentId, 'participants', pid));
  }

  async function handleCloseRegistration() {
    setClosingLoading(true);
    try {
      const shuffled = shuffle(participants);
      const batch    = writeBatch(db);

      for (let gi = 0; gi < numGroups; gi++) {
        const groupPlayers = shuffled
          .filter((_, i) => i % numGroups === gi)
          .map(p => p.id);

        const groupRef = doc(collection(db, 'tournaments', tournamentId, 'groups'));
        batch.set(groupRef, {
          name:      String.fromCharCode(65 + gi),
          playerIds: groupPlayers,
          createdAt: serverTimestamp(),
        });

        roundRobinMatches(groupPlayers).forEach(m => {
          const matchRef = doc(
            collection(db, 'tournaments', tournamentId, 'groups', groupRef.id, 'matches'),
          );
          batch.set(matchRef, {
            ...m,
            score1: 0, score2: 0,
            faults1: 0, faults2: 0,
            roundsWon1: 0, roundsWon2: 0,
            currentRound: 1,
            rounds: [],
            status: 'pending',
            log: [],
            createdAt: serverTimestamp(),
          });
        });
      }

      batch.update(doc(db, 'tournaments', tournamentId), {
        status:    'groups',
        numGroups,
      });

      await batch.commit();
      navigation.replace('Tournament', { tournamentId });
    } catch (e) {
      console.error(e);
      setClosingLoading(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color="#e63946" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const isOrganizer     = tournament?.createdBy === auth.currentUser?.uid;
  const isReferee       = (tournament?.refereeUids ?? []).includes(auth.currentUser?.uid);
  const canStart        = isOrganizer || isReferee;
  const suggestedGroups = Math.max(1, Math.ceil(participants.length / 4));
  const perGroupPreview  = numGroups > 0 ? Math.ceil(participants.length / numGroups) : 0;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.topbar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>{tournament?.name}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 110 }}>

        {/* Invite code */}
        <View style={s.codeCard}>
          <Text style={s.codeLabel}>CÓDIGO DE INVITACIÓN</Text>
          <Text style={s.code}>{tournament?.inviteCode}</Text>
          <TouchableOpacity
            style={s.shareBtn}
            onPress={() => Share.share({ message: `Únete al torneo "${tournament?.name}" con el código: ${tournament?.inviteCode}` })}
          >
            <Text style={s.shareBtnText}>Compartir código</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statNum}>{participants.length}</Text>
            <Text style={s.statLabel}>Jugadores</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{suggestedGroups}</Text>
            <Text style={s.statLabel}>Grupos sugeridos</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>
              {participants.length > 0 ? Math.ceil(participants.length / suggestedGroups) : '—'}
            </Text>
            <Text style={s.statLabel}>Por grupo</Text>
          </View>
        </View>

        {/* Add player */}
        {isOrganizer && (
          <View style={s.addCard}>
            <Text style={s.sectionLabel}>AGREGAR JUGADOR</Text>
            <TextInput
              style={s.input}
              placeholder="Nombre *"
              placeholderTextColor="#444"
              value={addName}
              onChangeText={setAddName}
            />
            <TextInput
              style={s.input}
              placeholder="Nombre del Beyblade (opcional)"
              placeholderTextColor="#444"
              value={addBey}
              onChangeText={setAddBey}
            />
            <TouchableOpacity
              style={[s.addBtn, !addName.trim() && s.btnDisabled]}
              disabled={!addName.trim() || addLoading}
              onPress={handleAddPlayer}
            >
              {addLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.addBtnText}>+ Agregar</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Referees — organizer only */}
        {isOrganizer && (
          <View style={s.addCard}>
            <Text style={s.sectionLabel2}>ÁRBITROS</Text>

            {/* Current referees */}
            {refereeUsers.length > 0 && (
              <View style={s.refereeList}>
                {refereeUsers.map(u => (
                  <View key={u.uid} style={s.refereeRow}>
                    <View style={s.refereeAvatar}>
                      <Text style={s.refereeAvatarText}>{(u.displayName || '?')[0].toUpperCase()}</Text>
                    </View>
                    <View style={s.refereeInfo}>
                      <Text style={s.refereeName}>{u.displayName}</Text>
                      <Text style={s.refereeEmail}>{u.email}</Text>
                    </View>
                    <TouchableOpacity style={s.removeBtn} onPress={() => removeReferee(u.uid)}>
                      <Text style={s.removeBtnText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Search */}
            <TextInput
              style={s.input}
              placeholder="Buscar por nombre o email..."
              placeholderTextColor="#444"
              value={refSearch}
              onFocus={loadUsersIfNeeded}
              onChangeText={searchReferees}
              autoCapitalize="none"
            />
            {refSearching && <ActivityIndicator color="#e63946" size="small" style={{ marginBottom: 8 }} />}
            {refResults.map(u => (
              <TouchableOpacity key={u.uid} style={s.refResultRow} onPress={() => addReferee(u)}>
                <View style={s.refereeAvatar}>
                  <Text style={s.refereeAvatarText}>{(u.displayName || '?')[0].toUpperCase()}</Text>
                </View>
                <View style={s.refereeInfo}>
                  <Text style={s.refereeName}>{u.displayName}</Text>
                  <Text style={s.refereeEmail}>{u.email}</Text>
                </View>
                <Text style={s.refAddIcon}>+</Text>
              </TouchableOpacity>
            ))}
            {refSearch.length >= 2 && !refSearching && refResults.length === 0 && (
              <Text style={s.refEmpty}>Sin resultados</Text>
            )}
          </View>
        )}

        {/* Referee badge for non-organizer referees */}
        {!isOrganizer && isReferee && (
          <View style={s.refBadgeCard}>
            <Text style={s.refBadgeText}>⚖️  Eres árbitro de este torneo</Text>
          </View>
        )}

        {/* Player list */}
        <Text style={s.sectionLabel}>JUGADORES REGISTRADOS</Text>
        {participants.length === 0
          ? <View style={s.empty}><Text style={s.emptyText}>No hay jugadores aún</Text></View>
          : participants.map((p, i) => (
            <View key={p.id} style={s.playerRow}>
              <View style={s.playerNum}>
                <Text style={s.playerNumText}>{i + 1}</Text>
              </View>
              <View style={s.playerInfo}>
                <Text style={s.playerName}>{p.name}</Text>
                {!!p.beyName && <Text style={s.playerBey}>{p.beyName}</Text>}
              </View>
              <View style={[s.badge, p.source === 'organizer' ? s.badgeOrg : s.badgeInv]}>
                <Text style={[s.badgeText, p.source === 'organizer' && s.badgeTextOrg]}>
                  {p.source === 'organizer' ? 'ORG' : p.source === 'invited' ? 'INV' : 'AGR'}
                </Text>
              </View>
              {isOrganizer && (
                <TouchableOpacity style={s.removeBtn} onPress={() => handleRemove(p.id)}>
                  <Text style={s.removeBtnText}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        }
      </ScrollView>

      {canStart && (
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.closeBtn, participants.length < 2 && s.btnDisabled]}
            disabled={participants.length < 2}
            onPress={() => setShowClose(true)}
          >
            <Text style={s.closeBtnText}>Cerrar registro y generar grupos</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Close registration modal */}
      <Modal visible={showClose} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Cerrar registro</Text>
            <Text style={s.sheetSub}>{participants.length} jugadores serán distribuidos aleatoriamente</Text>

            <Text style={s.sheetLabel}>Número de grupos</Text>
            <View style={s.stepper}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => setNumGroups(n => Math.max(1, n - 1))}
              >
                <Text style={s.stepBtnText}>−</Text>
              </TouchableOpacity>
              <View style={s.stepCenter}>
                <Text style={s.stepVal}>{numGroups}</Text>
                <Text style={s.stepUnit}>grupos</Text>
              </View>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => setNumGroups(n => Math.min(participants.length, n + 1))}
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={s.sheetInfo}>
              <Text style={s.sheetInfoText}>~{perGroupPreview} jugadores por grupo</Text>
            </View>

            <View style={s.sheetBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowClose(false)}>
                <Text style={s.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.confirmBtn}
                onPress={handleCloseRegistration}
                disabled={closingLoading}
              >
                {closingLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.confirmBtnText}>Generar grupos</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0f' },
  topbar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 16, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  back:           { fontSize: 22, color: '#555' },
  topTitle:       { flex: 1, fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 3, textAlign: 'center' },
  scroll:         { flex: 1 },

  codeCard:       { margin: 20, backgroundColor: '#12121a', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 0.5, borderColor: '#1e1e2e' },
  codeLabel:      { fontSize: 10, letterSpacing: 4, color: '#555', marginBottom: 8 },
  code:           { fontSize: 36, fontWeight: '900', color: '#e63946', letterSpacing: 6, marginBottom: 12 },
  shareBtn:       { backgroundColor: '#1a0a0e', borderWidth: 1, borderColor: '#e63946', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  shareBtnText:   { color: '#e63946', fontSize: 12, fontWeight: '600', letterSpacing: 1 },

  statsRow:       { flexDirection: 'row', marginHorizontal: 20, gap: 8, marginBottom: 8 },
  statCard:       { flex: 1, backgroundColor: '#12121a', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#1e1e2e' },
  statNum:        { fontSize: 26, fontWeight: '900', color: '#fff' },
  statLabel:      { fontSize: 9, letterSpacing: 2, color: '#555', marginTop: 2, textAlign: 'center' },

  sectionLabel:   { fontSize: 10, letterSpacing: 4, color: '#555', textTransform: 'uppercase', paddingHorizontal: 20, marginTop: 20, marginBottom: 10 },

  addCard:        { marginHorizontal: 20, backgroundColor: '#12121a', borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: '#1e1e2e', marginBottom: 4 },
  input:          { backgroundColor: '#0a0a0f', borderWidth: 0.5, borderColor: '#222', borderRadius: 10, padding: 11, color: '#fff', fontSize: 14, marginBottom: 10 },
  addBtn:         { backgroundColor: '#e63946', borderRadius: 10, padding: 12, alignItems: 'center' },
  addBtnText:     { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnDisabled:    { opacity: 0.35 },

  empty:          { marginHorizontal: 20, backgroundColor: '#12121a', borderRadius: 12, padding: 20, borderWidth: 0.5, borderColor: '#1e1e2e', alignItems: 'center' },
  emptyText:      { color: '#444', fontSize: 13 },

  playerRow:      { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 6, backgroundColor: '#12121a', borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#1e1e2e' },
  playerNum:      { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1e1e2e', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  playerNumText:  { fontSize: 11, fontWeight: '600', color: '#555' },
  playerInfo:     { flex: 1 },
  playerName:     { fontSize: 14, fontWeight: '600', color: '#fff' },
  playerBey:      { fontSize: 11, color: '#555', marginTop: 1 },
  badge:          { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 },
  badgeOrg:       { backgroundColor: '#3d0a0a' },
  badgeInv:       { backgroundColor: '#0a1a2e' },
  badgeText:      { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: '#6aaccd' },
  badgeTextOrg:   { color: '#e63946' },
  removeBtn:      { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  removeBtnText:  { fontSize: 20, color: '#555', lineHeight: 24 },

  sectionLabel2:  { fontSize: 10, letterSpacing: 4, color: '#555', textTransform: 'uppercase', marginBottom: 12 },
  refereeList:    { marginBottom: 12 },
  refereeRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0a0f', borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 0.5, borderColor: '#222' },
  refResultRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f1a2e', borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 0.5, borderColor: '#1a2a3e' },
  refereeAvatar:  { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e63946', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  refereeAvatarText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  refereeInfo:    { flex: 1 },
  refereeName:    { fontSize: 13, fontWeight: '600', color: '#fff' },
  refereeEmail:   { fontSize: 11, color: '#555', marginTop: 1 },
  refAddIcon:     { fontSize: 20, color: '#4ade80', fontWeight: '700', paddingHorizontal: 4 },
  refEmpty:       { fontSize: 12, color: '#444', textAlign: 'center', paddingVertical: 8 },
  refBadgeCard:   { marginHorizontal: 20, marginBottom: 12, backgroundColor: '#0a1a0e', borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#1a3a1e', alignItems: 'center' },
  refBadgeText:   { fontSize: 13, color: '#4ade80', fontWeight: '600' },

  footer:         { padding: 16, paddingBottom: 28, borderTopWidth: 0.5, borderTopColor: '#111' },
  closeBtn:       { backgroundColor: '#e63946', borderRadius: 12, padding: 14, alignItems: 'center' },
  closeBtnText:   { color: '#fff', fontSize: 14, fontWeight: '600' },

  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:          { backgroundColor: '#12121a', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle:     { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 1, marginBottom: 4 },
  sheetSub:       { fontSize: 12, color: '#555', marginBottom: 20 },
  sheetLabel:     { fontSize: 10, letterSpacing: 3, color: '#555', textTransform: 'uppercase', marginBottom: 10 },
  stepper:        { flexDirection: 'row', backgroundColor: '#0a0a0f', borderWidth: 0.5, borderColor: '#222', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  stepBtn:        { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  stepBtnText:    { fontSize: 24, color: '#666' },
  stepCenter:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepVal:        { fontSize: 26, fontWeight: '900', color: '#fff' },
  stepUnit:       { fontSize: 10, color: '#555', marginTop: 1 },
  sheetInfo:      { backgroundColor: '#0a1a2e', borderRadius: 10, padding: 10, marginBottom: 20 },
  sheetInfoText:  { fontSize: 12, color: '#4a7a9d', textAlign: 'center' },
  sheetBtns:      { flexDirection: 'row', gap: 10 },
  cancelBtn:      { flex: 1, backgroundColor: '#1e1e2e', borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtnText:  { color: '#666', fontSize: 14, fontWeight: '600' },
  confirmBtn:     { flex: 2, backgroundColor: '#e63946', borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
