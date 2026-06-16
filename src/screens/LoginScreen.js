import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, Animated, Linking,
} from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

// Replace with your Web Client ID from Firebase Project Settings → General → Your apps → Web app
const WEB_CLIENT_ID = '557197275610-s2t5nvimtqco32ds16dkectog834n9tj.apps.googleusercontent.com';

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const spinAnim              = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
    ).start();
  }, []);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  async function handleGoogleLogin() {
    setLoading(true);
    setError('');
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signIn();
      const { idToken } = await GoogleSignin.getTokens();

      const credential = GoogleAuthProvider.credential(idToken);
      const result     = await signInWithCredential(auth, credential);
      const user       = result.user;

      await setDoc(doc(db, 'users', user.uid), {
        displayName: user.displayName ?? 'Blader',
        email:       user.email ?? '',
        photoURL:    user.photoURL ?? '',
        updatedAt:   serverTimestamp(),
      }, { merge: true });

    } catch (e) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled — no error shown
      } else if (e.code === statusCodes.IN_PROGRESS) {
        setError('Ya hay un inicio de sesión en progreso');
      } else if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError('Google Play Services no disponible');
      } else {
        console.error(e);
        setError('Error al iniciar sesión. Inténtalo de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        <Text style={s.logo}>MXBBL</Text>
        <Text style={s.sub}>LIGA MEXICANA</Text>

        <Animated.View style={[s.ring, { transform: [{ rotate: spin }] }]} />

        {!!error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity style={s.btn} onPress={handleGoogleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#1a1a2e" />
          ) : (
            <View style={s.btnInner}>
              <Text style={s.gIcon}>G</Text>
              <Text style={s.btnText}>Continuar con Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={s.terms}>
          Al continuar aceptas nuestra{' '}
          <Text
            style={s.termsLink}
            onPress={() => Linking.openURL('https://jgutierrezg.github.io/bbmxleague/privacy-policy.html')}
          >
            Política de Privacidad
          </Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  inner:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  logo:      { fontSize: 56, fontWeight: '900', color: '#fff', letterSpacing: 6 },
  sub:       { fontSize: 11, letterSpacing: 6, color: '#555', marginTop: 4, marginBottom: 48 },
  ring:      {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 3, borderColor: '#e63946',
    borderTopColor: 'transparent', marginBottom: 48,
  },
  errorBox:  { backgroundColor: '#1a0a0e', borderWidth: 1, borderColor: '#e63946', borderRadius: 10, padding: 10, marginBottom: 16, width: '100%' },
  errorText: { color: '#e63946', fontSize: 12, textAlign: 'center' },
  btn:       { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 16 },
  btnInner:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gIcon:     { fontSize: 16, fontWeight: '900', color: '#4285F4' },
  btnText:   { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  terms:     { fontSize: 12, color: '#444', textAlign: 'center' },
  termsLink: { color: '#e63946', textDecorationLine: 'underline' },
});
