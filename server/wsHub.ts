import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { resolveUserFromToken } from '../src/middleware/auth.ts';
import type {
  CallParticipantInfo,
  ChatMessageItem,
  FacultyDelayAlertItem,
  OdLeaveRequestItem,
  PowerBoostAcknowledgementItem,
  UserProfile,
} from '../src/types.ts';

interface ConnectedClient {
  socketId: string;
  ws: WebSocket;
  user: UserProfile;
  groupId: number | null;
  callGroupId: number | null;
  callState: {
    callMode: 'audio' | 'video';
    micMuted: boolean;
    cameraOff: boolean;
    screenSharing: boolean;
    handRaised: boolean;
  };
}

class ChatWebSocketHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ConnectedClient>();
  private socketsById = new Map<string, ConnectedClient>();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws) => {
      ws.on('message', async (raw) => {
        try {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            groupId?: number;
            targetSocketId?: string;
            callMode?: 'audio' | 'video';
            micMuted?: boolean;
            cameraOff?: boolean;
            screenSharing?: boolean;
            handRaised?: boolean;
            sdp?: unknown;
            candidate?: unknown;
          };

          if (payload.type === 'auth' && typeof payload.token === 'string') {
            const user = await resolveUserFromToken(payload.token);
            if (!user || user.status !== 'approved') {
              ws.send(JSON.stringify({ type: 'auth:error', error: 'Unauthorized' }));
              ws.close(4001, 'Unauthorized');
              return;
            }
            const socketId = crypto.randomUUID();
            const client: ConnectedClient = {
              socketId,
              ws,
              user,
              groupId: typeof payload.groupId === 'number' ? payload.groupId : null,
              callGroupId: null,
              callState: {
                callMode: 'video',
                micMuted: false,
                cameraOff: false,
                screenSharing: false,
                handRaised: false,
              },
            };
            this.clients.set(ws, client);
            this.socketsById.set(socketId, client);
            ws.send(
              JSON.stringify({
                type: 'auth:ok',
                userId: user.id,
                socketId,
                activeCalls: this.getActiveCallsSnapshot(),
              })
            );
            this.broadcastPresence();
            return;
          }

          const client = this.clients.get(ws);
          if (!client) return;

          if (payload.type === 'join:group' && typeof payload.groupId === 'number') {
            client.groupId = payload.groupId;
            this.broadcastPresence();
          } else if (payload.type === 'typing' && client.groupId) {
            this.broadcastToGroup(
              client.groupId,
              {
                type: 'typing',
                groupId: client.groupId,
                userId: client.user.id,
                userName: client.user.fullName,
              },
              ws
            );
          } else if (payload.type === 'call:join' && typeof payload.groupId === 'number') {
            const prevCallGroup = client.callGroupId;
            const callMode = payload.callMode === 'audio' ? 'audio' : 'video';
            client.callGroupId = payload.groupId;
            client.callState = {
              callMode,
              micMuted: Boolean(payload.micMuted),
              cameraOff: callMode === 'audio' ? true : Boolean(payload.cameraOff),
              screenSharing: false,
              handRaised: false,
            };

            if (prevCallGroup && prevCallGroup !== payload.groupId) {
              this.broadcastCallRoomUpdate(prevCallGroup);
            }

            // Send existing peers in this call room to the joiner so joiner initiates WebRTC offers
            const peers = this.getCallRoomParticipants(payload.groupId).filter(
              (p) => p.socketId !== client.socketId
            );
            ws.send(
              JSON.stringify({
                type: 'call:joined',
                groupId: payload.groupId,
                socketId: client.socketId,
                peers,
              })
            );

            this.broadcastCallRoomUpdate(payload.groupId);
          } else if (payload.type === 'call:leave') {
            const leftGroup = client.callGroupId;
            if (leftGroup !== null) {
              client.callGroupId = null;
              client.callState.screenSharing = false;
              client.callState.handRaised = false;
              this.broadcastCallPeerLeft(leftGroup, client.socketId);
              this.broadcastCallRoomUpdate(leftGroup);
            }
          } else if (payload.type === 'call:state' && client.callGroupId !== null) {
            if (typeof payload.micMuted === 'boolean') client.callState.micMuted = payload.micMuted;
            if (typeof payload.cameraOff === 'boolean') client.callState.cameraOff = payload.cameraOff;
            if (typeof payload.screenSharing === 'boolean') {
              client.callState.screenSharing = payload.screenSharing;
            }
            if (typeof payload.handRaised === 'boolean') {
              client.callState.handRaised = payload.handRaised;
            }
            this.broadcastCallRoomUpdate(client.callGroupId);
          } else if (
            (payload.type === 'call:offer' ||
              payload.type === 'call:answer' ||
              payload.type === 'call:ice') &&
            typeof payload.targetSocketId === 'string' &&
            client.callGroupId !== null
          ) {
            const target = this.socketsById.get(payload.targetSocketId);
            if (
              target &&
              target.callGroupId === client.callGroupId &&
              target.ws.readyState === WebSocket.OPEN
            ) {
              target.ws.send(
                JSON.stringify({
                  type: payload.type,
                  groupId: client.callGroupId,
                  fromSocketId: client.socketId,
                  fromParticipant: this.toParticipantInfo(client),
                  sdp: payload.sdp,
                  candidate: payload.candidate,
                })
              );
            }
          }
        } catch {
          // Ignore malformed client frames
        }
      });

      ws.on('close', () => {
        const client = this.clients.get(ws);
        if (client) {
          this.clients.delete(ws);
          this.socketsById.delete(client.socketId);
          if (client.callGroupId !== null) {
            this.broadcastCallPeerLeft(client.callGroupId, client.socketId);
            this.broadcastCallRoomUpdate(client.callGroupId);
          }
          this.broadcastPresence();
        }
      });

      ws.on('error', () => {
        const client = this.clients.get(ws);
        if (client) {
          this.clients.delete(ws);
          this.socketsById.delete(client.socketId);
          if (client.callGroupId !== null) {
            this.broadcastCallPeerLeft(client.callGroupId, client.socketId);
            this.broadcastCallRoomUpdate(client.callGroupId);
          }
        }
      });
    });
  }

  private toParticipantInfo(client: ConnectedClient): CallParticipantInfo {
    return {
      socketId: client.socketId,
      userId: client.user.id,
      fullName: client.user.fullName,
      role: client.user.role,
      callMode: client.callState.callMode,
      micMuted: client.callState.micMuted,
      cameraOff: client.callState.cameraOff,
      screenSharing: client.callState.screenSharing,
      handRaised: client.callState.handRaised,
    };
  }

  getCallRoomParticipants(groupId: number): CallParticipantInfo[] {
    const list: CallParticipantInfo[] = [];
    for (const c of this.clients.values()) {
      if (c.callGroupId === groupId && c.ws.readyState === WebSocket.OPEN) {
        list.push(this.toParticipantInfo(c));
      }
    }
    return list;
  }

  getActiveCallsSnapshot(): Record<string, CallParticipantInfo[]> {
    const result: Record<string, CallParticipantInfo[]> = {};
    for (const c of this.clients.values()) {
      if (c.callGroupId !== null && c.ws.readyState === WebSocket.OPEN) {
        const key = String(c.callGroupId);
        if (!result[key]) result[key] = [];
        result[key].push(this.toParticipantInfo(c));
      }
    }
    return result;
  }

  private broadcastCallRoomUpdate(groupId: number): void {
    const participants = this.getCallRoomParticipants(groupId);
    this.broadcastAll({
      type: 'call:room_update',
      groupId,
      participants,
    });
  }

  private broadcastCallPeerLeft(groupId: number, socketId: string): void {
    const frame = JSON.stringify({
      type: 'call:peer_left',
      groupId,
      socketId,
    });
    for (const c of this.clients.values()) {
      if (c.callGroupId === groupId && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(frame);
      }
    }
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  private broadcastPresence(): void {
    const onlineUsers = Array.from(
      new Map(
        Array.from(this.clients.values()).map((c) => [
          c.user.id,
          { id: c.user.id, fullName: c.user.fullName, role: c.user.role, groupId: c.groupId },
        ])
      ).values()
    );
    const frame = JSON.stringify({ type: 'presence:update', onlineUsers });
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(frame);
      }
    }
  }

  broadcastToGroup(groupId: number, event: Record<string, unknown>, exclude?: WebSocket): void {
    const frame = JSON.stringify(event);
    for (const c of this.clients.values()) {
      if (c.ws === exclude) continue;
      if (
        c.ws.readyState === WebSocket.OPEN &&
        (c.groupId === groupId || event.type === 'community:changed')
      ) {
        c.ws.send(frame);
      }
    }
  }

  broadcastAll(event: Record<string, unknown>): void {
    const frame = JSON.stringify(event);
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(frame);
      }
    }
  }

  emitMessageCreated(
    message: ChatMessageItem,
    meta?: { groupName?: string; communityName?: string }
  ): void {
    this.broadcastAll({
      type: 'message:created',
      message,
      groupName: meta?.groupName ?? '',
      communityName: meta?.communityName ?? '',
    });
  }

  emitMessageUpdated(message: ChatMessageItem): void {
    this.broadcastAll({ type: 'message:updated', message });
  }

  emitMessageDeleted(groupId: number, messageId: number): void {
    this.broadcastAll({ type: 'message:deleted', groupId, messageId });
  }

  emitCommunityChanged(): void {
    this.broadcastAll({ type: 'community:changed' });
  }

  emitPowerBoostAcknowledged(
    groupId: number,
    messageId: number,
    acknowledgement: PowerBoostAcknowledgementItem
  ): void {
    this.broadcastAll({
      type: 'power_boost:acknowledged',
      groupId,
      messageId,
      acknowledgement,
    });
  }

  emitPowerBoostStopped(groupId: number, messageId: number): void {
    this.broadcastAll({
      type: 'power_boost:stopped',
      groupId,
      messageId,
    });
  }

  emitFacultyDelayCreated(alert: FacultyDelayAlertItem): void {
    this.broadcastAll({
      type: 'faculty_delay:created',
      alert,
    });
  }

  emitFacultyDelayUpdated(alert: FacultyDelayAlertItem): void {
    this.broadcastAll({
      type: 'faculty_delay:updated',
      alert,
    });
  }

  emitOdLeaveCreated(request: OdLeaveRequestItem): void {
    this.broadcastAll({
      type: 'od_leave:created',
      request,
    });
  }

  emitOdLeaveUpdated(request: OdLeaveRequestItem): void {
    this.broadcastAll({
      type: 'od_leave:updated',
      request,
    });
  }

  emitSessionAttendanceAlert(payload: {
    subjectCode: string;
    subjectName: string;
    yearOfStudy: string;
    section: string;
    periodNumber: number;
    presentCount: number;
    expectedCount: number;
    ratePct: number;
    createdAt: string;
  }): void {
    this.broadcastAll({
      type: 'attendance:session_alert',
      alert: payload,
    });
  }

  emitLowAttendanceRisk(payload: {
    rollNo: string;
    studentName: string;
    yearOfStudy: string;
    section: string;
    cumulativeRate: number;
    presentCount: number;
    totalSessions: number;
    notifiedAt: string;
  }): void {
    this.broadcastAll({
      type: 'attendance:low_risk',
      risk: payload,
    });
  }

  emitGoalTrackerNudge(userIds: number[], isoDate: string): void {
    const idSet = new Set(userIds);
    const frame = JSON.stringify({
      type: 'goal:daily_nudge',
      isoDate,
      title: 'Academic Goal Tracker Check-in',
      body: 'You have not updated your weekly Academic Goal Tracker activity today. Open Overview to log progress.',
    });
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN && idSet.has(c.user.id)) {
        c.ws.send(frame);
      }
    }
  }
}

export const wsHub = new ChatWebSocketHub();

