import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  TextInput, ActivityIndicator, ScrollView, Image, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { signOut, updateProfile } from 'firebase/auth';
import {
  doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../config/firebase';

export default function ProfileScreen({ navigation }) {
  const user = auth.currentUser;

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [beyName, setBeyName]         = useState('');
  const [photoURL, setPhotoURL]       = useState(user?.photoURL ?? null);
  const [editing, setEditing]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statsOrg, setStatsOrg]       = useState(null);
  const [statsJoined, setStatsJoined] = useState(null);
  const [statsWins, setStatsWins]     = useState(null);

  useEffect(() => {
    loadProfile();
    loadStats();
  }, []);

  async function loadProfile() {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      setBeyName(snap.data().beyName ?? '');
    }
  }

  async function loadStats() {
    const [orgSnap, joinedSnap] = await Promise.all([
      getDocs(query(collection(db, 'tournaments'), where('createdBy', '==', user.uid))),
      getDocs(query(collection(db, 'tournaments'), where('participantUids', 'array-contains', user.uid))),
    ]);
    setStatsOrg(orgSnap.size);
    setStatsJoined(joinedSnap.size);

    let wins = 0;
    for (const t of joinedSnap.docs) {
      if (t.data().status === 'finished' && t.data().winnerId === user.uid) wins++;
    }
    setStatsWins(wins);
  }

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería para cambiar la foto.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled) return;

    await uploadPhoto(result.assets[0].uri);
  }

  async function uploadPhoto(uri) {
    setUploading(true);
    setUploadProgress(0);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();

      const storageRef = ref(storage, `avatars/${user.uid}.jpg`);
      const uploadTask = uploadBytesResumable(storageRef, blob, { contentType: 'image/jpeg' });

      await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          snapshot => {
            const progress = snapshot.bytesTransferred / snapshot.totalBytes;
            setUploadProgress(progress);
          },
          reject,
          resolve,
        );
      });

      const downloadURL = await getDownloadURL(storageRef);

      await updateProfile(user, { photoURL: downloadURL });
      await setDoc(doc(db, 'users', user.uid), {
        photoURL: downloadURL,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setPhotoURL(downloadURL);
    } catch (e) {
      Alert.alert('Error', 'No se pudo subir la foto. Intenta de nuevo.');
      console.error(e);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function handleSave() {
    const name = displayName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await updateProfile(user, { displayName: name });
      await setDoc(doc(db, 'users', user.uid), {
        displayName: name,
        beyName: beyName.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setEditing(false);
    } catch (e) {
      Alert.alert('Error', 'No se pudo guardar. Intenta de nuevo.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  function handleSignOut() {
    Alert.alert(
      'Cerrar sesión',
      '¿Seguro que quieres cerrar sesión?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => signOut(auth) },
      ],
    );
  }

  const initials = (user?.displayName || user?.email || 'U')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>PERFIL</Text>
        <TouchableOpacity
          onPress={() => setEditing(e => !e)}
          style={s.editBtn}
        >
          <Text style={s.editBtnText}>{editing ? 'Cancelar' : 'Editar'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Avatar */}
        <View style={s.avatarSection}>
          <TouchableOpacity onPress={handlePickPhoto} disabled={uploading} style={s.avatarWrapper}>
            {photoURL ? (
              <Image source={{ uri: photoURL }} style={s.avatarImg} />
            ) : (
              <View style={s.avatarCircle}>
                <Text style={s.avatarInitials}>{initials}</Text>
              </View>
            )}

            {/* Overlay while uploading */}
            {uploading ? (
              <View style={s.avatarOverlay}>
                <ActivityIndicator color="#fff" />
                <Text style={s.uploadPct}>{Math.round(uploadProgress * 100)}%</Text>
              </View>
            ) : (
              <View style={s.cameraTag}>
                <Text style={s.cameraIcon}>📷</Text>
              </View>
            )}
          </TouchableOpacity>

          {editing ? (
            <TextInput
              style={s.nameInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Tu nombre"
              placeholderTextColor="#444"
              autoFocus
            />
          ) : (
            <Text style={s.nameText}>{user?.displayName || 'Sin nombre'}</Text>
          )}
          <Text style={s.emailText}>{user?.email}</Text>
        </View>

        {/* Beyblade name */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>BEYBLADE FAVORITO</Text>
          {editing ? (
            <TextInput
              style={s.fieldInput}
              value={beyName}
              onChangeText={setBeyName}
              placeholder="Nombre de tu Beyblade"
              placeholderTextColor="#444"
            />
          ) : (
            <View style={s.fieldRow}>
              <Text style={s.fieldValue}>{beyName || 'No configurado'}</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>ESTADÍSTICAS</Text>
          <View style={s.statsGrid}>
            <StatCard label="Organizados"    value={statsOrg}    accent="#4ade80" />
            <StatCard label="Participaciones" value={statsJoined} accent="#fb923c" />
            <StatCard label="Victorias"       value={statsWins}   accent="#e63946" />
          </View>
        </View>

        {/* Save */}
        {editing && (
          <TouchableOpacity
            style={[s.saveBtn, (!displayName.trim() || saving) && s.btnDisabled]}
            onPress={handleSave}
            disabled={!displayName.trim() || saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.saveBtnText}>Guardar cambios</Text>}
          </TouchableOpacity>
        )}

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <View style={s.statCard}>
      <Text style={[s.statValue, { color: accent }]}>
        {value === null ? '—' : value}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0f' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 16 },
  backBtn:        { width: 36, alignItems: 'flex-start' },
  backText:       { fontSize: 22, color: '#fff' },
  headerTitle:    { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 4 },
  editBtn:        { width: 64, alignItems: 'flex-end' },
  editBtnText:    { fontSize: 14, color: '#e63946', fontWeight: '600' },

  scroll:         { paddingBottom: 60 },

  avatarSection:  { alignItems: 'center', paddingTop: 24, paddingBottom: 32 },
  avatarWrapper:  { marginBottom: 14, position: 'relative' },
  avatarImg:      { width: 90, height: 90, borderRadius: 45, borderWidth: 2, borderColor: '#e63946' },
  avatarCircle:   { width: 90, height: 90, borderRadius: 45, backgroundColor: '#e63946', alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 32, fontWeight: '900', color: '#fff' },
  avatarOverlay:  { position: 'absolute', top: 0, left: 0, width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  uploadPct:      { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  cameraTag:      { position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: '#1e1e2e', borderWidth: 1.5, borderColor: '#e63946', alignItems: 'center', justifyContent: 'center' },
  cameraIcon:     { fontSize: 12 },

  nameInput:      { fontSize: 22, fontWeight: '900', color: '#fff', borderBottomWidth: 1, borderBottomColor: '#e63946', textAlign: 'center', paddingBottom: 4, minWidth: 200 },
  nameText:       { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 4 },
  emailText:      { fontSize: 13, color: '#555' },

  section:        { marginHorizontal: 20, marginBottom: 24 },
  sectionLabel:   { fontSize: 11, letterSpacing: 4, color: '#555', textTransform: 'uppercase', marginBottom: 12 },
  fieldInput:     { backgroundColor: '#12121a', borderWidth: 0.5, borderColor: '#333', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15 },
  fieldRow:       { backgroundColor: '#12121a', borderRadius: 10, padding: 14, borderWidth: 0.5, borderColor: '#1e1e2e' },
  fieldValue:     { color: '#aaa', fontSize: 15 },

  statsGrid:      { flexDirection: 'row', gap: 10 },
  statCard:       { flex: 1, backgroundColor: '#12121a', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 0.5, borderColor: '#1e1e2e' },
  statValue:      { fontSize: 32, fontWeight: '900', marginBottom: 4 },
  statLabel:      { fontSize: 10, color: '#555', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' },

  saveBtn:        { marginHorizontal: 20, backgroundColor: '#e63946', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 },
  saveBtnText:    { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDisabled:    { opacity: 0.35 },

  signOutBtn:     { marginHorizontal: 20, backgroundColor: '#12121a', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 0.5, borderColor: '#2a0a0f' },
  signOutText:    { color: '#e63946', fontSize: 14, fontWeight: '600' },
});
