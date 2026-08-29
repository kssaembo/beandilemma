import Peer, { DataConnection } from 'peerjs';
import { GameState } from './types';

export type SyncRole = 'HOST' | 'CLIENT';
type ClientAction = { type: 'CLIENT_SUBMIT' | 'CLIENT_CONNECT'; playerId: string; beans?: number; name?: string; actionId?: string };
type WireMessage =
  | { type: 'STATE_UPDATE'; state: GameState; sentAt: number }
  | { type: 'CLIENT_ACTION'; action: ClientAction & { actionId: string }; sentAt: number }
  | { type: 'ADMIN_STATE'; state: GameState; sentAt: number }
  | { type: 'ACTION_ACK'; actionId: string; sentAt: number }
  | { type: 'REQUEST_STATE' | 'PING' | 'PONG'; sentAt: number };

const hostPeerId = (roomCode: string) => `beans-dilemma-${roomCode}-host`;
const checkpointKey = (roomCode: string) => `beans_dilemma_checkpoint_${roomCode}`;
const deviceKey = 'beans_dilemma_device_id';

function getDeviceId() {
  let id = localStorage.getItem(deviceKey);
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(deviceKey, id);
  }
  return id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
}

export function loadHostCheckpoint(roomCode: string): GameState | null {
  try {
    const raw = localStorage.getItem(checkpointKey(roomCode));
    return raw ? JSON.parse(raw) as GameState : null;
  } catch { return null; }
}

export class SyncBridge {
  private peer: Peer | null = null;
  private hostConnection: DataConnection | null = null;
  private clients = new Map<string, DataConnection>();
  private latestState: GameState | null = null;
  private pendingActions = new Map<string, WireMessage>();
  private processedActions = new Set<string>();
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private actionSequence = 0;
  private destroyed = false;
  private isConnected = false;

  constructor(
    private roomCode: string,
    private role: SyncRole,
    private onStateReceived: (state: GameState) => void,
    private onClientEvent: (event: { type: string; playerId: string; beans?: number; name?: string }) => void,
    private onError?: (error: Error) => void
  ) {
    if (role === 'HOST') {
      this.latestState = loadHostCheckpoint(roomCode);
      this.startHost();
    } else this.startClient();
    this.startHeartbeat();
  }

  private startHost() {
    this.peer = new Peer(hostPeerId(this.roomCode), { debug: 1 });
    this.peer.on('open', () => { this.isConnected = true; this.reconnectAttempt = 0; });
    this.peer.on('connection', connection => this.attachClient(connection));
    this.peer.on('disconnected', () => this.recoverPeer());
    this.peer.on('error', error => this.reportError(error));
  }

  private attachClient(connection: DataConnection) {
    connection.on('open', () => {
      this.clients.set(connection.peer, connection);
      this.isConnected = true;
      if (this.latestState) this.send(connection, { type: 'STATE_UPDATE', state: this.latestState, sentAt: Date.now() });
    });
    connection.on('data', data => this.handleHostMessage(connection, data as WireMessage));
    connection.on('close', () => this.clients.delete(connection.peer));
    connection.on('error', error => this.reportError(error));
  }

