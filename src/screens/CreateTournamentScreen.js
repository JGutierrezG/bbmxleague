import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator
} from 'react-native';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const TOTAL_STEPS = 3;

function pow2(n) { let p = 1; while (p < n) p *= 2; return p; }

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'BEY-';
  for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function CreateTournamentScreen({ navigation }) {
  const [step, setStep]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm]     = useState({
    name:         '',
    desc:         '',
    format:       'grupos',
    advancePer:   2,
    crossingMode: 'cruzado',
    matchPoints:  5,
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const adj = (key, delta, min, max) => set(key, Math.min(max, Math.max(min, form[key] + delta)));

  async function handleCreate() {
    setLoading(true);
    try {
      const inviteCode = generateInviteCode();
      const ref = await addDoc(collection(db, 'tournaments'), {
        name:         form.name.trim(),
        desc:         form.desc.trim(),
        format:       form.format,
        advancePer:   form.advancePer,
        crossingMode: form.crossingMode,
        matchPoints:  form.matchPoints,
        status:       'registration',
        inviteCode,
        createdBy:    auth.currentUser.uid,
        createdAt:    serverTimestamp(),
      });
      navigation.replace('PreRegistro', { tournamentId: ref.id });
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }

  // ── STEPS ──
  function Step0() {
    return (
      <>
        <Text style={s.stepNum}>Paso 1 de 3</Text>
        <Text style={s.stepTitle}>INFORMACIÓN BÁSICA</Text>
        <Text style={s.label}>Nombre del torneo</Text>
        <TextInput
          style={s.input}
          placeholder="Ej. Liga CDMX Temporada 3"
          placeholderTextColor="#444"
          value={form.name}
          onChangeText={v => set('name', v)}
        />
        <Text style={s.label}>Descripción (opcional)</Text>
        <TextInput
          style={s.input}
          placeholder="Añade contexto para los jugadores"
          placeholderTextColor="#444"
          value={form.desc}
          onChangeText={v => set('desc', v)}
        />
        <Text style={s.label}>Formato</Text>
        <View style={s.optRow}>
          <TouchableOpacity
            style={[s.opt, form.format === 'grupos' && s.optSel]}
            onPress={() => set('format', 'grupos')}
          >
            <Text style={[s.optTitle, form.format === 'grupos' && s.optTitleSel]}>Grupos + Elim.</Text>
            <Text style={s.optSub}>Recomendado</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.opt, s.optDisabled]}>
            <Text style={s.optTitle}>Eliminación</Text>
            <Text style={s.optSub}>Pronto</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  function Step1() {
    return (
      <>
        <Text style={s.stepNum}>Paso 2 de 3</Text>
        <Text style={s.stepTitle}>FASE ELIMINATORIA</Text>
        <Text style={s.label}>¿Cuántos clasifican por grupo?</Text>
        <View style={s.optRow}>
          {[1,2,3].map(n => (
            <TouchableOpacity
              key={n}
              style={[s.opt, form.advancePer === n && s.optSel]}
              onPress={() => set('advancePer', n)}
            >
              <Text style={[s.optTitle, form.advancePer === n && s.optTitleSel]}>Top {n}</Text>
              <Text style={s.optSub}>por grupo</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>Cruces del bracket</Text>
        <View style={s.optRow}>
          <TouchableOpacity
            style={[s.opt, form.crossingMode === 'cruzado' && s.optSel]}
            onPress={() => set('crossingMode', 'cruzado')}
          >
            <Text style={[s.optTitle, form.crossingMode === 'cruzado' && s.optTitleSel]}>Cruzado</Text>
            <Text style={s.optSub}>1°A vs 2°B</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.opt, form.crossingMode === 'ranking' && s.optSel]}
            onPress={() => set('crossingMode', 'ranking')}
          >
            <Text style={[s.optTitle, form.crossingMode === 'ranking' && s.optTitleSel]}>Por ranking</Text>
            <Text style={s.optSub}>General grupos</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  function Step2() {
    return (
      <>
        <Text style={s.stepNum}>Paso 3 de 3</Text>
        <Text style={s.stepTitle}>REGLAS DE JUEGO</Text>
        <Text style={s.label}>Puntos para ganar un match</Text>
        <Stepper val={form.matchPoints} onMinus={() => adj('matchPoints',-1,1,10)} onPlus={() => adj('matchPoints',1,1,10)} unit="puntos" />
        <View style={s.infoBox}>
          <Text style={s.infoText}>Aplica a todos los matches del torneo</Text>
        </View>
        <Text style={s.dividerLabel}>Resumen</Text>
        <View style={s.summaryCard}>
          {[
            ['Nombre',     form.name || '—'],
            ['Clasifican', `Top ${form.advancePer} por grupo`],
            ['Bracket',    form.crossingMode === 'cruzado' ? 'Cruzado' : 'Por ranking'],
            ['Meta/match', `${form.matchPoints} puntos`],
          ].map(([k, v]) => (
            <View key={k} style={s.summaryRow}>
              <Text style={s.summaryKey}>{k}</Text>
              <Text style={s.summaryVal}>{v}</Text>
            </View>
          ))}
        </View>
      </>
    );
  }

  const steps = [Step0, Step1, Step2];
  const canNext = step === 0 ? form.name.trim().length >= 2 : true;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.topbar}>
        <TouchableOpacity onPress={() => step > 0 ? setStep(step - 1) : navigation.goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.topTitle}>NUEVO TORNEO</Text>
        <Text style={s.stepInd}>{step + 1} / {TOTAL_STEPS}</Text>
      </View>

      {/* progress dots */}
      <View style={s.dots}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <View key={i} style={[s.dot, i < step && s.dotDone, i === step && s.dotActive]} />
        ))}
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {steps[step]()}
      </ScrollView>

      <View style={s.footer}>
        {step > 0 && (
          <TouchableOpacity style={s.btnPrev} onPress={() => setStep(step - 1)}>
            <Text style={s.btnPrevText}>←</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.btnNext, !canNext && s.btnDisabled]}
          disabled={!canNext || loading}
          onPress={() => step < TOTAL_STEPS - 1 ? setStep(step + 1) : handleCreate()}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnNextText}>{step < TOTAL_STEPS - 1 ? 'Siguiente' : 'Crear torneo'}</Text>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Stepper({ val, onMinus, onPlus, unit }) {
  return (
    <View style={s.stepper}>
      <TouchableOpacity style={s.stepperBtn} onPress={onMinus}>
        <Text style={s.stepperBtnText}>−</Text>
      </TouchableOpacity>
      <View style={s.stepperCenter}>
        <Text style={s.stepperVal}>{val}</Text>
        <Text style={s.stepperUnit}>{unit}</Text>
      </View>
      <TouchableOpacity style={s.stepperBtn} onPress={onPlus}>
        <Text style={s.stepperBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0a0a0f' },
  topbar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 16, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  back:          { fontSize: 22, color: '#555' },
  topTitle:      { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  stepInd:       { fontSize: 11, color: '#444', letterSpacing: 1 },
  dots:          { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  dot:           { width: 6, height: 6, borderRadius: 3, backgroundColor: '#222' },
  dotDone:       { backgroundColor: '#555' },
  dotActive:     { backgroundColor: '#e63946' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },
  stepNum:       { fontSize: 10, letterSpacing: 3, color: '#555', textTransform: 'uppercase', marginBottom: 2 },
  stepTitle:     { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 2, marginBottom: 20 },
  label:         { fontSize: 11, letterSpacing: 3, color: '#555', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  input:         { backgroundColor: '#12121a', borderWidth: 0.5, borderColor: '#222', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 16 },
  optRow:        { flexDirection: 'row', gap: 8, marginBottom: 16 },
  opt:           { flex: 1, backgroundColor: '#12121a', borderWidth: 0.5, borderColor: '#222', borderRadius: 12, padding: 12, alignItems: 'center' },
  optSel:        { borderColor: '#e63946', backgroundColor: '#1a0a0e' },
  optDisabled:   { opacity: 0.3 },
  optTitle:      { fontSize: 12, fontWeight: '500', color: '#ccc', marginBottom: 2 },
  optTitleSel:   { color: '#e63946' },
  optSub:        { fontSize: 10, color: '#555' },
  stepper:       { flexDirection: 'row', backgroundColor: '#12121a', borderWidth: 0.5, borderColor: '#222', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  stepperBtn:    { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText:{ fontSize: 22, color: '#666' },
  stepperCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepperVal:    { fontSize: 24, fontWeight: '900', color: '#fff' },
  stepperUnit:   { fontSize: 10, color: '#555', marginTop: 2 },
  infoBox:       { backgroundColor: '#0a1a2e', borderWidth: 0.5, borderColor: '#0d2a4a', borderRadius: 10, padding: 10, marginBottom: 16 },
  infoText:      { fontSize: 12, color: '#4a7a9d' },
  infoHi:        { color: '#6aaccd', fontWeight: '600' },
  dividerLabel:  { fontSize: 10, letterSpacing: 3, color: '#555', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  summaryCard:   { backgroundColor: '#12121a', borderWidth: 0.5, borderColor: '#1e1e2e', borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
  summaryRow:    { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  summaryKey:    { fontSize: 12, color: '#555' },
  summaryVal:    { fontSize: 12, fontWeight: '500', color: '#ccc' },
  footer:        { padding: 16, paddingBottom: 28, borderTopWidth: 0.5, borderTopColor: '#111', flexDirection: 'row', gap: 8 },
  btnPrev:       { width: 48, backgroundColor: '#111', borderWidth: 0.5, borderColor: '#1e1e2e', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnPrevText:   { fontSize: 20, color: '#666' },
  btnNext:       { flex: 1, backgroundColor: '#e63946', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnDisabled:   { opacity: 0.35 },
  btnNextText:   { fontSize: 14, fontWeight: '600', color: '#fff' },
});
