// Auth adapter — Firebase wiring goes here once credentials are provided.
//
// The Landing page calls these functions; replace each body with the real
// Firebase Auth call. Keep the return shape so the UI keeps working.

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export class AuthNotConfiguredError extends Error {
  constructor() {
    super('Sign-in is not configured yet. Please use Quick join for now.');
    this.name = 'AuthNotConfiguredError';
  }
}

export const isAuthConfigured = false;

export async function signInWithGoogle(): Promise<AuthUser> {
  throw new AuthNotConfiguredError();
}

export async function signInWithEmail(_email: string, _password: string): Promise<AuthUser> {
  throw new AuthNotConfiguredError();
}

export async function signUpWithEmail(_email: string, _password: string): Promise<AuthUser> {
  throw new AuthNotConfiguredError();
}