  private handleHostMessage(connection: DataConnection, message: WireMessage) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'PING') return this.send(connection, { type: 'PONG', sentAt: Date.now() });
    if (message.type === 'REQUEST_STATE' && this.latestState) {
      return this.send(connection, { type: 'STATE_UPDATE', state: this.latestState, sentAt: Date.now() });
    }
    if (message.type === 'ADMIN_STATE') {
      if (!this.latestState || message.state.lastUpdated >= this.latestState.lastUpdated) {
        this.latestState = message.state;
        localStorage.setItem(checkpointKey(this.roomCode), JSON.stringify(message.state));
        this.onStateReceived(message.state);
        const update: WireMessage = { type: 'STATE_UPDATE', state: message.state, sentAt: Date.now() };
        this.clients.forEach(client => this.send(client, update));
      }
      return;
    }
    if (message.type !== 'CLIENT_ACTION') return;
    const { action } = message;
    this.send(connection, { type: 'ACTION_ACK', actionId: action.actionId, sentAt: Date.now() });
    if (this.processedActions.has(action.actionId)) return;
    this.processedActions.add(action.actionId);
    if (this.processedActions.size > 1000) this.processedActions = new Set(Array.from(this.processedActions).slice(-500));
    this.onClientEvent({ type: action.type === 'CLIENT_SUBMIT' ? 'SUBMIT_BEANS' : 'CLIENT_CONNECT', playerId: action.playerId, beans: action.beans, name: action.name });
  }

  private startClient() {
    const peerId = `beans-dilemma-${this.roomCode}-${getDeviceId()}-${Math.random().toString(36).slice(2, 7)}`;
    this.peer = new Peer(peerId, { debug: 1 });
    this.peer.on('open', () => this.connectToHost());
    this.peer.on('disconnected', () => this.scheduleReconnect());
    this.peer.on('error', error => { this.reportError(error); this.scheduleReconnect(); });
  }

  private connectToHost() {
    if (!this.peer || this.destroyed) return;
    const connection = this.peer.connect(hostPeerId(this.roomCode), { reliable: true, serialization: 'json' });
    this.hostConnection = connection;
    connection.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempt = 0;
      this.send(connection, { type: 'REQUEST_STATE', sentAt: Date.now() });
      this.pendingActions.forEach(message => this.send(connection, message));
      this.sendClientAction({ type: 'CLIENT_CONNECT', playerId: `client_${getDeviceId()}`, name: '태블릿 연결' });
    });
    connection.on('data', data => this.handleClientMessage(data as WireMessage));
    connection.on('close', () => { this.isConnected = false; this.scheduleReconnect(); });
    connection.on('error', error => { this.reportError(error); this.scheduleReconnect(); });
  }

  private handleClientMessage(message: WireMessage) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'STATE_UPDATE') this.onStateReceived(message.state);
    else if (message.type === 'ACTION_ACK') this.pendingActions.delete(message.actionId);
    else if (message.type === 'PING' && this.hostConnection) this.send(this.hostConnection, { type: 'PONG', sentAt: Date.now() });
  }

  private scheduleReconnect() {
    if (this.destroyed || this.role !== 'CLIENT' || this.reconnectTimer !== null) return;
    this.isConnected = false;
    const delay = Math.min(10000, 1000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.peer?.open) this.connectToHost(); else this.recoverPeer();
    }, delay);
  }

  private recoverPeer() {
    if (this.destroyed) return;
    try {
      if (this.peer && !this.peer.destroyed) this.peer.reconnect();
      else if (this.role === 'CLIENT') this.startClient(); else this.startHost();
    } catch { if (this.role === 'CLIENT') this.scheduleReconnect(); }
  }

  private startHeartbeat() {
    this.heartbeatTimer = window.setInterval(() => {
      const ping: WireMessage = { type: 'PING', sentAt: Date.now() };
      if (this.role === 'HOST') this.clients.forEach(connection => { if (connection.open) this.send(connection, ping); });
      else if (this.hostConnection?.open) this.send(this.hostConnection, ping);
    }, 5000);
  }

  private send(connection: DataConnection, message: WireMessage) { if (connection.open) connection.send(message); }
  private reportError(error: unknown) {
    this.isConnected = false;
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  public broadcastState(state: GameState) {
    if (this.role !== 'HOST') {
      if (this.hostConnection?.open) this.send(this.hostConnection, { type: 'ADMIN_STATE', state, sentAt: Date.now() });
      return;
    }
    this.latestState = state;
    try { localStorage.setItem(checkpointKey(this.roomCode), JSON.stringify(state)); }
    catch (error) { console.warn('Host checkpoint save failed:', error); }
    const message: WireMessage = { type: 'STATE_UPDATE', state, sentAt: Date.now() };
    this.clients.forEach(connection => this.send(connection, message));
  }

  public sendClientAction(action: ClientAction) {
    if (this.role === 'HOST') {
      this.onClientEvent({ type: action.type === 'CLIENT_SUBMIT' ? 'SUBMIT_BEANS' : 'CLIENT_CONNECT', playerId: action.playerId, beans: action.beans, name: action.name });
      return;
    }
    const actionId = action.actionId || `${getDeviceId()}-${Date.now()}-${this.actionSequence++}`;
    const message: WireMessage = { type: 'CLIENT_ACTION', action: { ...action, actionId }, sentAt: Date.now() };
    this.pendingActions.set(actionId, message);
    if (this.hostConnection?.open) this.send(this.hostConnection, message);
  }

  public getBrokerStatus() { return this.isConnected; }
  public destroy() {
    this.destroyed = true;
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.hostConnection?.close();
    this.clients.forEach(connection => connection.close());
    this.clients.clear();
    this.peer?.destroy();
    this.isConnected = false;
  }
}

export async function deleteRoomDataFromFirestore(roomCode: string) { localStorage.removeItem(checkpointKey(roomCode)); }
export async function purgeAllRoomsDataFromFirestore() { /* WebRTC rooms are ephemeral. */ }
export async function autoPurgeStaleRooms(_maxAgeMinutes?: number) { /* No shared database exists. */ }
