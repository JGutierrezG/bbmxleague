import {
  collection, addDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const PLAYERS = [
  { name: 'Tyson Granger',   beyName: 'Dragoon' },
  { name: 'Kai Hiwatari',    beyName: 'Dranzer' },
  { name: 'Max Tate',        beyName: 'Draciel' },
  { name: 'Ray Kon',         beyName: 'Driger' },
  { name: 'Brooklyn',        beyName: 'Zeus' },
  { name: 'Tala Valkov',     beyName: 'Wolborg' },
  { name: 'Daichi Sumeragi', beyName: 'Strata Dragoon' },
  { name: 'Garland',         beyName: 'Apollon' },
];

function roundRobin(playerIds) {
  const matches = [];
  for (let i = 0; i < playerIds.length; i++)
    for (let j = i + 1; j < playerIds.length; j++)
      matches.push({ player1Id: playerIds[i], player2Id: playerIds[j] });
  return matches;
}

export async function seedTestTournament() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');

  const tournamentRef = await addDoc(collection(db, 'tournaments'), {
    name:            'Torneo de Prueba',
    desc:            'Generado automáticamente para testing',
    format:          'grupos',
    numGroups:       2,
    playersPerGroup: 4,
    advancePer:      2,
    crossingMode:    'cruzado',
    matchPoints:     5,
    status:          'groups',
    inviteCode:      'BEY-TST',
    createdBy:       uid,
    createdAt:       serverTimestamp(),
    participantUids: [],
  });

  const tid = tournamentRef.id;

  // Create participants sequentially to get their IDs
  const pIds = [];
  for (const p of PLAYERS) {
    const ref = await addDoc(collection(db, 'tournaments', tid, 'participants'), {
      name:    p.name,
      beyName: p.beyName,
      source:  'manual',
      addedBy: uid,
      addedAt: serverTimestamp(),
    });
    pIds.push(ref.id);
  }

  // Create groups and round-robin matches in one batch
  const batch = writeBatch(db);
  const groupDefs = [
    { name: 'A', playerIds: pIds.slice(0, 4) },
    { name: 'B', playerIds: pIds.slice(4, 8) },
  ];

  for (const group of groupDefs) {
    const groupRef = doc(collection(db, 'tournaments', tid, 'groups'));
    batch.set(groupRef, {
      name:      group.name,
      playerIds: group.playerIds,
      createdAt: serverTimestamp(),
    });
    roundRobin(group.playerIds).forEach(m => {
      const matchRef = doc(
        collection(db, 'tournaments', tid, 'groups', groupRef.id, 'matches'),
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

  await batch.commit();
  return tid;
}
