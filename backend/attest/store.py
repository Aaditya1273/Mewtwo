"""SQLite persistence. Durable so nonce/claim state survives restarts (replay protection)."""

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  mission_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  ephemeral_pubkey TEXT NOT NULL,
  siws_message TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at REAL NOT NULL,
  expires_at REAL NOT NULL,
  started_at REAL,
  submitted_at REAL,
  chain_head BLOB NOT NULL,
  sgt_mint TEXT,
  eligibility_mode TEXT,
  evidence_root BLOB,
  receipt TEXT
);
CREATE TABLE IF NOT EXISTS checkpoints (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  idx INTEGER NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  foreground INTEGER NOT NULL,
  interactions INTEGER NOT NULL,
  response_ms INTEGER NOT NULL,
  hash BLOB NOT NULL,
  received_at REAL NOT NULL,
  PRIMARY KEY (session_id, idx)
);
-- One row per verified claim. identity_key = SGT mint (production) or dev:<wallet>.
CREATE TABLE IF NOT EXISTS claims (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  identity_key TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  seq INTEGER NOT NULL,          -- claim index today for this mission; part of the on-chain PDA seeds
  reward_base INTEGER NOT NULL,  -- reward reserved from the sponsor pool, in mint base units
  UNIQUE (identity_key, mission_id, day, seq)
);
CREATE INDEX IF NOT EXISTS claims_by_identity_day ON claims(identity_key, mission_id, day);
-- Sponsor deposits into the attestor's reward pool, verified on-chain. One row per transaction.
CREATE TABLE IF NOT EXISTS sponsor_deposits (
  signature TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  amount_base INTEGER NOT NULL,
  depositor TEXT,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  wallet TEXT PRIMARY KEY,
  xp INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  reputation INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_day INTEGER
);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    db = sqlite3.connect(path, check_same_thread=False)  # default mode: `with db:` is one transaction
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(SCHEMA)
    return db
