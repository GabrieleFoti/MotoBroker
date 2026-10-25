// Login Cognito (email + password), niente account GitHub.
// Stesso pattern di bertoniassociati/src/admin/cognito.js.
import { CognitoUser, CognitoUserPool, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { CMS_CONFIG } from './config.js';

const pool = new CognitoUserPool({ UserPoolId: CMS_CONFIG.userPoolId, ClientId: CMS_CONFIG.clientId });

const STORAGE_KEY = 'motobroker-admin-session';

function saveSession(session, email) {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      email,
      idToken: session.getIdToken().getJwtToken(),
      accessToken: session.getAccessToken().getJwtToken(),
      refreshToken: session.getRefreshToken().getToken(),
      expiresAt: session.getIdToken().getExpiration() * 1000,
    })
  );
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function cognitoUserFor(email) {
  return new CognitoUser({ Username: email, Pool: pool });
}

// Risolve con { idToken } oppure rigetta con { code: 'NEW_PASSWORD_REQUIRED', cognitoUser }
// oppure rigetta con un Error normale (credenziali sbagliate, ecc).
export function login(email, password) {
  return new Promise((resolve, reject) => {
    const cognitoUser = cognitoUserFor(email);
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });
    cognitoUser.authenticateUser(authDetails, {
      onSuccess(session) {
        saveSession(session, email);
        resolve({ idToken: session.getIdToken().getJwtToken() });
      },
      onFailure(err) {
        reject(err);
      },
      newPasswordRequired() {
        // Cognito rifiuta il challenge se reinviamo attributi già impostati
        // ("Cannot modify an already provided email"): non rimandarne nessuno.
        const err = new Error('NEW_PASSWORD_REQUIRED');
        err.code = 'NEW_PASSWORD_REQUIRED';
        err.cognitoUser = cognitoUser;
        reject(err);
      },
    });
  });
}

export function completeNewPassword(cognitoUser, email, newPassword) {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess(session) {
        saveSession(session, email);
        resolve({ idToken: session.getIdToken().getJwtToken() });
      },
      onFailure(err) {
        reject(err);
      },
    });
  });
}

export function forgotPassword(email) {
  return new Promise((resolve, reject) => {
    cognitoUserFor(email).forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
      inputVerificationCode: () => resolve(),
    });
  });
}

export function confirmForgotPassword(email, code, newPassword) {
  return new Promise((resolve, reject) => {
    cognitoUserFor(email).confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

export function logout() {
  const current = pool.getCurrentUser();
  if (current) current.signOut();
  clearSession();
}

function refreshIfNeeded() {
  return new Promise((resolve, reject) => {
    const stored = loadSession();
    if (!stored) return reject(new Error('NOT_AUTHENTICATED'));
    // Rinnova se manca meno di 60s alla scadenza dell'idToken.
    if (stored.expiresAt - Date.now() > 60_000) return resolve(stored.idToken);

    const cognitoUser = cognitoUserFor(stored.email);
    const RefreshToken = { getToken: () => stored.refreshToken };
    cognitoUser.refreshSession(RefreshToken, (err, session) => {
      if (err) {
        clearSession();
        return reject(err);
      }
      saveSession(session, stored.email);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

// Token id valido (rinnovato se necessario). Rigetta se non autenticato o refresh fallito.
export async function getIdToken() {
  return refreshIfNeeded();
}

export function currentEmail() {
  const stored = loadSession();
  return stored ? stored.email : null;
}

export function isAuthenticated() {
  return !!loadSession();
}

// Messaggi d'errore in italiano, distinguendo i casi Cognito più comuni.
export function messageFor(err) {
  const name = err?.code || err?.name;
  if (name === 'NotAuthorizedException') {
    const m = err.message || '';
    if (/expired|temporary password has expired/i.test(m)) return 'La password temporanea è scaduta: chiedi un nuovo invito.';
    if (/session/i.test(m)) return 'Sessione scaduta: torna al login e accedi di nuovo con la password temporanea.';
    if (/Incorrect username or password/i.test(m)) return 'Email o password non corretti.';
    return 'Accesso non riuscito: ' + m;
  }
  if (name === 'UserNotFoundException') return 'Utente non trovato.';
  if (name === 'InvalidPasswordException') return 'Password non valida: ' + (err.message || '');
  if (name === 'CodeMismatchException') return 'Codice non corretto.';
  if (name === 'ExpiredCodeException') return 'Codice scaduto, richiedine un altro.';
  if (name === 'LimitExceededException') return 'Troppi tentativi, riprova più tardi.';
  return err?.message || 'Si è verificato un errore.';
}
