/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState } from './types';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, collection, setDoc, addDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export type SyncRole = 'HOST' | 'CLIENT';

export interface SyncMessage {
  type: 'STATE_UPDATE' | 'CLIENT_SUBMIT' | 'CLIENT_CONNECT' | 'PING';
  gameState?: GameState;
  playerId?: string;
  beans?: number;
  playerName?: string;
  timestamp: number;
}

export class SyncBridge {
  private roomCode: string = '';
  private role: SyncRole = 'HOST';
  private onStateReceived: (state: GameState) => void;
  private onClientEvent: (event: { type: string; playerId: string; beans?: number; name?: string }) => void;
  private onError?: (error: Error) => void;
  private unsubscribeRoom: (() => void) | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private isConnected: boolean = true;

  constructor(
    roomCode: string,
    role: SyncRole,
    onStateReceived: (state: GameState) => void,
    onClientEvent: (event: { type: string; playerId: string; beans?: number; name?: string }) => void,
    onError?: (error: Error) => void
  ) {
    this.roomCode = roomCode;
    this.role = role;
    this.onStateReceived = onStateReceived;
    this.onClientEvent = onClientEvent;
    this.onError = onError;

    this.initLocalStorageSync();
    this.initFirestoreSync();
  }

  // 1. LocalStorage Sync - Same device cross-tab fallback
  private initLocalStorageSync() {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `beans_dilemma_state_${this.roomCode}`) {
        if (e.newValue) {
          try {
            const state: GameState = JSON.parse(e.newValue);
            if (this.role === 'CLIENT') {
              this.onStateReceived(state);
            }
          } catch (err) {
            console.error('Failed to parse localStorage state:', err);
          }
        }
      } else if (e.key === `beans_dilemma_action_${this.roomCode}` && this.role === 'HOST') {
        if (e.newValue) {
          try {
            const action = JSON.parse(e.newValue);
            this.onClientEvent(action);
          } catch (err) {
            console.error('Failed to parse localStorage action:', err);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
  }

  // 2. Firestore Sync - Cross-device and cross-network synchronizer
  private initFirestoreSync() {
    try {
      const roomRef = doc(db, 'rooms', this.roomCode);

      if (this.role === 'HOST') {
        // HOST listens to transactions submitted by clients in the events sub-collection
        const eventsColl = collection(db, 'rooms', this.roomCode, 'events');
        this.unsubscribeEvents = onSnapshot(eventsColl, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const data = change.doc.data();
              this.onClientEvent({
                type: data.type === 'CLIENT_SUBMIT' ? 'SUBMIT_BEANS' : 'CLIENT_CONNECT',
                playerId: data.playerId,
                beans: data.beans,
                name: data.playerName
              });
              // Consume and delete client transactional event to avoid dual execution
              deleteDoc(change.doc.ref).catch((err) => {
                console.error('Failed to delete processed event document:', err);
                this.onError?.(err);
              });
            }
          });
        }, (err) => {
          console.error('Firestore events subscription error:', err);
          this.isConnected = false;
          this.onError?.(err);
        });

        // HOST also listens to state updates (supports multi-host projector and persistence sync)
        this.unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
          if (snapshot.exists()) {
            const state = snapshot.data() as GameState;
            this.onStateReceived(state);
          }
        }, (err) => {
          console.error('Firestore room state subscription error (HOST):', err);
          this.isConnected = false;
          this.onError?.(err);
        });

      } else {
        // CLIENTs listen to the consolidated GameState published by host
        this.unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
          if (snapshot.exists()) {
            const state = snapshot.data() as GameState;
            this.onStateReceived(state);
          }
        }, (err) => {
          console.error('Firestore room state subscription error (CLIENT):', err);
          this.isConnected = false;
          this.onError?.(err);
        });

        // Announce client connection so the Host re-broadcasts the updated ledger/ready flag
        this.sendClientAction({
          type: 'CLIENT_CONNECT',
          playerId: `client_${Math.random().toString(16).slice(2, 10)}`,
          name: '태블릿 대기'
        });
      }
    } catch (err) {
      console.error('Firestore sync setup failed:', err);
      this.isConnected = false;
      this.onError?.(err as Error);
    }
  }

  // Broadcast entire state (Called by HOST)
  public broadcastState(state: GameState) {
    // 1. Maintain instant localStorage state
    try {
      localStorage.setItem(`beans_dilemma_state_${this.roomCode}`, JSON.stringify(state));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }

    // 2. Publish updated complete state to Firestore
    try {
      const roomRef = doc(db, 'rooms', this.roomCode);
      setDoc(roomRef, state).catch((err) => {
        console.error('Firestore setDoc failed inside broadcastState:', err);
        this.onError?.(err);
      });
    } catch (e) {
      console.error('Firestore broadcast write failed:', e);
      this.onError?.(e as Error);
    }
  }

  // Send action to Host (Called by CLIENT)
  public sendClientAction(action: { type: 'CLIENT_SUBMIT' | 'CLIENT_CONNECT'; playerId: string; beans?: number; name?: string }) {
    // 1. Update localStorage for same-device cross-tab testing
    try {
      localStorage.setItem(
        `beans_dilemma_action_${this.roomCode}`,
        JSON.stringify({
          type: action.type === 'CLIENT_SUBMIT' ? 'SUBMIT_BEANS' : 'CLIENT_CONNECT',
          playerId: action.playerId,
          beans: action.beans,
          name: action.name
        })
      );
      // Quickly clear to raise new storage events
      setTimeout(() => localStorage.removeItem(`beans_dilemma_action_${this.roomCode}`), 50);
    } catch (e) {
      console.warn('LocalStorage action write failed:', e);
    }

    // 2. Add as distinct transactional auto-ID document in subcollection
    try {
      const eventsColl = collection(db, 'rooms', this.roomCode, 'events');
      addDoc(eventsColl, {
        type: action.type,
        playerId: action.playerId,
        beans: action.beans ?? 0,
        playerName: action.name ?? '',
        timestamp: Date.now()
      }).catch((err) => {
        console.error('Firestore addDoc failed inside sendClientAction:', err);
        this.onError?.(err);
      });
    } catch (e) {
      console.error('Firestore event dispatch failed:', e);
      this.onError?.(e as Error);
    }
  }

  // Get Connection Status
  public getBrokerStatus(): boolean {
    return this.isConnected;
  }

  // Cleanup connections and listeners
  public destroy() {
    if (this.unsubscribeRoom) {
      try {
        this.unsubscribeRoom();
      } catch (e) {
        // ignore
      }
    }
    if (this.unsubscribeEvents) {
      try {
        this.unsubscribeEvents();
      } catch (e) {
        // ignore
      }
    }
  }
}
