import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  ScrollView, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  collection, query, where, onSnapshot, orderBy,
  getDocs, addDoc, serverTimestamp, doc, updateDoc, arrayUnion,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { seedTestTournament } from '../utils/seedData';

export default function HomeScreen({ navigation }) {
  const [myTournaments, setMyTournaments]       = useState([]);
  const [joinedTournaments, setJoinedTournaments] = useState([]);
  const [loading, setLoading]                   = useState(true);

  const [seeding, setSeeding]               = useState(false);
  const [showJoin, setShowJoin]             = useState(false);
  const [code, setCode]                     = useState('');
  const [joinName, setJoinName]             = useState('');
  const [joinBey, setJoinBey]               = useState('');
  const [joinStep, setJoinStep]             = useState(1); // 1=code, 2=name
  const [joinTournament, setJoinTournament] = useState(null);
  const [joinLoading, setJoinLoading]       = useState(false);
  const [joinError, setJoinError]           = useState('');

  const user = auth.currentUser;

  useEffect(() => {
    const myQ = query(
      collection(db, 'tournaments'),
      where('createdBy', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsubMy = onSnapshot(myQ, snap => {
      setMyTournaments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    const joinedQ = query(
      collection(db, 'tournaments'),
      where('participantUids', 'array-contains', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsubJoined = onSnapshot(joinedQ, snap => {
      setJoinedTournaments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubMy(); unsubJoined(); };
  }, []);

  function openJoinModal() {
    setCode('');
    setJoinName('');
    setJoinBey('');
    setJoinStep(1);
    setJoinTournament(null);
    setJoinError('');
    setShowJoin(true);
  }

  async function handleValidateCode() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setJoinLoading(true);
    setJoinError('');
    try {
      const snap = await getDocs(
        query(collection(db, 'tournaments'), where('inviteCode', '==', trimmed)),
      );
      if (snap.empty) {
        setJoinError('Código no encontrado. Verifica e intenta de nuevo.');
        return;
      }
      const t = { id: snap.docs[0].id, ...snap.docs[0].data() };
      if (t.status !== 'registration') {
        setJoinError('Este torneo ya cerró su registro.');
        return;
      }
      if (t.createdBy === user.uid) {
        setJoinError('Eres el organizador de este torneo.');
        return;
      }
      // Check if already registered
      const existing = await getDocs(
        query(
          collection(db, 'tournaments', t.id, 'participants'),
          where('uid', '==', user.uid),
        ),
      );
      if (!existing.empty) {
        setJoinError('Ya estás registrado en este torneo.');
        return;
      }
      setJoinTournament(t);
      setJoinStep(2);
    } catch (e) {
      setJoinError('Error al buscar el torneo. Intenta de nuevo.');
      console.error(e);
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleConfirmJoin() {
    if (!joinName.trim()) return;
    setJoinLoading(true);
    try {
      await Promise.all([
        addDoc(
          collection(db, 'tournaments', joinTournament.id, 'participants'),
          {
            uid:     user.uid,
            name:    joinName.trim(),
            beyName: joinBey.trim(),
            source:  'invited',
            addedBy: user.uid,
            addedAt: serverTimestamp(),
          },
        ),
        updateDoc(doc(db, 'tournaments', joinTournament.id), {
          participantUids: arrayUnion(user.uid),
        }),
      ]);
      setShowJoin(false);
      navigation.navigate('PreRegistro', { tournamentId: joinTournament.id });
    } catch (e) {
      setJoinError('Error al unirte. Intenta de nuevo.');
      console.error(e);
    } finally {
      setJoinLoading(false);
    }
  }

  const statusLabel = s => ({ registration: 'Abierto', groups: 'En curso', bracket: 'Bracket', finished: 'Finalizado' }[s] || s);
  const statusColor = s => ({ registration: '#4ade80', groups: '#fb923c', bracket: '#e63946', finished: '#555' }[s] || '#555');
  const statusBg    = s => ({ registration: '#0f3d1f', groups: '#3d1a0f', bracket: '#3d0a0a', finished: '#111' }[s] || '#111');

  function TournamentCard({ t }) {
    return (
      <TouchableOpacity
        style={st.card}
        onPress={() => navigation.navigate(
          t.status === 'registration' ? 'PreRegistro' : 'Tournament',
          { tournamentId: t.id },
        )}
      >
        <View style={st.cardHeader}>
          <Text style={st.cardName}>{t.name}</Text>
          <View style={[st.badge, { backgroundColor: statusBg(t.status) }]}>
            <Text style={[st.badgeText, { color: statusColor(t.status) }]}>
              {statusLabel(t.status)}
            </Text>
          </View>
        </View>
        <Text style={st.cardMeta}>
          {t.numGroups ? `${t.numGroups} grupos · ` : ''}{t.matchPoints} pts
        </Text>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <ActivityIndicator color="#e63946" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.container}>
      <View style={st.topbar}>
        <Text style={st.title}>TORNEOS</Text>
        <TouchableOpacity style={st.avatar} onPress={() => navigation.navigate('Profile')}>
          <Text style={st.avatarText}>{(user.displayName || 'U')[0].toUpperCase()}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={st.scroll} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* DEV seed button */}
        <TouchableOpacity
          style={st.seedBtn}
          disabled={seeding}
          onPress={async () => {
            setSeeding(true);
            try {
              const tid = await seedTestTournament();
              navigation.navigate('Tournament', { tournamentId: tid });
            } finally {
              setSeeding(false);
            }
          }}
        >
          {seeding
            ? <ActivityIndicator color="#555" size="small" />
            : <Text style={st.seedBtnText}>+ Torneo de prueba</Text>
          }
        </TouchableOpacity>

        <Text style={st.sectionLabel}>ORGANIZANDO</Text>
        {myTournaments.length === 0
          ? <View style={st.empty}><Text style={st.emptyText}>No has creado torneos aún</Text></View>
          : myTournaments.map(t => <TournamentCard key={t.id} t={t} />)
        }

        <Text style={st.sectionLabel}>PARTICIPANDO</Text>
        {joinedTournaments.length === 0
          ? <View style={st.empty}><Text style={st.emptyText}>Únete con un código para ver torneos aquí</Text></View>
          : joinedTournaments.map(t => <TournamentCard key={t.id} t={t} />)
        }
      </ScrollView>

      {/* FABs */}
      <View style={st.fabGroup}>
        <TouchableOpacity style={st.fabSecondary} onPress={openJoinModal}>
          <Text style={st.fabSecondaryText}>Unirse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.fab} onPress={() => navigation.navigate('CreateTournament')}>
          <Text style={st.fabText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Join modal */}
      <Modal visible={showJoin} transparent animationType="slide">
        <KeyboardAvoidingView
          style={st.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={st.sheet}>
            {joinStep === 1 ? (
              <>
                <Text style={st.sheetTitle}>Unirse con código</Text>
                <Text style={st.sheetSub}>Ingresa el código BEY-XXX del torneo</Text>
                <TextInput
                  style={st.codeInput}
                  placeholder="BEY-XXX"
                  placeholderTextColor="#444"
                  value={code}
                  onChangeText={t => { setCode(t.toUpperCase()); setJoinError(''); }}
                  autoCapitalize="characters"
                  autoFocus
                  maxLength={7}
                />
                {!!joinError && <Text style={st.errorText}>{joinError}</Text>}
                <View style={st.sheetBtns}>
                  <TouchableOpacity style={st.cancelBtn} onPress={() => setShowJoin(false)}>
                    <Text style={st.cancelBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.confirmBtn, !code.trim() && st.btnDisabled]}
                    disabled={!code.trim() || joinLoading}
                    onPress={handleValidateCode}
                  >
                    {joinLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={st.confirmBtnText}>Buscar</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={st.sheetTitle}>{joinTournament?.name}</Text>
                <Text style={st.sheetSub}>¿Cómo quieres aparecer en el torneo?</Text>
                <TextInput
                  style={st.input}
                  placeholder="Tu nombre *"
                  placeholderTextColor="#444"
                  value={joinName}
                  onChangeText={setJoinName}
                  autoFocus
                />
                <TextInput
                  style={st.input}
                  placeholder="Nombre de tu Beyblade (opcional)"
                  placeholderTextColor="#444"
                  value={joinBey}
                  onChangeText={setJoinBey}
                />
                {!!joinError && <Text style={st.errorText}>{joinError}</Text>}
                <View style={st.sheetBtns}>
                  <TouchableOpacity style={st.cancelBtn} onPress={() => setJoinStep(1)}>
                    <Text style={st.cancelBtnText}>← Atrás</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.confirmBtn, !joinName.trim() && st.btnDisabled]}
                    disabled={!joinName.trim() || joinLoading}
                    onPress={handleConfirmJoin}
                  >
                    {joinLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={st.confirmBtnText}>Unirse</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0a0a0f' },
  topbar:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 16 },
  title:           { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: 4 },
  avatar:          { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e63946', alignItems: 'center', justifyContent: 'center' },
  avatarText:      { color: '#fff', fontSize: 13, fontWeight: '600' },
  scroll:          { flex: 1 },
  sectionLabel:    { fontSize: 11, letterSpacing: 4, color: '#555', textTransform: 'uppercase', paddingHorizontal: 20, marginTop: 20, marginBottom: 10 },
  empty:           { marginHorizontal: 20, backgroundColor: '#12121a', borderRadius: 12, padding: 20, borderWidth: 0.5, borderColor: '#222', alignItems: 'center' },
  emptyText:       { color: '#444', fontSize: 13 },
  card:            { marginHorizontal: 20, marginBottom: 10, backgroundColor: '#12121a', borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: '#222' },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardName:        { fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 1, flex: 1 },
  badge:           { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  badgeText:       { fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  cardMeta:        { fontSize: 12, color: '#555' },

  seedBtn:         { marginHorizontal: 20, marginTop: 16, marginBottom: 4, borderWidth: 1, borderColor: '#222', borderStyle: 'dashed', borderRadius: 10, padding: 10, alignItems: 'center' },
  seedBtnText:     { color: '#333', fontSize: 12 },
  fabGroup:        { position: 'absolute', bottom: 24, right: 20, alignItems: 'flex-end', gap: 10 },
  fabSecondary:    { backgroundColor: '#1e1e2e', borderWidth: 1, borderColor: '#e63946', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12 },
  fabSecondaryText:{ color: '#e63946', fontSize: 13, fontWeight: '600' },
  fab:             { width: 52, height: 52, borderRadius: 26, backgroundColor: '#e63946', alignItems: 'center', justifyContent: 'center' },
  fabText:         { color: '#fff', fontSize: 28, lineHeight: 32 },

  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:           { backgroundColor: '#12121a', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle:      { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 1, marginBottom: 4 },
  sheetSub:        { fontSize: 12, color: '#555', marginBottom: 20 },
  codeInput:       { backgroundColor: '#0a0a0f', borderWidth: 1, borderColor: '#333', borderRadius: 12, padding: 14, color: '#e63946', fontSize: 28, fontWeight: '900', letterSpacing: 8, textAlign: 'center', marginBottom: 12 },
  input:           { backgroundColor: '#0a0a0f', borderWidth: 0.5, borderColor: '#222', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 10 },
  errorText:       { color: '#e63946', fontSize: 12, marginBottom: 12, textAlign: 'center' },
  sheetBtns:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:       { flex: 1, backgroundColor: '#1e1e2e', borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtnText:   { color: '#666', fontSize: 14, fontWeight: '600' },
  confirmBtn:      { flex: 2, backgroundColor: '#e63946', borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmBtnText:  { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnDisabled:     { opacity: 0.35 },
});
