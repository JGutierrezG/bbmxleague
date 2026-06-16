# MXBBL — Contexto del Proyecto

## Estado actual (junio 2026)

La app está **lista para subir al Play Store**. El AAB de producción fue generado exitosamente y probado en dispositivo físico (Samsung Galaxy S28B) vía USB. Las reglas de Firestore están endurecidas y desplegadas.

---

## Stack tecnológico

- **React Native 0.85.3 + Expo SDK 56** (managed workflow)
- **Firebase**: Auth (Google Sign-In), Firestore, Storage
- **EAS Build** para builds de producción Android
- **GitHub Pages** para política de privacidad
- **Repo público**: `https://github.com/JGutierrezG/bbmxleague`

## Identidades clave

| Campo | Valor |
|---|---|
| Nombre app | MXBBL |
| Package Android | `com.elpapa.mxbb` |
| Bundle ID iOS | `com.elpapa.mxbb` |
| Firebase Project | `beyxtournament` |
| EAS Project ID | `aede16b7-2ceb-4243-bcc5-c9b8a25a4249` |
| EAS Owner | `bolmack` |
| Web Client ID (Google) | `557197275610-s2t5nvimtqco32ds16dkectog834n9tj.apps.googleusercontent.com` |
| Play Store email | `bolmack7@gmail.com` |

---

## Arquitectura Firestore

```
/users/{uid}
  displayName, email, photoURL, beyName, updatedAt

/tournaments/{tournamentId}
  name, desc, format, numGroups, playersPerGroup, advancePer,
  crossingMode, matchPoints, status, inviteCode, createdBy,
  createdAt, participantUids[], refereeUids[], winnerId

  /participants/{id}
    uid?, name, beyName, source (manual|organizer|join), addedBy, addedAt

  /groups/{groupId}
    name, playerIds[], createdAt

    /matches/{matchId}
      player1Id, player2Id, score1, score2, faults1, faults2,
      roundsWon1, roundsWon2, currentRound, rounds[], status, log[]

  /bracket/{matchId}
    player1Id, player2Id, score1, score2, round, status, winnerId
```

**Status flow**: `registration` → `groups` → `bracket` → `finished`

---

## Pantallas

| Pantalla | Archivo | Descripción |
|---|---|---|
| Login | `LoginScreen.js` | Google Sign-In, link a política de privacidad |
| Home | `HomeScreen.js` | Lista torneos propios y en los que participa |
| Crear torneo | `CreateTournamentScreen.js` | Formulario nuevo torneo |
| Pre-registro | `PreRegistroScreen.js` | Gestión de participantes, búsqueda de usuarios registrados |
| Torneo | `TournamentScreen.js` | Tabs: Grupos, Bracket, Info |
| Match Scorer | `MatchScorerScreen.js` | Pantalla de marcador en vivo |
| Perfil | `ProfileScreen.js` | Foto, nombre, bey favorito |

---

## Permisos y roles

- **`canManage = isOrganizer || isReferee`** — patrón usado en app y Firestore Rules
- `isOrganizer`: `tournament.createdBy == currentUser.uid`
- `isReferee`: `tournament.refereeUids.includes(currentUser.uid)`
- Solo `canManage` puede: generar bracket, cerrar grupos, finalizar torneo, editar matches
- Cualquier usuario autenticado puede: leer torneos, unirse vía código, ver resultados

---

## google-services.json

- **NUNCA commitear** — repo es público
- Está en `.gitignore`
- Se entrega a EAS vía secret de tipo `file`:
  ```bash
  eas env:create --name GOOGLE_SERVICES_JSON --type file \
    --value ./google-services.json --environment production --visibility secret
  ```
- `app.config.js` lo referencia dinámicamente:
  ```js
  googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'
  ```
- SHA-1s registrados en Firebase para `com.elpapa.mxbb`:
  - WSL debug: `12:9C:5B:39:40:3B:B1:69:05:0D:44:05:5E:41:35:E1:F0:94:9E:15`
  - Windows debug: `59:48:C2:EC:78:D4:EE:BE:9C:11:FD:CB:1F:65:0E:CC:F6:2A:F1:12`
  - Release keystore EAS: `7B:65:27:CF:75:17:02:81:AF:59:A2:DE:29:DA:94:ED:C7:B2:9D:E8` y otros

---

## Builds

### Build de producción (Play Store)
```bash
eas build --platform android --profile production
```
- Genera AAB firmado con keystore de EAS
- `autoIncrement: true` en `eas.json` (versionCode sube automáticamente)
- Último AAB exitoso: `https://expo.dev/artifacts/eas/YgGs4yDGg2npPcrtoC1_ZPkMzv1kUJQKFYzecKJnFGw.aab`

### Test en dispositivo físico (USB)
```bash
# Prerrequisitos: USB debugging activado, adb autorizado
npx expo run:android           # compila e instala en el dispositivo conectado
adb reverse tcp:8082 tcp:8082  # redirige puerto para Metro
npx expo start --port 8082     # inicia bundler (en terminal separada)
```

---

## Firestore Rules

Reglas activas en producción (desplegadas con `npx firebase-tools deploy --only firestore:rules`):

- **Matches y bracket**: solo `canManage()` puede escribir
- **Participants crear**: `canManage()` O auto-registro (uid propio)
- **Participants editar/borrar**: solo `canManage()`
- **Tournaments update**: `canManage()` O solo tocar `participantUids` (join)

---

## Privacidad y Play Store

- **Política de privacidad**: `https://jgutierrezg.github.io/bbmxleague/privacy-policy.html`
- Repo GitHub Pages: `https://github.com/JGutierrezG/bbmxleague` (público)
- Archivos en `docs/privacy-policy.html` y `docs/index.html`
- Link clickeable en `LoginScreen.js` vía `Linking.openURL`

---

## Pendientes para publicar en Play Store

1. Subir el AAB a Google Play Console (sección Producción → Nueva versión)
2. Completar ficha: descripción, capturas de pantalla (mínimo 2), ícono 512x512
3. Cuestionario de clasificación de contenido
4. Formulario de seguridad de datos (recopilamos: nombre, email, foto vía Google)
5. Enviar para revisión (1–3 días)

## Opcional (futuro)
- Configurar `eas submit` con Service Account Key para uploads automáticos
- Build para iOS (necesita cuenta Apple Developer $99/año)
