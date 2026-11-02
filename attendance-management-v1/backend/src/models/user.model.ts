export interface UserRecord {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  created_at: string;
}

export interface PublicUser {
  username: string;
  email: string | null;
}

export interface SessionRecord {
  id: number;
  user_id: number;
  expires_at: string;
}
