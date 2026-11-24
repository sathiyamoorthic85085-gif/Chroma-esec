import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Hand,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import {
  ROLE_LABELS,
  type CallParticipantInfo,
  type UserProfile,
  type UserRole,
} from '../types';

export interface CallSignalFrame {
  type: 'call:joined' | 'call:offer' | 'call:answer' | 'call:ice' | 'call:peer_left';
  groupId: number;
  socketId?: string;
  peers?: CallParticipantInfo[];
  fromSocketId?: string;
  fromParticipant?: CallParticipantInfo;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface CommunityCallRoomProps {
  ws: WebSocket | null;
  mySocketId: string | null;
  groupId: number;
  groupName: string;
  communityName: string;
  initialMode: 'audio' | 'video';
  currentUser: UserProfile;
  participants: CallParticipantInfo[];
  signalQueue: CallSignalFrame[];
  onSignalsConsumed: (count: number) => void;
  onLeave: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function formatDuration(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function RemoteVideoTile({
  participant,
  stream,
}: {
  participant: CallParticipantInfo;
  stream?: MediaStream;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!stream) return;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {});
    }
  }, [stream]);

  const hasLiveVideo =
    Boolean(stream) &&
    stream!.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled) &&
    (!participant.cameraOff || participant.screenSharing);

  return (
    <div className="relative bg-slate-800 border border-slate-700 rounded-xl overflow-hidden aspect-video flex items-center justify-center">
      {hasLiveVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-2.5 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-indigo-600/90 text-white font-semibold text-lg flex items-center justify-center">
            {getInitials(participant.fullName)}
          </div>
          <div>
            <div className="text-sm font-medium text-white">{participant.fullName}</div>
            <div className="text-[11px] text-slate-400">
              {ROLE_LABELS[participant.role as UserRole] ?? participant.role}
            </div>
          </div>
        </div>
      )}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {participant.handRaised && (
        <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-amber-500 text-slate-950 text-[11px] font-semibold flex items-center gap-1">
          <Hand className="w-3.5 h-3.5" />
          Hand Raised
        </div>
      )}

      {participant.screenSharing && (
        <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium flex items-center gap-1">
          <Monitor className="w-3.5 h-3.5" />
          Presenting
        </div>
      )}

      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
        <div className="px-2.5 py-1 rounded-md bg-slate-950/75 text-white text-xs font-medium truncate">
          {participant.fullName}
        </div>
        <div className="flex items-center gap-1.5">
          {participant.micMuted ? (
            <span
              className="w-7 h-7 rounded-full bg-red-600/90 text-white flex items-center justify-center"
              title="Microphone muted"
            >
              <MicOff className="w-3.5 h-3.5" />
            </span>
          ) : (
            <span
              className="w-7 h-7 rounded-full bg-slate-950/70 text-emerald-400 flex items-center justify-center"
              title="Microphone active"
            >
              <Volume2 className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function CommunityCallRoom({
  ws,
  mySocketId,
  groupId,
  groupName,
  communityName,
  initialMode,
  currentUser,
  participants,
  signalQueue,
  onSignalsConsumed,
  onLeave,
}: CommunityCallRoomProps) {
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(initialMode === 'audio');
  const [screenSharing, setScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const sendWs = useCallback(
    (payload: Record<string, unknown>) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    },
    [ws]
  );

  // Elapsed meeting timer
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const cleanupPeer = useCallback((peerSocketId: string) => {
    const pc = peersRef.current.get(peerSocketId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peersRef.current.delete(peerSocketId);
    }
    pendingIceRef.current.delete(peerSocketId);
    setRemoteStreams((prev) => {
      if (!(peerSocketId in prev)) return prev;
      const next = { ...prev };
      delete next[peerSocketId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerSocketId: string): RTCPeerConnection => {
      const existing = peersRef.current.get(peerSocketId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current.set(peerSocketId, pc);

      const stream = localStreamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }
      }

      // If currently screen sharing, ensure the video track sent is the screen track
      const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (screenTrack) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(screenTrack).catch(() => {});
        } else if (screenStreamRef.current) {
          pc.addTrack(screenTrack, screenStreamRef.current);
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendWs({
            type: 'call:ice',
            targetSocketId: peerSocketId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const [inbound] = event.streams;
        if (inbound) {
          setRemoteStreams((prev) => ({ ...prev, [peerSocketId]: inbound }));
        } else {
          setRemoteStreams((prev) => {
            const current = prev[peerSocketId] ?? new MediaStream();
            current.addTrack(event.track);
            return { ...prev, [peerSocketId]: current };
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          cleanupPeer(peerSocketId);
        }
      };

      return pc;
    },
    [sendWs, cleanupPeer]
  );

  // Acquire local audio/video stream and join the WebSocket call room
  useEffect(() => {
    let cancelled = false;

    const initMediaAndJoin = async () => {
      let acquiredStream: MediaStream | null = null;
      let startCamOff = initialMode === 'audio';
      let startMicMuted = false;

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          acquiredStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video:
              initialMode === 'video'
                ? { width: { ideal: 1280 }, height: { ideal: 720 } }
                : false,
          });
        } catch {
          // Fallback to audio-only if camera fails
          try {
            acquiredStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false,
            });
            startCamOff = true;
            setMediaNotice('Camera unavailable — joined with microphone audio.');
          } catch {
            startCamOff = true;
            startMicMuted = true;
            setMediaNotice(
              'Microphone/camera permission denied — joined in listen-only mode.'
            );
          }
        }
      } else {
        startCamOff = true;
        startMicMuted = true;
        setMediaNotice('Media devices unavailable in this browser — listen-only mode.');
      }

      if (cancelled) {
        acquiredStream?.getTracks().forEach((t) => t.stop());
        return;
      }

      localStreamRef.current = acquiredStream;
      setCameraOff(startCamOff);
      setMicMuted(startMicMuted);

      if (localVideoRef.current && acquiredStream) {
        localVideoRef.current.srcObject = acquiredStream;
        localVideoRef.current.play().catch(() => {});
      }

      sendWs({
        type: 'call:join',
        groupId,
        callMode: initialMode,
        micMuted: startMicMuted,
        cameraOff: startCamOff,
      });
    };

    initMediaAndJoin();

    return () => {
      cancelled = true;
      sendWs({ type: 'call:leave' });
      for (const peerId of Array.from(peersRef.current.keys())) {
        cleanupPeer(peerId);
      }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    };
  }, [groupId, initialMode, sendWs, cleanupPeer]);

  // Process incoming WebRTC signaling frames from parent WebSocket
  useEffect(() => {
    if (signalQueue.length === 0) return;

    const batch = [...signalQueue];
    onSignalsConsumed(batch.length);

    const flushPendingIce = async (peerId: string, pc: RTCPeerConnection) => {
      const queued = pendingIceRef.current.get(peerId);
      if (!queued || queued.length === 0) return;
      pendingIceRef.current.delete(peerId);
      for (const cand of queued) {
        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
    };

    (async () => {
      for (const frame of batch) {
        if (frame.groupId !== groupId) continue;

        if (frame.type === 'call:joined' && Array.isArray(frame.peers)) {
          for (const peer of frame.peers) {
            if (peer.socketId === frame.socketId) continue;
            const pc = createPeerConnection(peer.socketId);
            try {
              const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
              });
              await pc.setLocalDescription(offer);
              sendWs({
                type: 'call:offer',
                targetSocketId: peer.socketId,
                sdp: offer,
              });
            } catch {
              // Ignore negotiation error for disconnected peer
            }
          }
        } else if (frame.type === 'call:offer' && frame.fromSocketId && frame.sdp) {
          const pc = createPeerConnection(frame.fromSocketId);
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(frame.sdp));
            await flushPendingIce(frame.fromSocketId, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWs({
              type: 'call:answer',
              targetSocketId: frame.fromSocketId,
              sdp: answer,
            });
          } catch {
            // Ignore stale offer
          }
        } else if (frame.type === 'call:answer' && frame.fromSocketId && frame.sdp) {
          const pc = peersRef.current.get(frame.fromSocketId);
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(frame.sdp));
              await flushPendingIce(frame.fromSocketId, pc);
            } catch {
              // Ignore stale answer
            }
          }
        } else if (frame.type === 'call:ice' && frame.fromSocketId && frame.candidate) {
          const pc = peersRef.current.get(frame.fromSocketId);
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(frame.candidate)).catch(() => {});
          } else {
            const list = pendingIceRef.current.get(frame.fromSocketId) ?? [];
            list.push(frame.candidate);
            pendingIceRef.current.set(frame.fromSocketId, list);
          }
        } else if (frame.type === 'call:peer_left' && frame.socketId) {
          cleanupPeer(frame.socketId);
        }
      }
    })();
  }, [signalQueue, groupId, onSignalsConsumed, createPeerConnection, sendWs, cleanupPeer]);

  const toggleMic = () => {
    const nextMuted = !micMuted;
    const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];
    for (const track of audioTracks) {
      track.enabled = !nextMuted;
    }
    setMicMuted(nextMuted);
    sendWs({ type: 'call:state', micMuted: nextMuted });
  };

  const toggleCamera = async () => {
    const nextOff = !cameraOff;
    if (!nextOff) {
      // Enable or acquire camera track
      const existingVideo = localStreamRef.current?.getVideoTracks()[0];
      if (existingVideo) {
        existingVideo.enabled = true;
      } else if (navigator.mediaDevices?.getUserMedia) {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          });
          const camTrack = camStream.getVideoTracks()[0];
          if (!localStreamRef.current) {
            localStreamRef.current = new MediaStream();
          }
          localStreamRef.current.addTrack(camTrack);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
            localVideoRef.current.play().catch(() => {});
          }
          // Renegotiate or replace video track for peers
          for (const [peerId, pc] of peersRef.current.entries()) {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) {
              await sender.replaceTrack(camTrack).catch(() => {});
            } else {
              pc.addTrack(camTrack, localStreamRef.current);
              const offer = await pc.createOffer().catch(() => null);
              if (offer) {
                await pc.setLocalDescription(offer).catch(() => {});
                sendWs({ type: 'call:offer', targetSocketId: peerId, sdp: offer });
              }
            }
          }
        } catch {
          setMediaNotice('Unable to activate camera — check browser camera permissions.');
          return;
        }
      }
    } else {
      const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
      for (const track of videoTracks) {
        track.enabled = false;
      }
    }

    setCameraOff(nextOff);
    sendWs({ type: 'call:state', cameraOff: nextOff });
  };

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    sendWs({ type: 'call:state', screenSharing: false });

    const camTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    for (const pc of peersRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(camTrack).catch(() => {});
      }
    }
  }, [sendWs]);

  const toggleScreenShare = async () => {
    if (screenSharing) {
      await stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaNotice('Screen sharing is not supported on this device/browser.');
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = displayStream;
      const screenTrack = displayStream.getVideoTracks()[0];
      screenTrack.onended = () => {
        stopScreenShare();
      };

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = displayStream;
        localVideoRef.current.play().catch(() => {});
      }

      for (const [peerId, pc] of peersRef.current.entries()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack).catch(() => {});
        } else {
          pc.addTrack(screenTrack, displayStream);
          const offer = await pc.createOffer().catch(() => null);
          if (offer) {
            await pc.setLocalDescription(offer).catch(() => {});
            sendWs({ type: 'call:offer', targetSocketId: peerId, sdp: offer });
          }
        }
      }

      setScreenSharing(true);
      sendWs({ type: 'call:state', screenSharing: true });
    } catch {
      // User cancelled screen picker
    }
  };

  const toggleHand = () => {
    const next = !handRaised;
    setHandRaised(next);
    sendWs({ type: 'call:state', handRaised: next });
  };

  const remoteParticipants = participants.filter((p) => p.socketId !== mySocketId);
  const totalCount = remoteParticipants.length + 1;
  const gridCols =
    totalCount <= 1
      ? 'grid-cols-1 max-w-2xl mx-auto'
      : totalCount === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : totalCount <= 4
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col">
      {/* Top Meet Header */}
      <header className="px-4 sm:px-6 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <h2 className="text-sm sm:text-base font-semibold truncate">{groupName}</h2>
            <span className="text-xs text-slate-400 hidden sm:inline truncate">
              · {communityName}
            </span>
          </div>
          <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5 flex items-center gap-3">
            <span>{initialMode === 'video' ? 'Group Video Meet' : 'Group Voice Call'}</span>
            <span>·</span>
            <span>{formatDuration(elapsedSec)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {totalCount} {totalCount === 1 ? 'participant' : 'participants'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onLeave}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap shrink-0"
        >
          <PhoneOff className="w-4 h-4" />
          Leave Call
        </button>
      </header>

      {mediaNotice && (
        <div className="px-4 sm:px-6 py-2 bg-amber-950/70 border-b border-amber-800/60 text-xs text-amber-200">
          {mediaNotice}
        </div>
      )}

      {/* Participant Grid */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 flex items-center justify-center">
        <div className={`w-full grid ${gridCols} gap-4`}>
          {/* Local Self Tile */}
          <div className="relative bg-slate-900 border border-slate-700 rounded-xl overflow-hidden aspect-video flex items-center justify-center">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${
                !cameraOff || screenSharing ? 'block' : 'hidden'
              }`}
            />
            {cameraOff && !screenSharing && (
              <div className="flex flex-col items-center gap-2.5 px-4 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-600 text-white font-semibold text-lg flex items-center justify-center">
                  {getInitials(currentUser.fullName)}
                </div>
                <div>
                  <div className="text-sm font-medium text-white">
                    {currentUser.fullName} (You)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {ROLE_LABELS[currentUser.role]}
                  </div>
                </div>
              </div>
            )}

            {handRaised && (
              <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-amber-500 text-slate-950 text-[11px] font-semibold flex items-center gap-1">
                <Hand className="w-3.5 h-3.5" />
                Hand Raised
              </div>
            )}

            {screenSharing && (
              <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium flex items-center gap-1">
                <Monitor className="w-3.5 h-3.5" />
                You are presenting
              </div>
            )}

            <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
              <div className="px-2.5 py-1 rounded-md bg-slate-950/75 text-white text-xs font-medium truncate">
                {currentUser.fullName} (You)
              </div>
              {micMuted && (
                <span className="w-7 h-7 rounded-full bg-red-600/90 text-white flex items-center justify-center">
                  <MicOff className="w-3.5 h-3.5" />
                </span>
              )}
            </div>
          </div>

          {/* Remote Participants */}
          {remoteParticipants.map((participant) => (
            <RemoteVideoTile
              key={participant.socketId}
              participant={participant}
              stream={remoteStreams[participant.socketId]}
            />
          ))}
        </div>
      </main>

      {/* Bottom Google Meet Control Dock */}
      <footer className="px-4 py-4 pb-safe border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-center gap-3 shrink-0">
        <button
          type="button"
          onClick={toggleMic}
          className={`min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
            micMuted
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-white'
          }`}
        >
          {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          {micMuted ? 'Unmute' : 'Mute'}
        </button>

        <button
          type="button"
          onClick={toggleCamera}
          className={`min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
            cameraOff
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-white'
          }`}
        >
          {cameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
          {cameraOff ? 'Turn On Camera' : 'Camera Off'}
        </button>

        <button
          type="button"
          onClick={toggleScreenShare}
          className={`min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
            screenSharing
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-white'
          }`}
        >
          {screenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
          {screenSharing ? 'Stop Sharing' : 'Share Screen'}
        </button>

        <button
          type="button"
          onClick={toggleHand}
          className={`min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
            handRaised
              ? 'bg-amber-500 hover:bg-amber-600 text-slate-950'
              : 'bg-slate-800 hover:bg-slate-700 text-white'
          }`}
        >
          <Hand className="w-4 h-4" />
          {handRaised ? 'Lower Hand' : 'Raise Hand'}
        </button>

        <button
          type="button"
          onClick={onLeave}
          className="min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white inline-flex items-center gap-2 transition-colors whitespace-nowrap"
        >
          <PhoneOff className="w-4 h-4" />
          End Call
        </button>
      </footer>
    </div>
  );
}
